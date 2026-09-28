import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createInventoryHandlers } from "../controllers/inventoryController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requirePermission,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { PERMISSIONS } from "../types/permissions.js";
import {
  validateParams,
  clinicIdParamsSchema,
  clinicInventoryItemParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createInventoryService } from "../services/inventoryService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const INVENTORY_READ_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

const INVENTORY_MANAGE_ROLES = ["owner_admin", "group_practice_manager"] as const;

export function createInventoryRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const inventoryService = createInventoryService(deps.inventoryRepository, deps.analyticsRepository);
  const handlers = createInventoryHandlers(inventoryService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(validateParams(clinicIdParamsSchema));

  router.get(
    "/",
    requirePermission(PERMISSIONS.MODULE_INVENTORY),
    requireRoles(...INVENTORY_READ_ROLES),
    asyncHandler((req, res) => handlers.listInventory(req, res)),
  );

  router.get(
    "/adjustments",
    requirePermission(PERMISSIONS.MODULE_INVENTORY),
    requireRoles(...INVENTORY_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.listAdjustments(req, res)),
  );

  router.post(
    "/adjust",
    requirePermission(PERMISSIONS.MODULE_INVENTORY),
    requireRoles(...INVENTORY_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.adjustInventory(req, res)),
  );

  router.post(
    "/receive",
    // module:receiving is the sole authorization gate — admin must explicitly
    // grant this permission.  clinical_staff with the grant can receive.
    // The manager-role guard has been deliberately removed here: module:receiving
    // replaces it, consistent with how other module permissions work (e.g.
    // module:procurement replaced requireRoles on PO creation).
    requirePermission(PERMISSIONS.MODULE_RECEIVING),
    asyncHandler((req, res) => handlers.receiveInventory(req, res)),
  );

  router.get(
    "/:itemId",
    requirePermission(PERMISSIONS.MODULE_INVENTORY),
    requireRoles(...INVENTORY_READ_ROLES),
    validateParams(clinicInventoryItemParamsSchema),
    asyncHandler((req, res) => handlers.getInventoryItem(req, res)),
  );

  return router;
}
