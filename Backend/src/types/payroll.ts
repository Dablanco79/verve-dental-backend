// ─────────────────────────────────────────────────────────────────────────────
// Payroll, Timesheets, and Leave Management — canonical TypeScript types.
//
// These types mirror the 008_payroll_and_leave_schema migration exactly.
// The `as const` arrays are the single source of truth for each ENUM's
// allowed values — Zod validators in controllers derive from them directly
// (z.enum(PAYROLL_TYPES)) so no string duplication exists in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

// ── ENUMs ─────────────────────────────────────────────────────────────────────

/**
 * A staff member's payroll contract arrangement.
 * Stored on the users row and used by the roster-completion hook to decide
 * which timesheet entry type to auto-generate.
 *
 *   hourly     → support staff and hourly-rate dentists.
 *                Hook generates a 'hourly_auto' draft timesheet entry.
 *   commission → dentists/specialists paid by percentage-of-collections.
 *                Hook generates a 'commission_log' pending-verification entry.
 */
export const STAFF_PAYROLL_TRACKS = ["hourly", "commission"] as const;
export type StaffPayrollTrack = (typeof STAFF_PAYROLL_TRACKS)[number];

/**
 * Payroll track discriminator. Determines which fields are populated on a
 * timesheet_entries row and which workflow applies.
 *
 * hourly_auto   → system-generated from a completed roster shift (clock-in/out required).
 * hourly_manual → manager-entered back-fill or correction (no mandatory roster link).
 * commission_log → provider attendance record; no clock-in/out; verified via
 *                  attendance_status by a manager.
 */
export const PAYROLL_TYPES = [
  "hourly_auto",
  "hourly_manual",
  "commission_log",
] as const;

export type PayrollType = (typeof PAYROLL_TYPES)[number];

/**
 * Attendance status — the materials forecasting safeguard enum.
 *
 * RULE (non-negotiable):
 *   'present'          → forecasting engine calculates FULL expected material usage.
 *   'absent' | 'sick'  → forecasting engine evaluates material usage as exactly ZERO.
 *   'pending_verification' → commission_log default; forecasting engine SKIPS this shift.
 *   'cancelled'        → shift did not occur (e.g. patient cancellation storm); ZERO usage.
 *
 * commission_log entries are ALWAYS created as 'pending_verification'.
 * A manager must explicitly set 'present' before usage is counted.
 */
export const ATTENDANCE_STATUSES = [
  "pending_verification",
  "present",
  "absent",
  "sick",
  "cancelled",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Hourly timesheet submission and approval lifecycle.
 * NULL for commission_log entries (they use attendance_status instead).
 *
 * draft              → being entered by manager or system; not yet submitted.
 * submitted          → submitted for manager review.
 * approved           → manager approved; eligible for payroll export.
 * rejected           → manager rejected; requires staff/manager correction.
 * requires_amendment → conditionally approved pending a specific correction.
 * processed          → exported to payroll adapter (Xero/MYOB/KeyPay/CSV); immutable.
 */
export const TIMESHEET_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "requires_amendment",
  "processed",
] as const;

export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/**
 * Leave categories under the Australian Fair Work Act / National Employment Standards.
 *
 * annual        → Annual leave (NES: 4 weeks/year for full-time).
 * sick          → Personal/carer's leave used for own illness.
 * personal      → Personal/carer's leave used to care for a family member.
 * compassionate → Compassionate/bereavement leave (NES: 2 days per permissible occasion).
 * unpaid        → Unpaid leave (parental, community service, agreed arrangement).
 * other         → Enterprise-agreement or award-specific leave types.
 */
