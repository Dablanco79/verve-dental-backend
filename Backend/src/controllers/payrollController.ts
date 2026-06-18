// ─────────────────────────────────────────────────────────────────────────────
// Payroll Controller — Leave & Timesheet HTTP handlers
//
// Two factory functions are exported from this file:
//   createLeaveHandlers(leaveService)       — leave request lifecycle
//   createTimesheetHandlers(timesheetService) — timesheet clocking + approvals
//
// All Zod schemas use the `as const` enum arrays from types/payroll.ts as the
// single source of truth for allowed values.  parseBody() throws a 400
// AppError on validation failure; asyncHandler() in the route layer forwards
// it to the global errorHandler.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";

import type { LeaveService } from "../services/leaveService.js";
import type { TimesheetService } from "../services/timesheetService.js";
import type { LeaveRequest, TimesheetEntry } from "../types/payroll.js";
import {
  ATTENDANCE_STATUSES,
  LEAVE_REQUEST_STATUSES,
  LEAVE_TYPES,
  PAYROLL_TYPES,
  TIMESHEET_STATUSES,
} from "../types/payroll.js";
import { AppError } from "../types/errors.js";
import { parseBody, zodToDetails } from "../utils/validation.js";

// ── Shared primitives ─────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Express types req.params values as string | string[]; normalise to string.
function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

function requireUuidParam(req: Request, paramName: string): string {
  const value = routeParam(req.params[paramName]);
  if (!UUID_REGEX.test(value)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      [{ field: paramName, message: `${paramName} must be a valid UUID` }],
    );
  }
  return value;
}

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.user;
}

// Calendar dates (YYYY-MM-DD) — leave and timesheet shift dates are date-only.
// A strict regex is used instead of z.coerce.date() to prevent any implicit
// timezone conversion at the parsing layer; the service works in UTC.
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = () =>
  z.string().regex(ISO_DATE_REGEX, "Must be a YYYY-MM-DD date string");

// Full ISO 8601 datetimes with timezone — { offset: true } accepts both UTC
// ('Z') and local offsets (e.g. '+10:00' for AEST).
const isoDatetime = () => z.string().datetime({ offset: true });

// ── Serializers ───────────────────────────────────────────────────────────────
// Date objects are serialized to ISO strings here so the service layer never
// needs to know about the HTTP response format.

