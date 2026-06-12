import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createUserHandlers } from "../controllers/userController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
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
    asyncHandler((req, res) => handlers.listUsers(req, res)),
  );

  router.post(
    "/",
    asyncHandler((req, res) => handlers.createUser(req, res)),
  );

  return router;
}
