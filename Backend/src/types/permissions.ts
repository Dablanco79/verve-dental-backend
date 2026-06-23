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
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

// ── Role defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner_admin: ALL_PERMISSIONS,

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
