import type { UserRole } from "../types/index.js";

export function canManageProducts(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

export function canManageUsers(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

export function canManageRoster(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/** Labor cost / financial forecast data — clinical_staff must not see raw cost figures. */
export function canViewLaborForecast(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Clinic settings page — clinical_staff is excluded.
 * group_practice_manager can view but cannot save (owner_admin only for mutations).
 */
export function canViewClinicSettings(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/** Internal billing ledger — write actions (settlement) restricted to admin roles. */
export function canManageBilling(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Analytics dashboard, sub-reports, and audit trail.
 * clinical_staff must not access financial KPIs or the audit log.
 */
export function canViewAnalytics(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Payroll management — clinic-wide timesheet list, manual entry creation,
 * approve / reject timesheets, and commission attendance verification.
 * clinical_staff can only clock in/out their own entries (not manage others).
 */
export function canManagePayroll(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Timesheet access — all authenticated roles can clock in/out and view their
 * own timesheet entries.  Use `canManagePayroll` to gate clinic-wide views
 * and approval actions.
 */
export function canAccessTimesheets(): boolean {
  return true;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner_admin: "Owner / Admin",
  group_practice_manager: "Practice Manager",
  clinical_staff: "Clinical Staff",
};
