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
  const handlers = createPurchaseOrderHandlers(deps.purchaseOrderService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(requireRoles("owner_admin", "group_practice_manager"));

  // List all PO lines for the clinic (draft + submitted), enriched with catalog metadata.
  router.get(
    "/",
    asyncHandler((req, res) => handlers.listPurchaseOrders(req, res)),
  );

  // Export all PO lines as a downloadable CSV file.
  // Mounted BEFORE /:poId so /export.csv is matched as a literal path segment.
  router.get(
    "/export.csv",
    asyncHandler((req, res) => handlers.exportPurchaseOrdersCsv(req, res)),
  );

  // Submit a draft purchase order (transitions status: draft → submitted).
  router.patch(
    "/:poId/submit",
    asyncHandler((req, res) => handlers.submitPurchaseOrder(req, res)),
  );

  return router;
}
