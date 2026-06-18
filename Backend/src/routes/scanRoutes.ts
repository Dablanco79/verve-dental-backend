import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createScanHandlers } from "../controllers/scanController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createScanService } from "../services/scanService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const SCAN_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

export function createScanRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const scanService = createScanService(deps.catalogRepository, deps.inventoryRepository);
  const handlers = createScanHandlers(scanService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(validateParams(clinicIdParamsSchema));

  router.post(
    "/",
    requireRoles(...SCAN_ROLES),
    asyncHandler((req, res) => handlers.handleScan(req, res)),
  );

  return router;
}
