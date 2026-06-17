/**
 * laborForecastService.ts
 *
 * Labor Cost Projection Engine — Module 06, Session 3.
 *
 * Projects total labor costs for a clinic over a configurable forward window by
 * combining three data sources:
 *
 *   1. Non-cancelled upcoming roster shifts (the demand signal).
 *   2. Approved hourly timesheets from the past HISTORICAL_LOOKBACK_DAYS
 *      (calibrates projected hours per staff member beyond naive shift-duration
 *      arithmetic — actual clocked hours often diverge from scheduled hours).
 *   3. Built-in AUD default rates per shift type (placeholder until a
 *      clinic_labor_rates table is introduced in Module 09; the algorithm
 *      structure is rate-source agnostic — swap the lookup and nothing else
 *      changes).
 *
 * Role proxy:
 *   RosterEntry carries shiftType ("standard" | "overtime" | "on_call" |
 *   "training") which is the highest-resolution role-like grouping available
 *   without injecting userRepository as a dependency.  A dedicated
 *   clinical_role column on users ("dentist", "dental_nurse", etc.) will be
 *   added in Module 09; at that point the grouping key can be changed without
 *   altering this service's interface.
 *
 * Hourly rate defaults (AUD minor units — cents per hour, FY2026 dental award):
 *   standard  → 5 000 c/hr  (AUD 50.00)
 *   overtime  → 7 500 c/hr  (AUD 75.00 — 1.5× standard)
 *   on_call   → 6 250 c/hr  (AUD 62.50 — 1.25× standard)
 *   training  → 5 000 c/hr  (AUD 50.00 — same as standard, no shift premium)
 *   fallback  → 5 500 c/hr  (AUD 55.00 — clinic-wide average when no coverage)
 *
 * Overhead multiplier (default 1.15):
 *   Covers Australian employer obligations — 11% superannuation guarantee
 *   (FY2026 rate), payroll tax, and WorkCover insurance.  A clinic-specific
 *   overhead_multiplier column will be added to the clinics table in Module 09
 *   and wired through LaborForecastOptions.
 *
 * Monetary representation (LEDGER SAFETY):
 *   All cost values are accumulated and stored as INTEGER AUD CENTS to eliminate
 *   floating-point summation drift.  Division by 100 to produce fractional
 *   dollar strings must occur exclusively at the API serialisation layer
 *   (laborForecastRoutes.ts) — never inside this service.
 *
 * Multi-tenant contract (non-negotiable):
 *   Every public method takes (caller, clinicId) and enforces:
 *     a) owner_admin may query any clinic.
 *     b) group_practice_manager may only query their own homeClinicId.
 *     c) clinical_staff is denied entirely (labor cost data is financial).
 *   The route layer additionally enforces enforceTenantParam("clinicId"), so
 *   the service layer acts as a second, independent line of defence.
 *
 * Timezone calibration:
 *   All calendar-day boundaries (lookback start, forecast end) are computed in
 *   the clinic's explicit IANA timezone via options.timezone to prevent midnight-
 *   crossing drift on servers running in UTC.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { TimesheetRepository } from "../repositories/timesheetRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default AUD hourly rates in CENTS per hour, indexed by shiftType.
 * Approximate FY2026 Australian dental award rates (Dental Industry Award 2020).
 * Will be replaced by a clinic_labor_rates DB lookup in Module 09.
 */
const DEFAULT_HOURLY_RATE_CENTS: Readonly<Record<string, number>> = {
  standard: 5_000,
  overtime: 7_500,
  on_call:  6_250,
  training: 5_000,
};

/**
 * Clinic-wide fallback rate in CENTS per hour.
 * Applied when a shiftType has no historical timesheet coverage at the queried
 * clinic.  Represents the blended average cost across a mixed dental practice
 * workforce (AUD 55.00/hr).
 */
const CLINIC_WIDE_FALLBACK_RATE_CENTS = 5_500;

/**
 * Overhead multiplier applied to every base cost calculation.
 * 1.15 ≈ 11% super + 2% payroll tax + 2% WorkCover (rounded for simplicity).
 * Will be configurable per-clinic once Module 09 adds the column.
 */
const DEFAULT_OVERHEAD_MULTIPLIER = 1.15;

/**
 * How many calendar days back to sample approved hourly timesheets for
 * per-staff and clinic-wide hours-per-shift calibration.
 */
const HISTORICAL_LOOKBACK_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Public output types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Labor cost projection for a single clinician role (shiftType) within the
 * forecast window.
 *
 * Monetary fields are INTEGER AUD CENTS — divide by 100 at the presentation
 * layer to obtain fractional dollar strings.  This eliminates floating-point
 * drift that accumulates across multi-line cost summations.
 */
