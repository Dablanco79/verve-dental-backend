import type { DatabasePool } from "../db/pool.js";
import type {
  CreateRosterEntryInput,
  ListRosterOptions,
  RosterEntry,
  RosterStatus,
  ShiftType,
  UpdateRosterEntryInput,
} from "../types/roster.js";
import type { RosterRepository } from "./rosterRepository.js";

type RosterEntryRow = {
  id: string;
  staff_user_id: string;
  staff_email: string;
  rostered_clinic_id: string;
  rostered_clinic_name: string;
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
    async createEntry(input: CreateRosterEntryInput): Promise<RosterEntry> {
      const { rows } = await pool.query<RosterEntryRow>(
        `INSERT INTO roster_entries
           (staff_user_id, staff_email, rostered_clinic_id, rostered_clinic_name,
            shift_start_at, shift_end_at, shift_type, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
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
      if (!row) throw new Error("Failed to create roster entry");

      const entry = toRosterEntry(row);

      await pool.query(
        `INSERT INTO roster_entry_audit
           (roster_entry_id, changed_by_user_id, changed_by_email, action, snapshot)
         VALUES ($1, $2, $3, 'created', $4)`,
        [row.id, input.createdByUserId, input.staffEmail, JSON.stringify(entry)],
      );

      return entry;
    },

    async findEntryById(entryId: string): Promise<RosterEntry | null> {
      const { rows } = await pool.query<RosterEntryRow>(
        "SELECT * FROM roster_entries WHERE id = $1",
        [entryId],
      );

      return rows[0] ? toRosterEntry(rows[0]) : null;
    },

    async listByClinic(
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      const params: unknown[] = [clinicId];
      const conditions: string[] = ["rostered_clinic_id = $1"];

      if (options?.status) {
        params.push(options.status);
        conditions.push(`status = $${params.length}`);
      }
      if (options?.from) {
        params.push(options.from);
        conditions.push(`shift_start_at >= $${params.length}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`shift_start_at < $${params.length}`);
      }

      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT * FROM roster_entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY shift_start_at ASC`,
        params,
      );

      return rows.map(toRosterEntry);
    },

    async listByStaff(
      staffUserId: string,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      const params: unknown[] = [staffUserId];
      const conditions: string[] = ["staff_user_id = $1"];

      if (options?.from) {
        params.push(options.from);
        conditions.push(`shift_start_at >= $${params.length}`);
      }
      if (options?.to) {
        params.push(options.to);
        conditions.push(`shift_start_at < $${params.length}`);
      }

      const { rows } = await pool.query<RosterEntryRow>(
        `SELECT * FROM roster_entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY shift_start_at ASC`,
        params,
      );

      return rows.map(toRosterEntry);
    },

    async updateEntry(
      entryId: string,
      input: UpdateRosterEntryInput,
      changedBy: { userId: string; email: string },
    ): Promise<RosterEntry> {
      const setClauses: string[] = ["updated_at = now()"];
      const params: unknown[] = [];

      if (input.shiftStartAt !== undefined) {
        params.push(input.shiftStartAt);
        setClauses.push(`shift_start_at = $${params.length}`);
      }
      if (input.shiftEndAt !== undefined) {
        params.push(input.shiftEndAt);
        setClauses.push(`shift_end_at = $${params.length}`);
      }
      if (input.shiftType !== undefined) {
        params.push(input.shiftType);
        setClauses.push(`shift_type = $${params.length}`);
      }
      if (input.status !== undefined) {
        params.push(input.status);
        setClauses.push(`status = $${params.length}`);
      }
      if (input.notes !== undefined) {
        params.push(input.notes);
        setClauses.push(`notes = $${params.length}`);
      }

      params.push(entryId);

      const { rows } = await pool.query<RosterEntryRow>(
        `UPDATE roster_entries
         SET ${setClauses.join(", ")}
         WHERE id = $${params.length}
         RETURNING *`,
        params,
      );

      const row = rows[0];
      if (!row) throw new Error(`Roster entry not found: ${entryId}`);

      const updated = toRosterEntry(row);
      const action = input.status === "cancelled" ? "cancelled" : "updated";

      await pool.query(
        `INSERT INTO roster_entry_audit
           (roster_entry_id, changed_by_user_id, changed_by_email, action, snapshot)
         VALUES ($1, $2, $3, $4, $5)`,
        [entryId, changedBy.userId, changedBy.email, action, JSON.stringify(updated)],
      );

      return updated;
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
  };
}
