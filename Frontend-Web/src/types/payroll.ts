/**
 * Module 05 — Payroll, Timesheets & Leave Management (Frontend types)
 *
 * Mirrors Backend/src/types/payroll.ts.
 * All Date objects are ISO-8601 strings here — the API serialises every
 * timestamp before the JSON response leaves the server.
 *
 * `as const` arrays are the single source of truth for each ENUM domain;
 * label maps and type aliases derive from them so string literals never
 * drift between the type layer and the UI.
 */

// ── ENUMs ─────────────────────────────────────────────────────────────────────

/**
 * A staff member's payroll contract arrangement (stored on the users row).
 * Determines which timesheet entry type the roster-completion hook creates.
 *
 *   hourly     → support staff and hourly-rate clinicians.
 *   commission → dentists/specialists paid by percentage-of-collections.
 */
export const STAFF_PAYROLL_TRACKS = ["hourly", "commission"] as const;
export type StaffPayrollTrack = (typeof STAFF_PAYROLL_TRACKS)[number];

/**
 * Payroll track discriminator on `timesheet_entries`.
 *
 *   hourly_auto    → system-generated from a completed roster shift.
 *   hourly_manual  → manager back-fill or correction; no mandatory roster link.
 *   commission_log → provider attendance record; clock-in/out not used.
 */
export const PAYROLL_TYPES = [
  "hourly_auto",
  "hourly_manual",
  "commission_log",
] as const;
export type PayrollType = (typeof PAYROLL_TYPES)[number];

/**
 * Attendance verification status — the **materials forecasting safeguard**.
 *
 * RULE (non-negotiable):
 *   'present'              → forecasting engine counts FULL expected material usage.
 *   'absent' | 'sick'      → material usage = ZERO for that shift.
 *   'pending_verification' → commission_log default; forecasting engine SKIPS.
 *   'cancelled'            → shift did not occur; ZERO usage.
 *
 * commission_log entries are ALWAYS created as 'pending_verification'.
 * A manager must explicitly set 'present' before the shift is counted.
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
 * Hourly timesheet approval lifecycle.
 * commission_log entries do NOT use this field (null in API responses).
 *
 *   draft              → being entered; not yet submitted.
 *   submitted          → awaiting manager review.
 *   approved           → manager approved; eligible for payroll export.
 *   rejected           → requires staff/manager correction.
 *   requires_amendment → conditionally approved pending a specific fix.
 *   processed          → exported to payroll adapter (Xero/MYOB/KeyPay/CSV); immutable.
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
 *   annual        → Annual leave (NES: 4 weeks/year full-time).
 *   sick          → Personal/carer's leave for own illness.
 *   personal      → Personal/carer's leave for family member.
 *   compassionate → Compassionate/bereavement leave (NES: 2 days per occasion).
 *   unpaid        → Unpaid leave (parental, community service, agreed arrangement).
 *   other         → Enterprise-agreement or award-specific types.
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
 * 'withdrawn' — the employee withdraws their own pending request.
 */
export const LEAVE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

// ── Domain shapes (API response) ──────────────────────────────────────────────

/**
 * Unified timesheet / provider attendance record as returned by the API.
 * All timestamps are ISO-8601 strings. Track-specific fields are null when
 * they do not apply to the entry's payrollType.
 *
 * Hourly-only fields  → null for commission_log
 * Commission-only field (commissionNote) → null for hourly_auto / hourly_manual
 */
export type TimesheetEntry = {
  id: string;

  // ── Track discriminator ──────────────────────────────────────────────────
  payrollType: PayrollType;

  // ── Staff identity ───────────────────────────────────────────────────────
  staffUserId: string;
  /** Denormalized for display — avoids a users JOIN on every list query. */
  staffEmail: string;

  // ── Clinic context ───────────────────────────────────────────────────────
  /** users.home_clinic_id — payroll grouping / reporting scope. */
  clinicId: string;
  /** Physical location the work occurred; may differ from home clinic. */
  rosteredClinicId: string;
  rosteredClinicName: string;

  // ── Roster link ──────────────────────────────────────────────────────────
  /** null for hourly_manual back-fills with no corresponding roster shift. */
  rosterEntryId: string | null;

  // ── Shift window ─────────────────────────────────────────────────────────
  /** YYYY-MM-DD — date-only, used for quick date-range display. */
  shiftDate: string;
  /** UTC ISO-8601 timestamp. */
  shiftStartAt: string;
  /** UTC ISO-8601 timestamp. */
  shiftEndAt: string;

  // ── Attendance status (FORECASTING SAFEGUARD) ────────────────────────────
  attendanceStatus: AttendanceStatus;

  // ── Hourly clocking (null for commission_log) ────────────────────────────
  clockInAt: string | null;
  clockOutAt: string | null;
  breakDurationMinutes: number | null;

  // ── Accounting-agnostic hour breakdown (null for commission_log) ─────────
  totalHoursWorked: number | null;
  ordinaryHours: number | null;
  /** Hours at 1.5× rate (Australian Award overtime threshold 1). */
  overtime15xHours: number | null;
  /** Hours at 2.0× rate (Australian Award overtime threshold 2). */
  overtime2xHours: number | null;
  /** Catch-all for enterprise-agreement or award-specific overtime rates. */
  overtimeCustomHours: number | null;

  // ── Timesheet workflow (null for commission_log) ─────────────────────────
  timesheetStatus: TimesheetStatus | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;

  // ── Commission annotation (null for hourly tracks) ───────────────────────
  /** Manager-entered note when verifying provider attendance. */
  commissionNote: string | null;

  // ── Generation metadata ──────────────────────────────────────────────────
  /** 'system_auto' | 'manager_manual' | <user email> */
  generatedBy: string;

  createdAt: string;
  updatedAt: string;
};