export const LEAVE_TYPES = [
  "annual",
  "sick",
  "personal",
  "compassionate",
  "unpaid",
  "other",
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

/**
 * Leave request lifecycle.
 * 'withdrawn' (not 'cancelled') — the employee withdraws their own request.
 * Admin cancellation of an approved leave is a future feature handled separately.
 */
export const LEAVE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

// ── Table row shapes ──────────────────────────────────────────────────────────

/**
 * Unified timesheet / provider attendance record.
 * Track-specific fields are `null` when not applicable to the payroll_type:
 *
 *   Hourly fields  (clockInAt, clockOutAt, breakDurationMinutes, hour buckets,
 *                   timesheetStatus, approvedByUserId, approvedAt, approvalNotes)
 *                → null for commission_log
 *
 *   Commission field (commissionNote)
 *                → null for hourly_auto / hourly_manual
 *
 * The repository layer maps DB snake_case → camelCase. Date columns from the
 * DB arrive as JavaScript Date objects (node-postgres default).
 */
export type TimesheetEntry = {
  id: string;

  // ── Track discriminator ────────────────────────────────────────────────────
  payrollType: PayrollType;

  // ── Staff identity ─────────────────────────────────────────────────────────
  // staffEmail is denormalized for display — avoids a users JOIN on every
  // audit/reporting query (matches the pattern in roster_entries and
  // inventory_adjustments).
  staffUserId: string;
  staffEmail: string;

  // ── Clinic context ─────────────────────────────────────────────────────────
  // clinicId       = users.home_clinic_id — payroll grouping / reporting scope.
  // rosteredClinicId = where the work physically occurred — may differ from
  //                    home clinic for cross-location deployments.
  clinicId: string;
  rosteredClinicId: string;
  rosteredClinicName: string;

  // ── Roster link ────────────────────────────────────────────────────────────
  // null for hourly_manual back-fills / corrections with no roster shift.
  rosterEntryId: string | null;

  // ── Shift window ───────────────────────────────────────────────────────────
  // shiftDate is a YYYY-MM-DD string (DB `date` type — no time component).
  // shiftStartAt / shiftEndAt are full timestamps (DB `timestamptz`).
  shiftDate: string;
  shiftStartAt: Date;
  shiftEndAt: Date;

  // ── Attendance status (FORECASTING SAFEGUARD) ──────────────────────────────
  attendanceStatus: AttendanceStatus;

  // ── Hourly clocking (null for commission_log) ──────────────────────────────
  clockInAt: Date | null;
  clockOutAt: Date | null;
  breakDurationMinutes: number | null;

  // ── Accounting-agnostic hour breakdown (null for commission_log) ───────────
  // Pre-calculated by the payroll engine. The Module 09 adapter layer maps
  // these generic numeric fields to Xero / MYOB / KeyPay / CSV column names
  // at export time — no schema change required to support a new integration.
  totalHoursWorked: number | null;
  ordinaryHours: number | null;
  /** Hours at 1.5× rate (Australian Award overtime threshold 1). */
  overtime15xHours: number | null;
  /** Hours at 2.0× rate (Australian Award overtime threshold 2). */
  overtime2xHours: number | null;
  /** Catch-all band for enterprise-agreement or award-specific overtime rates. */
  overtimeCustomHours: number | null;

  // ── Timesheet workflow (null for commission_log) ───────────────────────────
  timesheetStatus: TimesheetStatus | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  approvalNotes: string | null;

  // ── Commission annotation (null for hourly tracks) ─────────────────────────
  // Manager-entered note when verifying provider attendance.
  // e.g. "Left early — half-day patient load", "No-show confirmed by reception".
  commissionNote: string | null;

  // ── Generation metadata ────────────────────────────────────────────────────
  // 'system_auto'    → created by the roster-completion hook.
  // 'manager_manual' → created by a manager directly.
  // <email>          → created by a specific named user.
  generatedBy: string;

  createdAt: Date;
  updatedAt: Date;
};

/**
 * Leave request row shape. `reason` is the employee's explanation;
 * `reviewNotes` is the manager's response on approve/reject.
 * Both may be null (reason is optional on request; reviewNotes before action).
 */
export type LeaveRequest = {
  id: string;
  staffUserId: string;
  /** Denormalized for display without a users JOIN. */
  staffEmail: string;
  /** home_clinic_id — payroll grouping. */
  clinicId: string;
  leaveType: LeaveType;
  /** Inclusive start date. YYYY-MM-DD (DB `date` type). */
  startDate: string;
  /** Inclusive end date. YYYY-MM-DD (DB `date` type). */
  endDate: string;
  /** Decimal to support half-day requests (0.5, 1.5, etc.). */
  totalDays: number;
  /** Employee's explanation for the request. */
  reason: string | null;
  status: LeaveRequestStatus;
  /** null until a manager acts on the request. */
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  /** Manager's notes on approval or rejection. */
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Input shapes ──────────────────────────────────────────────────────────────

/**
 * Input for creating a new timesheet entry (hourly or commission track).
 * `timesheetStatus` is excluded — the service sets it based on `payrollType`:
 *   hourly_auto / hourly_manual → 'draft'
 *   commission_log              → null
 */
export type CreateTimesheetEntryInput = Omit<
  TimesheetEntry,
  | "id"
  | "timesheetStatus"
  | "approvedByUserId"
  | "approvedAt"
  | "approvalNotes"
  | "createdAt"
  | "updatedAt"
>;

/**
 * Atomic payload produced by `clockUpdatePayload()` in the service layer.
 * Bundles the raw clock-out fields with all derived hour columns so the
 * repository `update()` method can only write clock-out data as a single
 * indivisible unit — it is structurally impossible to mutate `clockOutAt` or
 * `breakDurationMinutes` without simultaneously recalculating the hour buckets.
 */
export type ClockMutation = {
  clockOutAt: Date;
  breakDurationMinutes: number;
  totalHoursWorked: number;
  ordinaryHours: number;
  overtime15xHours: number;
  overtime2xHours: number;
  overtimeCustomHours: number;
};

/**
 * Fields a manager may update on an existing timesheet entry.
 * Processed entries are frozen at the service layer — this type does not
 * enforce that; the service checks `timesheetStatus !== 'processed'`.
 *
 * FIX LOW — Clock-field atomicity enforcement:
 *   `clockOutAt` and `breakDurationMinutes` are NOT individually updatable.
 *   They may only be written as part of a `clockMutation` bundle, which
 *   forces the five derived hour-bucket columns to be recalculated in the
 *   same repository call.  `clockInAt` is excluded entirely — it is set once
 *   at `create()` time and never subsequently changed.
 *
 *   The individual hour-bucket fields (`totalHoursWorked` etc.) remain
 *   directly settable for the approval re-calculation path, where the manager
 *   recomputes hours from stored clock times without changing the clock times.
 */
export type UpdateTimesheetEntryInput = Partial<{
  attendanceStatus: AttendanceStatus;
  timesheetStatus: TimesheetStatus | null;
  /** Atomically writes clock-out + all derived hour columns.  Must be produced by clockUpdatePayload(). */
  clockMutation: ClockMutation;
  totalHoursWorked: number | null;
  ordinaryHours: number | null;
  overtime15xHours: number | null;
  overtime2xHours: number | null;
  overtimeCustomHours: number | null;
  commissionNote: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  approvalNotes: string | null;
}>;

/**
 * Input for submitting a new leave request.
 * Excludes server-managed fields and the approval/review fields
 * (those are set when a manager acts on the request).
 */
export type CreateLeaveRequestInput = Omit<
  LeaveRequest,
  | "id"
  | "status"
  | "reviewedByUserId"
  | "reviewedAt"
  | "reviewNotes"
  | "createdAt"
  | "updatedAt"
>;

/**
 * Input for a manager acting on a leave request (approve / reject / withdraw).
 * `reviewNotes` is required when rejecting so staff understand the reason.
 */
export type UpdateLeaveStatusInput = {
  status: LeaveRequestStatus;
  reviewedByUserId: string;
  reviewNotes: string | null;
};

// ── List / filter options ─────────────────────────────────────────────────────

export type ListTimesheetOptions = {
  /** Filter to a single date (YYYY-MM-DD). */
  shiftDate?: string;
  /** Filter from this date inclusive (YYYY-MM-DD). */
  from?: string;
  /** Filter to this date inclusive (YYYY-MM-DD). */
  to?: string;
  payrollType?: PayrollType;
  attendanceStatus?: AttendanceStatus;
  timesheetStatus?: TimesheetStatus;
  /** If true, only return entries where timesheetStatus = 'submitted'. */
  pendingApprovalOnly?: boolean;
};

export type ListLeaveOptions = {
  from?: string;
  to?: string;
  leaveType?: LeaveType;
  status?: LeaveRequestStatus;
};
