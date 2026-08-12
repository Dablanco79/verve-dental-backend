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
import { rlsTenantContextMiddleware } from "../db/tenantContext.js";
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

  // rlsTenantContextMiddleware must run AFTER authenticate so req.user is set.
  //
  // For /admin/pilot-reset routes there is no :clinicId in the URL.
  // rlsTenantContextMiddleware therefore resolves clinicId from req.user.homeClinicId.
  // Because the actor is always owner_admin, ownerAdmin=true is propagated into
  // AsyncLocalStorage, causing installRlsPoolHook to inject:
  //   app.owner_admin_mode = 'true'
  // on every pool connection checked out during this request.
  //
  // With app_is_owner_admin()=true, FORCE ROW LEVEL SECURITY is satisfied for
  // all FORCE-RLS tables (clinic_inventory_items, draft_purchase_orders,
  // supplier_invoices, product_suppliers, audit_events, etc.), making
  // getPreviewCounts() and verifyPostReset() counts accurate.
  //
  // The destructive boundary is NOT the RLS clinic_id — it is always the explicit
  // WHERE clinic_id = $selectedClinicId predicate in every DELETE/UPDATE/COUNT
  // query.  The selected clinic from the request body remains the sole
  // authoritative reset target.
  const rlsContext = rlsTenantContextMiddleware();

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
    rlsContext,
    asyncHandler((req, res) => handlers.preview(req, res)),
  );

  router.post(
    "/execute",
    authenticate,
    requireRoles("owner_admin"),
    rlsContext,
    asyncHandler((req, res) => handlers.execute(req, res)),
  );

  return router;
}
