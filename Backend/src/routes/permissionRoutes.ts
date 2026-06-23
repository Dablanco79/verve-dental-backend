/**
 * RBAC v2 — Permission management routes.
 *
 * Mounted at /clinics/:clinicId/users (same prefix as userRoutes so :userId
 * is picked up automatically with mergeParams: true).
 *
 *   GET    /:userId/permissions                 — list grants for user in clinic
 *   POST   /:userId/permissions                 — grant a permission
 *   DELETE /:userId/permissions/:permission     — revoke a permission
 *
 * All routes require owner_admin role; non-admin callers receive 403.
 */

import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createPermissionHandlers } from "../controllers/permissionController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import {
  validateParams,
  clinicUserParamsSchema,
  clinicUserPermissionParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createPermissionService } from "../services/permissionService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createPermissionRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  const permissionService = createPermissionService(
    deps.permissionRepository,
    deps.auditService,
  );
  const handlers = createPermissionHandlers(permissionService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(requireRoles("owner_admin"));

  router.get(
    "/:userId/permissions",
    validateParams(clinicUserParamsSchema),
    asyncHandler((req, res) => handlers.listPermissions(req, res)),
  );

  router.post(
    "/:userId/permissions",
    validateParams(clinicUserParamsSchema),
    asyncHandler((req, res) => handlers.grantPermission(req, res)),
  );

  router.delete(
    "/:userId/permissions/:permission",
    validateParams(clinicUserPermissionParamsSchema),
    asyncHandler((req, res) => handlers.revokePermission(req, res)),
  );

  return router;
}
