/**
 * laborForecastService.ts
 *
 * Labour Cost Analysis Engine — Module 06 / 08.
 *
 * Exposes two service methods:
 *
 *   getLaborForecast  — original forward-only projection (kept for backward
 *                       compatibility; existing tests continue to pass unchanged).
 *
 *   getLaborCostAnalysis — full date-range analysis covering historical
 *                          timesheet breakdown AND future forecast in one call.
 *                          Replaces getLaborForecast as the primary UI data source.
 *
 * Key design rules (non-negotiable):
 *
 *   EFFECTIVE-DATED RATES: The rate used for each shift is looked up using the
 *   shift's own clinic-local calendar date — never "today" — so a pay rise
 *   effective mid-window uses the correct rate for every shift before and after
 *   the change date.  Cache key = staffId + "::" + shiftLocalDate.
 *
 *   HISTORICAL COST: Approved/Pending cost uses ts.totalHoursWorked and the
 *   rate effective on ts.shiftDate (not today's rate).
 *
 *   PLANNING ESTIMATE: Approved + Pending Approval + Future Forecast.
 *   Excluded: Rejected, Requires Amendment, Incomplete, Missing.
 *
 *   GPM REDACTION: Callers without "payroll:rates:read" permission receive null
 *   for ALL cost fields — per-staff AND clinic-level aggregates (historical,
 *   future, planning estimate).  Hours and counts are always visible.
 *
 *   LEDGER SAFETY: All monetary values are accumulated as INTEGER AUD CENTS.
 *   Division by 100 is performed exclusively in the route serialisation layer.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { TimesheetRepository } from "../repositories/timesheetRepository.js";
import type { StaffPayRateRepository } from "../repositories/staffPayRateRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { EffectivePayRate } from "../types/payRate.js";
import type { StaffPayrollTrack, TimesheetEntry } from "../types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_HOURLY_RATE_CENTS: Readonly<Record<string, number>> = {
  standard: 5_000,
  overtime: 7_500,
  on_call:  6_250,
  training: 5_000,
};

const CLINIC_WIDE_FALLBACK_RATE_CENTS = 5_500;
const DEFAULT_OVERHEAD_MULTIPLIER = 1.15;
const HISTORICAL_LOOKBACK_DAYS = 30;
/** Maximum date range (inclusive days) accepted by getLaborCostAnalysis. */
const MAX_ANALYSIS_RANGE_DAYS = 365;

// ─────────────────────────────────────────────────────────────────────────────
// Original output types (getLaborForecast — preserved for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export type RoleLaborProjection = {
  role: string;
  totalScheduledHours: number;
  projectedBaseCost: number;
  projectedOverheadCost: number;
  totalProjectedCost: number;
  usingFallbackForSomeStaff: boolean;
};

export type LaborForecastSummary = {
  clinicId: string;
  forecastWindowDays: number;
  totalProjectedHours: number;
  totalProjectedBaseCost: number;
  totalProjectedOverheadCost: number;
  grandTotalProjectedCost: number;
  breakdownByRole: RoleLaborProjection[];
  anyStaffUsingFallback: boolean;
};

