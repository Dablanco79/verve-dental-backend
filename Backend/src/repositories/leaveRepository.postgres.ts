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
  ApproveLeaveResult,
  ApproveLeaveCancellationResult,
  CancelApprovedLeaveInput,
  CreateLeaveCancellationRequestInput,
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  LeaveCancellationRequest,
  LeaveCancellationRequestStatus,
  LeaveRosterConflict,
  LeaveRequestStatus,
  LeaveType,
  ListLeaveOptions,
  ListLeavePageOptions,
  RosterLeaveBlock,
  UpdateLeaveStatusInput,
} from "../types/payroll.js";
import type { DatabasePool } from "../db/pool.js";
import type { PoolClient } from "pg";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "../db/tenantContext.js";
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
  cancelled_by_user_id: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  cancellation_self_review_exception_used: boolean;
  created_at: Date;
  updated_at: Date;
};

type LeaveCancellationRequestRow = {
  id: string;
  leave_request_id: string;
  clinic_id: string;
  staff_user_id: string;
  requested_by_user_id: string;
  request_reason: string;
  status: string;
  requested_at: Date;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  self_review_exception_used: boolean;
  created_at: Date;
  updated_at: Date;
};

type RosterConflictRow = {
  id: string;
  staff_user_id: string;
  rostered_clinic_id: string;
  rostered_clinic_name: string;
  shift_start_at: Date;
  shift_end_at: Date;
  status: "scheduled" | "confirmed";
};

