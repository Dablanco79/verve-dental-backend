import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierContractHandlers } from "../controllers/supplierContractController.js";
import { createSupplierContractService } from "../services/supplierContractService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";

/**
 * Relationship-scoped router — mounted at /supplier-relationships.
 *
 * Routes:
 *   GET  /:relationshipId/contracts   → listByRelationship  (all roles)
 *   POST /:relationshipId/contracts   → create              (owner_admin, group_practice_manager)
 */
export function createRelationshipContractRouter(
  deps: AppDependencies,
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createSupplierContractService(
    deps.supplierContractRepository,
    deps.supplierRelationshipRepository,
  );
  const handlers = createSupplierContractHandlers(service);

  router.get(
    "/:relationshipId/contracts",
    authenticate,
    asyncHandler((req, res) => handlers.listByRelationship(req, res)),
  );

  router.post(
    "/:relationshipId/contracts",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.create(req, res)),
  );

  return router;
}

/**
 * Standalone router — mounted at /supplier-contracts.
 *
 * Routes:
 *   GET   /:id             → getById     (tenant-checked in service)
 *   PATCH /:id             → update      (owner_admin, group_practice_manager)
 *   POST  /:id/expire      → expire      (owner_admin, group_practice_manager)
 *   POST  /:id/terminate   → terminate   (owner_admin, group_practice_manager)
 *
 * No DELETE endpoint — expire or terminate only.
 */
export function createSupplierContractRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createSupplierContractService(
    deps.supplierContractRepository,
    deps.supplierRelationshipRepository,
  );
  const handlers = createSupplierContractHandlers(service);

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
    "/:id/expire",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.expire(req, res)),
  );

  router.post(
    "/:id/terminate",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.terminate(req, res)),
  );

  return router;
}
