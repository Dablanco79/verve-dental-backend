import { Router } from "express";
import { z } from "zod";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createAnalyticsHandlers } from "../controllers/analyticsController.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Validates :clinicId + :eventId for the single-event detail route.
const analyticsEventParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  eventId: z.string().uuid("eventId must be a valid UUID"),
});

/**
 * Analytics & Audit Trail routes — mounted at /clinics/:clinicId/analytics
 *
 * RBAC:
 *   All routes: owner_admin, group_practice_manager only
 *   clinical_staff has no access (enforced by AnalyticsService.assertAnalyticsAccess)
 *
 * Tenant isolation:
 *   enforceTenantParam middleware + service-layer assertAnalyticsAccess (defence in depth)
 *
 * REST surface:
 *   GET /dashboard              — 30-day KPI summary (revenue, inventory, roster)
 *   GET /revenue                — Monthly revenue breakdown (?months=12)
 *   GET /inventory              — Inventory consumption report (?periodDays=30)
 *   GET /staff                  — Staff attendance summary (?periodDays=30)
 *   GET /audit-events           — Paginated audit trail (?entityType=&actorId=&from=&to=&limit=&offset=)
 *   GET /audit-events/:eventId  — Single audit event detail
 */
export function createGlobalAnalyticsRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const ownerOnly = requireRoles("owner_admin");
  const h = createAnalyticsHandlers(deps.analyticsService);

  router.get(
    "/dashboard/all",
    authenticate,
    ownerOnly,
    asyncHandler((req, res) => h.getAllClinicsDashboard(req, res)),
  );

  return router;
}

export function createAnalyticsRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const tenantGuard = enforceTenantParam("clinicId");
  const managerOrAdmin = requireRoles("owner_admin", "group_practice_manager");

  const h = createAnalyticsHandlers(deps.analyticsService);

  // All analytics routes require manager/admin + tenant enforcement.
  const guards = [authenticate, tenantGuard, managerOrAdmin];

  // ── KPI dashboard ─────────────────────────────────────────────────────────
  router.get(
    "/dashboard",
    ...guards,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.getDashboard(req, res)),
  );

  // ── Revenue report ────────────────────────────────────────────────────────
  router.get(
    "/revenue",
    ...guards,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.getRevenue(req, res)),
  );

  // ── Inventory consumption report ──────────────────────────────────────────
  router.get(
    "/inventory",
    ...guards,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.getInventory(req, res)),
  );

  // ── Staff attendance report ───────────────────────────────────────────────
  router.get(
    "/staff",
    ...guards,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.getStaff(req, res)),
  );

  // ── Audit trail ───────────────────────────────────────────────────────────
  router.get(
    "/audit-events",
    ...guards,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.listAuditEvents(req, res)),
  );

  router.get(
    "/audit-events/:eventId",
    ...guards,
    validateParams(analyticsEventParamsSchema),
    asyncHandler((req, res) => h.getAuditEvent(req, res)),
  );

  return router;
}
