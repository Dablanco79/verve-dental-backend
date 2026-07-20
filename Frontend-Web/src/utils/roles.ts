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
 * Materials demand forecast and inventory planning dashboard.
 * clinical_staff is excluded to keep planning workflows manager-only.
 * Note: the backend allows all roles; the frontend applies a stricter gate.
 */
export function canViewMaterialsForecast(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Clinic settings page — clinical_staff is excluded.
 * group_practice_manager can view but cannot save (owner_admin only for mutations).
 */
export function canViewClinicSettings(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Clinics list and create-clinic page — owner_admin only.
 * group_practice_manager is excluded because POST /clinics is owner_admin only
 * at the backend, making the create action unavailable to them.
 */
export function canManageClinics(role: UserRole): boolean {
  return role === "owner_admin";
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

/**
 * Manual inventory adjustments — restricted to admin / manager.
 * clinical_staff may view stock but must not modify quantities directly.
 */
export function canManageInventory(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Adjustment history log — restricted to admin / manager.
 * Mirrors the backend requireRoles guard on GET /inventory/adjustments.
 */
export function canViewAdjustmentHistory(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Supplier catalogue management — create/update suppliers, manage catalogue.
 * clinical_staff can read suppliers but must not write.
 */
export function canManageSuppliers(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Stocktake management — create, start, complete, cancel sessions.
 * clinical_staff may only perform counts (update line quantities).
 */
export function canManageStocktake(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

/**
 * Stocktake count — all roles can view sessions and enter counted quantities.
 */
export function canPerformStocktake(): boolean {
  return true;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner_admin: "Owner / Admin",
  group_practice_manager: "Practice Manager",
  clinical_staff: "Clinical Staff",
};
