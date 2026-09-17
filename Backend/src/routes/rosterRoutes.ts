import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createRosterHandlers } from "../controllers/rosterController.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { rlsTenantContextMiddleware } from "../db/tenantContext.js";
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
    // ── Module 06 — canonical clinic lookup ────────────────────────────────
    deps.clinicRepository,
    // ── Multi-clinic access foundation (Migration 047) ─────────────────────
    deps.clinicAssignmentsRepository,
    // Inject the timesheet completion hook so the roster service auto-generates
    // timesheet entries when a shift is marked 'completed'.
    deps.timesheetService,
    // ── Module 08 — audit trail ─────────────────────────────────────────────
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

  // /eligible-staff and /me must be declared before /:entryId to avoid shadowing.
  router.get(
    "/eligible-staff",
    requireRoles("owner_admin", "group_practice_manager"),
    asyncHandler((req, res) => handlers.listEligibleStaff(req, res)),
  );

  // Conflict pre-flight check — must be before /:entryId to avoid shadowing.
  router.get(
    "/conflicts",
    requireRoles(...ROSTER_WRITE_ROLES),
    asyncHandler((req, res) => handlers.checkConflicts(req, res)),
  );

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

/**
 * Clinic-agnostic personal roster router.
 * Mounted at /api/v1/roster (no :clinicId in path).
 * Returns the authenticated user's own shifts across all clinics.
 */
export function createPersonalRosterRouter(deps: AppDependencies): Router {
  const router = Router();
  const rosterService = createRosterService(
    deps.rosterRepository,
    deps.userRepository,
    deps.clinicRepository,
    deps.clinicAssignmentsRepository,
    deps.timesheetService,
    deps.analyticsRepository,
  );
  const handlers = createRosterHandlers(rosterService);
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);

  router.use(authenticate);
  // Establishes per-request RLS context (clinicId = homeClinicId, userId = caller.id).
  // This populates app.current_user_id so the narrow roster_entries RLS policy
  // (staff_user_id = app_current_user_id()) can authorise cross-clinic own-row reads
  // without any owner_admin bypass.
  router.use(rlsTenantContextMiddleware());

  // GET /roster/accessible-clinics — returns clinics the caller can manage.
  // Must be declared before /me to avoid shadowing.
  router.get(
    "/accessible-clinics",
    requireRoles("owner_admin", "group_practice_manager"),
    asyncHandler((req, res) => handlers.getAccessibleClinics(req, res)),
  );

  // GET /roster/me — returns caller's shifts across ALL rostered clinics.
  router.get(
    "/me",
    requireRoles("owner_admin", "group_practice_manager", "clinical_staff"),
    asyncHandler((req, res) => handlers.getMyShiftsAllClinics(req, res)),
  );

  return router;
}
