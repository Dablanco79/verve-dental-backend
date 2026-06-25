import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierRelationshipHandlers } from "../controllers/supplierRelationshipController.js";
import { createSupplierRelationshipService } from "../services/supplierRelationshipService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";

/**
 * Clinic-scoped router — mounted at /clinics/:clinicId/supplier-relationships.
 *
 * Routes:
 *   GET  /   → listByClinic       (all roles — clinical_staff read-only)
 *   POST /   → create             (owner_admin, group_practice_manager)
 */
export function createClinicSupplierRelationshipRouter(
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

  const service = createSupplierRelationshipService(
    deps.supplierRelationshipRepository,
    deps.supplierRepository,
  );
  const handlers = createSupplierRelationshipHandlers(service);

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
 * Standalone router — mounted at /supplier-relationships.
 *
 * Routes:
 *   GET   /:relationshipId             → getById      (tenant-checked in service)
 *   PATCH /:relationshipId             → update       (owner_admin, group_practice_manager)
 *   POST  /:relationshipId/deactivate  → deactivate   (owner_admin, group_practice_manager)
 */
export function createSupplierRelationshipRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createSupplierRelationshipService(
    deps.supplierRelationshipRepository,
    deps.supplierRepository,
  );
  const handlers = createSupplierRelationshipHandlers(service);

  router.get(
    "/:relationshipId",
    authenticate,
    asyncHandler((req, res) => handlers.getById(req, res)),
  );

  router.patch(
    "/:relationshipId",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.update(req, res)),
  );

  router.post(
    "/:relationshipId/deactivate",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.deactivate(req, res)),
  );

  return router;
}
