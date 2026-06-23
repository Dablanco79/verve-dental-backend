/**
 * PostgreSQL-backed PermissionRepository.
 *
 * Queries run with owner_admin context (via withTenantContext) because:
 *   - listActiveByUser is called from the auth path (no per-request clinic context).
 *   - grant/revoke are called from clinic-scoped API routes whose pool hook has
 *     already injected a tenant context, but using withTenantContext + ownerAdmin=true
 *     is safe here — RBAC enforcement is done in permissionService, not at DB level.
 *
 * Table: user_permission_grants
 *   id           UUID PRIMARY KEY
 *   clinic_id    UUID NOT NULL
 *   user_id      UUID NOT NULL
 *   permission   TEXT NOT NULL
 *   granted_by   UUID NOT NULL
 *   granted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 *   revoked_at   TIMESTAMPTZ
 *
 * Partial unique index ensures only one active grant per (clinic_id, user_id, permission):
 *   UNIQUE (clinic_id, user_id, permission) WHERE revoked_at IS NULL
 */

import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "../db/tenantContext.js";
import type { DatabasePool } from "../db/pool.js";
import { AppError } from "../types/errors.js";
import type { PermissionGrant, PermissionRepository } from "./permissionRepository.js";

type GrantRow = {
  id: string;
  clinic_id: string;
  user_id: string;
  permission: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
};

function rowToGrant(row: GrantRow): PermissionGrant {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    userId: row.user_id,
    permission: row.permission,
    grantedBy: row.granted_by,
    grantedAt: new Date(row.granted_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

export function createPostgresPermissionRepository(
  pool: DatabasePool,
): PermissionRepository {
  return {
    async listActiveByUser(userId: string): Promise<string[]> {
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<{ permission: string }>(
            `SELECT DISTINCT permission
               FROM user_permission_grants
              WHERE user_id = $1
                AND revoked_at IS NULL`,
            [userId],
          );
          return rows.map((r) => r.permission);
        },
        true, // ownerAdmin
      );
    },

    async listGrantsByUser(userId: string, clinicId: string): Promise<PermissionGrant[]> {
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<GrantRow>(
            `SELECT *
               FROM user_permission_grants
              WHERE user_id = $1
                AND clinic_id = $2
              ORDER BY granted_at ASC`,
            [userId, clinicId],
          );
          return rows.map(rowToGrant);
        },
        true,
      );
    },

    async grant(
      clinicId: string,
      userId: string,
      permission: string,
      grantedBy: string,
    ): Promise<PermissionGrant> {
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          // Return existing active grant if one already exists (idempotent).
          const { rows: existing } = await client.query<GrantRow>(
            `SELECT * FROM user_permission_grants
              WHERE clinic_id = $1
                AND user_id   = $2
                AND permission = $3
                AND revoked_at IS NULL
              LIMIT 1`,
            [clinicId, userId, permission],
          );

          if (existing[0]) return rowToGrant(existing[0]);

          const { rows } = await client.query<GrantRow>(
            `INSERT INTO user_permission_grants
               (clinic_id, user_id, permission, granted_by)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [clinicId, userId, permission, grantedBy],
          );

          const row = rows[0];
          if (!row) {
            throw new AppError(500, "INTERNAL_ERROR", "Failed to create permission grant");
          }

          return rowToGrant(row);
        },
        true,
      );
    },

    async revoke(clinicId: string, userId: string, permission: string): Promise<void> {
      await withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const result = await client.query(
            `UPDATE user_permission_grants
                SET revoked_at = now()
              WHERE clinic_id   = $1
                AND user_id     = $2
                AND permission  = $3
                AND revoked_at IS NULL`,
            [clinicId, userId, permission],
          );

          if ((result.rowCount ?? 0) === 0) {
            throw new AppError(
              404,
              "PERMISSION_GRANT_NOT_FOUND",
              `No active grant for permission "${permission}" on user ${userId}`,
            );
          }
        },
        true,
      );
    },
  };
}
