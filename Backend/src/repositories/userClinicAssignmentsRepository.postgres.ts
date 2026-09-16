import type { DatabasePool } from "../db/pool.js";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "../db/tenantContext.js";
import type {
  ClinicAssignment,
  UpsertAssignmentInput,
  UserClinicAssignmentsRepository,
} from "./userClinicAssignmentsRepository.js";

type AssignmentRow = {
  id: string;
  user_id: string;
  clinic_id: string;
  can_roster: boolean;
  can_operate: boolean;
  assigned_by_user_id: string | null;
  assigned_at: Date;
  updated_at: Date;
};

function toAssignment(row: AssignmentRow): ClinicAssignment {
  return {
    id: row.id,
    userId: row.user_id,
    clinicId: row.clinic_id,
    canRoster: row.can_roster,
    canOperate: row.can_operate,
    assignedByUserId: row.assigned_by_user_id,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresUserClinicAssignmentsRepository(
  pool: DatabasePool,
): UserClinicAssignmentsRepository {
  return {
    async listByUser(userId: string): Promise<ClinicAssignment[]> {
      // Cross-clinic query — must use ownerAdmin context to bypass clinic RLS.
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<AssignmentRow>(
          `SELECT * FROM user_clinic_assignments WHERE user_id = $1 ORDER BY assigned_at ASC`,
          [userId],
        );
        return rows.map(toAssignment);
      }, true);
    },

    async listByClinic(clinicId: string): Promise<ClinicAssignment[]> {
      // Uses the active tenant context set by rlsTenantContextMiddleware.
      const { rows } = await pool.query<AssignmentRow>(
        `SELECT * FROM user_clinic_assignments WHERE clinic_id = $1 ORDER BY assigned_at ASC`,
        [clinicId],
      );
      return rows.map(toAssignment);
    },

    async listRosterEligible(clinicId: string): Promise<ClinicAssignment[]> {
      // Joined against users to filter inactive accounts.
      // Uses active tenant context — roster-eligible queries are always
      // performed within a clinic-scoped route context.
      const { rows } = await pool.query<AssignmentRow>(
        `SELECT uca.*
         FROM user_clinic_assignments uca
         JOIN users u ON u.id = uca.user_id
         WHERE uca.clinic_id = $1
           AND uca.can_roster = true
           AND u.is_active = true
         ORDER BY uca.assigned_at ASC`,
        [clinicId],
      );
      return rows.map(toAssignment);
    },

    async listOperationalClinicIds(userId: string): Promise<string[]> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<{ clinic_id: string }>(
          `SELECT clinic_id FROM user_clinic_assignments
           WHERE user_id = $1 AND can_operate = true`,
          [userId],
        );
        return rows.map((r) => r.clinic_id);
      }, true);
    },

    async hasOperationalAccess(userId: string, clinicId: string): Promise<boolean> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM user_clinic_assignments
             WHERE user_id = $1 AND clinic_id = $2 AND can_operate = true
           ) AS exists`,
          [userId, clinicId],
        );
        return rows[0]?.exists ?? false;
      }, true);
    },

    async hasRosterEligibility(userId: string, clinicId: string): Promise<boolean> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM user_clinic_assignments
             WHERE user_id = $1 AND clinic_id = $2 AND can_roster = true
           ) AS exists`,
          [userId, clinicId],
        );
        return rows[0]?.exists ?? false;
      }, true);
    },

    async upsert(input: UpsertAssignmentInput): Promise<ClinicAssignment> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const { rows } = await client.query<AssignmentRow>(
          `INSERT INTO user_clinic_assignments
             (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (user_id, clinic_id) DO UPDATE SET
             can_roster          = EXCLUDED.can_roster,
             can_operate         = EXCLUDED.can_operate,
             assigned_by_user_id = COALESCE(EXCLUDED.assigned_by_user_id, user_clinic_assignments.assigned_by_user_id),
             updated_at          = now()
           RETURNING *`,
          [
            input.userId,
            input.clinicId,
            input.canRoster,
            input.canOperate,
            input.assignedByUserId ?? null,
          ],
        );
        const row = rows[0];
        if (!row) throw new Error("upsert returned no rows");
        return toAssignment(row);
      }, true);
    },

    async replaceForUser(
      userId: string,
      newAssignments: UpsertAssignmentInput[],
      grantedByUserId: string,
    ): Promise<ClinicAssignment[]> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        // Single transaction: delete removed clinics, then upsert the new set.
        const newClinicIds = newAssignments.map((a) => a.clinicId);

        // DELETE rows not present in the new set.
        if (newClinicIds.length > 0) {
          await client.query(
            `DELETE FROM user_clinic_assignments
             WHERE user_id = $1
               AND clinic_id NOT IN (SELECT UNNEST($2::uuid[]))`,
            [userId, newClinicIds],
          );
        } else {
          // Empty replacement — remove all existing rows for this user.
          await client.query(
            `DELETE FROM user_clinic_assignments WHERE user_id = $1`,
            [userId],
          );
        }

        const results: ClinicAssignment[] = [];
        for (const a of newAssignments) {
          const { rows } = await client.query<AssignmentRow>(
            `INSERT INTO user_clinic_assignments
               (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (user_id, clinic_id) DO UPDATE SET
               can_roster          = EXCLUDED.can_roster,
               can_operate         = EXCLUDED.can_operate,
               assigned_by_user_id = $5,
               updated_at          = now()
             RETURNING *`,
            [a.userId, a.clinicId, a.canRoster, a.canOperate, grantedByUserId],
          );
          const row = rows[0];
          if (row) results.push(toAssignment(row));
        }
        return results;
      }, true);
    },

    async remove(userId: string, clinicId: string): Promise<boolean> {
      return withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, async (client) => {
        const result = await client.query(
          `DELETE FROM user_clinic_assignments WHERE user_id = $1 AND clinic_id = $2`,
          [userId, clinicId],
        );
        return (result.rowCount ?? 0) > 0;
      }, true);
    },
  };
}
