// ─────────────────────────────────────────────────────────────────────────────
// Timesheet Repository — PostgreSQL implementation
//
// Column mapping reference (snake_case DB → camelCase TypeScript):
//   payroll_type         → payrollType         (DB ENUM → TS PayrollType)
//   staff_user_id        → staffUserId
//   staff_email          → staffEmail
//   clinic_id            → clinicId
//   rostered_clinic_id   → rosteredClinicId
//   rostered_clinic_name → rosteredClinicName
//   roster_entry_id      → rosterEntryId       (nullable FK)
//   shift_date           → shiftDate           (DB date → TS string 'YYYY-MM-DD')
//   shift_start_at       → shiftStartAt        (DB timestamptz → TS Date)
//   shift_end_at         → shiftEndAt          (DB timestamptz → TS Date)
//   attendance_status    → attendanceStatus    (DB ENUM → TS AttendanceStatus)
//   clock_in_at          → clockInAt           (DB timestamptz → TS Date | null)
//   clock_out_at         → clockOutAt          (DB timestamptz → TS Date | null)
//   break_duration_minutes → breakDurationMinutes  (DB integer → TS number | null)
//   total_hours_worked   → totalHoursWorked    (DB numeric → TS number via parseFloat)
//   ordinary_hours       → ordinaryHours       (DB numeric → TS number via parseFloat)
//   overtime_1_5x_hours  → overtime15xHours    (DB numeric → TS number via parseFloat)
//   overtime_2x_hours    → overtime2xHours     (DB numeric → TS number via parseFloat)
//   overtime_custom_hours → overtimeCustomHours (DB numeric → TS number via parseFloat)
//   timesheet_status     → timesheetStatus     (DB ENUM | null → TS TimesheetStatus | null)
//   approved_by_user_id  → approvedByUserId    (nullable FK)
//   approved_at          → approvedAt          (DB timestamptz → TS Date | null)
//   approval_notes       → approvalNotes
//   commission_note      → commissionNote
//   generated_by         → generatedBy
//
// node-postgres type notes:
//   • date (OID 1082)      → 'YYYY-MM-DD' string  (no conversion needed)
//   • timestamptz (OID 1184) → JavaScript Date object (no conversion needed)
//   • numeric (OID 1700)   → string   → parseFloat() applied for all numeric cols
//   • integer (OID 23)     → JavaScript number (no conversion needed)
//
// FORECASTING SAFEGUARD (getForecastLogs):
//   Queries rostered_clinic_id (not clinic_id) — the physical clinic where
//   materials are consumed.  Filters payroll_type = 'commission_log' and
//   attendance_status IN ('present', 'absent', 'sick').  The statuses
//   'pending_verification' and 'cancelled' are NEVER returned so the
//   materials forecasting engine cannot count unverified or void shifts.
//   The query uses the idx_timesheet_attendance_forecast partial index.
// ─────────────────────────────────────────────────────────────────────────────

import { AppError } from "../types/errors.js";
import type {
  AttendanceStatus,
  ClockMutation,
  CreateTimesheetEntryInput,
  ListTimesheetOptions,
  PayrollType,
  TimesheetEntry,
  TimesheetStatus,
  UpdateTimesheetEntryInput,
} from "../types/payroll.js";
import type { DatabasePool } from "../db/pool.js";
import type { TimesheetRepository } from "./timesheetRepository.js";

// ── Row shape returned by node-postgres ──────────────────────────────────────

type TimesheetEntryRow = {
  id: string;
  payroll_type: string;
  staff_user_id: string;
  staff_email: string;
  clinic_id: string;
  rostered_clinic_id: string;
  rostered_clinic_name: string;
  roster_entry_id: string | null;
  // node-postgres returns 'date' columns as 'YYYY-MM-DD' strings.
  shift_date: string;
  shift_start_at: Date;
  shift_end_at: Date;
  attendance_status: string;
  clock_in_at: Date | null;
  clock_out_at: Date | null;
  // node-postgres returns 'integer' as a JS number.
  break_duration_minutes: number | null;
  // node-postgres returns 'numeric' as a string to preserve precision.
  total_hours_worked: string | null;
  ordinary_hours: string | null;
  overtime_1_5x_hours: string | null;
  overtime_2x_hours: string | null;
  overtime_custom_hours: string | null;
  timesheet_status: string | null;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  approval_notes: string | null;
  commission_note: string | null;
  generated_by: string;
  created_at: Date;
  updated_at: Date;
};

// ── Row → domain model mapper ─────────────────────────────────────────────────

