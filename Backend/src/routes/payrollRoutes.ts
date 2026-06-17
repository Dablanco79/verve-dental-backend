// ─────────────────────────────────────────────────────────────────────────────
// Payroll Routes — Leave & Timesheet sub-routers
//
// Two factory functions are exported:
//   createLeaveRouter(deps)      — mounts at /clinics/:clinicId/leave
//   createTimesheetRouter(deps)  — mounts at /clinics/:clinicId/timesheets
//
// Both routers apply authenticate + enforceTenantParam("clinicId") at the
// router level so every handler in this module is guaranteed a valid, tenant-
// scoped req.user.  Per-route requireRoles() guards then differentiate between
// staff-accessible endpoints and manager-only actions.
//
// ROLE CONSTANTS
//   PAYROLL_MANAGER_ROLES — owner_admin, group_practice_manager
//     Can list clinic-wide data, create manual entries, and approve/reject.
//   PAYROLL_ALL_ROLES — extends manager roles with clinical_staff
//     Clock-in/out, own leave submission and withdrawal.
//
// ROUTE ORDERING NOTE
//   Static sub-paths (/me, /clock-in, /forecast) MUST be declared before
//   parameterised paths (/:leaveId, /:timesheetId) so Express does not treat
//   the literal segment as a UUID parameter value.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createLeaveHandlers,
  createTimesheetHandlers,
} from "../controllers/payrollController.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Roles that can review, approve/reject, and access clinic-wide payroll data.
const PAYROLL_MANAGER_ROLES = [
  "owner_admin",
  "group_practice_manager",
] as const;

// All authenticated roles — extends manager roles with clinical_staff for
// staff-facing actions (clock-in, own leave submission/withdrawal).
const PAYROLL_ALL_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Leave sub-router
// Mounted at: /api/v1/clinics/:clinicId/leave
// ─────────────────────────────────────────────────────────────────────────────

export function createLeaveRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const handlers = createLeaveHandlers(deps.leaveService);

  // Every leave route requires a valid JWT and must belong to the correct tenant.
  router.use(authenticate, enforceTenantParam("clinicId"));

  // ── /me — must come before /:leaveId to avoid route shadowing ──────────────
  router.get(
    "/me",
    requireRoles(...PAYROLL_ALL_ROLES),
    asyncHandler((req, res) => handlers.listMyLeave(req, res)),
  );

  // ── Clinic-wide list (manager) & new request (all roles) ───────────────────
  router.get(
    "/",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.listClinicLeave(req, res)),
  );

  router.post(
    "/",
    requireRoles(...PAYROLL_ALL_ROLES),
    asyncHandler((req, res) => handlers.createLeaveRequest(req, res)),
  );

  // ── Per-request action endpoints ────────────────────────────────────────────
  // The service layer enforces ownership (withdraw) and manager RBAC
  // (approve/reject) as a second line of defence.

  router.post(
    "/:leaveId/approve",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.approveLeaveRequest(req, res)),
  );

  router.post(
    "/:leaveId/reject",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.rejectLeaveRequest(req, res)),
  );

  // Staff withdraw their own request; managers can also withdraw via owner_admin.
  router.post(
    "/:leaveId/withdraw",
    requireRoles(...PAYROLL_ALL_ROLES),
    asyncHandler((req, res) => handlers.withdrawLeaveRequest(req, res)),
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timesheet sub-router
// Mounted at: /api/v1/clinics/:clinicId/timesheets
// ─────────────────────────────────────────────────────────────────────────────

export function createTimesheetRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const handlers = createTimesheetHandlers(deps.timesheetService);

  // Every timesheet route requires a valid JWT and must belong to the correct tenant.
  router.use(authenticate, enforceTenantParam("clinicId"));

  // ── Static sub-paths — declared BEFORE /:timesheetId to prevent shadowing ──

  // Staff clocks in; the service rejects manager/admin callers with FORBIDDEN.
  router.post(
    "/clock-in",
    requireRoles(...PAYROLL_ALL_ROLES),
    asyncHandler((req, res) => handlers.clockIn(req, res)),
  );

  // Returns verified commission_log entries for the materials forecasting engine.
  router.get(
    "/forecast",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.getForecastLogs(req, res)),
  );

  // ── Clinic-wide list (manager) & manual entry (manager) ────────────────────
  router.get(
    "/",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.listTimesheets(req, res)),
  );

  router.post(
    "/",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.createManualEntry(req, res)),
  );

  // ── Per-timesheet action endpoints ─────────────────────────────────────────

  // Staff clocks out of their own open entry; service enforces ownership.
  router.post(
    "/:timesheetId/clock-out",
    requireRoles(...PAYROLL_ALL_ROLES),
    asyncHandler((req, res) => handlers.clockOut(req, res)),
  );

  router.post(
    "/:timesheetId/approve",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.approveTimesheet(req, res)),
  );

  router.post(
    "/:timesheetId/reject",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.rejectTimesheet(req, res)),
  );

  // Commission attendance verification — affects the materials forecast engine.
  router.post(
    "/:timesheetId/verify-attendance",
    requireRoles(...PAYROLL_MANAGER_ROLES),
    asyncHandler((req, res) => handlers.verifyCommissionAttendance(req, res)),
  );

  return router;
}
