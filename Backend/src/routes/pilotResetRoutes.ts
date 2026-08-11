/**
 * Pilot Reset Routes
 *
 * Mounts at: /admin/pilot-reset
 *
 * POST /admin/pilot-reset/preview  — count what WOULD be deleted (no writes)
 * POST /admin/pilot-reset/execute  — execute the reset (destructive, transactional)
 *
 * Both routes require:
 *   authenticate → requireRoles("owner_admin")
 *
 * The PILOT_RESET_ENABLED flag is checked inside each handler so that the
 * feature can be removed cleanly by unsetting the environment variable.
 */

import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import type { EnvConfig } from "../config/index.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createPilotResetHandlers } from "../controllers/pilotResetController.js";
import { createPilotResetService } from "../services/pilotResetService.js";
import {
  createPostgresPilotResetRepository,
  createInMemoryPilotResetRepository,
} from "../repositories/pilotResetRepository.postgres.js";

export function createPilotResetRouter(
  deps: AppDependencies,
  config: EnvConfig,
): Router {
  const router = Router();

  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  const pilotResetRepository = deps.databasePool
    ? createPostgresPilotResetRepository(deps.databasePool)
    : createInMemoryPilotResetRepository();

  const pilotResetService = createPilotResetService(
    pilotResetRepository,
    deps.userRepository,
    deps.analyticsRepository,
    deps.auditService,
    config,
    deps.databasePool,
    deps.redisClient,
  );

  const handlers = createPilotResetHandlers(pilotResetService, config);

  router.post(
    "/preview",
    authenticate,
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.preview(req, res)),
  );

  router.post(
    "/execute",
    authenticate,
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.execute(req, res)),
  );

  return router;
}