export type LaborForecastOptions = {
  forecastDays?: number;
  timezone?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// New output types (getLaborCostAnalysis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hours + costs for a single status bucket (all monetary values in integer AUD cents).
 * Cost fields are null when the caller lacks "payroll:rates:read".
 */
export type CostBreakdown = {
  hours: number;
  /** null when cost is redacted for the caller. */
  baseCostCents: number | null;
  /** null when cost is redacted for the caller. */
  superCostCents: number | null;
  /** null when cost is redacted for the caller. */
  totalCostCents: number | null;
};

/** Count + scheduled hours for exception categories (no cost). */
export type ExceptionSummary = {
  count: number;
  scheduledHours: number;
};

/** Full historical status breakdown for dates < today (null when no historical dates in range). */
export type HistoricalBreakdown = {
  approved: CostBreakdown;
  /** Pending Approval — timesheetStatus = "submitted". */
  pending: CostBreakdown;
  /** Rejected — excluded from planning estimate, shown for visibility. */
  rejected: CostBreakdown;
  /** Requires Amendment — excluded from planning estimate. */
  requiresAmendment: CostBreakdown;
  /** Draft hourly timesheets — incomplete, no cost. */
  incomplete: ExceptionSummary;
  /** Historical roster entries with no linked timesheet — no cost. */
  missing: ExceptionSummary;
};

/** Per-shiftType projection within the future forecast section. */
export type ShiftTypeProjection = {
  shiftType: string;
  projectedHours: number;
  /** null when cost is redacted for the caller. */
  baseCostCents: number | null;
  /** null when cost is redacted for the caller. */
  superCostCents: number | null;
  /** null when cost is redacted for the caller. */
  totalCostCents: number | null;
  usingFallbackForSomeStaff: boolean;
};

/** Future forecast section (null when no future dates in range). */
export type FutureForecastSection = {
  totalHours: number;
  /** null when cost is redacted for the caller. */
  baseCostCents: number | null;
  /** null when cost is redacted for the caller. */
  superCostCents: number | null;
  /** null when cost is redacted for the caller. */
  totalCostCents: number | null;
  anyStaffUsingFallback: boolean;
  breakdownByShiftType: ShiftTypeProjection[];
};

/**
 * Planning estimate = Approved + Pending Approval + Future Forecast.
 * All cost fields are null when the caller lacks "payroll:rates:read".
 */
export type PlanningEstimate = {
  /** null when cost is redacted for the caller. */
  approvedCostCents: number | null;
  /** null when cost is redacted for the caller. */
  pendingCostCents: number | null;
  /** null when cost is redacted for the caller. */
  futureCostCents: number | null;
  /** null when cost is redacted for the caller. */
  totalCostCents: number | null;
};

/**
 * Per-staff cost breakdown row.
 *
 * Rate and cost fields are null when the caller does not have "payroll:rates:read"
 * (i.e. a GPM without explicit payroll rate access).  Hours fields are always visible.
 */
export type StaffCostBreakdown = {
  staffUserId: string;
  staffEmail: string;
  // Hours — always visible
  approvedHours: number;
  pendingHours: number;
  rejectedHours: number;
  requiresAmendmentHours: number;
  incompleteCount: number;
  incompleteScheduledHours: number;
  missingShiftCount: number;
  missingScheduledHours: number;
  futureProjectedHours: number;
  // Rate info — null when redacted
  baseHourlyRateCents: number | null;
  superRatePercent: number | null;
  rateSource: "configured" | "fallback" | null;
  // Costs — null when redacted
  approvedCostCents: number | null;
  pendingCostCents: number | null;
  rejectedCostCents: number | null;
  requiresAmendmentCostCents: number | null;
  futureCostCents: number | null;
};

export type DataQuality = {
  hasIncompleteTimesheets: boolean;
  hasMissingTimesheets: boolean;
  hasRejectedTimesheets: boolean;
  hasRequiresAmendment: boolean;
};

export type LaborCostAnalysis = {
  clinicId: string;
  dateRange: { from: string; to: string; timezone: string };
  /** null when the date range contains no historical dates (entirely future). */
  historical: HistoricalBreakdown | null;
  /** null when the date range contains no future dates (entirely historical). */
  futureForecast: FutureForecastSection | null;
  planningEstimate: PlanningEstimate;
  staffBreakdown: StaffCostBreakdown[];
  dataQuality: DataQuality;
};

export type LaborCostAnalysisOptions = {
  /** Clinic-local YYYY-MM-DD start date (inclusive). */
  from: string;
  /** Clinic-local YYYY-MM-DD end date (inclusive). */
  to: string;
  /** IANA timezone string. Defaults to "Australia/Sydney". */
  timezone?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────────────

export type LaborForecastService = ReturnType<typeof createLaborForecastService>;

export function createLaborForecastService(
  rosterRepository: RosterRepository,
  timesheetRepository: TimesheetRepository,
  staffPayRateRepository?: StaffPayRateRepository,
  userRepository?: UserRepository,
) {
  // ── Internal helpers (closure scope) ─────────────────────────────────────

  function assertTenantAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (caller.role === "owner_admin") return;
    if (caller.homeClinicId !== clinicId) {
      throw new AppError(403, "TENANT_ACCESS_DENIED", "You do not have access to this clinic's forecast data");
    }
  }

  function assertFinancialAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(403, "INSUFFICIENT_PERMISSIONS", "Labor cost data is restricted to owner_admin and group_practice_manager");
    }
  }

  /**
   * Per-(staffId, shiftDate) rate cache shared across a single service call.
   * Returns the effective pay rate for the staff member on the given date string,
   * using the shift's own calendar date rather than today — ensuring pay rises
   * effective mid-window are applied to the correct shifts.
   *
   * IMPORTANT: This function must be constructed fresh for each service call
   * (via buildRateCache()) so the cache does not leak between requests.
   */
  function buildRateCache() {
    const cache = new Map<string, EffectivePayRate | null>();

    return async function getCachedRate(
      staffId: string,
      dateStr: string,
    ): Promise<EffectivePayRate | null> {
      if (!staffPayRateRepository) return null;
      const key = `${staffId}::${dateStr}`;
      if (cache.has(key)) return cache.get(key) ?? null;
      const rate = await staffPayRateRepository.findEffectiveRate(staffId, dateStr);
      cache.set(key, rate);
      return rate;
    };
  }

  // ── Exported service methods ───────────────────────────────────────────────

  return {
    // ── getLaborForecast (PRESERVED — backward compatible) ─────────────────
    /**
     * Forward-only projection. Kept for backward compatibility; existing tests
     * continue to pass unchanged.
     *
     * Rate lookup fix applied: each shift now uses its own clinic-local date as
     * the rate lookup key (per-shift, not per-staff with today's date).
     */
    async getLaborForecast(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: LaborForecastOptions,
    ): Promise<LaborForecastSummary> {
      assertTenantAccess(caller, clinicId);
      assertFinancialAccess(caller);

      const forecastDays = options?.forecastDays ?? 14;
      const timezone = options?.timezone ?? "Australia/Sydney";

      const now = new Date();
      const localNowStr = toLocalDateString(now, timezone);
      const localForecastEndStr = addCalendarDays(localNowStr, forecastDays);
      const localLookbackStartStr = addCalendarDays(localNowStr, -HISTORICAL_LOOKBACK_DAYS);
      const forecastEndUTC = localDayStartUTC(localForecastEndStr, timezone);

      // 1. Upcoming non-cancelled shifts
      const upcomingShifts = await rosterRepository.listByClinic(clinicId, {
        from: now,
        to: forecastEndUTC,
      });
      const activeShifts = upcomingShifts.filter((s) => s.status !== "cancelled");

      // 2. Historical timesheet calibration (approved hours per staff)
      const historicalTimesheets = await timesheetRepository.listByClinic(clinicId, {
        from: localLookbackStartStr,
        to: localNowStr,
        timesheetStatus: "approved",
      });

      const staffAccumulator = new Map<string, { totalHours: number; count: number }>();
      for (const ts of historicalTimesheets) {
        if (ts.totalHoursWorked === null || ts.totalHoursWorked <= 0) continue;
        const acc = staffAccumulator.get(ts.staffUserId) ?? { totalHours: 0, count: 0 };
        staffAccumulator.set(ts.staffUserId, {
          totalHours: acc.totalHours + ts.totalHoursWorked,
          count: acc.count + 1,
        });
      }

      const staffAvgHoursMap = new Map<string, number>();
      for (const [staffId, { totalHours, count }] of staffAccumulator) {
        staffAvgHoursMap.set(staffId, totalHours / count);
      }

      let clinicAvgHoursPerShift: number | null = null;
      {
        let clinicTotalHours = 0;
        let clinicShiftCount = 0;
        for (const [, { totalHours, count }] of staffAccumulator) {
          clinicTotalHours += totalHours;
          clinicShiftCount += count;
        }
        if (clinicShiftCount > 0) {
          clinicAvgHoursPerShift = clinicTotalHours / clinicShiftCount;
        }
      }

      const staffWithHistory = new Set(staffAvgHoursMap.keys());

      // 3. Clinic-wide fallback rate
      let clinicWideFallbackCents = CLINIC_WIDE_FALLBACK_RATE_CENTS;
      {
        let coveredRateSum = 0;
        let coveredRateCount = 0;
        for (const shift of activeShifts) {
          if (staffWithHistory.has(shift.staffUserId)) {
            coveredRateSum += DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? CLINIC_WIDE_FALLBACK_RATE_CENTS;
            coveredRateCount += 1;
          }
        }
        if (coveredRateCount > 0) {
          clinicWideFallbackCents = Math.round(coveredRateSum / coveredRateCount);
        }
      }

      // 3b. Per-shift rate cache (keyed by staffId + shiftLocalDate — not today)
      const getCachedRate = buildRateCache();

      // 4. Aggregate by shiftType
      const roleAccumulator = new Map<string, {
        projectedHours: number;
        hasHistoryCoverage: boolean;
        baseCostCents: number;
        overheadCostCents: number;
        usingFallbackForSomeStaff: boolean;
      }>();

      for (const shift of activeShifts) {
        const scheduledDurationMs = shift.shiftEndAt.getTime() - shift.shiftStartAt.getTime();
        const scheduledDurationHours = scheduledDurationMs / (1_000 * 60 * 60);

        let projectedHoursForShift: number;
        const staffAvg = staffAvgHoursMap.get(shift.staffUserId);
        if (staffAvg !== undefined) {
          projectedHoursForShift = staffAvg;
        } else if (clinicAvgHoursPerShift !== null) {
          projectedHoursForShift = clinicAvgHoursPerShift;
        } else {
          projectedHoursForShift = scheduledDurationHours;
        }

        // FIX: use the shift's own clinic-local date, not today's date.
        const shiftLocalDate = toLocalDateString(shift.shiftStartAt, timezone);
        const staffRate = await getCachedRate(shift.staffUserId, shiftLocalDate);

        let shiftBaseCostCents: number;
        let shiftOverheadCostCents: number;
        let shiftUsingFallback: boolean;

        if (staffRate) {
          const roundedShiftHours = round2dp(projectedHoursForShift);
          shiftBaseCostCents = Math.round(roundedShiftHours * staffRate.baseHourlyRateCents);
          shiftOverheadCostCents = Math.round(shiftBaseCostCents * staffRate.superRatePercent / 100);
          shiftUsingFallback = false;
        } else {
          let hourlyRateCents: number;
          if (staffPayRateRepository) {
            hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? clinicWideFallbackCents;
          } else {
            const hasHistory = staffWithHistory.has(shift.staffUserId);
            hourlyRateCents = hasHistory
              ? (DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? clinicWideFallbackCents)
              : clinicWideFallbackCents;
          }
          const roundedShiftHours = round2dp(projectedHoursForShift);
          shiftBaseCostCents = Math.round(roundedShiftHours * hourlyRateCents);
          shiftOverheadCostCents = Math.round(shiftBaseCostCents * (DEFAULT_OVERHEAD_MULTIPLIER - 1));
          shiftUsingFallback = true;
        }

        const existing = roleAccumulator.get(shift.shiftType) ?? {
          projectedHours: 0,
          hasHistoryCoverage: false,
          baseCostCents: 0,
          overheadCostCents: 0,
          usingFallbackForSomeStaff: false,
        };

        roleAccumulator.set(shift.shiftType, {
          projectedHours: existing.projectedHours + projectedHoursForShift,
          hasHistoryCoverage: existing.hasHistoryCoverage || staffWithHistory.has(shift.staffUserId),
          baseCostCents: existing.baseCostCents + shiftBaseCostCents,
          overheadCostCents: existing.overheadCostCents + shiftOverheadCostCents,
          usingFallbackForSomeStaff: existing.usingFallbackForSomeStaff || shiftUsingFallback,
        });
      }

      // 5. Build per-role projections
      const breakdownByRole: RoleLaborProjection[] = [];
      let totalProjectedHours = 0;
      let totalProjectedBaseCost = 0;
      let totalProjectedOverheadCost = 0;
      let grandTotalProjectedCost = 0;
      let anyStaffUsingFallback = false;

      for (const [shiftType, { projectedHours, baseCostCents, overheadCostCents, usingFallbackForSomeStaff }] of roleAccumulator) {
        const roundedHours = round2dp(projectedHours);
        const totalCostCents = baseCostCents + overheadCostCents;

        breakdownByRole.push({
          role: shiftType,
          totalScheduledHours: roundedHours,
          projectedBaseCost: baseCostCents,
          projectedOverheadCost: overheadCostCents,
          totalProjectedCost: totalCostCents,
          usingFallbackForSomeStaff,
        });

        totalProjectedHours = round2dp(totalProjectedHours + roundedHours);
        totalProjectedBaseCost += baseCostCents;
        totalProjectedOverheadCost += overheadCostCents;
        grandTotalProjectedCost += totalCostCents;
        if (usingFallbackForSomeStaff) anyStaffUsingFallback = true;
      }

      breakdownByRole.sort((a, b) => a.role.localeCompare(b.role));

      return {
        clinicId,
        forecastWindowDays: forecastDays,
        totalProjectedHours,
        totalProjectedBaseCost,
        totalProjectedOverheadCost,
        grandTotalProjectedCost,
        breakdownByRole,
        anyStaffUsingFallback,
      };
    },

    // ── getLaborCostAnalysis — primary method ──────────────────────────────
    /**
     * Full date-range labour cost analysis.
     *
     * Supports historical-only, future-only, or mixed ranges.
     *
     * Historical section: classifies timesheets by status (approved / pending /
     * rejected / requires_amendment / incomplete) and detects missing timesheets
     * via a single bulk roster-entry lookup.
     *
     * Future section: projects hours and costs using historical calibration and
     * effective-dated pay rates (rate looked up on the shift's own date, not today).
     *
     * Planning estimate = Approved + Pending Approval + Future Forecast.
     *
     * GPM redaction: callers without "payroll:rates:read" receive null for ALL
     * cost fields — both per-staff and clinic-level aggregates (historical,
     * future forecast, and planning estimate).  Hours and counts are always visible.
     */
    async getLaborCostAnalysis(
      caller: AuthenticatedUser,
      clinicId: string,
      options: LaborCostAnalysisOptions,
    ): Promise<LaborCostAnalysis> {
      assertTenantAccess(caller, clinicId);
      assertFinancialAccess(caller);

      const callerCanSeeRates = caller.permissions.includes("payroll:rates:read");
      const timezone = options.timezone ?? "Australia/Sydney";
      const { from: fromDate, to: toDate } = options;

      // Validate date range
      if (fromDate > toDate) {
        throw new AppError(400, "INVALID_DATE_RANGE", "from date must be on or before to date");
      }
      const rangeDays = daysBetween(fromDate, toDate);
      if (rangeDays > MAX_ANALYSIS_RANGE_DAYS) {
        throw new AppError(
          400,
          "DATE_RANGE_TOO_LARGE",
          `Date range must not exceed ${String(MAX_ANALYSIS_RANGE_DAYS)} days (requested ${String(rangeDays)})`,
        );
      }

      const now = new Date();
      const localTodayStr = toLocalDateString(now, timezone);

      // Historical: dates <= localTodayStr (inclusive today — TODAY IS HYBRID).
      // A shift today whose timesheet already exists is classified historically by
      // status; a shift today with no timesheet stays in Future Forecast.
      const hasHistorical = fromDate <= localTodayStr;
      const hasFuture = toDate >= localTodayStr;

      // UTC timestamps for roster queries (exclusive upper bound semantics)
      const fromUTC = localDayStartUTC(fromDate, timezone);
      const toExclusiveUTC = localDayStartUTC(addCalendarDays(toDate, 1), timezone);

      // Shared rate cache keyed by (staffId, shiftDate)
      const getCachedRate = buildRateCache();

      // Per-staff accumulator for the staff breakdown table
      type StaffAccum = {
        staffEmail: string;
        approvedHours: number;
        approvedBaseCents: number;
        approvedSuperCents: number;
        pendingHours: number;
        pendingBaseCents: number;
        pendingSuperCents: number;
        rejectedHours: number;
        rejectedTotalCents: number;
        requiresAmendmentHours: number;
        requiresAmendmentTotalCents: number;
        incompleteCount: number;
        incompleteScheduledHours: number;
        missingShiftCount: number;
        missingScheduledHours: number;
        futureProjectedHours: number;
        futureTotalCents: number;
        // Latest seen rate info (for the staff breakdown rate column)
        latestRateCents: number | null;
        latestSuperPercent: number | null;
        hasConfiguredRate: boolean;
        hasFallbackShift: boolean;
      };

      const staffMap = new Map<string, StaffAccum>();

      function ensureStaff(staffUserId: string, staffEmail: string): StaffAccum {
        if (!staffMap.has(staffUserId)) {
          staffMap.set(staffUserId, {
            staffEmail,
            approvedHours: 0, approvedBaseCents: 0, approvedSuperCents: 0,
            pendingHours: 0, pendingBaseCents: 0, pendingSuperCents: 0,
            rejectedHours: 0, rejectedTotalCents: 0,
            requiresAmendmentHours: 0, requiresAmendmentTotalCents: 0,
            incompleteCount: 0, incompleteScheduledHours: 0,
            missingShiftCount: 0, missingScheduledHours: 0,
            futureProjectedHours: 0, futureTotalCents: 0,
            latestRateCents: null, latestSuperPercent: null,
            hasConfiguredRate: false, hasFallbackShift: false,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return staffMap.get(staffUserId)!;
      }

      // Helper: compute cost for a timesheet entry using its historical rate
      async function historicalCost(
        ts: TimesheetEntry,
      ): Promise<{ baseCostCents: number; superCostCents: number }> {
        const hours = ts.totalHoursWorked ?? 0;
        if (hours <= 0) return { baseCostCents: 0, superCostCents: 0 };

        const rate = await getCachedRate(ts.staffUserId, ts.shiftDate);

        if (rate) {
          const baseCostCents = Math.round(round2dp(hours) * rate.baseHourlyRateCents);
          const superCostCents = Math.round(baseCostCents * rate.superRatePercent / 100);
          return { baseCostCents, superCostCents };
        }

        // Fallback: use standard default rate + 15% overhead
        const hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS["standard"] ?? CLINIC_WIDE_FALLBACK_RATE_CENTS;
        const baseCostCents = Math.round(round2dp(hours) * hourlyRateCents);
        const superCostCents = Math.round(baseCostCents * (DEFAULT_OVERHEAD_MULTIPLIER - 1));
        return { baseCostCents, superCostCents };
      }

      // ── Historical section ───────────────────────────────────────────────
      let historicalBreakdown: HistoricalBreakdown | null = null;
      // Raw (non-redacted) cost totals used to build planning estimate regardless of
      // whether the caller can see costs.
      let rawHistoricalApprovedCents = 0;
      let rawHistoricalPendingCents = 0;

      if (hasHistorical) {
        // Inclusive today: query timesheets up through clinic-local today so that
        // shifts which already have a linked timesheet are classified by status
        // (not left floating in the future forecast).
        const historicalToDate = toDate <= localTodayStr ? toDate : localTodayStr;

        // All hourly timesheets in the historical window (all statuses)
        const allHistoricalTs = await timesheetRepository.listByClinic(clinicId, {
          from: fromDate,
          to: historicalToDate,  // inclusive today
        });
        const hourlyTs = allHistoricalTs.filter(
          (ts) => ts.payrollType === "hourly_auto" || ts.payrollType === "hourly_manual",
        );

        // Historical non-cancelled roster entries — now includes today so we can
        // detect today's shifts as missing vs upcoming correctly in the loop below.
        const tomorrowStartUTC = localDayStartUTC(addCalendarDays(localTodayStr, 1), timezone);
        const historicalRosterShifts = await rosterRepository.listByClinic(clinicId, {
          from: fromUTC,
          to: tomorrowStartUTC,  // exclusive = start of tomorrow, so today is included
        });
        const historicalActiveRoster = historicalRosterShifts.filter(
          (s) => s.status !== "cancelled",
        );

        // Bulk lookup: rosterEntryId → timesheet (for missing detection)
        const rosterEntryIds = historicalActiveRoster.map((s) => s.id);
        const rosterTimesheetMap = await timesheetRepository.findByRosterEntryIds(rosterEntryIds);

        // Commission-track detection via the authoritative users.payroll_track column.
        // Batch-fetch all clinic staff records once if userRepository is injected.
        // If no userRepository is provided (e.g. unit tests that don't test commission
        // detection), the map is empty and all staff are treated as hourly — the
        // conservative fallback that produces more Missing alerts, never fewer.
        let staffPayrollTrackMap = new Map<string, StaffPayrollTrack>();
        if (userRepository) {
          const clinicUsers = await userRepository.listByClinic(clinicId);
          staffPayrollTrackMap = new Map(clinicUsers.map((u) => [u.id, u.payrollTrack]));
        }

        // Internal (non-redacted) accumulator
        type RawCostAccum = { hours: number; base: number; super_: number; total: number };
        const mkZero = (): RawCostAccum => ({ hours: 0, base: 0, super_: 0, total: 0 });
        const raw = {
          approved:          mkZero(),
          pending:           mkZero(),
          rejected:          mkZero(),
          requiresAmendment: mkZero(),
          incomplete:        { count: 0, scheduledHours: 0 },
          missing:           { count: 0, scheduledHours: 0 },
        };

        // Helper: build a public CostBreakdown from internal accumulator, applying redaction.
        function mkCostBreakdown(r: RawCostAccum): CostBreakdown {
          return {
            hours: r.hours,
            baseCostCents:  callerCanSeeRates ? r.base   : null,
            superCostCents: callerCanSeeRates ? r.super_ : null,
            totalCostCents: callerCanSeeRates ? r.total  : null,
          };
        }

        for (const ts of hourlyTs) {
          const sa = ensureStaff(ts.staffUserId, ts.staffEmail);

          if (ts.timesheetStatus === "approved" || ts.timesheetStatus === "processed") {
            const { baseCostCents, superCostCents } = await historicalCost(ts);
            const hours = ts.totalHoursWorked ?? 0;
            raw.approved.hours = round2dp(raw.approved.hours + hours);
            raw.approved.base   += baseCostCents;
            raw.approved.super_ += superCostCents;
            raw.approved.total  += baseCostCents + superCostCents;
            sa.approvedHours = round2dp(sa.approvedHours + hours);
            sa.approvedBaseCents += baseCostCents;
            sa.approvedSuperCents += superCostCents;

            // Track rate info for staff breakdown column
            const rate = await getCachedRate(ts.staffUserId, ts.shiftDate);
            if (rate) {
              sa.latestRateCents = rate.baseHourlyRateCents;
              sa.latestSuperPercent = rate.superRatePercent;
              sa.hasConfiguredRate = true;
            } else {
              sa.hasFallbackShift = true;
            }

          } else if (ts.timesheetStatus === "submitted") {
            const { baseCostCents, superCostCents } = await historicalCost(ts);
            const hours = ts.totalHoursWorked ?? 0;
            raw.pending.hours = round2dp(raw.pending.hours + hours);
            raw.pending.base   += baseCostCents;
            raw.pending.super_ += superCostCents;
            raw.pending.total  += baseCostCents + superCostCents;
            sa.pendingHours = round2dp(sa.pendingHours + hours);
            sa.pendingBaseCents += baseCostCents;
            sa.pendingSuperCents += superCostCents;

          } else if (ts.timesheetStatus === "rejected") {
            const { baseCostCents, superCostCents } = await historicalCost(ts);
            const hours = ts.totalHoursWorked ?? 0;
            raw.rejected.hours = round2dp(raw.rejected.hours + hours);
            raw.rejected.base   += baseCostCents;
            raw.rejected.super_ += superCostCents;
            raw.rejected.total  += baseCostCents + superCostCents;
            sa.rejectedHours = round2dp(sa.rejectedHours + hours);
            sa.rejectedTotalCents += baseCostCents + superCostCents;

          } else if (ts.timesheetStatus === "requires_amendment") {
            const { baseCostCents, superCostCents } = await historicalCost(ts);
            const hours = ts.totalHoursWorked ?? 0;
            raw.requiresAmendment.hours = round2dp(raw.requiresAmendment.hours + hours);
            raw.requiresAmendment.base   += baseCostCents;
            raw.requiresAmendment.super_ += superCostCents;
            raw.requiresAmendment.total  += baseCostCents + superCostCents;
            sa.requiresAmendmentHours = round2dp(sa.requiresAmendmentHours + hours);
            sa.requiresAmendmentTotalCents += baseCostCents + superCostCents;

          } else if (ts.timesheetStatus === "draft") {
            // Incomplete: draft hourly entry — report count, no cost.
            raw.incomplete.count++;
            // shiftEndAt / shiftStartAt are always non-nullable Date values per the TimesheetEntry type.
            const scheduledHours = round2dp(
              (ts.shiftEndAt.getTime() - ts.shiftStartAt.getTime()) / (1000 * 60 * 60),
            );
            raw.incomplete.scheduledHours = round2dp(raw.incomplete.scheduledHours + scheduledHours);
            sa.incompleteCount++;
            sa.incompleteScheduledHours = round2dp(sa.incompleteScheduledHours + scheduledHours);
          }
          // timesheetStatus = null → commission_log (filtered out above by payrollType check)
        }

        // Missing detection: historical roster entries with no linked hourly timesheet.
        //
        // TODAY HYBRID: Today's roster entries without a linked timesheet are NOT
        // "missing" — they are still upcoming and will appear in the Future Forecast.
        //
        // COMMISSION TRACK: Commission-track staff without a linked timesheet are NOT
        // "missing hourly" — their payroll is tracked via commission_log entries, not
        // hourly timesheets.  The authoritative source is users.payroll_track (fetched
        // via userRepository above), NOT historical commission_log activity.
        for (const rosterEntry of historicalActiveRoster) {
          const shiftLocalDate = toLocalDateString(rosterEntry.shiftStartAt, timezone);
          const linked = rosterTimesheetMap.get(rosterEntry.id) ?? null;

          // TODAY HYBRID: if there is no linked timesheet and the shift is today,
          // it is still upcoming — leave it for the Future Forecast section.
          if (shiftLocalDate >= localTodayStr && linked === null) continue;

          // Determine if this is a missing HOURLY timesheet:
          //   • linked = null   → missing only if staff.payroll_track ≠ 'commission'
          //   • linked = commission_log → not missing (expected for commission staff)
          //   • linked = hourly_auto / hourly_manual → not missing (has timesheet)
          const isHourlyMissing: boolean =
            linked === null
              ? staffPayrollTrackMap.get(rosterEntry.staffUserId) !== "commission"
              : false; // linked is commission_log or hourly — either way not missing

          if (isHourlyMissing) {
            const scheduledHours = round2dp(
              (rosterEntry.shiftEndAt.getTime() - rosterEntry.shiftStartAt.getTime()) / (1000 * 60 * 60),
            );
            raw.missing.count++;
            raw.missing.scheduledHours = round2dp(raw.missing.scheduledHours + scheduledHours);
            const sa = ensureStaff(rosterEntry.staffUserId, rosterEntry.staffEmail);
            sa.missingShiftCount++;
            sa.missingScheduledHours = round2dp(sa.missingScheduledHours + scheduledHours);
          }
        }

        // Capture raw totals for the planning estimate (computed before redaction).
        rawHistoricalApprovedCents = raw.approved.total;
        rawHistoricalPendingCents  = raw.pending.total;

        // Build the public HistoricalBreakdown with cost redaction applied.
        historicalBreakdown = {
          approved:          mkCostBreakdown(raw.approved),
          pending:           mkCostBreakdown(raw.pending),
          rejected:          mkCostBreakdown(raw.rejected),
          requiresAmendment: mkCostBreakdown(raw.requiresAmendment),
          incomplete:        raw.incomplete,
          missing:           raw.missing,
        };
      }

      // ── Future forecast section ──────────────────────────────────────────
      let futureForecastSection: FutureForecastSection | null = null;
      let rawFutureCents = 0;

      if (hasFuture) {
        const futureFromDate = fromDate >= localTodayStr ? fromDate : localTodayStr;
        const futureFromUTC = localDayStartUTC(futureFromDate, timezone);

        // Upcoming non-cancelled shifts in the future window (includes today)
        const upcomingShifts = await rosterRepository.listByClinic(clinicId, {
          from: futureFromUTC,
          to: toExclusiveUTC,
        });
        const allActiveShifts = upcomingShifts.filter((s) => s.status !== "cancelled");

        // ISSUE 2 FIX — TODAY HYBRID: exclude today's shifts that already have a
        // linked hourly timesheet.  Those shifts are classified in the historical
        // section (by timesheet status) and must not be double-counted here.
        const todayActiveShifts = allActiveShifts.filter(
          (s) => toLocalDateString(s.shiftStartAt, timezone) === localTodayStr,
        );
        const todayShiftsInHistorical = new Set<string>();
        if (todayActiveShifts.length > 0) {
          const todayTsMap = await timesheetRepository.findByRosterEntryIds(
            todayActiveShifts.map((s) => s.id),
          );
          for (const [rosterEntryId, ts] of todayTsMap) {
            if (ts && (ts.payrollType === "hourly_auto" || ts.payrollType === "hourly_manual")) {
              todayShiftsInHistorical.add(rosterEntryId);
            }
          }
        }

        // Keep only shifts that are NOT already captured in the historical section.
        const activeShifts = allActiveShifts.filter((s) => !todayShiftsInHistorical.has(s.id));

        // Hours calibration: approved timesheets from the past 30 days
        const lookbackStartStr = addCalendarDays(localTodayStr, -HISTORICAL_LOOKBACK_DAYS);
        const calibrationTs = await timesheetRepository.listByClinic(clinicId, {
          from: lookbackStartStr,
          to: localTodayStr,
          timesheetStatus: "approved",
        });

        // Calibration: approved timesheets from the past 30 days.
        // Used only to determine staffWithHistory (for rate-fallback blending).
        // NOTE: historical hour averages must NOT replace the roster's authoritative
        // scheduled duration — see projectedHours assignment below.
        const hoursAccum = new Map<string, { totalHours: number; count: number }>();
        for (const ts of calibrationTs) {
          if (ts.totalHoursWorked === null || ts.totalHoursWorked <= 0) continue;
          const acc = hoursAccum.get(ts.staffUserId) ?? { totalHours: 0, count: 0 };
          hoursAccum.set(ts.staffUserId, {
            totalHours: acc.totalHours + ts.totalHoursWorked,
            count: acc.count + 1,
          });
        }

        // staffWithHistory is used only for clinicWideFallbackCents blending.
        const staffWithHistory = new Set(hoursAccum.keys());

        // Clinic-wide fallback rate (blended from covered shift types)
        let clinicWideFallbackCents = CLINIC_WIDE_FALLBACK_RATE_CENTS;
        {
          let coveredRateSum = 0, coveredRateCount = 0;
          for (const shift of activeShifts) {
            if (staffWithHistory.has(shift.staffUserId)) {
              coveredRateSum += DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? CLINIC_WIDE_FALLBACK_RATE_CENTS;
              coveredRateCount++;
            }
          }
          if (coveredRateCount > 0) clinicWideFallbackCents = Math.round(coveredRateSum / coveredRateCount);
        }

        // Aggregate by shiftType
        const shiftTypeAcc = new Map<string, {
          projectedHours: number;
          baseCostCents: number;
          superCostCents: number;
          usingFallback: boolean;
        }>();

        let futureTotalHours = 0;
        let futureTotalBaseCents = 0;
        let futureTotalSuperCents = 0;
        let anyFutureFallback = false;

        for (const shift of activeShifts) {
          const scheduledDurationHours =
            (shift.shiftEndAt.getTime() - shift.shiftStartAt.getTime()) / (1_000 * 60 * 60);

          // Projected hours = roster-scheduled duration.
          //
          // The roster entry is the authoritative source of planned hours for a
          // future shift.  Historical approved-hour averages must NOT substitute
          // the scheduled duration — doing so causes values like ~32 h or ~2 h
          // to appear for a single rostered day, depending on each staff member's
          // approval history.  Historical data remains available for
          // utilisation/variance analysis but must not distort planned hours.
          const projectedHours = scheduledDurationHours;

          // Rate lookup using shift's clinic-local date (THE FIX)
          const shiftLocalDate = toLocalDateString(shift.shiftStartAt, timezone);
          const staffRate = await getCachedRate(shift.staffUserId, shiftLocalDate);

          let shiftBaseCostCents: number;
          let shiftSuperCostCents: number;
          let shiftUsingFallback: boolean;

          if (staffRate) {
            const roundedHours = round2dp(projectedHours);
            shiftBaseCostCents = Math.round(roundedHours * staffRate.baseHourlyRateCents);
            shiftSuperCostCents = Math.round(shiftBaseCostCents * staffRate.superRatePercent / 100);
            shiftUsingFallback = false;
          } else {
            let hourlyRateCents: number;
            if (staffPayRateRepository) {
              hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? clinicWideFallbackCents;
            } else {
              const hasHistory = staffWithHistory.has(shift.staffUserId);
              hourlyRateCents = hasHistory
                ? (DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? clinicWideFallbackCents)
                : clinicWideFallbackCents;
            }
            const roundedHours = round2dp(projectedHours);
            shiftBaseCostCents = Math.round(roundedHours * hourlyRateCents);
            shiftSuperCostCents = Math.round(shiftBaseCostCents * (DEFAULT_OVERHEAD_MULTIPLIER - 1));
            shiftUsingFallback = true;
          }

          // Accumulate per shift type
          const existing = shiftTypeAcc.get(shift.shiftType) ?? {
            projectedHours: 0, baseCostCents: 0, superCostCents: 0, usingFallback: false,
          };
          shiftTypeAcc.set(shift.shiftType, {
            projectedHours: existing.projectedHours + projectedHours,
            baseCostCents: existing.baseCostCents + shiftBaseCostCents,
            superCostCents: existing.superCostCents + shiftSuperCostCents,
            usingFallback: existing.usingFallback || shiftUsingFallback,
          });

          futureTotalHours = round2dp(futureTotalHours + projectedHours);
          futureTotalBaseCents += shiftBaseCostCents;
          futureTotalSuperCents += shiftSuperCostCents;
          if (shiftUsingFallback) anyFutureFallback = true;

          // Staff breakdown: future section
          const sa = ensureStaff(shift.staffUserId, shift.staffEmail);
          sa.futureProjectedHours = round2dp(sa.futureProjectedHours + projectedHours);
          sa.futureTotalCents += shiftBaseCostCents + shiftSuperCostCents;
          if (staffRate && !shiftUsingFallback) {
            sa.latestRateCents = staffRate.baseHourlyRateCents;
            sa.latestSuperPercent = staffRate.superRatePercent;
            sa.hasConfiguredRate = true;
          } else if (shiftUsingFallback) {
            sa.hasFallbackShift = true;
          }
        }

        const rawFutureTotalCents = futureTotalBaseCents + futureTotalSuperCents;
        rawFutureCents = rawFutureTotalCents;

        const breakdownByShiftType: ShiftTypeProjection[] = [...shiftTypeAcc.entries()]
          .map(([shiftType, acc]) => ({
            shiftType,
            projectedHours: round2dp(acc.projectedHours),
            // Apply cost redaction — null for callers without payroll:rates:read
            baseCostCents:  callerCanSeeRates ? acc.baseCostCents                    : null,
            superCostCents: callerCanSeeRates ? acc.superCostCents                   : null,
            totalCostCents: callerCanSeeRates ? (acc.baseCostCents + acc.superCostCents) : null,
            usingFallbackForSomeStaff: acc.usingFallback,
          }))
          .sort((a, b) => a.shiftType.localeCompare(b.shiftType));

        futureForecastSection = {
          totalHours: futureTotalHours,
          // Apply cost redaction
          baseCostCents:  callerCanSeeRates ? futureTotalBaseCents : null,
          superCostCents: callerCanSeeRates ? futureTotalSuperCents : null,
          totalCostCents: callerCanSeeRates ? rawFutureTotalCents : null,
          anyStaffUsingFallback: anyFutureFallback,
          breakdownByShiftType,
        };
      }

      // ── Planning estimate ─────────────────────────────────────────────────
      // Use RAW (pre-redaction) cents so the formula is always correct internally.
      // Apply null redaction based on callerCanSeeRates at the point of output.
      const rawTotalPlanningCents =
        rawHistoricalApprovedCents + rawHistoricalPendingCents + rawFutureCents;

      const planningEstimate: PlanningEstimate = {
        approvedCostCents: callerCanSeeRates ? rawHistoricalApprovedCents : null,
        pendingCostCents:  callerCanSeeRates ? rawHistoricalPendingCents  : null,
        futureCostCents:   callerCanSeeRates ? rawFutureCents             : null,
        totalCostCents:    callerCanSeeRates ? rawTotalPlanningCents      : null,
      };

      // ── Staff breakdown with GPM redaction ───────────────────────────────
      const staffBreakdown: StaffCostBreakdown[] = [...staffMap.entries()].map(
        ([staffUserId, sa]) => {
          const rateSource: "configured" | "fallback" | null =
            callerCanSeeRates
              ? (sa.hasConfiguredRate ? "configured" : sa.hasFallbackShift ? "fallback" : null)
              : null;

          return {
            staffUserId,
            staffEmail: sa.staffEmail,
            approvedHours: sa.approvedHours,
            pendingHours: sa.pendingHours,
            rejectedHours: sa.rejectedHours,
            requiresAmendmentHours: sa.requiresAmendmentHours,
            incompleteCount: sa.incompleteCount,
            incompleteScheduledHours: sa.incompleteScheduledHours,
            missingShiftCount: sa.missingShiftCount,
            missingScheduledHours: sa.missingScheduledHours,
            futureProjectedHours: sa.futureProjectedHours,
            // Redact rate/cost for GPM without payroll:rates:read
            baseHourlyRateCents: callerCanSeeRates ? sa.latestRateCents : null,
            superRatePercent: callerCanSeeRates ? sa.latestSuperPercent : null,
            rateSource,
            approvedCostCents: callerCanSeeRates
              ? (sa.approvedBaseCents + sa.approvedSuperCents)
              : null,
            pendingCostCents: callerCanSeeRates
              ? (sa.pendingBaseCents + sa.pendingSuperCents)
              : null,
            rejectedCostCents: callerCanSeeRates ? sa.rejectedTotalCents : null,
            requiresAmendmentCostCents: callerCanSeeRates ? sa.requiresAmendmentTotalCents : null,
            futureCostCents: callerCanSeeRates ? sa.futureTotalCents : null,
          };
        },
      );

      // ── Data quality flags ────────────────────────────────────────────────
      // Use hours (always non-null) rather than cost fields which may be redacted.
      const dataQuality: DataQuality = {
        hasIncompleteTimesheets: (historicalBreakdown?.incomplete.count ?? 0) > 0,
        hasMissingTimesheets:    (historicalBreakdown?.missing.count ?? 0) > 0,
        hasRejectedTimesheets:   (historicalBreakdown?.rejected.hours ?? 0) > 0,
        hasRequiresAmendment:    (historicalBreakdown?.requiresAmendment.hours ?? 0) > 0,
      };

      return {
        clinicId,
        dateRange: { from: fromDate, to: toDate, timezone },
        historical: historicalBreakdown,
        futureForecast: futureForecastSection,
        planningEstimate,
        staffBreakdown,
        dataQuality,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal math utilities
// ─────────────────────────────────────────────────────────────────────────────

function round2dp(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Returns inclusive day count between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone-safe date utilities
// ─────────────────────────────────────────────────────────────────────────────

function toLocalDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function localDayStartUTC(dateStr: string, timezone: string): Date {
  const noonUTC = new Date(`${dateStr}T12:00:00.000Z`);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(noonUTC);

  const p = (type: string): string =>
    parts.find((x) => x.type === type)?.value ?? "00";

  const localNoonAsUTC = new Date(
    `${p("year")}-${p("month")}-${p("day")}T${p("hour").padStart(2, "0")}:${p("minute")}:${p("second")}Z`,
  );

  const offsetMs = noonUTC.getTime() - localNoonAsUTC.getTime();
  const utcMidnight = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(utcMidnight.getTime() + offsetMs);
}