function toTimesheetEntry(row: TimesheetEntryRow): TimesheetEntry {
  return {
    id: row.id,
    payrollType: row.payroll_type as PayrollType,
    staffUserId: row.staff_user_id,
    staffEmail: row.staff_email,
    clinicId: row.clinic_id,
    rosteredClinicId: row.rostered_clinic_id,
    rosteredClinicName: row.rostered_clinic_name,
    rosterEntryId: row.roster_entry_id,
    shiftDate: row.shift_date,
    shiftStartAt: row.shift_start_at,
    shiftEndAt: row.shift_end_at,
    attendanceStatus: row.attendance_status as AttendanceStatus,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    breakDurationMinutes: row.break_duration_minutes,
    totalHoursWorked:
      row.total_hours_worked !== null
        ? parseFloat(row.total_hours_worked)
        : null,
    ordinaryHours:
      row.ordinary_hours !== null ? parseFloat(row.ordinary_hours) : null,
    // overtime_1_5x_hours in DB maps to overtime15xHours in TypeScript.
    overtime15xHours:
      row.overtime_1_5x_hours !== null
        ? parseFloat(row.overtime_1_5x_hours)
        : null,
    // overtime_2x_hours in DB maps to overtime2xHours in TypeScript.
    overtime2xHours:
      row.overtime_2x_hours !== null
        ? parseFloat(row.overtime_2x_hours)
        : null,
    overtimeCustomHours:
      row.overtime_custom_hours !== null
        ? parseFloat(row.overtime_custom_hours)
        : null,
    timesheetStatus: row.timesheet_status as TimesheetStatus | null,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    approvalNotes: row.approval_notes,
    commissionNote: row.commission_note,
    generatedBy: row.generated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPostgresTimesheetRepository(
  pool: DatabasePool,
): TimesheetRepository {
  return {
    // ── create ─────────────────────────────────────────────────────────────

    /**
     * Inserts a new timesheet entry.
     *
     * timesheetStatus initial value is determined here — not passed in input
     * (CreateTimesheetEntryInput excludes it):
     *   commission_log → NULL  (attendance verified via attendance_status)
     *   hourly_auto / hourly_manual → 'draft'
     */
    async create(input: CreateTimesheetEntryInput): Promise<TimesheetEntry> {
      const initialTimesheetStatus =
        input.payrollType === "commission_log" ? null : "draft";

      const { rows } = await pool.query<TimesheetEntryRow>(
        `INSERT INTO timesheet_entries
           (payroll_type, staff_user_id, staff_email,
            clinic_id, rostered_clinic_id, rostered_clinic_name, roster_entry_id,
            shift_date, shift_start_at, shift_end_at,
            attendance_status,
            clock_in_at, clock_out_at, break_duration_minutes,
            total_hours_worked, ordinary_hours,
            overtime_1_5x_hours, overtime_2x_hours, overtime_custom_hours,
            timesheet_status,
            commission_note, generated_by)
         VALUES
           ($1,  $2,  $3,
            $4,  $5,  $6,  $7,
            $8,  $9,  $10,
            $11,
            $12, $13, $14,
            $15, $16,
            $17, $18, $19,
            $20,
            $21, $22)
         RETURNING *`,
        [
          input.payrollType,
          input.staffUserId,
          input.staffEmail,
          input.clinicId,
          input.rosteredClinicId,
          input.rosteredClinicName,
          input.rosterEntryId ?? null,
          input.shiftDate,
          input.shiftStartAt,
          input.shiftEndAt,
          input.attendanceStatus,
          input.clockInAt ?? null,
          input.clockOutAt ?? null,
          input.breakDurationMinutes ?? null,
          input.totalHoursWorked ?? null,
          input.ordinaryHours ?? null,
          input.overtime15xHours ?? null,    // overtime_1_5x_hours
          input.overtime2xHours ?? null,     // overtime_2x_hours
          input.overtimeCustomHours ?? null,
          initialTimesheetStatus,
          input.commissionNote ?? null,
          input.generatedBy,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create timesheet entry");
      return toTimesheetEntry(row);
    },

    // ── findById ───────────────────────────────────────────────────────────

    async findById(id: string): Promise<TimesheetEntry | null> {
      const { rows } = await pool.query<TimesheetEntryRow>(
        "SELECT * FROM timesheet_entries WHERE id = $1",
        [id],
      );

      return rows[0] ? toTimesheetEntry(rows[0]) : null;
    },

    // ── findByRosterEntry ──────────────────────────────────────────────────

    /**
     * Returns the entry linked to a specific roster shift.
     * Used by the roster-completion hook as a duplicate guard — prevents
     * re-generating an entry when a shift transitions to 'completed' more
     * than once (e.g. on a service retry).
     *
     * Hits idx_timesheet_entries_roster_entry (partial, WHERE NOT NULL).
     */
    async findByRosterEntry(
      rosterEntryId: string,
    ): Promise<TimesheetEntry | null> {
      const { rows } = await pool.query<TimesheetEntryRow>(
        "SELECT * FROM timesheet_entries WHERE roster_entry_id = $1 LIMIT 1",
        [rosterEntryId],
      );

      return rows[0] ? toTimesheetEntry(rows[0]) : null;
    },

    // ── listByStaff ────────────────────────────────────────────────────────

    async listByStaff(
      staffUserId: string,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      const params: unknown[] = [staffUserId];
      const conditions: string[] = ["staff_user_id = $1"];

      if (options?.payrollType) {
        params.push(options.payrollType);
        conditions.push(`payroll_type = $${String(params.length)}`);
      }

      if (options?.attendanceStatus) {
        params.push(options.attendanceStatus);
        conditions.push(`attendance_status = $${String(params.length)}`);
      }

      if (options?.shiftDate) {
        params.push(options.shiftDate);
        conditions.push(`shift_date = $${String(params.length)}::date`);
      } else {
        if (options?.from) {
          params.push(options.from);
          conditions.push(`shift_date >= $${String(params.length)}::date`);
        }
        if (options?.to) {
          params.push(options.to);
          conditions.push(`shift_date <= $${String(params.length)}::date`);
        }
      }

      // pendingApprovalOnly overrides any timesheetStatus filter.
      if (options?.pendingApprovalOnly) {
        conditions.push(`timesheet_status = 'submitted'`);
      } else if (options?.timesheetStatus) {
        params.push(options.timesheetStatus);
        conditions.push(`timesheet_status = $${String(params.length)}`);
      }

      const { rows } = await pool.query<TimesheetEntryRow>(
        `SELECT * FROM timesheet_entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY shift_date DESC`,
        params,
      );

      return rows.map(toTimesheetEntry);
    },

    // ── listByClinic ───────────────────────────────────────────────────────

    async listByClinic(
      clinicId: string,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      const params: unknown[] = [clinicId];
      const conditions: string[] = ["clinic_id = $1"];

      if (options?.payrollType) {
        params.push(options.payrollType);
        conditions.push(`payroll_type = $${String(params.length)}`);
      }

      if (options?.attendanceStatus) {
        params.push(options.attendanceStatus);
        conditions.push(`attendance_status = $${String(params.length)}`);
      }

      if (options?.shiftDate) {
        params.push(options.shiftDate);
        conditions.push(`shift_date = $${String(params.length)}::date`);
      } else {
        if (options?.from) {
          params.push(options.from);
          conditions.push(`shift_date >= $${String(params.length)}::date`);
        }
        if (options?.to) {
          params.push(options.to);
          conditions.push(`shift_date <= $${String(params.length)}::date`);
        }
      }

      // pendingApprovalOnly overrides any timesheetStatus filter — this is
      // the primary fast path for the manager approval queue.
      if (options?.pendingApprovalOnly) {
        conditions.push(`timesheet_status = 'submitted'`);
      } else if (options?.timesheetStatus) {
        params.push(options.timesheetStatus);
        conditions.push(`timesheet_status = $${String(params.length)}`);
      }

      const { rows } = await pool.query<TimesheetEntryRow>(
        `SELECT * FROM timesheet_entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY shift_date DESC`,
        params,
      );

      return rows.map(toTimesheetEntry);
    },

    // ── getForecastLogs ────────────────────────────────────────────────────

    /**
     * Returns verified commission_log entries for the materials forecasting
     * engine.
     *
     * FORECASTING SAFEGUARD — inclusion contract:
     *   'present'  → full material usage counted
     *   'absent'   → forecast engine evaluates usage as ZERO
     *   'sick'     → forecast engine evaluates usage as ZERO
     *
     * STRICT EXCLUSION:
     *   'pending_verification' → NEVER returned (manager has not yet verified)
     *   'cancelled'            → NEVER returned (shift did not occur)
     *
     * Filters on rostered_clinic_id (the physical work location) rather than
     * clinic_id (home clinic) — materials are consumed at the rostered clinic,
     * not the staff member's home location.
     *
     * Query uses the idx_timesheet_attendance_forecast partial index:
     *   ON timesheet_entries (attendance_status, payroll_type, shift_date)
     *   WHERE payroll_type = 'commission_log'
     */
    async getForecastLogs(
      rosteredClinicId: string,
      date: string,
    ): Promise<TimesheetEntry[]> {
      const { rows } = await pool.query<TimesheetEntryRow>(
        `SELECT * FROM timesheet_entries
         WHERE payroll_type        = 'commission_log'
           AND rostered_clinic_id  = $1
           AND shift_date          = $2::date
           AND attendance_status   IN ('present', 'absent', 'sick')
           AND approved_by_user_id IS NOT NULL
           AND approved_at         IS NOT NULL
         ORDER BY created_at ASC`,
        [rosteredClinicId, date],
      );

      return rows.map(toTimesheetEntry);
    },

    // ── update ─────────────────────────────────────────────────────────────

    /**
     * Applies a partial update — only fields present in the input object are
     * written; undefined fields are left unchanged.  This is the same
     * semantics as the in-memory implementation (explicit undefined check).
     *
     * Callers (service layer) always call findById first and check for null,
     * so a zero-rows result here is surfaced as an internal server error
     * (should never happen in practice).
     *
     * FIX LOW — Clock-field atomicity:
     *   Raw clock fields (`clock_out_at`, `break_duration_minutes`) are only
     *   written as part of a `clockMutation` bundle, which also atomically
     *   writes all five derived hour-bucket columns.  `clock_in_at` is
     *   excluded from updates entirely — it is set once at create time.
     *
     * Column name remapping for overtime fields:
     *   overtime15xHours → overtime_1_5x_hours
     *   overtime2xHours  → overtime_2x_hours
     */
    async update(
      id: string,
      input: UpdateTimesheetEntryInput,
    ): Promise<TimesheetEntry> {
      const setClauses: string[] = ["updated_at = now()"];
      const params: unknown[] = [];

      if (input.attendanceStatus !== undefined) {
        params.push(input.attendanceStatus);
        setClauses.push(`attendance_status = $${String(params.length)}`);
      }

      if (input.timesheetStatus !== undefined) {
        params.push(input.timesheetStatus);
        setClauses.push(`timesheet_status = $${String(params.length)}`);
      }

      // clockMutation — atomically writes clock-out and all five hour-bucket
      // columns so they can never drift out of sync with the clock times.
      if (input.clockMutation !== undefined) {
        const m: ClockMutation = input.clockMutation;
        params.push(m.clockOutAt);
        setClauses.push(`clock_out_at = $${String(params.length)}`);
        params.push(m.breakDurationMinutes);
        setClauses.push(`break_duration_minutes = $${String(params.length)}`);
        params.push(m.totalHoursWorked);
        setClauses.push(`total_hours_worked = $${String(params.length)}`);
        params.push(m.ordinaryHours);
        setClauses.push(`ordinary_hours = $${String(params.length)}`);
        params.push(m.overtime15xHours);
        setClauses.push(`overtime_1_5x_hours = $${String(params.length)}`);
        params.push(m.overtime2xHours);
        setClauses.push(`overtime_2x_hours = $${String(params.length)}`);
        params.push(m.overtimeCustomHours);
        setClauses.push(`overtime_custom_hours = $${String(params.length)}`);
      }

      // Individual hour-bucket fields — approval re-calculation path only
      // (recalculates derived columns without changing stored clock times).
      if (input.totalHoursWorked !== undefined) {
        params.push(input.totalHoursWorked);
        setClauses.push(`total_hours_worked = $${String(params.length)}`);
      }

      if (input.ordinaryHours !== undefined) {
        params.push(input.ordinaryHours);
        setClauses.push(`ordinary_hours = $${String(params.length)}`);
      }

      // TypeScript overtime15xHours → overtime_1_5x_hours in DB
      if (input.overtime15xHours !== undefined) {
        params.push(input.overtime15xHours);
        setClauses.push(`overtime_1_5x_hours = $${String(params.length)}`);
      }

      // TypeScript overtime2xHours → overtime_2x_hours in DB
      if (input.overtime2xHours !== undefined) {
        params.push(input.overtime2xHours);
        setClauses.push(`overtime_2x_hours = $${String(params.length)}`);
      }

      if (input.overtimeCustomHours !== undefined) {
        params.push(input.overtimeCustomHours);
        setClauses.push(`overtime_custom_hours = $${String(params.length)}`);
      }

      if (input.commissionNote !== undefined) {
        params.push(input.commissionNote);
        setClauses.push(`commission_note = $${String(params.length)}`);
      }

      if (input.approvedByUserId !== undefined) {
        params.push(input.approvedByUserId);
        setClauses.push(`approved_by_user_id = $${String(params.length)}`);
      }

      if (input.approvedAt !== undefined) {
        params.push(input.approvedAt);
        setClauses.push(`approved_at = $${String(params.length)}`);
      }

      if (input.approvalNotes !== undefined) {
        params.push(input.approvalNotes);
        setClauses.push(`approval_notes = $${String(params.length)}`);
      }

      params.push(id);
      const idParam = params.length;

      const { rows } = await pool.query<TimesheetEntryRow>(
        `UPDATE timesheet_entries
         SET ${setClauses.join(", ")}
         WHERE id = $${String(idParam)}
         RETURNING *`,
        params,
      );

      const row = rows[0];
      if (!row) {
        throw new AppError(404, "NOT_FOUND", "Timesheet entry not found");
      }

      return toTimesheetEntry(row);
    },
  };
}
