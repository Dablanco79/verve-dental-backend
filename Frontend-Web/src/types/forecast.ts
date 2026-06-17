/**
 * Labor cost projection types — mirrors the Backend service output shapes from
 * laborForecastService.ts (Module 06, Session 3).
 *
 * All monetary values are AUD, rounded to 2 decimal places by the API.
 */

/** Per-role (shiftType) labor cost projection within the forecast window. */
export type RoleLaborProjection = {
  /** ShiftType acting as role proxy: "standard" | "overtime" | "on_call" | "training". */
  role: string;
  /** Total projected hours for all non-cancelled shifts of this role in the window. */
  totalScheduledHours: number;
  /** Base labor cost: totalScheduledHours × hourlyRate (AUD). */
  projectedBaseCost: number;
  /** Overhead component: baseCost × (overheadMultiplier − 1) (AUD). */
  projectedOverheadCost: number;
  /** Grand total per role: baseCost + overheadCost (AUD). */
  totalProjectedCost: number;
};

/** Clinic-level labor cost summary returned by GET /clinics/:clinicId/forecast/labor. */
export type LaborForecastSummary = {
  clinicId: string;
  /** Number of calendar days in the forward-looking forecast window. */
  forecastWindowDays: number;
  /** Sum of projected hours across all roles. */
  totalProjectedHours: number;
  /** Sum of base costs across all roles (AUD). */
  totalProjectedBaseCost: number;
  /** Sum of overhead components across all roles (AUD). */
  totalProjectedOverheadCost: number;
  /** Grand total cost including all roles and overhead (AUD). */
  grandTotalProjectedCost: number;
  /** Per-role breakdown, sorted alphabetically by role name. */
  breakdownByRole: RoleLaborProjection[];
};
