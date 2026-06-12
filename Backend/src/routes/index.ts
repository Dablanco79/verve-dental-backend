import { rateLimit } from "express-rate-limit";
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
import { createInventoryRouter } from "./inventoryRoutes.js";
import { createProductRouter } from "./productRoutes.js";
import { createScanRouter } from "./scanRoutes.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createApiRouter(deps: AppDependencies, config: EnvConfig): Router {
  const router = Router();
  const authHandlers = createAuthHandlers(deps.authService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "TOO_MANY_REQUESTS", message: "Too many attempts, please try again later." },
    // Skip rate limiting in test environment so the test suite is unaffected.
    skip: () => config.NODE_ENV === "test",
  });

  router.get("/health", getHealth);

  router.post("/auth/login", authRateLimiter, asyncHandler((req, res) => authHandlers.login(req, res)));
  router.post("/auth/mfa/verify", authRateLimiter, asyncHandler((req, res) => authHandlers.verifyMfa(req, res)));
  router.post("/auth/refresh", authRateLimiter, asyncHandler((req, res) => authHandlers.refresh(req, res)));
  router.post("/auth/logout", (req, res) => {
    authHandlers.logout(req, res);
  });
  router.get("/auth/me", authenticate, (req, res) => {
    authHandlers.me(req, res);
  });

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

  router.use("/clinics/:clinicId/inventory", createInventoryRouter(deps));
  router.use("/clinics/:clinicId/scans", createScanRouter(deps));
  router.use("/clinics/:clinicId/products", createProductRouter(deps));

  return router;
}
