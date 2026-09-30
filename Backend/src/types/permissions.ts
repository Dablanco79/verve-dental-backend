/**
 * RBAC v2 — permission string constants and role defaults.
 *
 * Design principles:
 *   • Permission strings use "resource:action" format for easy prefix-matching.
 *   • DEFAULT_PERMISSIONS defines what each role receives without any explicit
 *     grants in user_permission_grants.  These are baked into access tokens at
 *     issuance time so downstream middleware can gate on req.user.permissions
 *     without an extra DB round-trip per request.
 *   • Explicit grants (rows in user_permission_grants) are unioned with the
 *     role defaults when the token is signed.  Revocations are NOT modelled
 *     here — this table only grants additional permissions, never removes them.
 *
 * Module access gates (module:*):
 *   • module:* permissions come ENTIRELY from user_permission_grants rows —
 *     they are NOT in DEFAULT_PERMISSIONS for group_practice_manager or
 *     clinical_staff.  This means they can be revoked per-user by an owner_admin.
 *   • owner_admin receives ALL_PERMISSIONS (which includes all module:* constants)
 *     inherently — no grant rows are required.
 *   • New users receive initial module grants transactionally on creation via
 *     INITIAL_MODULE_GRANTS (see userService.createUser).
 *   • Migration 052 backfills module grants for existing active users.
 *
 * Do not remove existing roles from DEFAULT_PERMISSIONS — downstream
 * requireRoles checks remain the primary gate until RBAC v2 is fully rolled out.
 */

import type { UserRole } from "./auth.js";

// ── Permission strings ────────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Inventory
  INVENTORY_READ:     "inventory:read",
  INVENTORY_WRITE:    "inventory:write",

  // Users
  USERS_READ:         "users:read",
  USERS_WRITE:        "users:write",

  // Clinic settings
  CLINIC_READ:        "clinic:read",
  CLINIC_WRITE:       "clinic:write",

  // Roster
  ROSTER_READ:        "roster:read",
  ROSTER_WRITE:       "roster:write",

  // Timesheets / leave
  TIMESHEETS_READ:    "timesheets:read",
  TIMESHEETS_WRITE:   "timesheets:write",

  // Billing
  BILLING_READ:       "billing:read",

  // Analytics / audit trail
  ANALYTICS_READ:     "analytics:read",

  // Permission management (grant / revoke)
  PERMISSIONS_MANAGE: "permissions:manage",

  // ── Module access gates (pilot) ───────────────────────────────────────────
  // These come from user_permission_grants rows, NOT DEFAULT_PERMISSIONS
  // (except for owner_admin who has ALL_PERMISSIONS inherently).
  MODULE_TIMESHEETS:  "module:timesheets",
  MODULE_ROSTER:      "module:roster",
  MODULE_LEAVE:       "module:leave",
  MODULE_INVENTORY:   "module:inventory",
  MODULE_STOCKTAKES:  "module:stocktakes",
  MODULE_PROCUREMENT: "module:procurement",
  MODULE_RECEIVING:   "module:receiving",
  MODULE_REPORTS:     "module:reports",

  // Pay rate management — restricted to owner_admin by default
  PAYROLL_RATES_READ:  "payroll:rates:read",
  PAYROLL_RATES_WRITE: "payroll:rates:write",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

// ── Role defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  // owner_admin gets ALL_PERMISSIONS which now includes all module:* constants.
  owner_admin: ALL_PERMISSIONS,

  // group_practice_manager and clinical_staff receive action-level permissions
  // only. Module access (module:*) comes exclusively from user_permission_grants
  // rows so that it can be revoked per-user.
  group_practice_manager: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.CLINIC_READ,
    PERMISSIONS.ROSTER_READ,
    PERMISSIONS.ROSTER_WRITE,
    PERMISSIONS.TIMESHEETS_READ,
    PERMISSIONS.TIMESHEETS_WRITE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.ANALYTICS_READ,
  ],

  clinical_staff: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ROSTER_READ,
    PERMISSIONS.TIMESHEETS_READ,
  ],
};

// ── Initial module grants for new users ───────────────────────────────────────
//
// When a new user is created, userService.createUser grants these module
// permissions transactionally as rows in user_permission_grants.
// owner_admin is not listed here — they have ALL_PERMISSIONS inherently.

export const INITIAL_MODULE_GRANTS: Partial<Record<UserRole, Permission[]>> = {
  group_practice_manager: [
    PERMISSIONS.MODULE_TIMESHEETS,
    PERMISSIONS.MODULE_ROSTER,
    PERMISSIONS.MODULE_LEAVE,
    PERMISSIONS.MODULE_INVENTORY,
    PERMISSIONS.MODULE_STOCKTAKES,
    PERMISSIONS.MODULE_PROCUREMENT,
    PERMISSIONS.MODULE_RECEIVING,
    PERMISSIONS.MODULE_REPORTS,
  ],
  clinical_staff: [
    PERMISSIONS.MODULE_TIMESHEETS,
    PERMISSIONS.MODULE_ROSTER,
    PERMISSIONS.MODULE_LEAVE,
  ],
};
