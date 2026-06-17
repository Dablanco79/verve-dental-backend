import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createInventoryHandlers } from "../controllers/inventoryController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
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

  router.get(
    "/",
    requireRoles(...INVENTORY_READ_ROLES),
    asyncHandler((req, res) => handlers.listInventory(req, res)),
  );

  router.get(
    "/adjustments",
    requireRoles(...INVENTORY_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.listAdjustments(req, res)),
  );

  router.post(
    "/adjust",
    requireRoles(...INVENTORY_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.adjustInventory(req, res)),
  );

  router.get(
    "/:itemId",
    requireRoles(...INVENTORY_READ_ROLES),
    asyncHandler((req, res) => handlers.getInventoryItem(req, res)),
  );

  return router;
}
