import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import type { EnvConfig } from "../config/index.js";
import { createAuthHandlers } from "../controllers/authController.js";
import { getHealth } from "../controllers/healthController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { rlsTenantContextMiddleware } from "../db/tenantContext.js";
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
import { asyncHandler } from "../utils/asyncHandler.js";

export function createApiRouter(deps: AppDependencies, config: EnvConfig): Router {
  const router = Router();
  const authHandlers = createAuthHandlers(deps.authService, config);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
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

  router.get("/health", getHealth);

  router.post("/auth/login", authRateLimiter, asyncHandler((req, res) => authHandlers.login(req, res)));
  router.post("/auth/mfa/verify", authRateLimiter, asyncHandler((req, res) => authHandlers.verifyMfa(req, res)));
  router.post("/auth/mfa/setup", authRateLimiter, authenticate, asyncHandler((req, res) => authHandlers.setupMfa(req, res)));
  router.post("/auth/mfa/confirm", authRateLimiter, authenticate, asyncHandler((req, res) => authHandlers.confirmMfa(req, res)));
  router.post("/auth/refresh", authRateLimiter, asyncHandler((req, res) => authHandlers.refresh(req, res)));
  router.post("/auth/logout", asyncHandler((req, res) => authHandlers.logout(req, res)));
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

  // rlsContext runs on all /clinics/:clinicId/* routes — sets the per-request
  // RLS session variable so installRlsPoolHook injects it on every DB checkout.
  router.use("/clinics/:clinicId", authenticate, rlsContext);

  router.use("/clinics/:clinicId/inventory", createInventoryRouter(deps));
  router.use("/clinics/:clinicId/scans", createScanRouter(deps));
  router.use("/clinics/:clinicId/products", createProductRouter(deps));
  router.use("/clinics/:clinicId/users", createUserRouter(deps));
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

  return router;
}
