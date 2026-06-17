import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createClinicHandlers } from "../controllers/clinicController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createClinicService } from "../services/clinicService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Mounts routes for the canonical clinic entity at /clinics/:clinicId.
 *
 * Mount order in the parent router matters — this router must be registered
 * AFTER all sub-path routers (/inventory, /roster, /timesheets …) so that
 * those specific paths are matched first and are never accidentally forwarded
 * to this router's prefix handler.
 *
 * Routes registered here:
 *   GET    /clinics/:clinicId  — fetch clinic details
 *   PATCH  /clinics/:clinicId  — update clinic metadata (owner_admin only)
 *
 * The GET /clinics list route is registered directly on the parent router in
 * routes/index.ts (no sub-router needed for a path with no params).
 */
export function createClinicRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });

  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const clinicService = createClinicService(deps.clinicRepository);
  const handlers = createClinicHandlers(clinicService);

  /**
   * GET /clinics/:clinicId
   *
   * All authenticated roles may fetch clinic details.
   * enforceTenantParam restricts non-admin callers to their home clinic;
   * owner_admin bypasses the check and may read any clinic.
   */
  router.get(
    "/",
    authenticate,
    enforceTenantParam("clinicId"),
    asyncHandler((req, res) => handlers.getClinic(req, res)),
  );

  /**
   * PATCH /clinics/:clinicId
   *
   * Restricted to owner_admin at both the route (requireRoles) and service
   * layers (defence in depth).  owner_admin may update any clinic regardless
   * of homeClinicId, so enforceTenantParam is intentionally omitted here.
   */
  router.patch(
    "/",
    authenticate,
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.updateClinic(req, res)),
  );

  return router;
}
