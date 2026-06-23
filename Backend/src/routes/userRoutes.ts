import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createUserHandlers } from "../controllers/userController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import {
  validateParams,
  clinicIdParamsSchema,
  clinicUserParamsSchema,
} from "../middleware/validationMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createUserRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createUserHandlers(deps.userService);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(requireRoles("owner_admin", "group_practice_manager"));

  router.get(
    "/",
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => handlers.listUsers(req, res)),
  );

  router.post(
    "/",
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => handlers.createUser(req, res)),
  );

  router.patch(
    "/:userId",
    validateParams(clinicUserParamsSchema),
    asyncHandler((req, res) => handlers.updateUser(req, res)),
  );

  router.post(
    "/:userId/reset-password",
    validateParams(clinicUserParamsSchema),
    asyncHandler((req, res) => handlers.resetPassword(req, res)),
  );

  return router;
}
