import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createProcurementPolicyHandlers } from "../controllers/procurementPolicyController.js";
import { createProcurementPolicyService } from "../services/procurementPolicyService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";

/**
 * Clinic-scoped router — mounted at /clinics/:clinicId/procurement-policies.
 *
 * Routes:
 *   GET  /   → listByClinic   (all roles — clinical_staff read-only)
 *   POST /   → create         (owner_admin, group_practice_manager)
 */
export function createClinicProcurementPolicyRouter(
  deps: AppDependencies,
): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createProcurementPolicyService(
    deps.procurementPolicyRepository,
  );
  const handlers = createProcurementPolicyHandlers(service);

  router.get(
    "/",
    authenticate,
    enforceTenantParam("clinicId"),
    asyncHandler((req, res) => handlers.listByClinic(req, res)),
  );

  router.post(
    "/",
    authenticate,
    enforceTenantParam("clinicId"),
    requireWriteAccess,
    asyncHandler((req, res) => handlers.create(req, res)),
  );

  return router;
}

/**
 * Standalone router — mounted at /procurement-policies.
 *
 * Routes:
 *   GET   /:id             → getById     (tenant-checked in service)
 *   PATCH /:id             → update      (owner_admin, group_practice_manager)
 *   POST  /:id/deactivate  → deactivate  (owner_admin, group_practice_manager)
 */
export function createProcurementPolicyRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createProcurementPolicyService(
    deps.procurementPolicyRepository,
  );
  const handlers = createProcurementPolicyHandlers(service);

  router.get(
    "/:id",
    authenticate,
    asyncHandler((req, res) => handlers.getById(req, res)),
  );

  router.patch(
    "/:id",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.update(req, res)),
  );

  router.post(
    "/:id/deactivate",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.deactivate(req, res)),
  );

  return router;
}
