import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createPurchaseOrderHandlers } from "../controllers/purchaseOrderController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createPurchaseOrderRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createPurchaseOrderHandlers(
    deps.inventoryRepository,
    deps.catalogRepository,
  );

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(requireRoles("owner_admin", "group_practice_manager"));

  router.get(
    "/",
    asyncHandler((req, res) => handlers.listPurchaseOrders(req, res)),
  );

  return router;
}
