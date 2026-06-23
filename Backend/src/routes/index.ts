import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import type { EnvConfig } from "../config/index.js";
import { createAuthHandlers } from "../controllers/authController.js";
import { createClinicHandlers } from "../controllers/clinicController.js";
import {
  createReadinessHandler,
  getHealth,
} from "../controllers/healthController.js";
import {
  createAuthenticateMiddleware,
  createMfaSetupMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createOriginGuard } from "../middleware/originGuard.js";
import { rlsTenantContextMiddleware } from "../db/tenantContext.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createClinicService } from "../services/clinicService.js";
import { createAnalyticsRouter } from "./analyticsRoutes.js";
import { createBillingRouter } from "./billingRoutes.js";
import { createClinicRouter } from "./clinicRoutes.js";
import { createForecastRouter } from "./forecastRoutes.js";
import { createLaborForecastRouter } from "./laborForecastRoutes.js";
import { createInventoryRouter } from "./inventoryRoutes.js";
import { createLeaveRouter, createTimesheetRouter } from "./payrollRoutes.js";
import { createProductRouter } from "./productRoutes.js";
import { createPurchaseOrderRouter } from "./purchaseOrderRoutes.js";
import { createRosterRouter } from "./rosterRoutes.js";
import { createScanRouter } from "./scanRoutes.js";
import { createUserRouter } from "./userRoutes.js";
import { createPermissionRouter } from "./permissionRoutes.js";
import { createSupplierRouter } from "./supplierRoutes.js";
import { createSupplierInvoiceRouter } from "./supplierInvoiceRoutes.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createApiRouter(deps: AppDependencies, config: EnvConfig): Router {
  const router = Router();
  const authHandlers = createAuthHandlers(deps.authService, config);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  // Clinic service instance for the global (non-tenant-scoped) clinic routes.
  // The per-clinic routes (/clinics/:clinicId/*) create their own instance via createClinicRouter.
  const clinicService = createClinicService(deps.clinicRepository, deps.analyticsRepository);
  const clinicHandlers = createClinicHandlers(clinicService);
  const mfaSetupAuth = createMfaSetupMiddleware(deps.authService, deps.auditService);
  // RLS context middleware: runs after authenticate, sets per-request AsyncLocalStorage
  // context so installRlsPoolHook can inject app.current_clinic_id on every checkout.
  const rlsContext = rlsTenantContextMiddleware();

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "TOO_MANY_REQUESTS", message: "Too many attempts, please try again later." },
    // Skip rate limiting in test environment so the test suite is unaffected.
    skip: () => config.NODE_ENV === "test",
  }) as unknown as RequestHandler;

  // Origin guard: validates Origin/Referer against CORS_ORIGIN in staging/production.
  // No-op pass-through in development/test so existing flows are unaffected.
  const originGuard = createOriginGuard(config);

  router.get("/health", getHealth);
  router.get("/ready", asyncHandler(createReadinessHandler(deps.healthService)));

  router.post("/auth/login", authRateLimiter, originGuard, asyncHandler((req, res) => authHandlers.login(req, res)));
  router.post("/auth/mfa/verify", authRateLimiter, originGuard, asyncHandler((req, res) => authHandlers.verifyMfa(req, res)));
  router.post("/auth/mfa/setup", authRateLimiter, originGuard, mfaSetupAuth, asyncHandler((req, res) => authHandlers.setupMfa(req, res)));
  router.post("/auth/mfa/confirm", authRateLimiter, originGuard, mfaSetupAuth, asyncHandler((req, res) => authHandlers.confirmMfa(req, res)));
  router.post("/auth/refresh", authRateLimiter, originGuard, asyncHandler((req, res) => authHandlers.refresh(req, res)));
  router.post("/auth/logout", originGuard, asyncHandler((req, res) => authHandlers.logout(req, res)));
  router.get("/auth/me", authenticate, (req, res) => {
    authHandlers.me(req, res);
  });

  router.post(
    "/auth/change-password",
    authenticate,
    asyncHandler((req, res) => authHandlers.changePassword(req, res)),
  );

  router.get(
    "/clinics/:clinicId/summary",
    authenticate,
    enforceTenantParam("clinicId"),
    validateParams(clinicIdParamsSchema),
    (req, res) => {
      authHandlers.getClinicSummary(req, res);
    },
  );

  router.get(
    "/admin/ping",
    authenticate,
    requireRoles("owner_admin"),
    (_req, res) => {
      res.status(200).json({ data: { message: "Admin access granted" } });
    },
  );

  // ── Global clinic routes (no :clinicId — owner_admin scope) ─────────────────
  //
  // GET  /clinics  — list all active clinics (owner_admin) or home clinic only
  //                  (group_practice_manager / clinical_staff).
  // POST /clinics  — create a new clinic (owner_admin only).
  //
  // Registered before the /clinics/:clinicId block so exact-path matches
  // are never shadowed by the parameterised sub-router prefix.
  router.get(
    "/clinics",
    authenticate,
    asyncHandler((req, res) => clinicHandlers.listClinics(req, res)),
  );
  router.post(
    "/clinics",
    authenticate,
    requireRoles("owner_admin"),
    asyncHandler((req, res) => clinicHandlers.createClinic(req, res)),
  );

  // rlsContext runs on all /clinics/:clinicId/* routes — sets the per-request
  // RLS session variable so installRlsPoolHook injects it on every DB checkout.
  router.use("/clinics/:clinicId", authenticate, rlsContext);

  router.use("/clinics/:clinicId/inventory", createInventoryRouter(deps));
  router.use("/clinics/:clinicId/scans", createScanRouter(deps));
  router.use("/clinics/:clinicId/products", createProductRouter(deps));
  router.use("/clinics/:clinicId/users", createUserRouter(deps));
  router.use("/clinics/:clinicId/users", createPermissionRouter(deps));
  router.use("/clinics/:clinicId/purchase-orders", createPurchaseOrderRouter(deps));
  router.use("/clinics/:clinicId/roster", createRosterRouter(deps));
  router.use("/clinics/:clinicId/forecast", createForecastRouter(deps));
  // Labor cost projection mounts at the same /forecast prefix — Express matches
  // each request against registered routes in order, so /materials and /alerts
  // are handled by createForecastRouter and /labor by createLaborForecastRouter.
  router.use("/clinics/:clinicId/forecast", createLaborForecastRouter(deps));

  // Payroll — timesheets and leave management (Module 05).
  router.use("/clinics/:clinicId/timesheets", createTimesheetRouter(deps));
  router.use("/clinics/:clinicId/leave", createLeaveRouter(deps));

  // Billing, invoicing, and payment records (Module 07).
  router.use("/clinics/:clinicId/billing", createBillingRouter(deps));

  // Analytics, reporting, and audit trails (Module 08).
  router.use("/clinics/:clinicId/analytics", createAnalyticsRouter(deps));

  // Clinic settings — GET/PATCH the canonical clinic entity (Module 06).
  // Registered LAST so all sub-path routers above are matched first.
  router.use("/clinics/:clinicId", createClinicRouter(deps));

  // Procurement — supplier management, catalogue pricing, import (Sprint O).
  // Global scope (not clinic-scoped): mirrors master_catalog_items pattern.
  router.use("/suppliers", createSupplierRouter(deps));

  // Supplier Invoice OCR — AP invoice upload, review, confirm (Sprint OCR-1).
  // Clinic-scoped: each clinic manages its own supplier invoices.
  router.use(
    "/clinics/:clinicId/supplier-invoices",
    createSupplierInvoiceRouter(deps, config),
  );

  return router;
}