export type RoleLaborProjection = {
  /** ShiftType acting as role proxy: "standard" | "overtime" | "on_call" | "training". */
  role: string;
  /** Total projected hours for all non-cancelled shifts of this role in the window. */
  totalScheduledHours: number;
  /** Base labor cost in AUD cents (integer). Divide by 100 for dollar display. */
  projectedBaseCost: number;
  /** Overhead component in AUD cents (integer). Divide by 100 for dollar display. */
  projectedOverheadCost: number;
  /** Grand total per role in AUD cents (integer). Divide by 100 for dollar display. */
  totalProjectedCost: number;
};

/**
 * Clinic-level labor cost summary returned by getLaborForecast.
 * Aggregates all RoleLaborProjection entries and carries the top-level totals.
 *
 * All monetary fields are INTEGER AUD CENTS — see RoleLaborProjection.
 */
export type LaborForecastSummary = {
  clinicId: string;
  /** Number of calendar days in the forward-looking forecast window. */
  forecastWindowDays: number;
  /** Sum of projected hours across all roles. */
  totalProjectedHours: number;
  /** Sum of base costs across all roles in AUD cents (integer). */
  totalProjectedBaseCost: number;
  /** Sum of overhead components across all roles in AUD cents (integer). */
  totalProjectedOverheadCost: number;
  /** Grand total cost including all roles and overhead in AUD cents (integer). */
  grandTotalProjectedCost: number;
  /** Per-role breakdown, sorted by role name for stable output. */
  breakdownByRole: RoleLaborProjection[];
};

