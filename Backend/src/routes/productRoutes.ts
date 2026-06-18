import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createProductHandlers } from "../controllers/productController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createProductService } from "../services/productService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const PRODUCT_MANAGE_ROLES = ["owner_admin", "group_practice_manager"] as const;

export function createProductRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const productService = createProductService(
    deps.catalogRepository,
    deps.inventoryRepository,
  );
  const handlers = createProductHandlers(productService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(validateParams(clinicIdParamsSchema));

  router.post(
    "/",
    requireRoles(...PRODUCT_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.createProduct(req, res)),
  );

  return router;
}