/** Leave request as returned by the API. */
export type LeaveRequest = {
  id: string;
  staffUserId: string;
  /** Denormalized for display without a users JOIN. */
  staffEmail: string;
  /** home_clinic_id — payroll grouping. */
  clinicId: string;
  leaveType: LeaveType;
  /** Inclusive start date — YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date — YYYY-MM-DD. */
  endDate: string;
  /** Decimal to support half-day requests (0.5, 1.5, etc.). */
  totalDays: number;
  /** Employee's explanation for the request. */
  reason: string | null;
  status: LeaveRequestStatus;
  /** null until a manager acts on the request. */
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  /** Manager's notes on approval or rejection. */
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Request body shapes ───────────────────────────────────────────────────────

/** POST /clinics/:clinicId/timesheets/clock-in */
export type ClockInRequest = {
  rosterEntryId?: string | null;
  rosteredClinicId: string;
  rosteredClinicName: string;
  shiftStartAt: string;
  shiftEndAt: string;
  notes?: string | null;
};

/** POST /clinics/:clinicId/timesheets/:timesheetId/clock-out */
export type ClockOutRequest = {
  clockOutAt: string;
  breakDurationMinutes: number;
};

/** POST /clinics/:clinicId/timesheets (manager manual entry) */
export type CreateManualTimesheetRequest = {
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  rosterEntryId?: string | null;
  payrollType: "hourly_manual" | "commission_log";
  shiftDate: string;
  shiftStartAt: string;
  shiftEndAt: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  breakDurationMinutes?: number | null;
  commissionNote?: string | null;
};

/** POST /clinics/:clinicId/timesheets/:timesheetId/approve */
export type ApproveTimesheetRequest = {
  approvalNotes?: string | null;
};

/** POST /clinics/:clinicId/timesheets/:timesheetId/reject */
export type RejectTimesheetRequest = {
  approvalNotes: string;
};

/** POST /clinics/:clinicId/timesheets/:timesheetId/verify-attendance */
export type VerifyAttendanceRequest = {
  attendanceStatus: "present" | "absent" | "sick" | "cancelled";
  commissionNote?: string | null;
};

/** POST /clinics/:clinicId/leave (all roles) */
export type CreateLeaveRequest = {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason?: string | null;
};

/** POST /clinics/:clinicId/leave/:leaveId/approve */
export type ApproveLeaveRequest = {
  reviewNotes?: string | null;
};

/** POST /clinics/:clinicId/leave/:leaveId/reject */
export type RejectLeaveRequest = {
  reviewNotes: string;
};

// ── Query filter shapes ───────────────────────────────────────────────────────

/** Query parameters accepted by GET /clinics/:clinicId/timesheets */
export type TimesheetFilters = {
  shiftDate?: string;
  from?: string;
  to?: string;
  payrollType?: PayrollType;
  attendanceStatus?: AttendanceStatus;
  timesheetStatus?: TimesheetStatus;
  pendingApprovalOnly?: boolean;
};

/** Query parameters accepted by GET /clinics/:clinicId/leave */
export type LeaveFilters = {
  from?: string;
  to?: string;
  leaveType?: LeaveType;
  status?: LeaveRequestStatus;
};

// ── Display helpers ───────────────────────────────────────────────────────────

export const PAYROLL_TYPE_LABELS: Record<PayrollType, string> = {
  hourly_auto: "Hourly (Auto)",
  hourly_manual: "Hourly (Manual)",
  commission_log: "Commission",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  pending_verification: "Pending Verification",
  present: "Present",
  absent: "Absent",
  sick: "Sick",
  cancelled: "Cancelled",
};

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  requires_amendment: "Requires Amendment",
  processed: "Processed",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  personal: "Personal / Carer's",
  compassionate: "Compassionate",
  unpaid: "Unpaid Leave",
  other: "Other",
};

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
