/**
 * forecastService.ts
 *
 * Core Materials Forecasting Engine for Verve Dental Operational Suite.
 *
 * The engine combines three data sources to produce SKU-level demand
 * projections and shortage alerts:
 *
 *   1. Upcoming scheduled/confirmed roster shifts (demand signal).
 *   2. Verified attendance logs via TimesheetRepository.getForecastLogs
 *      (FORECASTING SAFEGUARD — only present | absent | sick entries with a
 *      full manager approval audit trail are eligible inputs).
 *   3. Historical inventory consumption of type 'scan_deduct' per SKU,
 *      fetched via InventoryRepository.getConsumptionVolume which pushes the
 *      type and date predicates directly to the database engine.  This
 *      eliminates the previous dangerous pattern of retrieving a capped list
 *      of recent adjustments (limit: 200) and filtering in application memory,
 *      which could silently truncate history for high-volume clinics.
 *
 * Multi-tenant contract (non-negotiable):
 *   Every public method takes (caller, clinicId) and enforces that:
 *     a) owner_admin may query any clinic.
 *     b) group_practice_manager and clinical_staff may only query their own
 *        homeClinicId — any other clinicId throws 403 TENANT_ACCESS_DENIED.
 *   The route layer additionally enforces enforceTenantParam("clinicId"), so
 *   the service layer is a second, independent line of defence.
 *
 * Algorithm summary:
 *   historicalPresentShiftCount  = verified-present commission_log entries
 *                                  in the past `lookbackDays` at this clinic.
 *   historicalConsumption[sku]   = sum of scan_deduct deltas for this SKU in
 *                                  the same lookback window (fetched in one
 *                                  predicate-pushed DB query).
 *   avgUsagePerShift[sku]        = consumption / max(presentShiftCount, 1)
 *   scheduledShiftCount          = non-cancelled roster entries for the clinic
 *                                  inside the forecast window (next forecastDays).
 *   projectedUsage[sku]          = round(avgUsagePerShift × scheduledShiftCount)
 *   projectedStockRemaining[sku] = quantityOnHand - projectedUsage
 *   willBreach[sku]              = projectedStockRemaining < reorderPoint
 *
 * Severity tiers for alerts:
 *   critical → projectedStockRemaining ≤ 0  (actual stockout expected)
 *   warning  → 0 < projectedStockRemaining < reorderPoint  (buffer breach)
 *
 * Timezone calibration:
 *   All calendar-day boundaries (lookback start, forecast end) are computed
 *   in the clinic's explicit IANA timezone via options.timezone to prevent
 *   midnight-crossing drift on servers running in UTC.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { TimesheetRepository } from "../repositories/timesheetRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public output types
// ─────────────────────────────────────────────────────────────────────────────

export type SkuDemandProjection = {
  masterCatalogItemId: string;
  /** Canonical stock-keeping unit identifier (e.g. "VRV-GLV-001"). */
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  /** Quantity currently on hand at this clinic. */
  currentStock: number;
  /** Minimum stock level triggering a reorder alert. */
  reorderPoint: number;
  /** Number of upcoming (non-cancelled) roster shifts in the forecast window. */
  scheduledShiftCount: number;
  /** Verified-present commission_log entries in the historical lookback window. */
  historicalPresentShiftCount: number;
  /** Total scan_deduct units consumed in the lookback window for this SKU. */
  historicalConsumption: number;
  /** Average units consumed per verified-present shift (2 d.p.). */
  avgUsagePerShift: number;
  /** Projected total units to be consumed during the forecast window. */
  projectedUsage: number;
  /** Estimated stock remaining after the forecast window. */
  projectedStockRemaining: number;
  /** True when projectedStockRemaining falls below the clinic reorder point. */
  willBreachSafetyThreshold: boolean;
};

export type AlertSeverity = "critical" | "warning";

