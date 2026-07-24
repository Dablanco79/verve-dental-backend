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

  // List all PO lines for the clinic (draft + submitted + received + cancelled), enriched with catalog metadata.
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

  // Create a manual draft Purchase Order.
  router.post(
    "/",
    asyncHandler((req, res) => handlers.createPurchaseOrder(req, res)),
  );

  // Get detail for a single Purchase Order (header + enriched lines).
  router.get(
    "/:poId",
    asyncHandler((req, res) => handlers.getPurchaseOrderDetail(req, res)),
  );

  // Update editable header fields (supplier, notes, po_reference) on a draft PO.
  router.patch(
    "/:poId",
    asyncHandler((req, res) => handlers.updatePurchaseOrder(req, res)),
  );

  // Submit a draft purchase order (transitions status: draft → submitted).
  router.patch(
    "/:poId/submit",
    asyncHandler((req, res) => handlers.submitPurchaseOrder(req, res)),
  );

  // Cancel an eligible purchase order (draft or submitted → cancelled).
  router.post(
    "/:poId/cancel",
    asyncHandler((req, res) => handlers.cancelPurchaseOrder(req, res)),
  );

  // Add a line to a draft PO.
  router.post(
    "/:poId/lines",
    asyncHandler((req, res) => handlers.addPoLine(req, res)),
  );

  // Update a line on a draft PO.
  router.patch(
    "/:poId/lines/:lineId",
    asyncHandler((req, res) => handlers.updatePoLine(req, res)),
  );

  // Remove a line from a draft PO.
  router.delete(
    "/:poId/lines/:lineId",
    asyncHandler((req, res) => handlers.removePoLine(req, res)),
  );

  // Receive items against a submitted or partially-received PO.
  router.post(
    "/:poId/receive",
    asyncHandler((req, res) => handlers.receivePurchaseOrder(req, res)),
  );

  return router;
}
