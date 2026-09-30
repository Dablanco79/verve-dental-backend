import { Router } from "express";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createStaffPayRateHandlers } from "../controllers/staffPayRateController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requirePermission,
} from "../middleware/authMiddleware.js";
import { createStaffPayRateService } from "../services/staffPayRateService.js";
import { PERMISSIONS } from "../types/permissions.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Pay rate routes for a specific staff member.
 * Mounted at: /clinics/:clinicId/users/:userId/pay-rates
 *
 * All routes require:
 *   - Authentication
 *   - Tenant isolation (homeClinicId must match :clinicId for non-admin)
 *   - payroll:rates:read (GET) or payroll:rates:write (POST)
 */
export function createStaffPayRateRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const service = createStaffPayRateService(deps.staffPayRateRepository);
  const handlers = createStaffPayRateHandlers(service);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));

  router.get(
    "/",
    requirePermission(PERMISSIONS.PAYROLL_RATES_READ),
    asyncHandler((req, res) => handlers.listRates(req, res)),
  );

  router.post(
    "/",
    requirePermission(PERMISSIONS.PAYROLL_RATES_WRITE),
    asyncHandler((req, res) => handlers.createRate(req, res)),
  );

  return router;
}
