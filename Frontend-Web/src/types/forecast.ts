/**
 * Labour Cost Analysis types — mirrors the Backend service output shapes.
 *
 * All monetary values are AUD dollars (divided by 100 from integer cents by the API).
 * Hours are decimal (e.g. 7.5 = 7 hours 30 minutes).
 */

// ── Cost breakdown ────────────────────────────────────────────────────────────

/**
 * Hours + costs for a single status bucket (Approved / Pending / Rejected / RequiresAmendment).
 * Cost fields are null when the caller lacks "payroll:rates:read".
 */
export type CostBreakdown = {
  hours: number;
  /** null when the caller lacks payroll:rates:read. */
  baseCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  superCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  totalCost: number | null;
};

/** Count + scheduled hours for exception categories (no cost). */
export type ExceptionSummary = {
  count: number;
  scheduledHours: number;
};

// ── Historical section ────────────────────────────────────────────────────────

/** Historical labour status breakdown for dates before clinic-local today. */
export type HistoricalBreakdown = {
  /** Approved timesheets — confirmed labour cost. */
  approved: CostBreakdown;
  /** Pending Approval (timesheetStatus = "submitted"). */
  pending: CostBreakdown;
  /** Rejected — shown for visibility, excluded from planning estimate. */
  rejected: CostBreakdown;
  /** Requires Amendment — own exception category, excluded from planning estimate. */
  requiresAmendment: CostBreakdown;
  /** Draft hourly timesheets — no cost, report count only. */
  incomplete: ExceptionSummary;
  /** Historical roster entries with no linked timesheet. */
  missing: ExceptionSummary;
};

// ── Future forecast section ───────────────────────────────────────────────────

/** Projected costs per shift type within the future forecast window. */
export type ShiftTypeProjection = {
  shiftType: string;
  projectedHours: number;
  /** null when the caller lacks payroll:rates:read. */
  baseCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  superCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  totalCost: number | null;
  usingFallbackForSomeStaff: boolean;
};

/** Future forecast section (null when date range contains no future dates). */
export type FutureForecastSection = {
  totalHours: number;
  /** null when the caller lacks payroll:rates:read. */
  baseCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  superCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  totalCost: number | null;
  anyStaffUsingFallback: boolean;
  breakdownByShiftType: ShiftTypeProjection[];
};

// ── Planning estimate ─────────────────────────────────────────────────────────

/**
 * Planning estimate = Approved + Pending Approval + Future Forecast.
 * All cost fields are null when the caller lacks "payroll:rates:read".
 */
export type PlanningEstimate = {
  /** null when the caller lacks payroll:rates:read. */
  approvedCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  pendingCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  futureCost: number | null;
  /** null when the caller lacks payroll:rates:read. */
  totalCost: number | null;
};

// ── Staff breakdown ───────────────────────────────────────────────────────────

/**
 * Per-staff cost breakdown row.
 *
 * Rate and cost fields are null when the API caller does not have
 * "payroll:rates:read" permission (GPM without explicit rate access).
 * Hours fields are always present.
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
  baseHourlyRate: number | null;
  superRatePercent: number | null;
  rateSource: "configured" | "fallback" | null;
  // Costs — null when redacted
  approvedCost: number | null;
  pendingCost: number | null;
  rejectedCost: number | null;
  requiresAmendmentCost: number | null;
  futureCost: number | null;
};

// ── Data quality ──────────────────────────────────────────────────────────────

export type DataQuality = {
  hasIncompleteTimesheets: boolean;
  hasMissingTimesheets: boolean;
  hasRejectedTimesheets: boolean;
  hasRequiresAmendment: boolean;
};

// ── Top-level response ────────────────────────────────────────────────────────

/** Full Labour Cost Analysis response from GET /clinics/:clinicId/forecast/labor. */
export type LaborCostAnalysis = {
  clinicId: string;
  dateRange: { from: string; to: string; timezone: string };
  /** null when the date range contains no historical dates. */
  historical: HistoricalBreakdown | null;
  /** null when the date range contains no future dates. */
  futureForecast: FutureForecastSection | null;
  planningEstimate: PlanningEstimate;
  staffBreakdown: StaffCostBreakdown[];
  dataQuality: DataQuality;
};

// ── Legacy alias (kept to avoid breaking imports elsewhere) ───────────────────
/** @deprecated Use LaborCostAnalysis. Kept for any remaining references. */
export type LaborForecastSummary = LaborCostAnalysis;

// ── Group analysis types ─────────────────────────────────────────────────────

/** Per-clinic entry within a group labour cost analysis. */
export type GroupClinicEntry = {
  clinicId: string;
  clinicName: string;
  timezone: string;
  /** Full per-clinic analysis (all monetary values in AUD dollars). */
  analysis: LaborCostAnalysis;
};

/** Aggregated group totals (all monetary values in AUD dollars). */
export type GroupLaborTotals = {
  /** Sum of approved + pending + future hours across all clinics. */
  totalHours: number;
  approvedCost: number | null;
  pendingCost: number | null;
  futureCost: number | null;
  totalCost: number | null;
  /** Sum of missing shift counts across all clinics. */
  missingCount: number;
};

/**
 * Full group Labour Cost Analysis response from GET /api/v1/forecast/labor/group.
 * Accessible to owner_admin only (V1).
 */
export type GroupLaborCostAnalysis = {
  scope: "all_clinics";
  dateRange: { from: string; to: string };
  totals: GroupLaborTotals;
  clinics: GroupClinicEntry[];
};
