import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createRosterHandlers } from "../controllers/rosterController.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createRosterService } from "../services/rosterService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const ROSTER_READ_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

const ROSTER_WRITE_ROLES = ["owner_admin", "group_practice_manager"] as const;

export function createRosterRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const rosterService = createRosterService(
    deps.rosterRepository,
    deps.userRepository,
    // ── Module 06 — canonical clinic lookup ──────────────────────────────────
    // clinicRepository replaces the previous userRepository.getClinicName()
    // workaround; clinic names are now resolved from the authoritative source.
    deps.clinicRepository,
    // Inject the timesheet completion hook so the roster service auto-generates
    // timesheet entries when a shift is marked 'completed'.
    deps.timesheetService,
    // ── Module 08 — audit trail ───────────────────────────────────────────────
    // Write roster lifecycle events (created, updated, completed, cancelled)
    // to the append-only audit_events log.
    deps.analyticsRepository,
  );
  const handlers = createRosterHandlers(rosterService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  // All roster routes require authentication.
  // NOTE: enforceTenantParam is intentionally NOT used here.
  // RosterService performs its own RBAC + tenant check including the async
  // cross-clinic roster-membership lookup for rostered staff.
  router.use(authenticate);

  router.get(
    "/",
    requireRoles(...ROSTER_READ_ROLES),
    asyncHandler((req, res) => handlers.listEntries(req, res)),
  );

  router.post(
    "/",
    requireRoles(...ROSTER_WRITE_ROLES),
    asyncHandler((req, res) => handlers.createEntry(req, res)),
  );

  // /me must be declared before /:entryId to avoid route shadowing.
  router.get(
    "/me",
    requireRoles(...ROSTER_READ_ROLES),
    asyncHandler((req, res) => handlers.getMyShifts(req, res)),
  );

  router.get(
    "/:entryId",
    requireRoles(...ROSTER_READ_ROLES),
    asyncHandler((req, res) => handlers.getEntry(req, res)),
  );

  router.patch(
    "/:entryId",
    requireRoles(...ROSTER_WRITE_ROLES),
    asyncHandler((req, res) => handlers.updateEntry(req, res)),
  );

  router.delete(
    "/:entryId",
    requireRoles(...ROSTER_WRITE_ROLES),
    asyncHandler((req, res) => handlers.cancelEntry(req, res)),
  );

  return router;
}
