import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierContractPriceHandlers } from "../controllers/supplierContractPriceController.js";
import { createSupplierContractPriceService } from "../services/supplierContractPriceService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";

/**
 * Contract-scoped router — mounted at /supplier-contracts.
 *
 * Routes:
 *   GET  /:contractId/prices   → listByContract  (all roles)
 *   POST /:contractId/prices   → create          (owner_admin, group_practice_manager)
 */
export function createContractPriceSubRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const service = createSupplierContractPriceService(
    deps.supplierContractPriceRepository,
    deps.supplierContractRepository,
    deps.supplierRelationshipRepository,
  );
  const handlers = createSupplierContractPriceHandlers(service);

  router.get(
    "/:contractId/prices",
    authenticate,
    asyncHandler((req, res) => handlers.listByContract(req, res)),
  );

  router.post(
    "/:contractId/prices",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.create(req, res)),
  );

  return router;
}

/**
 * Standalone router — mounted at /supplier-contract-prices.
 *
 * Routes:
 *   GET   /:id         → getById   (tenant-checked in service)
 *   PATCH /:id         → update    (owner_admin, group_practice_manager)
 *   POST  /:id/expire  → expire    (owner_admin, group_practice_manager)
 *
 * No DELETE endpoint — expire only.
 */
export function createSupplierContractPriceRouter(
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

  const service = createSupplierContractPriceService(
    deps.supplierContractPriceRepository,
    deps.supplierContractRepository,
    deps.supplierRelationshipRepository,
  );
  const handlers = createSupplierContractPriceHandlers(service);

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

  return router;
}
