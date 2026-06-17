// ─────────────────────────────────────────────────────────────────────────────
// Leave Repository — PostgreSQL implementation
//
// Column mapping reference (snake_case DB → camelCase TypeScript):
//   staff_user_id       → staffUserId
//   staff_email         → staffEmail         (added in migration 010)
//   clinic_id           → clinicId
//   leave_type          → leaveType          (DB ENUM → TS LeaveType)
//   start_date          → startDate          (DB date → TS string 'YYYY-MM-DD')
//   end_date            → endDate            (DB date → TS string 'YYYY-MM-DD')
//   total_days          → totalDays          (DB numeric → TS number via parseFloat)
//   reviewed_by_user_id → reviewedByUserId
//   reviewed_at         → reviewedAt         (DB timestamptz → TS Date | null)
//   review_notes        → reviewNotes
//
// node-postgres type notes:
//   • date (OID 1082) columns are returned as 'YYYY-MM-DD' strings — no
//     conversion required; they match our string-typed TypeScript fields.
//   • numeric (OID 1700) columns are returned as strings — parseFloat() is
//     applied to total_days before it is returned to callers.
//   • timestamptz (OID 1184) columns are returned as JavaScript Date objects.
//
// Date filter semantics (mirror the in-memory implementation exactly):
//   from → include rows whose end_date >= from   (leave still active at 'from')
//   to   → include rows whose start_date <= to   (leave starts before 'to')
//   This two-sided overlap test correctly returns any leave that touches the
//   requested window, including leave that spans it entirely.
// ─────────────────────────────────────────────────────────────────────────────

import { AppError } from "../types/errors.js";
import type {
  CreateLeaveRequestInput,
  LeaveRequest,
  LeaveRequestStatus,
  LeaveType,
  ListLeaveOptions,
  UpdateLeaveStatusInput,
} from "../types/payroll.js";
import type { DatabasePool } from "../db/pool.js";
import type { LeaveRepository } from "./leaveRepository.js";

// ── Row shape returned by node-postgres ──────────────────────────────────────

type LeaveRequestRow = {
  id: string;
  staff_user_id: string;
  staff_email: string;
  clinic_id: string;
  leave_type: string;
  // node-postgres returns 'date' columns as 'YYYY-MM-DD' strings by default.
  start_date: string;
  end_date: string;
  // node-postgres returns 'numeric' columns as strings to preserve precision.
  total_days: string;
  reason: string | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

// ── Row → domain model mapper ─────────────────────────────────────────────────

function toLeaveRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    staffUserId: row.staff_user_id,
    staffEmail: row.staff_email,
    clinicId: row.clinic_id,
    leaveType: row.leave_type as LeaveType,
    startDate: row.start_date,
    endDate: row.end_date,
    totalDays: parseFloat(row.total_days),
    reason: row.reason,
    status: row.status as LeaveRequestStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPostgresLeaveRepository(
  pool: DatabasePool,
): LeaveRepository {
  return {
    // ── create ─────────────────────────────────────────────────────────────

    async create(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
      const { rows } = await pool.query<LeaveRequestRow>(
        `INSERT INTO leave_requests
           (staff_user_id, staff_email, clinic_id, leave_type,
            start_date, end_date, total_days, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.staffUserId,
          input.staffEmail,
          input.clinicId,
          input.leaveType,
          input.startDate,
          input.endDate,
          input.totalDays,
          input.reason ?? null,
        ],
      );

      const row = rows[0];
      if (!row) throw new Error("Failed to create leave request");
      return toLeaveRequest(row);
    },

    // ── findById ───────────────────────────────────────────────────────────

    async findById(id: string): Promise<LeaveRequest | null> {
      const { rows } = await pool.query<LeaveRequestRow>(
        "SELECT * FROM leave_requests WHERE id = $1",
        [id],
      );

      return rows[0] ? toLeaveRequest(rows[0]) : null;
    },

    // ── listByStaff ────────────────────────────────────────────────────────

    async listByStaff(
      staffUserId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      const params: unknown[] = [staffUserId];
      const conditions: string[] = ["staff_user_id = $1"];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`status = $${String(params.length)}`);
      }

      if (options?.leaveType) {
        params.push(options.leaveType);
        conditions.push(`leave_type = $${String(params.length)}`);
      }

      // from → include leave that is still active at 'from' (end_date >= from)
      if (options?.from) {
        params.push(options.from);
        conditions.push(`end_date >= $${String(params.length)}::date`);
      }

      // to → include leave that starts before or on 'to' (start_date <= to)
      if (options?.to) {
        params.push(options.to);
        conditions.push(`start_date <= $${String(params.length)}::date`);
      }

      const { rows } = await pool.query<LeaveRequestRow>(
        `SELECT * FROM leave_requests
         WHERE ${conditions.join(" AND ")}
         ORDER BY start_date DESC`,
        params,
      );

      return rows.map(toLeaveRequest);
    },

    // ── listByClinic ───────────────────────────────────────────────────────

    async listByClinic(
      clinicId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      const params: unknown[] = [clinicId];
      const conditions: string[] = ["clinic_id = $1"];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`status = $${String(params.length)}`);
      }

      if (options?.leaveType) {
        params.push(options.leaveType);
        conditions.push(`leave_type = $${String(params.length)}`);
      }

      // from → include leave that is still active at 'from' (end_date >= from)
      if (options?.from) {
        params.push(options.from);
        conditions.push(`end_date >= $${String(params.length)}::date`);
      }

      // to → include leave that starts before or on 'to' (start_date <= to)
      if (options?.to) {
        params.push(options.to);
        conditions.push(`start_date <= $${String(params.length)}::date`);
      }

      const { rows } = await pool.query<LeaveRequestRow>(
        `SELECT * FROM leave_requests
         WHERE ${conditions.join(" AND ")}
         ORDER BY start_date DESC`,
        params,
      );

      return rows.map(toLeaveRequest);
    },

    // ── findApprovedOverlap ────────────────────────────────────────────────

    /**
     * Returns all approved leave requests whose date range covers the given
     * calendar date.  Used by the roster scheduler to block shift creation.
     *
     * Overlap predicate:
     *   start_date <= date  AND  end_date >= date
     *
     * The partial index idx_leave_requests_clinic_date_range (WHERE status =
     * 'approved') is hit by the status = 'approved' filter in this query.
     */
    async findApprovedOverlap(
      staffUserId: string,
      date: string,
    ): Promise<LeaveRequest[]> {
      const { rows } = await pool.query<LeaveRequestRow>(
        `SELECT * FROM leave_requests
         WHERE staff_user_id = $1
           AND status = 'approved'
           AND start_date <= $2::date
           AND end_date   >= $2::date`,
        [staffUserId, date],
      );

      return rows.map(toLeaveRequest);
    },

    // ── updateStatus ───────────────────────────────────────────────────────

    async updateStatus(
      id: string,
      input: UpdateLeaveStatusInput,
    ): Promise<LeaveRequest> {
      const { rows } = await pool.query<LeaveRequestRow>(
        `UPDATE leave_requests
         SET status              = $1,
             reviewed_by_user_id = $2,
             reviewed_at         = now(),
             review_notes        = $3,
             updated_at          = now()
         WHERE id = $4
         RETURNING *`,
        [
          input.status,
          input.reviewedByUserId,
          input.reviewNotes ?? null,
          id,
        ],
      );

      const row = rows[0];
      if (!row) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }

      return toLeaveRequest(row);
    },
  };
}
