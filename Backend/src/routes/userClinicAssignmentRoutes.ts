import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createClinicAssignmentHandlers } from "../controllers/userClinicAssignmentController.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createClinicAssignmentRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createClinicAssignmentHandlers(
    deps.clinicAssignmentsRepository,
    deps.clinicRepository,
    deps.userRepository,
  );

  router.use(authenticate);

  // GET  /clinics/:clinicId/users/:userId/clinic-access
  // PUT  /clinics/:clinicId/users/:userId/clinic-access
  router.get(
    "/:userId/clinic-access",
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.getForUser(req, res)),
  );

  router.put(
    "/:userId/clinic-access",
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.replaceForUser(req, res)),
  );

  return router;
}

/**
 * Global (non-clinic-scoped) routes for the authenticated user's own access data.
 * Mounted at /api/v1/users.
 */
export function createUserAccessRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createClinicAssignmentHandlers(
    deps.clinicAssignmentsRepository,
    deps.clinicRepository,
    deps.userRepository,
  );

  router.use(authenticate);

  // GET /users/me/operational-clinics
  router.get(
    "/me/operational-clinics",
    requireRoles("owner_admin", "group_practice_manager", "clinical_staff"),
    asyncHandler((req, res) => handlers.getOperationalClinics(req, res)),
  );

  return router;
}