type RosterLeaveBlockRow = {
  leave_id: string;
  staff_user_id: string;
  staff_email: string;
  start_date: string;
  end_date: string;
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
    cancelledByUserId: row.cancelled_by_user_id,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    cancellationSelfReviewExceptionUsed: row.cancellation_self_review_exception_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCancellationRequest(row: LeaveCancellationRequestRow): LeaveCancellationRequest {
  return {
    id: row.id,
    leaveRequestId: row.leave_request_id,
    clinicId: row.clinic_id,
    staffUserId: row.staff_user_id,
    requestedByUserId: row.requested_by_user_id,
    requestReason: row.request_reason,
    status: row.status as LeaveCancellationRequestStatus,
    requestedAt: row.requested_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
    selfReviewExceptionUsed: row.self_review_exception_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertSoleOwnerAdminReviewException(
  client: PoolClient,
  clinicId: string,
  actorId: string,
  exceptionUsed: boolean,
): Promise<void> {
  if (!exceptionUsed) return;
  const { rows } = await client.query<{ allowed: boolean }>(
    `WITH target_organisation AS (
       SELECT organisation_id
         FROM clinics
        WHERE id = $1
          AND organisation_id IS NOT NULL
     )
     SELECT
       EXISTS (
         SELECT 1
           FROM users actor
           JOIN clinics actor_clinic ON actor_clinic.id = actor.home_clinic_id
           JOIN target_organisation target
             ON target.organisation_id = actor_clinic.organisation_id
          WHERE actor.id = $2
            AND actor.is_active = true
            AND actor.role = 'owner_admin'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM users u
           CROSS JOIN target_organisation target
          WHERE u.id <> $2
            AND u.is_active = true
            AND (
              (
                u.role = 'owner_admin'
                AND EXISTS (
                  SELECT 1
                    FROM clinics owner_clinic
                   WHERE owner_clinic.id = u.home_clinic_id
                     AND owner_clinic.organisation_id = target.organisation_id
                )
              )
              OR (
                u.role = 'group_practice_manager'
                AND u.home_clinic_id = $1
                AND EXISTS (
                  SELECT 1 FROM user_permission_grants g
                   WHERE g.user_id = u.id
                     AND g.clinic_id = $1
                     AND g.revoked_at IS NULL
                     AND g.permission = 'module:leave'
                )
              )
            )
       ) AS allowed`,
    [clinicId, actorId],
  );
  if (!(rows[0]?.allowed ?? false)) {
    throw new AppError(
      403,
      "SELF_REVIEW_FORBIDDEN",
      "You cannot review your own cancellation request",
    );
  }
}

function toRosterConflict(row: RosterConflictRow): LeaveRosterConflict {
  return {
    rosterEntryId: row.id,
    staffUserId: row.staff_user_id,
    rosteredClinicId: row.rostered_clinic_id,
    rosteredClinicName: row.rostered_clinic_name,
    shiftStartAt: row.shift_start_at,
    shiftEndAt: row.shift_end_at,
    status: row.status,
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
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create leave request");
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

    // ── listByClinicPaginated ──────────────────────────────────────────────

    async listByClinicPaginated(
      clinicId: string,
      options?: ListLeavePageOptions,
    ): Promise<LeavePage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;

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

      if (options?.from) {
        params.push(options.from);
        conditions.push(`end_date >= $${String(params.length)}::date`);
      }

      if (options?.to) {
        params.push(options.to);
        conditions.push(`start_date <= $${String(params.length)}::date`);
      }

      const where = conditions.join(" AND ");

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM leave_requests WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const idx = params.length + 1;
      params.push(limit, offset);
      const { rows } = await pool.query<LeaveRequestRow>(
        `SELECT * FROM leave_requests
         WHERE ${where}
         ORDER BY start_date DESC
         LIMIT $${String(idx)} OFFSET $${String(idx + 1)}`,
        params,
      );

      return { items: rows.map(toLeaveRequest), total, limit, offset };
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

    async findApprovedOverlapRange(
      staffUserId: string,
      firstDate: string,
      lastDate: string,
    ): Promise<LeaveRequest[]> {
      const { rows } = await pool.query<LeaveRequestRow>(
        `SELECT * FROM leave_requests
         WHERE staff_user_id = $1
           AND status = 'approved'
           AND start_date <= $3::date
           AND end_date   >= $2::date`,
        [staffUserId, firstDate, lastDate],
      );
      return rows.map(toLeaveRequest);
    },

    async approveWithRosterConflicts(input): Promise<ApproveLeaveResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true),
                  set_config('app.owner_admin_mode',  'true', true),
                  set_config('app.current_user_id',   '',     true)`,
          [AUTH_BYPASS_CLINIC_ID],
        );

        // Universal workforce lock order: person advisory lock, then row lock.
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended('workforce-person:' || $1::text, 0)
           )`,
          [input.expectedStaffUserId],
        );

        const locked = await client.query<LeaveRequestRow>(
          `SELECT * FROM leave_requests
           WHERE id = $1
             AND clinic_id = $2
             AND staff_user_id = $3
           FOR UPDATE`,
          [input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        const request = locked.rows[0];
        if (!request) {
          throw new AppError(404, "NOT_FOUND", "Leave request not found");
        }
        if (request.status !== "pending") {
          throw new AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            `Leave request is already '${request.status}' and cannot be approved`,
          );
        }

        const conflictRows = await client.query<RosterConflictRow>(
          `SELECT id, staff_user_id, rostered_clinic_id, rostered_clinic_name,
                  shift_start_at, shift_end_at, status
             FROM roster_entries
            WHERE staff_user_id = $1
              AND status IN ('scheduled', 'confirmed')
              AND timezone($4, shift_start_at)::date <= $3::date
              AND timezone($4, shift_end_at - interval '1 microsecond')::date >= $2::date
            ORDER BY shift_start_at, id`,
          [request.staff_user_id, request.start_date, request.end_date, input.timeZone],
        );

        const updated = await client.query<LeaveRequestRow>(
          `UPDATE leave_requests
              SET status = 'approved',
                  reviewed_by_user_id = $2,
                  reviewed_at = now(),
                  review_notes = $3,
                  updated_at = now()
            WHERE id = $1 AND status = 'pending'
            RETURNING *`,
          [input.leaveId, input.reviewedByUserId, input.reviewNotes],
        );
        const leave = updated.rows[0];
        if (!leave) {
          throw new AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            "Leave request is no longer pending",
          );
        }

        await client.query("COMMIT");
        return {
          leave: toLeaveRequest(leave),
          conflicts: conflictRows.rows.map(toRosterConflict),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async cancelApprovedLeave(input: CancelApprovedLeaveInput): Promise<LeaveRequest> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true),
                  set_config('app.owner_admin_mode',  'true', true),
                  set_config('app.current_user_id',   '',     true)`,
          [AUTH_BYPASS_CLINIC_ID],
        );

        // Universal workforce lock order: person advisory lock, then row lock.
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended('workforce-person:' || $1::text, 0)
           )`,
          [input.expectedStaffUserId],
        );

        const locked = await client.query<LeaveRequestRow>(
          `SELECT * FROM leave_requests
           WHERE id = $1
             AND clinic_id = $2
             AND staff_user_id = $3
           FOR UPDATE`,
          [input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        const request = locked.rows[0];
        if (!request) {
          throw new AppError(404, "NOT_FOUND", "Leave request not found");
        }
        if (request.status !== "approved") {
          throw new AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            `Leave request is '${request.status}' and cannot be cancelled`,
          );
        }

        const pending = await client.query(
          `SELECT id FROM leave_cancellation_requests
            WHERE leave_request_id = $1 AND status = 'pending'
            FOR UPDATE`,
          [input.leaveId],
        );
        if ((pending.rowCount ?? 0) > 0) {
          throw new AppError(
            409,
            "PENDING_CANCELLATION_REQUEST",
            "This leave request has a pending cancellation request",
          );
        }

        await assertSoleOwnerAdminReviewException(
          client,
          input.clinicId,
          input.cancelledByUserId,
          input.selfReviewExceptionUsed ?? false,
        );

        const updated = await client.query<LeaveRequestRow>(
          `UPDATE leave_requests
              SET status = 'cancelled',
                  cancelled_by_user_id = $2,
                  cancelled_at = now(),
                  cancellation_reason = $3,
                  cancellation_self_review_exception_used = $4,
                  updated_at = now()
            WHERE id = $1 AND status = 'approved'
            RETURNING *`,
          [input.leaveId, input.cancelledByUserId, input.cancellationReason, input.selfReviewExceptionUsed ?? false],
        );
        const leave = updated.rows[0];
        if (!leave) {
          throw new AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            "Leave request is no longer approved",
          );
        }

        await client.query("COMMIT");
        return toLeaveRequest(leave);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async createCancellationRequest(input: CreateLeaveCancellationRequestInput): Promise<LeaveCancellationRequest> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true),
                  set_config('app.owner_admin_mode', 'false', true),
                  set_config('app.current_user_id', $2, true)`,
          [input.clinicId, input.requestedByUserId],
        );
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('workforce-person:' || $1::text, 0))`, [input.staffUserId]);
        const parent = await client.query<LeaveRequestRow>(
          `SELECT * FROM leave_requests WHERE id = $1 AND clinic_id = $2 AND staff_user_id = $3 FOR UPDATE`,
          [input.leaveRequestId, input.clinicId, input.staffUserId],
        );
        if (!parent.rows[0]) throw new AppError(404, "NOT_FOUND", "Leave request not found");
        if (parent.rows[0].status !== "approved") {
          throw new AppError(409, "INVALID_STATUS_TRANSITION", "Only approved leave can be cancelled");
        }
        await client.query(
          `SELECT id FROM leave_cancellation_requests WHERE leave_request_id = $1 AND status = 'pending' FOR UPDATE`,
          [input.leaveRequestId],
        );
        const inserted = await client.query<LeaveCancellationRequestRow>(
          `INSERT INTO leave_cancellation_requests
             (leave_request_id, clinic_id, staff_user_id, requested_by_user_id, request_reason)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [input.leaveRequestId, input.clinicId, input.staffUserId, input.requestedByUserId, input.requestReason],
        ).catch((error: unknown) => {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
            throw new AppError(409, "DUPLICATE_PENDING_CANCELLATION", "A cancellation request is already pending");
          }
          throw error;
        });
        const row = inserted.rows[0];
        if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create cancellation request");
        await client.query("COMMIT");
        return toCancellationRequest(row);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async listCancellationRequestsByStaff(staffUserId, options) {
      const params: unknown[] = [staffUserId];
      const status = options?.status ? " AND status = $2" : "";
      if (options?.status) params.push(options.status);
      const { rows } = await pool.query<LeaveCancellationRequestRow>(
        `SELECT * FROM leave_cancellation_requests WHERE staff_user_id = $1${status} ORDER BY requested_at DESC`,
        params,
      );
      return rows.map(toCancellationRequest);
    },

    async listCancellationRequestsByClinic(clinicId, options) {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const params: unknown[] = [clinicId];
        const status = options?.status ? " AND status = $2" : "";
        if (options?.status) params.push(options.status);
        const { rows } = await client.query<LeaveCancellationRequestRow>(
          `SELECT * FROM leave_cancellation_requests WHERE clinic_id = $1${status} ORDER BY requested_at DESC`,
          params,
        );
        return rows.map(toCancellationRequest);
      }, true);
    },

    async findCancellationRequestById(input) {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<LeaveCancellationRequestRow>(
          `SELECT * FROM leave_cancellation_requests
            WHERE id = $1 AND leave_request_id = $2 AND clinic_id = $3`,
          [input.requestId, input.leaveId, input.clinicId],
        );
        return rows[0] ? toCancellationRequest(rows[0]) : null;
      }, true);
    },

    async approveCancellationRequest(input): Promise<ApproveLeaveCancellationResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true), set_config('app.owner_admin_mode', 'true', true), set_config('app.current_user_id', '', true)`,
          [AUTH_BYPASS_CLINIC_ID],
        );
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('workforce-person:' || $1::text, 0))`, [input.expectedStaffUserId]);
        const parent = await client.query<LeaveRequestRow>(
          `SELECT * FROM leave_requests WHERE id = $1 AND clinic_id = $2 AND staff_user_id = $3 FOR UPDATE`,
          [input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        const child = await client.query<LeaveCancellationRequestRow>(
          `SELECT * FROM leave_cancellation_requests WHERE id = $1 AND leave_request_id = $2 AND clinic_id = $3 AND staff_user_id = $4 FOR UPDATE`,
          [input.requestId, input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        if (!parent.rows[0] || !child.rows[0]) throw new AppError(404, "NOT_FOUND", "Cancellation request not found");
        if (parent.rows[0].status !== "approved" || child.rows[0].status !== "pending") {
          throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
        }
        await assertSoleOwnerAdminReviewException(
          client,
          input.clinicId,
          input.reviewedByUserId,
          input.selfReviewExceptionUsed,
        );
        const updatedChild = await client.query<LeaveCancellationRequestRow>(
          `UPDATE leave_cancellation_requests SET status = 'approved', reviewed_by_user_id = $2, reviewed_at = now(),
             review_notes = $3, self_review_exception_used = $4, updated_at = now()
           WHERE id = $1 AND status = 'pending' RETURNING *`,
          [input.requestId, input.reviewedByUserId, input.reviewNotes, input.selfReviewExceptionUsed],
        );
        const updatedParent = await client.query<LeaveRequestRow>(
          `UPDATE leave_requests SET status = 'cancelled', cancelled_by_user_id = $2, cancelled_at = now(),
             cancellation_reason = $3, cancellation_self_review_exception_used = $4, updated_at = now()
           WHERE id = $1 AND status = 'approved' RETURNING *`,
          [input.leaveId, input.reviewedByUserId, child.rows[0].request_reason, input.selfReviewExceptionUsed],
        );
        if (!updatedChild.rows[0] || !updatedParent.rows[0]) throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
        await client.query("COMMIT");
        return { request: toCancellationRequest(updatedChild.rows[0]), leave: toLeaveRequest(updatedParent.rows[0]) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },

    async declineCancellationRequest(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true), set_config('app.owner_admin_mode', 'true', true), set_config('app.current_user_id', '', true)`,
          [AUTH_BYPASS_CLINIC_ID],
        );
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('workforce-person:' || $1::text, 0))`, [input.expectedStaffUserId]);
        const parent = await client.query<LeaveRequestRow>(
          `SELECT * FROM leave_requests WHERE id = $1 AND clinic_id = $2 AND staff_user_id = $3 FOR UPDATE`,
          [input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        const child = await client.query<LeaveCancellationRequestRow>(
          `SELECT * FROM leave_cancellation_requests WHERE id = $1 AND leave_request_id = $2 AND clinic_id = $3 AND staff_user_id = $4 FOR UPDATE`,
          [input.requestId, input.leaveId, input.clinicId, input.expectedStaffUserId],
        );
        if (!parent.rows[0] || !child.rows[0]) throw new AppError(404, "NOT_FOUND", "Cancellation request not found");
        if (parent.rows[0].status !== "approved" || child.rows[0].status !== "pending") {
          throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
        }
        await assertSoleOwnerAdminReviewException(
          client,
          input.clinicId,
          input.reviewedByUserId,
          input.selfReviewExceptionUsed,
        );
        const updated = await client.query<LeaveCancellationRequestRow>(
          `UPDATE leave_cancellation_requests SET status = 'declined', reviewed_by_user_id = $2, reviewed_at = now(),
             review_notes = $3, self_review_exception_used = $4, updated_at = now()
           WHERE id = $1 AND status = 'pending' RETURNING *`,
          [input.requestId, input.reviewedByUserId, input.reviewNotes, input.selfReviewExceptionUsed],
        );
        if (!updated.rows[0]) throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
        await client.query("COMMIT");
        return toCancellationRequest(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },

    async listRosterConflicts(input): Promise<LeaveRosterConflict[]> {
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const leaveResult = await client.query<LeaveRequestRow>(
            `SELECT * FROM leave_requests
             WHERE id = $1
               AND clinic_id = $2
               AND staff_user_id = $3`,
            [input.leaveId, input.clinicId, input.expectedStaffUserId],
          );
          const request = leaveResult.rows[0];
          if (!request) throw new AppError(404, "NOT_FOUND", "Leave request not found");

          const conflicts = await client.query<RosterConflictRow>(
            `SELECT id, staff_user_id, rostered_clinic_id, rostered_clinic_name,
                    shift_start_at, shift_end_at, status
               FROM roster_entries
              WHERE staff_user_id = $1
                AND status IN ('scheduled', 'confirmed')
                AND timezone($4, shift_start_at)::date <= $3::date
                AND timezone($4, shift_end_at - interval '1 microsecond')::date >= $2::date
              ORDER BY shift_start_at, id`,
            [request.staff_user_id, request.start_date, request.end_date, input.timeZone],
          );
          return conflicts.rows.map(toRosterConflict);
        },
        true,
      );
    },

    async listApprovedForStaff(
      staffUserIds: string[],
      firstDate: string,
      lastDate: string,
    ): Promise<RosterLeaveBlock[]> {
      if (staffUserIds.length === 0) return [];
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<RosterLeaveBlockRow>(
            `SELECT id AS leave_id, staff_user_id, staff_email,
                    start_date, end_date
               FROM leave_requests
              WHERE staff_user_id = ANY($1::uuid[])
                AND status = 'approved'
                AND start_date <= $3::date
                AND end_date >= $2::date
              ORDER BY start_date, staff_user_id, id`,
            [staffUserIds, firstDate, lastDate],
          );
          return rows.map((row) => ({
            leaveId: row.leave_id,
            staffUserId: row.staff_user_id,
            staffEmail: row.staff_email,
            startDate: row.start_date,
            endDate: row.end_date,
          }));
        },
        true,
      );
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
