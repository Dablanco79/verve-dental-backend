import { Router } from "express";
import { z } from "zod";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createStocktakeHandlers } from "../controllers/stocktakeController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { createStocktakeService } from "../services/stocktakeService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ── Role groups ───────────────────────────────────────────────────────────────

// All authenticated inventory roles can read sessions and perform counts.
const STOCKTAKE_READ_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

// Only managers can create / edit / start / complete / cancel sessions.
const STOCKTAKE_MANAGE_ROLES = [
  "owner_admin",
  "group_practice_manager",
] as const;

// ── Param schemas ─────────────────────────────────────────────────────────────

const sessionParamsSchema = clinicIdParamsSchema.extend({
  sessionId: z.string().uuid("sessionId must be a valid UUID"),
});

const lineParamsSchema = sessionParamsSchema.extend({
  lineId: z.string().uuid("lineId must be a valid UUID"),
});

// ── Router factory ────────────────────────────────────────────────────────────

export function createStocktakeRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });

  const stocktakeService = createStocktakeService(
    deps.stocktakeRepository,
    deps.inventoryRepository,
    deps.analyticsRepository,
  );
  const handlers = createStocktakeHandlers(stocktakeService);
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));
  router.use(validateParams(clinicIdParamsSchema));

  // Session list + create
  router.get(
    "/",
    requireRoles(...STOCKTAKE_READ_ROLES),
    asyncHandler((req, res) => handlers.listSessions(req, res)),
  );

  router.post(
    "/",
    requireRoles(...STOCKTAKE_MANAGE_ROLES),
    asyncHandler((req, res) => handlers.createSession(req, res)),
  );

  // Session detail + edit
  router.get(
    "/:sessionId",
    requireRoles(...STOCKTAKE_READ_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.getSession(req, res)),
  );

  router.patch(
    "/:sessionId",
    requireRoles(...STOCKTAKE_MANAGE_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.updateSession(req, res)),
  );

  // Lifecycle transitions
  router.post(
    "/:sessionId/start",
    requireRoles(...STOCKTAKE_MANAGE_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.startSession(req, res)),
  );

  router.post(
    "/:sessionId/cancel",
    requireRoles(...STOCKTAKE_MANAGE_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.cancelSession(req, res)),
  );

  router.post(
    "/:sessionId/complete",
    requireRoles(...STOCKTAKE_MANAGE_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.completeSession(req, res)),
  );

  // Lines — read is open to all roles; count updates are open to all roles
  router.get(
    "/:sessionId/lines",
    requireRoles(...STOCKTAKE_READ_ROLES),
    validateParams(sessionParamsSchema),
    asyncHandler((req, res) => handlers.listLines(req, res)),
  );

  router.patch(
    "/:sessionId/lines/:lineId",
    requireRoles(...STOCKTAKE_READ_ROLES),
    validateParams(lineParamsSchema),
    asyncHandler((req, res) => handlers.updateLine(req, res)),
  );

  return router;
}
