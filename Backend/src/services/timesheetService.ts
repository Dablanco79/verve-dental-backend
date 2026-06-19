import type { AuthenticatedUser, UserRecord } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  CreateTimesheetEntryInput,
  ListTimesheetOptions,
  ListTimesheetPageOptions,
  TimesheetEntry,
  TimesheetPage,
} from "../types/payroll.js";
import type { RosterEntry } from "../types/roster.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { TimesheetRepository } from "../repositories/timesheetRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hour-bucket calculation (accounting-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates ordinary and overtime hour buckets from raw clocking data.
 *
 * Uses floor-based integer minute arithmetic to eliminate sub-minute
 * floating-point drift that can produce negative or anomalous results.
 * Throws AppError(400) immediately if workedMinutes ≤ 0 so callers never
 * have to check whether the returned buckets are meaningful.
 *
 * Daily thresholds (Australian Award placeholder — refined in Module 09):
 *   0–8 h  → ordinary time
 *   8–10 h → 1.5× overtime
 *   10 h+  → 2.0× overtime
 *
 * All results are rounded to 2 decimal places to match the DB numeric(6,2).
 */
function calculateHourBuckets(
  clockInAt: Date,
  clockOutAt: Date,
  breakDurationMinutes: number,
): {
  totalHoursWorked: number;
  ordinaryHours: number;
  overtime15xHours: number;
  overtime2xHours: number;
  overtimeCustomHours: number;
} {
  const grossMinutes = Math.floor(
    (clockOutAt.getTime() - clockInAt.getTime()) / 60_000,
  );
  const workedMinutes = grossMinutes - breakDurationMinutes;

  if (workedMinutes <= 0) {
    throw new AppError(
      400,
      "INVALID_CLOCK_TIMES",
      "Clock-out time must be after clock-in time accounting for break duration",
    );
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalHoursWorked = round2(workedMinutes / 60);

  const ordinaryHours = round2(Math.min(totalHoursWorked, 8));
  const afterOrdinary = Math.max(0, totalHoursWorked - 8);
  const overtime15xHours = round2(Math.min(afterOrdinary, 2));    // hours 8–10
  const overtime2xHours = round2(Math.max(0, afterOrdinary - 2)); // hours 10+

  return {
    totalHoursWorked,
    ordinaryHours,
    overtime15xHours,
    overtime2xHours,
    overtimeCustomHours: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX MEDIUM: Hour-bucket atomicity guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bundles a completed clock-out mutation with its recalculated hour buckets.
 *
 * Every service path that writes `clockOutAt` or `breakDurationMinutes` MUST
 * spread the result of this function into its repository payload.  This keeps
 * the accounting columns (`totalHoursWorked`, `ordinaryHours`, etc.) atomically
 * in sync with the clock mutation — it is structurally impossible to update
 * clock times without also recalculating the derived hour columns.
 */
function clockUpdatePayload(
  clockInAt: Date,
  clockOutAt: Date,
  breakDurationMinutes: number,
): {
  clockOutAt: Date;
  breakDurationMinutes: number;
  totalHoursWorked: number;
  ordinaryHours: number;
  overtime15xHours: number;
  overtime2xHours: number;
  overtimeCustomHours: number;
} {
  // calculateHourBuckets throws AppError(400) when the resulting workedMinutes ≤ 0,
  // so invalid clock combos are rejected before any repository write occurs.
  const buckets = calculateHourBuckets(clockInAt, clockOutAt, breakDurationMinutes);
  return { clockOutAt, breakDurationMinutes, ...buckets };
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC helpers
// ─────────────────────────────────────────────────────────────────────────────

function assertReviewAccess(caller: AuthenticatedUser, clinicId: string): void {
  if (caller.role === "owner_admin") return;
  if (caller.role === "group_practice_manager" && caller.homeClinicId === clinicId) return;
  throw new AppError(403, "FORBIDDEN", "Only managers and admins can approve timesheets");
}

// ─────────────────────────────────────────────────────────────────────────────
// Race-condition helper
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when an error carries a Postgres unique-violation code (23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────────────

export type TimesheetService = ReturnType<typeof createTimesheetService>;

export function createTimesheetService(
  timesheetRepository: TimesheetRepository,
  userRepository: UserRepository,
  rosterRepository: RosterRepository,
) {
  return {
    // ── Hourly clocking ───────────────────────────────────────────────────────

    /**
     * Records a clock-in for a staff member on an hourly track.
     * Creates a new 'hourly_auto' draft timesheet entry.
     *
     * FIX HIGH — Request-body spoofing prevention:
     *   `rosteredClinicId` and `rosteredClinicName` are NEVER trusted from the
     *   request body.  When a `rosterEntryId` is supplied, both values are
     *   derived exclusively from the trusted roster DB record after verifying
     *   that the entry belongs to the authenticated caller.  For ad-hoc
     *   clock-ins (no roster link), `rosteredClinicId` defaults to the route's
     *   verified `clinicId` and the clinic name is fetched from the DB.
     *
     *   Shift timing (`shiftDate`, `shiftStartAt`, `shiftEndAt`) is similarly
     *   derived from the roster record when one is linked.
     */
    async clockIn(
      caller: AuthenticatedUser,
      clinicId: string,
      input: {
        rosterEntryId: string | null;
        shiftDate: string;
        shiftStartAt: Date;
        shiftEndAt: Date;
      },
    ): Promise<TimesheetEntry> {
      if (caller.role === "owner_admin" || caller.role === "group_practice_manager") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Managers and admins cannot clock in. Use createManualEntry() instead.",
        );
      }

      // ── Derive trusted clinic + shift context ──────────────────────────────
      let rosteredClinicId: string;
      let rosteredClinicName: string;
      let shiftDate = input.shiftDate;
      let shiftStartAt = input.shiftStartAt;
      let shiftEndAt = input.shiftEndAt;

      if (input.rosterEntryId) {
        const rosterEntry = await rosterRepository.findEntryById(input.rosterEntryId);

        // Verify the roster entry exists AND belongs to the authenticated caller.
        // A staff member must not be able to clock in against another person's shift.
        if (!rosterEntry || rosterEntry.staffUserId !== caller.id) {
          throw new AppError(
            404,
            "ROSTER_NOT_FOUND",
            "Roster entry not found or does not belong to you",
          );
        }

        // Derive all clinic context and shift timing from the trusted DB record.
        // Any values supplied for these fields in the request body are ignored.
        rosteredClinicId = rosterEntry.rosteredClinicId;
        rosteredClinicName = rosterEntry.rosteredClinicName;
        shiftDate = rosterEntry.shiftStartAt.toISOString().slice(0, 10);
        shiftStartAt = rosterEntry.shiftStartAt;
        shiftEndAt = rosterEntry.shiftEndAt;
      } else {
        // Ad-hoc clock-in: use the route's verified clinicId as the rostered
        // clinic, and fetch the canonical name from the DB.
        rosteredClinicId = clinicId;
        const clinicName = await userRepository.getClinicName(clinicId);
        if (!clinicName) {
          throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
        }
        rosteredClinicName = clinicName;
      }

      const now = new Date();

      return timesheetRepository.create({
        payrollType: "hourly_auto",
        staffUserId: caller.id,
        staffEmail: caller.email,
        clinicId,
        rosteredClinicId,
        rosteredClinicName,
        rosterEntryId: input.rosterEntryId,
        shiftDate,
        shiftStartAt,
        shiftEndAt,
        attendanceStatus: "present",
        clockInAt: now,
        clockOutAt: null,
        breakDurationMinutes: null,
        totalHoursWorked: null,
        ordinaryHours: null,
        overtime15xHours: null,
        overtime2xHours: null,
        overtimeCustomHours: null,
        commissionNote: null,
        generatedBy: caller.email,
      });
    },

    /**
     * Records a clock-out and calculates hour buckets.
     * Scoped to the route's clinicId — a staff member cannot clock out of an
     * entry belonging to a different clinic.
     * Advances timesheetStatus from 'draft' to 'submitted' automatically
     * so the manager's approval queue is populated immediately.
     *
     * FIX MEDIUM — Hour-bucket atomicity: clock times and all derived hour
     * columns are written together via `clockUpdatePayload()` so the accounting
     * columns can never become stale relative to the clock mutation.
     */
    async clockOut(
      caller: AuthenticatedUser,
      clinicId: string,
      timesheetId: string,
      breakDurationMinutes: number,
    ): Promise<TimesheetEntry> {
      const entry = await timesheetRepository.findById(timesheetId);

      // Scope check: entry must exist AND belong to the route clinic.
      if (!entry || entry.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Timesheet entry not found");
      }

      if (entry.staffUserId !== caller.id) {
        throw new AppError(403, "FORBIDDEN", "You can only clock out of your own timesheet entry");
      }

      if (entry.payrollType === "commission_log") {
        throw new AppError(
          400,
          "INVALID_PAYROLL_TYPE",
          "Commission providers do not clock in/out",
        );
      }

      if (!entry.clockInAt) {
        throw new AppError(400, "NO_CLOCK_IN", "Cannot clock out without a prior clock-in");
      }

      if (entry.clockOutAt) {
        throw new AppError(409, "ALREADY_CLOCKED_OUT", "This timesheet entry already has a clock-out time");
      }

      if (entry.timesheetStatus === "processed") {
        throw new AppError(409, "ENTRY_PROCESSED", "Processed timesheet entries are immutable");
      }

      if (breakDurationMinutes < 0) {
        throw new AppError(400, "INVALID_BREAK", "breakDurationMinutes cannot be negative");
      }

      const now = new Date();

      // clockUpdatePayload throws AppError(400) when workedMinutes ≤ 0 and
      // atomically bundles clock fields with recalculated hour buckets.
      return timesheetRepository.update(timesheetId, {
        clockMutation: clockUpdatePayload(entry.clockInAt, now, breakDurationMinutes),
        timesheetStatus: "submitted",
      });
    },

    // ── Manual entry (manager) ────────────────────────────────────────────────

    /**
     * Manager creates a timesheet entry manually — e.g. for a missed clock-in,
     * a retrospective correction, or a back-fill entry without a roster link.
     *
     * SECURITY: staffEmail, clinicId, and rosteredClinic* are ALWAYS derived
     * server-side from trusted DB records.  Body-supplied values for those
     * fields are never trusted to prevent tenant/identity spoofing.
     *
     * FIX HIGH — Rosterless entries fully sealed:
     *   `rosteredClinicId` and `rosteredClinicName` are NEVER accepted from the
     *   request body in any code path.
     *   • With rosterEntryId → derived from the trusted roster DB record after
     *     verifying staff ownership.
     *   • Without rosterEntryId (ad-hoc) → `rosteredClinicId` is forced to the
     *     route's verified `clinicId`; `rosteredClinicName` is fetched from the
     *     DB via `userRepository.getClinicName()`.
     *
     * FIX MEDIUM — Cross-clinic work shifts allowed:
     *   Staff ownership is validated independently of the physical work location.
     *   A staff member whose home clinic is Clinic A may have a roster shift
     *   physically located at Clinic B — `rosterEntry.rosteredClinicId` is NOT
     *   required to equal the route's `clinicId`.
     *
     * FIX MEDIUM — Hour-bucket atomicity:
     *   Clock times and all hour columns are written together via
     *   `clockUpdatePayload()`.
     *
     * Always creates as 'hourly_manual'.  The entry is immediately advanced to
     * 'submitted' so it appears in the approval queue.
     */
    async createManualEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      input: {
        staffUserId: string;
        rosterEntryId: string | null;
        shiftDate: string;
        shiftStartAt: Date;
        shiftEndAt: Date;
        clockInAt: Date;
        clockOutAt: Date;
        breakDurationMinutes: number;
      },
    ): Promise<TimesheetEntry> {
      assertReviewAccess(caller, clinicId);

      // Identity verification: fetch the target user from the trusted DB record.
      // Never trust staffEmail or clinicId from the request body.
      const staffUser = await userRepository.findById(input.staffUserId);

      if (!staffUser) {
        throw new AppError(404, "NOT_FOUND", "Staff user not found");
      }

      // Tenant isolation: the target staff member must belong to the route's clinic.
      if (staffUser.homeClinicId !== clinicId) {
        throw new AppError(
          403,
          "CLINIC_MISMATCH",
          "Staff member does not belong to this clinic",
        );
      }

      // Derive identity from the trusted DB record.
      const staffEmail = staffUser.email;

      // ── FIX HIGH + FIX MEDIUM: Trusted clinic-context derivation ─────────
      // rosteredClinicId / rosteredClinicName are ALWAYS derived server-side.
      // FIX MEDIUM: the roster entry is only required to belong to the target
      // staff member — NOT to the route clinicId — so a staff member at Clinic A
      // can legitimately hold a rostered shift physically located at Clinic B.
      let rosteredClinicId: string;
      let rosteredClinicName: string;

      if (input.rosterEntryId) {
        const rosterEntry = await rosterRepository.findEntryById(input.rosterEntryId);

        if (!rosterEntry || rosterEntry.staffUserId !== input.staffUserId) {
          throw new AppError(
            404,
            "ROSTER_NOT_FOUND",
            "Roster entry not found or does not belong to the given staff member",
          );
        }

        // Derive clinic context exclusively from the trusted roster record.
        rosteredClinicId = rosterEntry.rosteredClinicId;
        rosteredClinicName = rosterEntry.rosteredClinicName;
      } else {
        // FIX HIGH: Ad-hoc entry — ignore any client-supplied rosteredClinic* values.
        // Force rosteredClinicId to the route's verified clinicId and fetch the
        // canonical clinic name from the DB rather than trusting the client payload.
        rosteredClinicId = clinicId;
        const clinicName = await userRepository.getClinicName(clinicId);
        if (!clinicName) {
          throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
        }
        rosteredClinicName = clinicName;
      }

      if (input.clockOutAt <= input.clockInAt) {
        throw new AppError(400, "INVALID_CLOCK_TIMES", "clockOutAt must be after clockInAt");
      }

      // clockUpdatePayload re-validates the times and throws AppError(400) on
      // workedMinutes ≤ 0, atomically bundling clock fields with hour buckets.
      const clockFields = clockUpdatePayload(
        input.clockInAt,
        input.clockOutAt,
        input.breakDurationMinutes,
      );

      const entry = await timesheetRepository.create({
        payrollType: "hourly_manual",
        staffUserId: input.staffUserId,
        staffEmail,           // Derived from DB — never from the request body.
        clinicId,             // From the verified route parameter — never from the body.
        rosteredClinicId,     // Derived from roster record when linked; forced to clinicId ad-hoc.
        rosteredClinicName,   // Derived from roster record when linked; fetched from DB ad-hoc.
        rosterEntryId: input.rosterEntryId,
        shiftDate: input.shiftDate,
        shiftStartAt: input.shiftStartAt,
        shiftEndAt: input.shiftEndAt,
        attendanceStatus: "present",
        clockInAt: input.clockInAt,
        ...clockFields,
        commissionNote: null,
        generatedBy: caller.email,
      });

      // Manual entries bypass the draft → submitted step and go straight to
      // 'submitted' so they appear in the approval queue immediately.
      return timesheetRepository.update(entry.id, { timesheetStatus: "submitted" });
    },

    // ── Manager approval ──────────────────────────────────────────────────────

    /**
     * Manager approves a submitted hourly timesheet.
     * Re-calculates hour buckets from the stored clock times to ensure the
     * values are authoritative at the point of approval (not the clock-out
     * estimate, which may have been corrected by a manual update).
     */
    async approveTimesheet(
      caller: AuthenticatedUser,
      clinicId: string,
      timesheetId: string,
      approvalNotes: string | null = null,
    ): Promise<TimesheetEntry> {
      assertReviewAccess(caller, clinicId);

      const entry = await timesheetRepository.findById(timesheetId);

      if (!entry || entry.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Timesheet entry not found");
      }

      if (entry.payrollType === "commission_log") {
        throw new AppError(
          400,
          "INVALID_PAYROLL_TYPE",
          "Commission entries are verified via attendance status, not the approval workflow",
        );
      }

      if (entry.timesheetStatus !== "submitted" && entry.timesheetStatus !== "requires_amendment") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Cannot approve a timesheet with status '${entry.timesheetStatus ?? "null"}'`,
        );
      }

      if (!entry.clockInAt || !entry.clockOutAt) {
        throw new AppError(
          400,
          "MISSING_CLOCK_TIMES",
          "Cannot approve a timesheet entry without both clock-in and clock-out times",
        );
      }

      // Re-calculate hour buckets at approval time using stored break duration
      // to ensure the approved values are authoritative.
      const buckets = calculateHourBuckets(
        entry.clockInAt,
        entry.clockOutAt,
        entry.breakDurationMinutes ?? 0,
      );

      return timesheetRepository.update(timesheetId, {
        ...buckets,
        timesheetStatus: "approved",
        approvedByUserId: caller.id,
        approvedAt: new Date(),
        approvalNotes,
      });
    },

    /** Manager rejects a submitted timesheet with a mandatory note. */
    async rejectTimesheet(
      caller: AuthenticatedUser,
      clinicId: string,
      timesheetId: string,
      approvalNotes: string,
    ): Promise<TimesheetEntry> {
      assertReviewAccess(caller, clinicId);

      if (!approvalNotes.trim()) {
        throw new AppError(400, "NOTES_REQUIRED", "A rejection note is required");
      }

      const entry = await timesheetRepository.findById(timesheetId);

      if (!entry || entry.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Timesheet entry not found");
      }

      if (entry.timesheetStatus !== "submitted") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Cannot reject a timesheet with status '${entry.timesheetStatus ?? "null"}'`,
        );
      }

      return timesheetRepository.update(timesheetId, {
        timesheetStatus: "rejected",
        approvedByUserId: caller.id,
        approvedAt: new Date(),
        approvalNotes,
      });
    },

    // ── Query methods ─────────────────────────────────────────────────────────

    async listTimesheetsForClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      assertReviewAccess(caller, clinicId);
      return timesheetRepository.listByClinic(clinicId, options);
    },

    async listTimesheetsForClinicPaginated(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListTimesheetPageOptions,
    ): Promise<TimesheetPage> {
      assertReviewAccess(caller, clinicId);
      return timesheetRepository.listByClinicPaginated(clinicId, options);
    },

    /**
     * Returns commission_log entries with verified attendance for the
     * materials forecasting engine.
     *
     * SAFETY CONTRACT (see TimesheetRepository.getForecastLogs):
     *   Only 'present', 'absent', 'sick' statuses are returned.
     *   'pending_verification' and 'cancelled' are NEVER included.
     *   Only entries with an approvedByUserId and approvedAt are included.
     */
    async getForecastLogsForClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      date: string,
    ): Promise<TimesheetEntry[]> {
      assertReviewAccess(caller, clinicId);
      return timesheetRepository.getForecastLogs(clinicId, date);
    },

    /**
     * Returns the authenticated caller's own timesheet entries.
     * Available to all roles — clinical_staff can view their own history,
     * managers can also use this to see their personal entries separately
     * from the clinic-wide list.
     *
     * Tenant isolation is enforced at the route layer via enforceTenantParam.
     * Data scoping is enforced here by passing caller.id to listByStaff —
     * the caller can never see another user's entries through this method.
     */
    async listMyTimesheets(
      caller: AuthenticatedUser,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      return timesheetRepository.listByStaff(caller.id, options);
    },

    // ── Commission verification (manager) ─────────────────────────────────────

    /**
     * Manager verifies a provider's attendance for a commission_log entry.
     * This is the primary path for updating attendance_status from
     * 'pending_verification' to 'present', 'absent', 'sick', or 'cancelled'.
     *
     * Explicitly stamps approvedByUserId and approvedAt so the forecasting
     * safeguard query (approved_by_user_id IS NOT NULL AND approved_at IS NOT
     * NULL) can confirm that every forecast-eligible row has an audit trail.
     *
     * FORECASTING IMPACT: Setting 'present' → full material usage counted.
     *                     Setting 'absent' | 'sick' → zero material usage.
     *                     Setting 'cancelled' → removed from forecast entirely.
     */
    async verifyCommissionAttendance(
      caller: AuthenticatedUser,
      clinicId: string,
      timesheetId: string,
      attendanceStatus: "present" | "absent" | "sick" | "cancelled",
      commissionNote: string | null = null,
    ): Promise<TimesheetEntry> {
      assertReviewAccess(caller, clinicId);

      const entry = await timesheetRepository.findById(timesheetId);

      if (!entry || entry.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Timesheet entry not found");
      }

      if (entry.payrollType !== "commission_log") {
        throw new AppError(
          400,
          "INVALID_PAYROLL_TYPE",
          "This method only applies to commission_log entries",
        );
      }

      return timesheetRepository.update(timesheetId, {
        attendanceStatus,
        commissionNote,
        approvedByUserId: caller.id,
        approvedAt: new Date(),
      });
    },

    // ── Roster-completion hook ─────────────────────────────────────────────────

    /**
     * Auto-generates a timesheet entry when a roster shift transitions to
     * 'completed'.  Called by RosterService after a successful status update.
     *
     * DUPLICATE GUARD: Checks for an existing entry linked to the roster entry
     * before inserting.  If two concurrent calls race past the pre-check, the
     * Postgres unique constraint (23505) on roster_entry_id is caught and the
     * existing record is returned instead of crashing.
     *
     * PAYROLL TRACK ROUTING:
     *   staffUser.payrollTrack === 'commission'
     *     → commission_log entry, attendanceStatus = 'pending_verification'
     *     → Manager MUST verify attendance before forecasting counts the shift.
     *
     *   staffUser.payrollTrack === 'hourly'
     *     → hourly_auto draft entry pre-filled with scheduled shift times.
     *     → Staff member can submit as-is or a manager can correct via
     *       createManualEntry() if actual clock times differ significantly.
     *
     * FIX MEDIUM — commission_log state enforcement:
     *   The `attendanceStatus` for commission_log entries is hard-coded to
     *   'pending_verification' here and cannot be overridden by the caller.
     *   This is the only code path that creates commission_log rows; the DB
     *   CHECK constraint (migration 011) provides a structural backstop that
     *   prevents any future pathway from inserting a commission_log entry with
     *   a verified status that lacks an approver audit trail.
     *
     * FIX MEDIUM — Hour-bucket atomicity:
     *   For hourly entries, clock fields and all derived hour columns are
     *   written together via `clockUpdatePayload()`.
     */
    async generateFromCompletedRoster(
      rosterEntry: RosterEntry,
      staffUser: UserRecord,
    ): Promise<TimesheetEntry | null> {
      // Duplicate guard — prevents double-generation on retry or concurrent calls.
      if (rosterEntry.id) {
        const existing = await timesheetRepository.findByRosterEntry(rosterEntry.id);
        if (existing) return existing;
      }

      const shiftDate = rosterEntry.shiftStartAt.toISOString().slice(0, 10);

      const base: Omit<
        CreateTimesheetEntryInput,
        | "payrollType"
        | "attendanceStatus"
        | "clockInAt"
        | "clockOutAt"
        | "breakDurationMinutes"
        | "totalHoursWorked"
        | "ordinaryHours"
        | "overtime15xHours"
        | "overtime2xHours"
        | "overtimeCustomHours"
        | "commissionNote"
      > = {
        staffUserId: staffUser.id,
        staffEmail: staffUser.email,
        clinicId: staffUser.homeClinicId,
        rosteredClinicId: rosterEntry.rosteredClinicId,
        rosteredClinicName: rosterEntry.rosteredClinicName,
        rosterEntryId: rosterEntry.id,
        shiftDate,
        shiftStartAt: rosterEntry.shiftStartAt,
        shiftEndAt: rosterEntry.shiftEndAt,
        generatedBy: "system_auto",
      };

      if (staffUser.payrollTrack === "commission") {
        try {
          return await timesheetRepository.create({
            ...base,
            payrollType: "commission_log",
            // FORECASTING SAFEGUARD: always pending_verification — never 'present'.
            // A manager must explicitly verify before the forecast engine counts this.
            // The DB CHECK constraint in migration 011 provides a structural backstop.
            attendanceStatus: "pending_verification",
            clockInAt: null,
            clockOutAt: null,
            breakDurationMinutes: null,
            totalHoursWorked: null,
            ordinaryHours: null,
            overtime15xHours: null,
            overtime2xHours: null,
            overtimeCustomHours: null,
            commissionNote: null,
          });
        } catch (err: unknown) {
          if (isUniqueViolation(err)) {
            return (await timesheetRepository.findByRosterEntry(rosterEntry.id)) ?? null;
          }
          throw err;
        }
      }

      // Hourly track — pre-fill with scheduled shift times as a draft baseline.
      // The actual clock times may differ; the manager can correct via
      // approveTimesheet() or createManualEntry().
      //
      // clockUpdatePayload atomically bundles the clock fields with recalculated
      // hour buckets so the accounting columns cannot be stale relative to the
      // stored clock times.
      const clockFields = clockUpdatePayload(
        rosterEntry.shiftStartAt,
        rosterEntry.shiftEndAt,
        0, // no break assumed for the draft — corrected at clock-out or approval
      );

      try {
        return await timesheetRepository.create({
          ...base,
          payrollType: "hourly_auto",
          attendanceStatus: "present",
          clockInAt: rosterEntry.shiftStartAt,
          ...clockFields,
          commissionNote: null,
        });
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          return (await timesheetRepository.findByRosterEntry(rosterEntry.id)) ?? null;
        }
        throw err;
      }
    },
  };
}
