/**
 * RBAC v2 — PermissionRepository
 *
 * Manages explicit per-user permission grants stored in user_permission_grants.
 * These grants are layered on top of DEFAULT_PERMISSIONS (role-based defaults)
 * and are baked into access tokens at issuance time.
 *
 * Lifecycle:
 *   grant()   — creates a new active grant (idempotent: noop if already active).
 *   revoke()  — soft-deletes the grant (sets revoked_at).
 *               Subsequent calls to listActiveByUser will exclude it.
 *   Re-grant after revocation creates a new row with a new grantedAt timestamp.
 */

import { randomUUID } from "node:crypto";
import { AppError } from "../types/errors.js";

export type PermissionGrant = {
  id: string;
  clinicId: string;
  userId: string;
  permission: string;
  grantedBy: string;
  grantedAt: Date;
  revokedAt: Date | null;
};

export interface PermissionRepository {
  /**
   * Returns the distinct set of active permission strings for a user across
   * all clinics.  Used when minting access tokens.
   */
  listActiveByUser(userId: string): Promise<string[]>;

  /**
   * Returns all grants (active and revoked) for a specific user in a given
   * clinic.  Used by the GET /permissions management endpoint.
   */
  listGrantsByUser(userId: string, clinicId: string): Promise<PermissionGrant[]>;

  /**
   * Creates an active grant.
   * If an identical active grant already exists, returns it unchanged (idempotent).
   * If a revoked grant exists, inserts a fresh row with a new grantedAt timestamp.
   */
  grant(
    clinicId: string,
    userId: string,
    permission: string,
    grantedBy: string,
  ): Promise<PermissionGrant>;

  /**
   * Soft-deletes the active grant for (clinicId, userId, permission).
   * Throws 404 PERMISSION_GRANT_NOT_FOUND when no active grant exists.
   */
  revoke(clinicId: string, userId: string, permission: string): Promise<void>;
}

// ── In-memory implementation (dev / test) ─────────────────────────────────────

export function createInMemoryPermissionRepository(): PermissionRepository {
  const grants = new Map<string, PermissionGrant>();

  function activeKey(clinicId: string, userId: string, permission: string): string {
    return `${clinicId}:${userId}:${permission}`;
  }

  function findActive(
    clinicId: string,
    userId: string,
    permission: string,
  ): PermissionGrant | undefined {
    for (const grant of grants.values()) {
      if (
        grant.clinicId === clinicId &&
        grant.userId === userId &&
        grant.permission === permission &&
        grant.revokedAt === null
      ) {
        return grant;
      }
    }
    return undefined;
  }

  return {
    listActiveByUser(userId: string): Promise<string[]> {
      const seen = new Set<string>();
      for (const grant of grants.values()) {
        if (grant.userId === userId && grant.revokedAt === null) {
          seen.add(grant.permission);
        }
      }
      return Promise.resolve(Array.from(seen));
    },

    listGrantsByUser(userId: string, clinicId: string): Promise<PermissionGrant[]> {
      const result = Array.from(grants.values())
        .filter((g) => g.userId === userId && g.clinicId === clinicId)
        .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime());
      return Promise.resolve(result);
    },

    grant(
      clinicId: string,
      userId: string,
      permission: string,
      grantedBy: string,
    ): Promise<PermissionGrant> {
      const existing = findActive(clinicId, userId, permission);
      if (existing) return Promise.resolve(existing);

      const newGrant: PermissionGrant = {
        id: randomUUID(),
        clinicId,
        userId,
        permission,
        grantedBy,
        grantedAt: new Date(),
        revokedAt: null,
      };

      grants.set(activeKey(clinicId, userId, permission) + ":" + newGrant.id, newGrant);
      return Promise.resolve(newGrant);
    },

    revoke(clinicId: string, userId: string, permission: string): Promise<void> {
      const existing = findActive(clinicId, userId, permission);
      if (!existing) {
        return Promise.reject(new AppError(
          404,
          "PERMISSION_GRANT_NOT_FOUND",
          `No active grant for permission "${permission}" on user ${userId}`,
        ));
      }
      existing.revokedAt = new Date();
      return Promise.resolve();
    },
  };
}
