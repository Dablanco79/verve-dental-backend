/**
 * RBAC v2 — HTTP handlers for permission grant management.
 *
 * Endpoints:
 *   GET    /clinics/:clinicId/users/:userId/permissions
 *   POST   /clinics/:clinicId/users/:userId/permissions
 *   DELETE /clinics/:clinicId/users/:userId/permissions/:permission
 */

import { z } from "zod";
import type { Request, Response } from "express";

import type { PermissionService } from "../services/permissionService.js";
import { AppError } from "../types/errors.js";

const grantBodySchema = z.object({
  permission: z.string().min(1, "permission is required"),
});

export function createPermissionHandlers(permissionService: PermissionService) {
  return {
    async listPermissions(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      const { clinicId, userId } = req.params as { clinicId: string; userId: string };

      const grants = await permissionService.listPermissions(caller, clinicId, userId);

      res.status(200).json({ data: grants });
    },

    async grantPermission(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      const { clinicId, userId } = req.params as { clinicId: string; userId: string };

      const parsed = grantBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          parsed.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        );
      }

      const grant = await permissionService.grantPermission(
        caller,
        clinicId,
        userId,
        parsed.data.permission,
      );

      res.status(201).json({ data: grant });
    },

    async revokePermission(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      const { clinicId, userId, permission } = req.params as {
        clinicId: string;
        userId: string;
        permission: string;
      };

      await permissionService.revokePermission(caller, clinicId, userId, permission);

      res.status(204).send();
    },
  };
}
