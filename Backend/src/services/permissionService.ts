/**
 * RBAC v2 — PermissionService
 *
 * Business logic for managing explicit per-user permission grants.
 * All mutating operations are restricted to owner_admin.
 *
 * Audit events emitted:
 *   user.permission.granted  — when a grant is created
 *   user.permission.revoked  — when a grant is soft-deleted
 */

import type { AuthenticatedUser } from "../types/auth.js";
import { ALL_PERMISSIONS, type Permission } from "../types/permissions.js";
import { AppError } from "../types/errors.js";
import type { PermissionGrant, PermissionRepository } from "../repositories/permissionRepository.js";
import type { AuditService } from "./auditService.js";

export type PermissionService = ReturnType<typeof createPermissionService>;

export function createPermissionService(
  permissionRepository: PermissionRepository,
  auditService: AuditService,
) {
  return {
    /**
     * Returns all grants (active and revoked) for a specific user in a clinic.
     * Restricted to owner_admin.
     */
    async listPermissions(
      caller: AuthenticatedUser,
      clinicId: string,
      userId: string,
    ): Promise<PermissionGrant[]> {
      if (caller.role !== "owner_admin") {
        throw new AppError(403, "FORBIDDEN", "Only owner_admin may manage permissions");
      }

      return permissionRepository.listGrantsByUser(userId, clinicId);
    },

    /**
     * Grants a permission to a user within a clinic.
     * Idempotent — returns the existing grant if already active.
     * Restricted to owner_admin.
     */
    async grantPermission(
      caller: AuthenticatedUser,
      clinicId: string,
      userId: string,
      permission: string,
    ): Promise<PermissionGrant> {
      if (caller.role !== "owner_admin") {
        throw new AppError(403, "FORBIDDEN", "Only owner_admin may grant permissions");
      }

      if (!ALL_PERMISSIONS.includes(permission as Permission)) {
        throw new AppError(
          400,
          "INVALID_PERMISSION",
          `"${permission}" is not a recognised permission string`,
        );
      }

      const grant = await permissionRepository.grant(clinicId, userId, permission, caller.id);

      auditService.logEvent("user.permission.granted", {
        userId: caller.id,
        email: caller.email,
        clinicId,
        resourceId: userId,
        role: caller.role,
      });

      return grant;
    },

    /**
     * Revokes an active permission grant from a user within a clinic.
     * Throws 404 when no active grant exists.
     * Restricted to owner_admin.
     */
    async revokePermission(
      caller: AuthenticatedUser,
      clinicId: string,
      userId: string,
      permission: string,
    ): Promise<void> {
      if (caller.role !== "owner_admin") {
        throw new AppError(403, "FORBIDDEN", "Only owner_admin may revoke permissions");
      }

      if (!ALL_PERMISSIONS.includes(permission as Permission)) {
        throw new AppError(
          400,
          "INVALID_PERMISSION",
          `"${permission}" is not a recognised permission string`,
        );
      }

      await permissionRepository.revoke(clinicId, userId, permission);

      auditService.logEvent("user.permission.revoked", {
        userId: caller.id,
        email: caller.email,
        clinicId,
        resourceId: userId,
        role: caller.role,
      });
    },
  };
}
