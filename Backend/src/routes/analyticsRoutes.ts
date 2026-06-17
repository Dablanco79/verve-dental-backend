import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createAnalyticsHandlers } from "../controllers/analyticsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

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
  const guards = [authenticate, tenantGuard, managerOrAdmin] as const;

  // ── KPI dashboard ─────────────────────────────────────────────────────────
  router.get(
    "/dashboard",
    ...guards,
    asyncHandler((req, res) => h.getDashboard(req, res)),
  );

  // ── Revenue report ────────────────────────────────────────────────────────
  router.get(
    "/revenue",
    ...guards,
    asyncHandler((req, res) => h.getRevenue(req, res)),
  );

  // ── Inventory consumption report ──────────────────────────────────────────
  router.get(
    "/inventory",
    ...guards,
    asyncHandler((req, res) => h.getInventory(req, res)),
  );

  // ── Staff attendance report ───────────────────────────────────────────────
  router.get(
    "/staff",
    ...guards,
    asyncHandler((req, res) => h.getStaff(req, res)),
  );

  // ── Audit trail ───────────────────────────────────────────────────────────
  router.get(
    "/audit-events",
    ...guards,
    asyncHandler((req, res) => h.listAuditEvents(req, res)),
  );

  router.get(
    "/audit-events/:eventId",
    ...guards,
    asyncHandler((req, res) => h.getAuditEvent(req, res)),
  );

  return router;
}