export type MaterialShortfallAlert = {
  severity: AlertSeverity;
  masterCatalogItemId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  currentStock: number;
  reorderPoint: number;
  projectedUsage: number;
  projectedStockRemaining: number;
  /** Units by which the projected remaining stock falls below the reorder point. */
  shortfallUnits: number;
  /**
   * Estimated calendar days until stock reaches zero, based on the average
   * daily consumption rate. Null when there are no historical present shifts
   * (no consumption rate to derive from) or when avgUsagePerShift is zero.
   */
  daysUntilStockout: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export type ForecastOptions = {
  /**
   * How many calendar days ahead to count upcoming roster shifts.
   * Defaults to 14 (two full working weeks).
   */
  forecastDays?: number;
  /**
   * How many calendar days back to sample scan_deduct history and
   * verified-present attendance logs.
   * Defaults to 30 (one full month).
   */
  lookbackDays?: number;
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

export type ForecastService = ReturnType<typeof createForecastService>;

export function createForecastService(
  inventoryRepository: InventoryRepository,
  catalogRepository: CatalogRepository,
  rosterRepository: RosterRepository,
  timesheetRepository: TimesheetRepository,
) {
  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Tenant guard.  owner_admin is allowed to query any clinic.
   * All other roles are restricted to their homeClinicId.
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
   * Core projection engine.
   * Fetches all data from repositories and builds the full demand table.
   */
  async function buildProjections(
    clinicId: string,
    options: ForecastOptions = {},
  ): Promise<SkuDemandProjection[]> {
    const forecastDays = options.forecastDays ?? 14;
    const lookbackDays = options.lookbackDays ?? 30;
    const timezone = options.timezone ?? "Australia/Sydney";

    const now = new Date();

    // Compute calendar-day boundaries in the clinic's local timezone to prevent
    // midnight-crossing drift when the server runs in UTC.
    const localNowStr = toLocalDateString(now, timezone);
    const localForecastEndStr = addCalendarDays(localNowStr, forecastDays);
    const localLookbackStartStr = addCalendarDays(localNowStr, -lookbackDays);

    // ── 1. Upcoming roster shifts ────────────────────────────────────────────
    // forecastEndUTC is the exclusive upper bound: the start of the first day
    // outside the forecast period in clinic-local time (expressed as UTC).
    const forecastEndUTC = localDayStartUTC(localForecastEndStr, timezone);

    const upcomingShifts = await rosterRepository.listByClinic(clinicId, {
      from: now,
      to: forecastEndUTC,
    });

    const scheduledShiftCount = upcomingShifts.filter(
      (s) => s.status !== "cancelled",
    ).length;

    // ── 2. Historical present-shift count (attendance safeguard) ─────────────
    // Iterate over each date in the lookback window and call getForecastLogs
    // (the FORECASTING SAFEGUARD method), then aggregate present-only entries.
    const historicalPresentEntries: string[] = [];

    let cursorDateStr = localLookbackStartStr;
    while (cursorDateStr <= localNowStr) {
      const logs = await timesheetRepository.getForecastLogs(clinicId, cursorDateStr);
      for (const log of logs) {
        if (log.attendanceStatus === "present") {
          historicalPresentEntries.push(log.id);
        }
      }
      cursorDateStr = addCalendarDays(cursorDateStr, 1);
    }

    const historicalPresentShiftCount = historicalPresentEntries.length;

    // ── 3. Historical inventory consumption ──────────────────────────────────
    // getConsumptionVolume pushes both the adjustment-type filter AND the date
    // predicate to the storage engine, eliminating the previous limit-200 cap.
    // The since Date is the UTC equivalent of the clinic-local lookback start.
    const lookbackSinceUTC = localDayStartUTC(localLookbackStartStr, timezone);

    const consumptionByMasterItemId = await inventoryRepository.getConsumptionVolume(
      clinicId,
      { type: "scan_deduct", since: lookbackSinceUTC },
    );

    // ── 4. Build per-SKU demand projections ──────────────────────────────────
    const inventoryItems = await inventoryRepository.listClinicInventory(clinicId);
    const projections: SkuDemandProjection[] = [];

    for (const item of inventoryItems) {
      const historicalConsumption =
        consumptionByMasterItemId.get(item.masterCatalogItemId) ?? 0;

      // avgUsagePerShift: guard against zero-division when no shifts were
      // verified in the lookback window (new clinic, or no history yet).
      const avgUsagePerShift =
        historicalPresentShiftCount > 0
          ? round2dp(historicalConsumption / historicalPresentShiftCount)
          : 0;

      const projectedUsage = Math.round(avgUsagePerShift * scheduledShiftCount);
      const projectedStockRemaining = item.quantityOnHand - projectedUsage;

      projections.push({
        masterCatalogItemId: item.masterCatalogItemId,
        sku: item.masterSku,
        name: item.name,
        category: item.category,
        unitOfMeasure: item.unitOfMeasure,
        currentStock: item.quantityOnHand,
        reorderPoint: item.reorderPoint,
        scheduledShiftCount,
        historicalPresentShiftCount,
        historicalConsumption,
        avgUsagePerShift,
        projectedUsage,
        projectedStockRemaining,
        willBreachSafetyThreshold: projectedStockRemaining < item.reorderPoint,
      });
    }

    return projections;
  }

  // ── Exported service methods ──────────────────────────────────────────────

  return {
    /**
     * Returns the full SKU demand projection table for a clinic.
     * All inventory items are included — consumers can filter on
     * `willBreachSafetyThreshold` client-side as needed.
     *
     * @param caller    - Authenticated session user (tenant guard applied).
     * @param clinicId  - Clinic whose forecast data is requested.
     * @param options   - Optional window + timezone configuration.
     */
    async getMaterialForecast(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ForecastOptions,
    ): Promise<SkuDemandProjection[]> {
      assertTenantAccess(caller, clinicId);
      return buildProjections(clinicId, options);
    },

    /**
     * Returns only the actionable shortage alerts — items where the
     * projected stock remaining will fall below the clinic's reorder
     * point during the forecast window.
     *
     * Sorted by severity (critical → warning) then by shortfall units
     * descending so the most urgent items appear first.
     *
     * @param caller    - Authenticated session user (tenant guard applied).
     * @param clinicId  - Clinic whose alert data is requested.
     * @param options   - Optional window + timezone configuration.
     */
    async getMaterialAlerts(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ForecastOptions,
    ): Promise<MaterialShortfallAlert[]> {
      assertTenantAccess(caller, clinicId);

      const projections = await buildProjections(clinicId, options);

      const alerts: MaterialShortfallAlert[] = projections
        .filter((p) => p.willBreachSafetyThreshold)
        .map((p) => {
          const severity: AlertSeverity =
            p.projectedStockRemaining <= 0 ? "critical" : "warning";

          const shortfallUnits = Math.max(
            0,
            p.reorderPoint - p.projectedStockRemaining,
          );

          // Days until stockout: currentStock / daily_usage_rate.
          // daily_usage_rate derived from lookback; null when no history.
          const forecastDays = options?.forecastDays ?? 14;
          const dailyUsageRate =
            forecastDays > 0 && p.scheduledShiftCount > 0
              ? p.avgUsagePerShift * (p.scheduledShiftCount / forecastDays)
              : null;

          const daysUntilStockout =
            dailyUsageRate !== null && dailyUsageRate > 0
              ? Math.floor(p.currentStock / dailyUsageRate)
              : null;

          return {
            severity,
            masterCatalogItemId: p.masterCatalogItemId,
            sku: p.sku,
            name: p.name,
            category: p.category,
            unitOfMeasure: p.unitOfMeasure,
            currentStock: p.currentStock,
            reorderPoint: p.reorderPoint,
            projectedUsage: p.projectedUsage,
            projectedStockRemaining: p.projectedStockRemaining,
            shortfallUnits,
            daysUntilStockout,
          };
        });

      // Sort: critical first, then by shortfall units descending.
      alerts.sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === "critical" ? -1 : 1;
        }
        return b.shortfallUnits - a.shortfallUnits;
      });

      return alerts;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal math utility
// ─────────────────────────────────────────────────────────────────────────────

/** Rounds a number to 2 decimal places without floating-point drift. */
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
 *   2. Use `Intl.DateTimeFormat.formatToParts` to obtain the local date/time
 *      components at that UTC reference point.
 *   3. Reconstruct the local noon as a UTC literal to compute the signed
 *      timezone offset in milliseconds.
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

  // Reconstruct local noon as a UTC literal string to compute the offset.
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
