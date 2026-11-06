import type { DatabasePool } from "../db/pool.js";
import { withTenantContext } from "../db/tenantContext.js";
import { AppError } from "../types/errors.js";
import type { CoverageGroup, LeaveCoverageWarning } from "../types/leaveCoverage.js";
import type { LeaveCoverageRepository } from "./leaveCoverageRepository.js";

type GroupRow = {
  id: string;
  clinic_id: string;
  name: string;
  member_user_ids: string[];
  created_at: Date;
  updated_at: Date;
};

type WarningRow = {
  enabled: boolean;
  group_count: string;
  subject_group_count: string;
  overlapping_count: string;
  affected_groups: Array<{ clinicId: string; groupId: string; groupName: string }>;
};

const toGroup = (row: GroupRow): CoverageGroup => ({
  id: row.id,
  clinicId: row.clinic_id,
  name: row.name,
  memberUserIds: row.member_user_ids,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function translateUnique(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    throw new AppError(409, "COVERAGE_GROUP_NAME_EXISTS", "Coverage group name already exists");
  }
  throw error;
}

export function createPostgresLeaveCoverageRepository(pool: DatabasePool): LeaveCoverageRepository {
  const selectGroup = `
    SELECT g.id, g.clinic_id, g.name, g.created_at, g.updated_at,
           COALESCE(array_agg(m.user_id ORDER BY m.user_id)
             FILTER (WHERE m.user_id IS NOT NULL), ARRAY[]::uuid[])::text[] AS member_user_ids
      FROM coverage_groups g
      LEFT JOIN coverage_group_members m
        ON m.group_id = g.id AND m.clinic_id = g.clinic_id`;

  return {
    async getSettings(clinicId) {
      const { rows } = await pool.query<{ enabled: boolean }>(
        "SELECT leave_overlap_warnings_enabled AS enabled FROM clinics WHERE id = $1",
        [clinicId],
      );
      if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Clinic not found");
      return { clinicId, enabled: rows[0].enabled };
    },

    async updateSettings(clinicId, enabled) {
      const { rows } = await pool.query<{ enabled: boolean }>(
        `UPDATE clinics SET leave_overlap_warnings_enabled = $2
          WHERE id = $1 RETURNING leave_overlap_warnings_enabled AS enabled`,
        [clinicId, enabled],
      );
      if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Clinic not found");
      return { clinicId, enabled: rows[0].enabled };
    },

    async listGroups(clinicId) {
      return withTenantContext(pool, clinicId, async (client) => {
        const { rows } = await client.query<GroupRow>(
          `${selectGroup}
            WHERE g.clinic_id = $1
            GROUP BY g.id
            ORDER BY g.name, g.id`,
          [clinicId],
        );
        return rows.map(toGroup);
      });
    },

    async createGroup(clinicId, name) {
      return withTenantContext(pool, clinicId, async (client) => {
        try {
          const { rows } = await client.query<GroupRow>(
            `INSERT INTO coverage_groups (clinic_id, name) VALUES ($1, $2)
             RETURNING id, clinic_id, name, ARRAY[]::text[] AS member_user_ids,
                       created_at, updated_at`,
            [clinicId, name],
          );
          if (!rows[0]) throw new AppError(500, "INTERNAL_ERROR", "Failed to create coverage group");
          return toGroup(rows[0]);
        } catch (error) {
          return translateUnique(error);
        }
      });
    },

    async updateGroup(clinicId, groupId, name) {
      return withTenantContext(pool, clinicId, async (client) => {
        try {
          const updated = await client.query(
            `UPDATE coverage_groups SET name = $3, updated_at = now()
              WHERE id = $2 AND clinic_id = $1`,
            [clinicId, groupId, name],
          );
          if (updated.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Coverage group not found");
          const { rows } = await client.query<GroupRow>(
            `${selectGroup}
              WHERE g.id = $2 AND g.clinic_id = $1
              GROUP BY g.id`,
            [clinicId, groupId],
          );
          const row = rows[0];
          if (!row) throw new AppError(404, "NOT_FOUND", "Coverage group not found");
          return toGroup(row);
        } catch (error) {
          return translateUnique(error);
        }
      });
    },

    async replaceMembers(clinicId, groupId, memberUserIds) {
      const uniqueIds = [...new Set(memberUserIds)];
      return withTenantContext(pool, clinicId, async (client) => {
        const group = await client.query(
          "SELECT id FROM coverage_groups WHERE id = $2 AND clinic_id = $1 FOR UPDATE",
          [clinicId, groupId],
        );
        if (group.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Coverage group not found");

        if (uniqueIds.length > 0) {
          const eligible = await client.query<{ user_id: string }>(
            `SELECT user_id FROM user_clinic_assignments
              WHERE clinic_id = $1 AND can_roster = true
                AND user_id = ANY($2::uuid[])`,
            [clinicId, uniqueIds],
          );
          const valid = new Set(eligible.rows.map((row) => row.user_id));
          const invalid = uniqueIds.filter((id) => !valid.has(id));
          if (invalid.length > 0) {
            throw new AppError(
              400,
              "INVALID_COVERAGE_MEMBERS",
              "All members must be roster-eligible at this clinic",
              invalid.map((id) => ({
                field: "memberUserIds",
                message: `${id} is not roster-eligible at this clinic`,
              })),
            );
          }
        }

        await client.query(
          "DELETE FROM coverage_group_members WHERE clinic_id = $1 AND group_id = $2",
          [clinicId, groupId],
        );
        if (uniqueIds.length > 0) {
          await client.query(
            `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
             SELECT $2, $1, unnest($3::uuid[])`,
            [clinicId, groupId, uniqueIds],
          );
        }
        await client.query(
          "UPDATE coverage_groups SET updated_at = now() WHERE id = $2 AND clinic_id = $1",
          [clinicId, groupId],
        );
        const { rows } = await client.query<GroupRow>(
          `${selectGroup}
            WHERE g.id = $2 AND g.clinic_id = $1
            GROUP BY g.id`,
          [clinicId, groupId],
        );
        const row = rows[0];
        if (!row) throw new AppError(404, "NOT_FOUND", "Coverage group not found");
        return toGroup(row);
      });
    },

    async getWarning(clinicId, subjectUserId, startDate, endDate) {
      // Owner mode is narrowly contained to this hard-filtered query because a
      // roster-eligible peer may have approved leave owned by another home clinic.
      return withTenantContext(pool, clinicId, async (client): Promise<LeaveCoverageWarning> => {
        const { rows } = await client.query<WarningRow>(
          `WITH clinic_groups AS (
             SELECT id, clinic_id, name
               FROM coverage_groups
              WHERE clinic_id = $1
           ), subject_groups AS (
             SELECT g.*
               FROM clinic_groups g
               JOIN coverage_group_members m
                 ON m.group_id = g.id AND m.clinic_id = $1
              WHERE m.user_id = $2
           ), peers AS (
             SELECT DISTINCT m.user_id
               FROM subject_groups g
               JOIN coverage_group_members m
                 ON m.group_id = g.id AND m.clinic_id = $1
              WHERE m.user_id <> $2
           ), overlapping_peers AS (
             SELECT DISTINCT l.staff_user_id
               FROM leave_requests l
               JOIN peers p ON p.user_id = l.staff_user_id
              WHERE l.status = 'approved'
                AND l.start_date <= $4::date
                AND l.end_date >= $3::date
           ), affected AS (
             SELECT DISTINCT g.clinic_id, g.id, g.name
               FROM subject_groups g
               JOIN coverage_group_members m
                 ON m.group_id = g.id AND m.clinic_id = $1
               JOIN overlapping_peers p ON p.staff_user_id = m.user_id
           )
           SELECT c.leave_overlap_warnings_enabled AS enabled,
                  (SELECT count(*)::text FROM clinic_groups) AS group_count,
                  (SELECT count(*)::text FROM subject_groups) AS subject_group_count,
                  (SELECT count(*)::text FROM overlapping_peers) AS overlapping_count,
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'clinicId', clinic_id, 'groupId', id, 'groupName', name
                    ) ORDER BY name, id)
                      FROM affected
                  ), '[]'::jsonb) AS affected_groups
             FROM clinics c
            WHERE c.id = $1`,
          [clinicId, subjectUserId, startDate, endDate],
        );
        const row = rows[0];
        if (!row) throw new AppError(404, "NOT_FOUND", "Clinic not found");
        const base = {
          enabled: row.enabled,
          overlappingColleagueCount: 0,
          affectedGroups: [],
        };
        if (!row.enabled) return { ...base, status: "disabled" };
        if (Number(row.group_count) === 0) return { ...base, status: "unconfigured" };
        if (Number(row.subject_group_count) === 0) return { ...base, status: "staff_unassigned" };
        return {
          enabled: true,
          status: "ready",
          overlappingColleagueCount: Number(row.overlapping_count),
          affectedGroups: row.affected_groups,
        };
      }, true);
    },
  };
}