function serializeLeave(r: LeaveRequest) {
  return {
    id: r.id,
    staffUserId: r.staffUserId,
    staffEmail: r.staffEmail,
    clinicId: r.clinicId,
    leaveType: r.leaveType,
    startDate: r.startDate,
    endDate: r.endDate,
    totalDays: r.totalDays,
    reason: r.reason,
    status: r.status,
    reviewedByUserId: r.reviewedByUserId,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNotes: r.reviewNotes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeTimesheet(e: TimesheetEntry) {
  return {
    id: e.id,
    payrollType: e.payrollType,
    staffUserId: e.staffUserId,
    staffEmail: e.staffEmail,
    clinicId: e.clinicId,
    rosteredClinicId: e.rosteredClinicId,
    rosteredClinicName: e.rosteredClinicName,
    rosterEntryId: e.rosterEntryId,
    shiftDate: e.shiftDate,
    shiftStartAt: e.shiftStartAt.toISOString(),
    shiftEndAt: e.shiftEndAt.toISOString(),
    attendanceStatus: e.attendanceStatus,
    clockInAt: e.clockInAt?.toISOString() ?? null,
    clockOutAt: e.clockOutAt?.toISOString() ?? null,
    breakDurationMinutes: e.breakDurationMinutes,
    totalHoursWorked: e.totalHoursWorked,
    ordinaryHours: e.ordinaryHours,
    overtime15xHours: e.overtime15xHours,
    overtime2xHours: e.overtime2xHours,
    overtimeCustomHours: e.overtimeCustomHours,
    timesheetStatus: e.timesheetStatus,
    approvedByUserId: e.approvedByUserId,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    approvalNotes: e.approvalNotes,
    commissionNote: e.commissionNote,
    generatedBy: e.generatedBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// =============================================================================
// LEAVE HANDLERS
// =============================================================================

// ── Zod schemas (leave) ───────────────────────────────────────────────────────

const createLeaveSchema = z
  .object({
    leaveType: z.enum(LEAVE_TYPES),
    startDate: isoDate(),
    endDate: isoDate(),
    // Decimal to support half-day requests (e.g. 0.5, 1.5).
    totalDays: z.number().positive("totalDays must be greater than zero"),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

// reviewNotes is optional for approvals but the manager may attach a note.
const approveLeaveSchema = z
  .object({
    reviewNotes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

// reviewNotes is MANDATORY for rejections so staff understand the decision.
const rejectLeaveSchema = z
  .object({
    reviewNotes: z
      .string()
      .trim()
      .min(1, "A review note explaining the rejection is required")
      .max(2000),
  })
  .strict();

// Supports filtering by date window, leave type, and status.
// from/to are YYYY-MM-DD (not full timestamps) to avoid timezone ambiguity.
const listLeaveQuerySchema = z
  .object({
    from: isoDate().optional(),
    to: isoDate().optional(),
    leaveType: z.enum(LEAVE_TYPES).optional(),
    status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'from' must be on or before 'to'",
        path: ["from"],
      });
    }
  });

// ── Factory ───────────────────────────────────────────────────────────────────

export function createLeaveHandlers(leaveService: LeaveService) {
  return {
    /**
     * POST /clinics/:clinicId/leave
     * Staff submits a leave request for their home clinic.
     * Managers/admins may also submit on behalf of staff (e.g. retrospective
     * sick leave).  The service enforces clinic-match for clinical_staff.
     */
    async createLeaveRequest(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const body = parseBody(createLeaveSchema, req.body);

      const request = await leaveService.createLeaveRequest(caller, clinicId, {
        leaveType: body.leaveType,
        startDate: body.startDate,
        endDate: body.endDate,
        totalDays: body.totalDays,
        reason: body.reason ?? null,
      });

      res.status(201).json({ data: serializeLeave(request) });
    },

    /**
     * GET /clinics/:clinicId/leave
     * Manager/admin lists all leave requests for the clinic.
     * The service enforces assertReviewAccess so clinical_staff cannot reach here
     * even if the role guard were bypassed.
     */
    async listClinicLeave(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = listLeaveQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const requests = await leaveService.getLeaveForClinic(
        caller,
        clinicId,
        parsed.data,
      );

      res.status(200).json({ data: requests.map(serializeLeave) });
    },

    /**
     * GET /clinics/:clinicId/leave/me
     * Any authenticated user retrieves their own leave history.
     * Managers can also use this endpoint to view their personal leave
     * separately from the clinic-wide GET /.
     */
    async listMyLeave(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = listLeaveQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const requests = await leaveService.getLeaveForStaff(
        caller,
        caller.id,
        clinicId,
        parsed.data,
      );

      res.status(200).json({ data: requests.map(serializeLeave) });
    },

    /**
     * POST /clinics/:clinicId/leave/:leaveId/approve
     * Manager approves a pending leave request.
     * The service automatically cancels any overlapping scheduled/confirmed
     * roster shifts for the staff member (roster guardrail).
     */
    async approveLeaveRequest(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const leaveId = requireUuidParam(req, "leaveId");
      const body = parseBody(approveLeaveSchema, req.body);

      const request = await leaveService.approveLeaveRequest(
        caller,
        clinicId,
        leaveId,
        body.reviewNotes ?? null,
      );

      res.status(200).json({ data: serializeLeave(request) });
    },

    /**
     * POST /clinics/:clinicId/leave/:leaveId/reject
     * Manager rejects a pending leave request.
     * reviewNotes is mandatory — the service also enforces this, giving
     * the client a clear error code (REVIEW_NOTES_REQUIRED) if omitted.
     */
    async rejectLeaveRequest(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const leaveId = requireUuidParam(req, "leaveId");
      const body = parseBody(rejectLeaveSchema, req.body);

      const request = await leaveService.rejectLeaveRequest(
        caller,
        clinicId,
        leaveId,
        body.reviewNotes,
      );

      res.status(200).json({ data: serializeLeave(request) });
    },

    /**
     * POST /clinics/:clinicId/leave/:leaveId/withdraw
     * Staff member withdraws their own pending leave request.
     * No body is required — the service enforces ownership (caller.id must
     * match staffUserId, or caller is owner_admin).
     */
    async withdrawLeaveRequest(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const leaveId = requireUuidParam(req, "leaveId");

      const request = await leaveService.withdrawLeaveRequest(
        caller,
        clinicId,
        leaveId,
      );

      res.status(200).json({ data: serializeLeave(request) });
    },
  };
}

export type LeaveHandlers = ReturnType<typeof createLeaveHandlers>;

// =============================================================================
// TIMESHEET HANDLERS
// =============================================================================

// ── Zod schemas (timesheet) ───────────────────────────────────────────────────

// rosteredClinicId and rosteredClinicName are intentionally absent — the
// service derives both server-side from the trusted roster DB record (when a
// rosterEntryId is supplied) or from the route clinicId + DB clinic name
// (ad-hoc clock-ins).  Accepting these fields from the body would allow a
// staff member to spoof their rostered location.
const clockInSchema = z
  .object({
    // null = no roster link (ad-hoc clock-in without a matching shift).
    rosterEntryId: z
      .string()
      .uuid("rosterEntryId must be a valid UUID")
      .nullable()
      .optional(),
    shiftDate: isoDate(),
    shiftStartAt: isoDatetime(),
    shiftEndAt: isoDatetime(),
  })
  .strict();

const clockOutSchema = z
  .object({
    breakDurationMinutes: z
      .number()
      .int("breakDurationMinutes must be a whole number of minutes")
      .min(0, "breakDurationMinutes cannot be negative"),
  })
  .strict();

// Managers only.  All clock times must be provided; the service calculates
// hour buckets and immediately advances the entry to 'submitted'.
// staffEmail, rosteredClinicId, and rosteredClinicName are intentionally
// absent — the service derives all three server-side from trusted DB records
// to prevent identity and rostered-location spoofing.
const createManualEntrySchema = z
  .object({
    staffUserId: z.string().uuid("staffUserId must be a valid UUID"),
    rosterEntryId: z
      .string()
      .uuid("rosterEntryId must be a valid UUID")
      .nullable()
      .optional(),
    shiftDate: isoDate(),
    shiftStartAt: isoDatetime(),
    shiftEndAt: isoDatetime(),
    clockInAt: isoDatetime(),
    clockOutAt: isoDatetime(),
    breakDurationMinutes: z
      .number()
      .int("breakDurationMinutes must be a whole number of minutes")
      .min(0, "breakDurationMinutes cannot be negative"),
  })
  .strict();

// approvalNotes is optional on approvals but required on rejections.
const approveTimesheetSchema = z
  .object({
    approvalNotes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const rejectTimesheetSchema = z
  .object({
    approvalNotes: z
      .string()
      .trim()
      .min(1, "A rejection note is required")
      .max(2000),
  })
  .strict();

// 'pending_verification' is excluded from the allowed set — it is the default
// state assigned by the system.  Managers advance a commission_log entry to a
// decisive status; they cannot set it back to pending.
const verifyAttendanceSchema = z
  .object({
    attendanceStatus: z.enum([
      "present",
      "absent",
      "sick",
      "cancelled",
    ] as const),
    commissionNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

// Query strings are always strings; pendingApprovalOnly is coerced from the
// "true" / "false" literals to a proper boolean so the service receives the
// correct type.  Any other value (e.g. "yes", "1") produces a 400.
const listTimesheetsQuerySchema = z
  .object({
    shiftDate: isoDate().optional(),
    from: isoDate().optional(),
    to: isoDate().optional(),
    payrollType: z.enum(PAYROLL_TYPES).optional(),
    attendanceStatus: z.enum(ATTENDANCE_STATUSES).optional(),
    timesheetStatus: z.enum(TIMESHEET_STATUSES).optional(),
    pendingApprovalOnly: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'from' must be on or before 'to'",
        path: ["from"],
      });
    }
    // shiftDate is a point-in-time filter; combining it with a range is
    // ambiguous and most likely a client mistake.
    if (data.shiftDate && (data.from ?? data.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'shiftDate' cannot be combined with 'from' or 'to' range filters",
        path: ["shiftDate"],
      });
    }
  });

// Forecast endpoint requires exactly one date — no range, no ambiguity.
const forecastQuerySchema = z.object({
  date: isoDate(),
});

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTimesheetHandlers(timesheetService: TimesheetService) {
  return {
    /**
     * POST /clinics/:clinicId/timesheets/clock-in
     * Clinical staff clocks in for a shift, creating an 'hourly_auto' draft.
     * The service rejects clock-ins from manager/admin roles — they must use
     * createManualEntry() instead.
     */
    async clockIn(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const body = parseBody(clockInSchema, req.body);

      const entry = await timesheetService.clockIn(caller, clinicId, {
        rosterEntryId: body.rosterEntryId ?? null,
        shiftDate: body.shiftDate,
        shiftStartAt: new Date(body.shiftStartAt),
        shiftEndAt: new Date(body.shiftEndAt),
      });

      res.status(201).json({ data: serializeTimesheet(entry) });
    },

    /**
     * POST /clinics/:clinicId/timesheets/:timesheetId/clock-out
     * Staff clocks out of their open timesheet entry.
     * The clinicId route param is forwarded to the service so the entry is
     * scoped to the correct clinic and cannot be accessed cross-tenant.
     * Hour buckets are calculated and timesheetStatus advances to 'submitted',
     * which places the entry in the manager's approval queue.
     */
    async clockOut(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const timesheetId = requireUuidParam(req, "timesheetId");
      const body = parseBody(clockOutSchema, req.body);

      const entry = await timesheetService.clockOut(
        caller,
        clinicId,
        timesheetId,
        body.breakDurationMinutes,
      );

      res.status(200).json({ data: serializeTimesheet(entry) });
    },

    /**
     * GET /clinics/:clinicId/timesheets
     * Manager/admin lists timesheet entries for the clinic.
     * Rich filter support: date range, payroll type, attendance/timesheet
     * status, and a pendingApprovalOnly=true shortcut for the approval queue.
     */
    async listTimesheets(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = listTimesheetsQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const entries = await timesheetService.listTimesheetsForClinic(
        caller,
        clinicId,
        {
          shiftDate: parsed.data.shiftDate,
          from: parsed.data.from,
          to: parsed.data.to,
          payrollType: parsed.data.payrollType,
          attendanceStatus: parsed.data.attendanceStatus,
          timesheetStatus: parsed.data.timesheetStatus,
          pendingApprovalOnly: parsed.data.pendingApprovalOnly,
        },
      );

      res.status(200).json({ data: entries.map(serializeTimesheet) });
    },

    /**
     * POST /clinics/:clinicId/timesheets
     * Manager creates an 'hourly_manual' entry — e.g. missed clock-in,
     * retrospective back-fill, or a correction with no roster link.
     * Hour buckets are calculated from the provided clock times and the entry
     * is immediately set to 'submitted' to appear in the approval queue.
     * rosteredClinicId and rosteredClinicName are derived server-side by the
     * service — they are never accepted from the request body.
     */
    async createManualEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const body = parseBody(createManualEntrySchema, req.body);

      const entry = await timesheetService.createManualEntry(caller, clinicId, {
        staffUserId: body.staffUserId,
        rosterEntryId: body.rosterEntryId ?? null,
        shiftDate: body.shiftDate,
        shiftStartAt: new Date(body.shiftStartAt),
        shiftEndAt: new Date(body.shiftEndAt),
        clockInAt: new Date(body.clockInAt),
        clockOutAt: new Date(body.clockOutAt),
        breakDurationMinutes: body.breakDurationMinutes,
      });

      res.status(201).json({ data: serializeTimesheet(entry) });
    },

    /**
     * POST /clinics/:clinicId/timesheets/:timesheetId/approve
     * Manager approves a submitted hourly timesheet.
     * Hour buckets are re-calculated from stored clock times at approval time
     * so the values are authoritative (not the clock-out estimate).
     */
    async approveTimesheet(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const timesheetId = requireUuidParam(req, "timesheetId");
      const body = parseBody(approveTimesheetSchema, req.body);

      const entry = await timesheetService.approveTimesheet(
        caller,
        clinicId,
        timesheetId,
        body.approvalNotes ?? null,
      );

      res.status(200).json({ data: serializeTimesheet(entry) });
    },

    /**
     * POST /clinics/:clinicId/timesheets/:timesheetId/reject
     * Manager rejects a submitted timesheet with a mandatory note.
     * The service also validates that approvalNotes is non-empty, returning
     * a NOTES_REQUIRED error code for any downstream handling.
     */
    async rejectTimesheet(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const timesheetId = requireUuidParam(req, "timesheetId");
      const body = parseBody(rejectTimesheetSchema, req.body);

      const entry = await timesheetService.rejectTimesheet(
        caller,
        clinicId,
        timesheetId,
        body.approvalNotes,
      );

      res.status(200).json({ data: serializeTimesheet(entry) });
    },

    /**
     * POST /clinics/:clinicId/timesheets/:timesheetId/verify-attendance
     * Manager verifies a provider's attendance on a commission_log entry.
     *
     * FORECASTING IMPACT:
     *   present   → full material usage counted by the forecast engine.
     *   absent    → zero material usage.
     *   sick      → zero material usage.
     *   cancelled → shift removed from forecast entirely.
     *
     * 'pending_verification' is excluded from the schema — the system sets it;
     * managers may only advance to a decisive status.
     */
    async verifyCommissionAttendance(
      req: Request,
      res: Response,
    ): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const timesheetId = requireUuidParam(req, "timesheetId");
      const body = parseBody(verifyAttendanceSchema, req.body);

      const entry = await timesheetService.verifyCommissionAttendance(
        caller,
        clinicId,
        timesheetId,
        body.attendanceStatus,
        body.commissionNote ?? null,
      );

      res.status(200).json({ data: serializeTimesheet(entry) });
    },

    /**
     * GET /clinics/:clinicId/timesheets/forecast?date=YYYY-MM-DD
     * Returns verified commission_log entries for the materials forecasting
     * engine.  Only 'present', 'absent', 'sick' statuses are returned;
     * 'pending_verification' and 'cancelled' are excluded by the repository.
     */
    async getForecastLogs(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = forecastQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const entries = await timesheetService.getForecastLogsForClinic(
        caller,
        clinicId,
        parsed.data.date,
      );

      res.status(200).json({ data: entries.map(serializeTimesheet) });
    },
  };
}

export type TimesheetHandlers = ReturnType<typeof createTimesheetHandlers>;