/** Options accepted by getLaborForecast. */
export type LaborForecastOptions = {
  /**
   * How many calendar days ahead to count upcoming roster shifts.
   * Defaults to 14 (two full working weeks).  Bounded [1, 90] by the route layer.
   */
  forecastDays?: number;
  /**
   * IANA timezone string for the clinic (e.g. "Australia/Sydney").
   * When provided, lookback and forecast windows are anchored to clinic-local
   * calendar-day boundaries, preventing midnight-crossing drift on UTC servers.
   * Falls back to "Australia/Sydney" when omitted.
   */
  timezone?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────────────

export type LaborForecastService = ReturnType<typeof createLaborForecastService>;

export function createLaborForecastService(
  rosterRepository: RosterRepository,
  timesheetRepository: TimesheetRepository,
) {
  // ── Internal helpers (closure scope) ─────────────────────────────────────

  /**
   * Tenant guard.
   * owner_admin is permitted to query any clinic.
   * All other roles are restricted to their own homeClinicId.
   */
  function assertTenantAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (caller.role === "owner_admin") return;

    if (caller.homeClinicId !== clinicId) {
      throw new AppError(
        403,
        "TENANT_ACCESS_DENIED",
        "You do not have access to this clinic's forecast data",
      );
    }
  }

  /**
   * RBAC gate for financial / labor cost data.
   * clinical_staff must never see raw cost projections — this prevents
   * staff from reverse-engineering colleague pay rates.
   */
  function assertFinancialAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "INSUFFICIENT_PERMISSIONS",
        "Labor cost data is restricted to owner_admin and group_practice_manager",
      );
    }
  }

  // ── Exported service methods ───────────────────────────────────────────────

  return {
    /**
     * Returns the full labor cost projection summary for a clinic.
     *
     * Algorithm:
     *   1. Fetch non-cancelled upcoming shifts within the forecastDays window.
     *   2. Query approved hourly timesheets from the past HISTORICAL_LOOKBACK_DAYS
     *      and build a per-staff average-hours-per-shift calibration map.
     *      Staff with no approved history fall back to the clinic-wide avg;
     *      clinics with no approved history fall back to scheduled shift duration.
     *   3. Determine the effective hourly rate (in cents) for each shiftType:
     *      - shiftTypes where at least one scheduled staff member has a historical
     *        approved timesheet → use DEFAULT_HOURLY_RATE_CENTS[shiftType].
     *      - shiftTypes where no scheduled staff member has approved history →
     *        use the clinic-wide average rate (weighted mean of default rates for
     *        covered shift types; CLINIC_WIDE_FALLBACK_RATE_CENTS when no history).
     *   4. Compute baseCostCents = round(projectedHours × hourlyRateCents) per role.
     *   5. Apply DEFAULT_OVERHEAD_MULTIPLIER; return the LaborForecastSummary.
     *
     * All monetary outputs are INTEGER AUD CENTS.  The route layer divides
     * by 100 before writing the JSON response.
     *
     * @param caller    - Authenticated session user (tenant + RBAC guard applied).
     * @param clinicId  - Clinic whose labor forecast is requested.
     * @param options   - Optional window configuration + clinic timezone.
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

      // Compute calendar-day boundaries in the clinic's local timezone to prevent
      // midnight-crossing drift when the server runs in UTC.
      const localNowStr = toLocalDateString(now, timezone);
      const localForecastEndStr = addCalendarDays(localNowStr, forecastDays);
      const localLookbackStartStr = addCalendarDays(localNowStr, -HISTORICAL_LOOKBACK_DAYS);

      // Convert local date boundaries to UTC timestamps for repository queries.
      // forecastEndUTC is the exclusive upper bound for the roster window
      // (start of the first day OUTSIDE the forecast period in clinic-local time).
      const forecastEndUTC = localDayStartUTC(localForecastEndStr, timezone);

      // ── 1. Upcoming non-cancelled shifts ────────────────────────────────────
      const upcomingShifts = await rosterRepository.listByClinic(clinicId, {
        from: now,
        to: forecastEndUTC,
      });

      const activeShifts = upcomingShifts.filter((s) => s.status !== "cancelled");

      // ── 2. Historical timesheet calibration ─────────────────────────────────
      // Query approved hourly timesheets for the lookback window.
      // These provide actual hours-worked data that typically diverges from
      // scheduled shift duration due to breaks, early finishes, or overtime.
      const historicalTimesheets = await timesheetRepository.listByClinic(clinicId, {
        from: localLookbackStartStr,
        to: localNowStr,
        timesheetStatus: "approved",
      });

      // Build per-staff average actual hours per shift.
      // Only entries with a positive totalHoursWorked contribute (commission_log
      // entries have null totalHoursWorked and are automatically excluded here).
      const staffAccumulator = new Map<string, { totalHours: number; count: number }>();

      for (const ts of historicalTimesheets) {
        if (ts.totalHoursWorked === null || ts.totalHoursWorked <= 0) continue;
        const acc = staffAccumulator.get(ts.staffUserId) ?? { totalHours: 0, count: 0 };
        staffAccumulator.set(ts.staffUserId, {
          totalHours: acc.totalHours + ts.totalHoursWorked,
          count: acc.count + 1,
        });
      }

      // Per-staff average: staffId → avg actual hours per shift.
      const staffAvgHoursMap = new Map<string, number>();
      for (const [staffId, { totalHours, count }] of staffAccumulator) {
        staffAvgHoursMap.set(staffId, totalHours / count);
      }

      // Clinic-wide average hours per shift (fallback for staff with no history).
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

      // Set of staffUserIds that have approved timesheet history at this clinic.
      const staffWithHistory = new Set(staffAvgHoursMap.keys());

      // ── 3. Clinic-wide average RATE fallback (in cents per hour) ─────────────
      // When a shiftType has no staff with approved history, the rate falls back
      // to the weighted average of DEFAULT rates across shiftTypes that DO have
      // historical coverage.  This reflects the clinic's actual cost mix rather
      // than a hard-coded constant where meaningful data exists.
      let clinicWideFallbackCents = CLINIC_WIDE_FALLBACK_RATE_CENTS;
      {
        let coveredRateSum = 0;
        let coveredRateCount = 0;
        for (const shift of activeShifts) {
          if (staffWithHistory.has(shift.staffUserId)) {
            coveredRateSum +=
              DEFAULT_HOURLY_RATE_CENTS[shift.shiftType] ?? CLINIC_WIDE_FALLBACK_RATE_CENTS;
            coveredRateCount += 1;
          }
        }
        if (coveredRateCount > 0) {
          clinicWideFallbackCents = Math.round(coveredRateSum / coveredRateCount);
        }
      }

      // ── 4. Aggregate projected hours and costs by shiftType ─────────────────
      const roleAccumulator = new Map<string, {
        projectedHours: number;
        hasHistoryCoverage: boolean;
      }>();

      for (const shift of activeShifts) {
        const scheduledDurationMs =
          shift.shiftEndAt.getTime() - shift.shiftStartAt.getTime();
        const scheduledDurationHours = scheduledDurationMs / (1_000 * 60 * 60);

        // Determine projected hours for this individual shift.
        // Priority: per-staff historical avg → clinic-wide avg → scheduled duration.
        let projectedHoursForShift: number;
        const staffAvg = staffAvgHoursMap.get(shift.staffUserId);

        if (staffAvg !== undefined) {
          projectedHoursForShift = staffAvg;
        } else if (clinicAvgHoursPerShift !== null) {
          projectedHoursForShift = clinicAvgHoursPerShift;
        } else {
          projectedHoursForShift = scheduledDurationHours;
        }

        const existing = roleAccumulator.get(shift.shiftType) ?? {
          projectedHours: 0,
          hasHistoryCoverage: false,
        };

        roleAccumulator.set(shift.shiftType, {
          projectedHours: existing.projectedHours + projectedHoursForShift,
          hasHistoryCoverage:
            existing.hasHistoryCoverage || staffWithHistory.has(shift.staffUserId),
        });
      }

      // ── 5. Build per-role projections ────────────────────────────────────────
      const breakdownByRole: RoleLaborProjection[] = [];
      let totalProjectedHours = 0;
      let totalProjectedBaseCost = 0;      // integer cents
      let totalProjectedOverheadCost = 0;  // integer cents
      let grandTotalProjectedCost = 0;     // integer cents

      for (const [shiftType, { projectedHours, hasHistoryCoverage }] of roleAccumulator) {
        // Determine the effective hourly rate (cents) for this shiftType.
        const hourlyRateCents = hasHistoryCoverage
          ? (DEFAULT_HOURLY_RATE_CENTS[shiftType] ?? clinicWideFallbackCents)
          : clinicWideFallbackCents;

        // Hours stay as a rounded float (2 dp) to eliminate IEEE 754 drift.
        const roundedHours = round2dp(projectedHours);

        // Cost arithmetic in integer cents — Math.round eliminates sub-cent drift.
        const baseCostCents = Math.round(roundedHours * hourlyRateCents);
        const overheadCostCents = Math.round(baseCostCents * (DEFAULT_OVERHEAD_MULTIPLIER - 1));
        const totalCostCents = baseCostCents + overheadCostCents;

        breakdownByRole.push({
          role: shiftType,
          totalScheduledHours: roundedHours,
          projectedBaseCost: baseCostCents,
          projectedOverheadCost: overheadCostCents,
          totalProjectedCost: totalCostCents,
        });

        totalProjectedHours = round2dp(totalProjectedHours + roundedHours);
        totalProjectedBaseCost += baseCostCents;
        totalProjectedOverheadCost += overheadCostCents;
        grandTotalProjectedCost += totalCostCents;
      }

      // Stable output: sort by role name so the response order is deterministic
      // regardless of iteration order over the Map.
      breakdownByRole.sort((a, b) => a.role.localeCompare(b.role));

      return {
        clinicId,
        forecastWindowDays: forecastDays,
        totalProjectedHours,
        totalProjectedBaseCost,
        totalProjectedOverheadCost,
        grandTotalProjectedCost,
        breakdownByRole,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal math utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rounds a number to 2 decimal places using the scale-of-100 technique to
 * eliminate floating-point drift that accumulates in multi-line hour summations.
 *
 * Used for HOURS only — cost arithmetic uses integer cents (no rounding needed).
 *
 * Example: round2dp(0.1 + 0.2) → 0.3  (not 0.30000000000000004)
 */
function round2dp(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone-safe date utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a Date as YYYY-MM-DD in the specified IANA timezone.
 *
 * Prevents midnight-crossing drift: when the server runs in UTC and it is
 * 11 PM in Australia/Sydney, `new Date().toISOString().slice(0, 10)` returns
 * yesterday's UTC date rather than today's local date.
 */
function toLocalDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Adds (or subtracts, when negative) calendar days to a YYYY-MM-DD date string.
 * Arithmetic is performed in UTC to avoid DST-induced ambiguity — day counts
 * are calendar days, so DST transitions within the window do not affect the
 * result.
 */
function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns the UTC timestamp corresponding to midnight (00:00:00) of `dateStr`
 * in the given IANA timezone.
 *
 * Algorithm:
 *   1. Take noon UTC on the target date — noon UTC is always within ±12 hours
 *      of midnight for every real-world timezone (offsets range from −12 to +14).
 *   2. Use `Intl.DateTimeFormat.formatToParts` to obtain the local hour/minute/
 *      second/date components at that UTC reference point.
 *   3. Reconstruct the local noon string as a UTC literal to compute the
 *      signed timezone offset in milliseconds.
 *   4. Apply the offset to UTC midnight on the target date.
 *
 * Example: timezone 'Australia/Sydney' (UTC+10), date '2026-06-16'
 *   → returns Date representing 2026-06-15T14:00:00.000Z
 */
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

  // Reconstruct local noon as a UTC literal string to compute offset.
  const localNoonAsUTC = new Date(
    `${p("year")}-${p("month")}-${p("day")}T${p("hour").padStart(2, "0")}:${p("minute")}:${p("second")}Z`,
  );

  // offsetMs = noonUTC_ms − localNoonAsUTC_ms
  // Negative for UTC+X (e.g., UTC+10 → −36 000 000 ms)
  // Positive for UTC−X (e.g., UTC−5  → +18 000 000 ms)
  const offsetMs = noonUTC.getTime() - localNoonAsUTC.getTime();

  // UTC midnight of target date + offsetMs = local midnight expressed as UTC.
  const utcMidnight = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(utcMidnight.getTime() + offsetMs);
}
