import { AppError } from "../types/errors.js";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "../db/tenantContext.js";
import type { DatabasePool } from "../db/pool.js";
import type {
  CreateRosterEntryInput,
  ListRosterOptions,
  ListRosterPageOptions,
  RosterEntry,
  RosterPage,
  RosterStatus,
  ShiftType,
  UpdateRosterEntryInput,
} from "../types/roster.js";
import type { RosterRepository } from "./rosterRepository.js";
import type { ConflictCheckParams, ConflictCheckUpdateParams } from "./rosterRepository.js";

type RosterEntryRow = {
  id: string;
  staff_user_id: string;
  staff_email: string;
  rostered_clinic_id: string;
  rostered_clinic_name: string;
  rostered_clinic_preferred_name: string | null;
  shift_start_at: Date;
  shift_end_at: Date;
  shift_type: string;
  status: string;
  notes: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

function toRosterEntry(row: RosterEntryRow): RosterEntry {
  return {
    id: row.id,
    staffUserId: row.staff_user_id,
    staffEmail: row.staff_email,
    rosteredClinicId: row.rostered_clinic_id,
    rosteredClinicName: row.rostered_clinic_name,
    rosteredClinicPreferredName: row.rostered_clinic_preferred_name ?? null,
    shiftStartAt: row.shift_start_at,
    shiftEndAt: row.shift_end_at,
    shiftType: row.shift_type as ShiftType,
    status: row.status as RosterStatus,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresRosterRepository(pool: DatabasePool): RosterRepository {
  return {
    async createEntry(input: CreateRosterEntryInput, conflictCheck?: ConflictCheckParams): Promise<RosterEntry> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (conflictCheck) {
          // ── Advisory-lock + inline conflict check ────────────────────────
          // 1. Set transaction-local owner-admin context so the SELECT below can
          //    read roster_entries across ALL clinics, bypassing RLS.
          // 2. Acquire a per-staff-member advisory lock (transaction-scoped).
          //    Two concurrent requests for the same staff member will execute
          //    their check-then-insert SERIALLY; different staff do not block
          //    each other.  hashtext(uuid) → int4, which pg casts to bigint.
          // 3. Run the strict-overlap query.
          // 4. Throw ROSTER_CONFLICT before writing if any overlap is found.
          await client.query(
            `SELECT set_config('app.current_clinic_id', $1, true),
                    set_config('app.owner_admin_mode',  'true', true),
                    set_config('app.current_user_id',   '',     true)`,
            [AUTH_BYPASS_CLINIC_ID],
          );
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
            [input.staffUserId],
          );
          const { rows: conflictRows } = await client.query<RosterEntryRow>(
            `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
             FROM roster_entries re
             LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
             WHERE re.staff_user_id = $1
               AND re.status != 'cancelled'
               AND re.shift_start_at < $2
               AND re.shift_end_at   > $3
             ORDER BY re.shift_start_at ASC
             LIMIT 1`,
            [input.staffUserId, conflictCheck.windowEnd, conflictCheck.windowStart],
          );
          if (conflictRows.length > 0) {
            const firstRow = conflictRows[0];
            if (!firstRow) throw new AppError(500, "INTERNAL_ERROR", "Unexpected empty conflict rows");
            const first = toRosterEntry(firstRow);
            const fmtT = (d: Date) =>
              d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
            const name = conflictCheck.staffDisplayName ?? input.staffEmail;
            throw new AppError(
              409,
              "ROSTER_CONFLICT",
              `Roster conflict: ${name} is already rostered at ${first.rosteredClinicName} from ${fmtT(first.shiftStartAt)}–${fmtT(first.shiftEndAt)}. The proposed shift overlaps this roster.`,
            );
          }
        }

        const { rows } = await client.query<RosterEntryRow>(
          `WITH ins AS (
             INSERT INTO roster_entries
               (staff_user_id, staff_email, rostered_clinic_id, rostered_clinic_name,
                shift_start_at, shift_end_at, shift_type, notes, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *
           )
           SELECT ins.*, c.preferred_name AS rostered_clinic_preferred_name
           FROM ins
           LEFT JOIN clinics c ON c.id = ins.rostered_clinic_id`,
          [
            input.staffUserId,
            input.staffEmail,
            input.rosteredClinicId,
            input.rosteredClinicName,
            input.shiftStartAt,
            input.shiftEndAt,
            input.shiftType,
            input.notes,
            input.createdByUserId,
          ],
        );

        const row = rows[0];
        if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create roster entry");

        const entry = toRosterEntry(row);

        // Audit row uses caller's email, not the staff member's email.
        await client.query(
          `INSERT INTO roster_entry_audit
             (roster_entry_id, changed_by_user_id, changed_by_email, action, snapshot)
           VALUES ($1, $2, $3, 'created', $4)`,
          [row.id, input.createdByUserId, input.createdByEmail, JSON.stringify(entry)],
        );

        await client.query("COMMIT");
        return entry;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async findEntryById(entryId: string): Promise<RosterEntry | null> {
      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE re.id = $1`,
        [entryId],
      );

      return rows[0] ? toRosterEntry(rows[0]) : null;
    },

    async listByClinic(
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      const params: unknown[] = [clinicId];
      const conditions: string[] = ["re.rostered_clinic_id = $1"];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`re.status = $${String(params.length)}`);
      }
      // Overlap math: the shift overlaps [from, to) when
      //   shift_start_at < to  AND  shift_end_at > from
      // This correctly captures overnight shifts that straddle a boundary.
      if (options?.from) {
        params.push(options.from);
        conditions.push(`re.shift_end_at > $${String(params.length)}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`re.shift_start_at < $${String(params.length)}`);
      }

      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY re.shift_start_at ASC`,
        params,
      );

      return rows.map(toRosterEntry);
    },

    async listByClinicPaginated(
      clinicId: string,
      options?: ListRosterPageOptions,
    ): Promise<RosterPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;

      const params: unknown[] = [clinicId];
      const conditions: string[] = ["re.rostered_clinic_id = $1"];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`re.status = $${String(params.length)}`);
      }
      if (options?.from) {
        params.push(options.from);
        conditions.push(`re.shift_end_at > $${String(params.length)}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`re.shift_start_at < $${String(params.length)}`);
      }

      const where = conditions.join(" AND ");

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM roster_entries re WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const idx = params.length + 1;
      params.push(limit, offset);
      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE ${where}
         ORDER BY re.shift_start_at ASC
         LIMIT $${String(idx)} OFFSET $${String(idx + 1)}`,
        params,
      );

      return { items: rows.map(toRosterEntry), total, limit, offset };
    },

    async listByStaff(
      staffUserId: string,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      // Cross-clinic own-row query. RLS is satisfied by the narrow policy added in
      // migration 047: `staff_user_id::text = app_current_user_id()`. The pool hook
      // populates app.current_user_id from the authenticated request context (set by
      // rlsTenantContextMiddleware on the /roster/me router). No owner_admin bypass
      // is required or used here.
      const params: unknown[] = [staffUserId];
      const conditions: string[] = ["re.staff_user_id = $1"];

      if (options?.from) {
        params.push(options.from);
        conditions.push(`re.shift_end_at > $${String(params.length)}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`re.shift_start_at < $${String(params.length)}`);
      }

      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY re.shift_start_at ASC`,
        params,
      );
      return rows.map(toRosterEntry);
    },

    async listByStaffAtClinic(
      staffUserId: string,
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      const params: unknown[] = [staffUserId, clinicId];
      const conditions: string[] = [
        "re.staff_user_id = $1",
        "re.rostered_clinic_id = $2",
      ];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`re.status = $${String(params.length)}`);
      }
      if (options?.from) {
        params.push(options.from);
        conditions.push(`re.shift_end_at > $${String(params.length)}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`re.shift_start_at < $${String(params.length)}`);
      }

      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY re.shift_start_at ASC`,
        params,
      );

      return rows.map(toRosterEntry);
    },

    async listByStaffAtClinicPaginated(
      staffUserId: string,
      clinicId: string,
      options?: ListRosterPageOptions,
    ): Promise<RosterPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;

      const params: unknown[] = [staffUserId, clinicId];
      const conditions: string[] = [
        "re.staff_user_id = $1",
        "re.rostered_clinic_id = $2",
      ];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`re.status = $${String(params.length)}`);
      }
      if (options?.from) {
        params.push(options.from);
        conditions.push(`re.shift_end_at > $${String(params.length)}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`re.shift_start_at < $${String(params.length)}`);
      }

      const where = conditions.join(" AND ");

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM roster_entries re WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const idx = params.length + 1;
      params.push(limit, offset);
      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
         FROM roster_entries re
         LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
         WHERE ${where}
         ORDER BY re.shift_start_at ASC
         LIMIT $${String(idx)} OFFSET $${String(idx + 1)}`,
        params,
      );

      return { items: rows.map(toRosterEntry), total, limit, offset };
    },

    async updateEntry(
      entryId: string,
      input: UpdateRosterEntryInput,
      changedBy: { userId: string; email: string },
      conflictCheck?: ConflictCheckUpdateParams,
    ): Promise<RosterEntry> {
      const setClauses: string[] = ["updated_at = now()"];
      const params: unknown[] = [];

      if (input.shiftStartAt !== undefined) {
        params.push(input.shiftStartAt);
        setClauses.push(`shift_start_at = $${String(params.length)}`);
      }
      if (input.shiftEndAt !== undefined) {
        params.push(input.shiftEndAt);
        setClauses.push(`shift_end_at = $${String(params.length)}`);
      }
      if (input.shiftType !== undefined) {
        params.push(input.shiftType);
        setClauses.push(`shift_type = $${String(params.length)}`);
      }
      if (input.status !== undefined) {
        params.push(input.status);
        setClauses.push(`status = $${String(params.length)}`);
      }
      if (input.notes !== undefined) {
        params.push(input.notes);
        setClauses.push(`notes = $${String(params.length)}`);
      }
      if (input.rosteredClinicId !== undefined) {
        params.push(input.rosteredClinicId);
        setClauses.push(`rostered_clinic_id = $${String(params.length)}`);
      }
      if (input.rosteredClinicName !== undefined) {
        params.push(input.rosteredClinicName);
        setClauses.push(`rostered_clinic_name = $${String(params.length)}`);
      }

      params.push(entryId);
      const idIdx = params.length;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (conflictCheck) {
          // ── Advisory-lock + inline conflict check (same pattern as createEntry) ──
          await client.query(
            `SELECT set_config('app.current_clinic_id', $1, true),
                    set_config('app.owner_admin_mode',  'true', true),
                    set_config('app.current_user_id',   '',     true)`,
            [AUTH_BYPASS_CLINIC_ID],
          );
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
            [conflictCheck.staffUserId],
          );

          const params: unknown[] = [
            conflictCheck.staffUserId,
            conflictCheck.windowEnd,
            conflictCheck.windowStart,
          ];
          let sql = `
            SELECT * FROM roster_entries
            WHERE staff_user_id = $1
              AND status != 'cancelled'
              AND shift_start_at < $2
              AND shift_end_at   > $3`;

          if (conflictCheck.excludeEntryId) {
            params.push(conflictCheck.excludeEntryId);
            sql += `\n              AND id != $${String(params.length)}`;
          }
          sql += "\n            ORDER BY shift_start_at ASC LIMIT 1";

          // Wrap conflict check with LEFT JOIN to satisfy RosterEntryRow type (preferred_name).
          sql = `WITH base AS (${sql}) SELECT base.*, c.preferred_name AS rostered_clinic_preferred_name FROM base LEFT JOIN clinics c ON c.id = base.rostered_clinic_id`;
          const { rows: conflictRows } = await client.query<RosterEntryRow>(sql, params);
          if (conflictRows.length > 0) {
            const firstRow = conflictRows[0];
            if (!firstRow) throw new AppError(500, "INTERNAL_ERROR", "Unexpected empty conflict rows");
            const first = toRosterEntry(firstRow);
            const fmtT = (d: Date) =>
              d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
            throw new AppError(
              409,
              "ROSTER_CONFLICT",
              `Roster conflict: staff member is already rostered at ${first.rosteredClinicName} from ${fmtT(first.shiftStartAt)}–${fmtT(first.shiftEndAt)}. The updated shift times overlap this roster.`,
            );
          }
        }

        // The AND status <> 'cancelled' guard prevents a concurrent cancel
        // from being silently overwritten (race-condition protection).
        const { rows } = await client.query<RosterEntryRow>(
          `WITH upd AS (
             UPDATE roster_entries
             SET ${setClauses.join(", ")}
             WHERE id = $${String(idIdx)} AND status <> 'cancelled'
             RETURNING *
           )
           SELECT upd.*, c.preferred_name AS rostered_clinic_preferred_name
           FROM upd
           LEFT JOIN clinics c ON c.id = upd.rostered_clinic_id`,
          params,
        );

        const row = rows[0];
        if (!row) {
          // Zero rows means the entry was concurrently cancelled between the
          // service pre-check and this write — surface as a clean 409.
          throw new AppError(
            409,
            "ENTRY_CANCELLED",
            "Cannot update a cancelled roster entry",
          );
        }

        const updated = toRosterEntry(row);
        const action = input.status === "cancelled" ? "cancelled" : "updated";

        await client.query(
          `INSERT INTO roster_entry_audit
             (roster_entry_id, changed_by_user_id, changed_by_email, action, snapshot)
           VALUES ($1, $2, $3, $4, $5)`,
          [entryId, changedBy.userId, changedBy.email, action, JSON.stringify(updated)],
        );

        await client.query("COMMIT");
        return updated;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async hasActiveShiftAtClinic(
      staffUserId: string,
      clinicId: string,
    ): Promise<boolean> {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM roster_entries
           WHERE staff_user_id = $1
             AND rostered_clinic_id = $2
             AND status != 'cancelled'
         ) AS exists`,
        [staffUserId, clinicId],
      );

      return rows[0]?.exists ?? false;
    },

    async findOverlappingShifts(
      staffUserId: string,
      windowStart: Date,
      windowEnd: Date,
      excludeEntryId?: string,
    ): Promise<RosterEntry[]> {
      // Runs with owner-admin context so it can scan shifts across ALL clinics,
      // not just the manager's current clinic.  This is required for cross-clinic
      // conflict detection during roster create / update.
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const params: unknown[] = [staffUserId, windowEnd, windowStart];
          // Strict overlap: existingStart < windowEnd AND existingEnd > windowStart
          // (touching — existingEnd === windowStart — is NOT a conflict)
          let sql = `
            SELECT re.*, c.preferred_name AS rostered_clinic_preferred_name
            FROM roster_entries re
            LEFT JOIN clinics c ON c.id = re.rostered_clinic_id
            WHERE re.staff_user_id = $1
              AND re.status != 'cancelled'
              AND re.shift_start_at < $2
              AND re.shift_end_at   > $3`;

          if (excludeEntryId) {
            params.push(excludeEntryId);
            sql += `\n              AND re.id != $${String(params.length)}`;
          }

          sql += "\n            ORDER BY re.shift_start_at ASC";

          const { rows } = await client.query<RosterEntryRow>(sql, params);
          return rows.map(toRosterEntry);
        },
        true, // ownerAdmin — bypass clinic-scoped RLS to see all clinics
      );
    },
  };
}
