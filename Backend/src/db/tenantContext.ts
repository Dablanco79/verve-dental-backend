import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";

/**
 * Resolves the clinic scope for application-layer queries.
 *
 * `user.homeClinicId`  — the user's payroll/contract location (on every JWT).
 * `requestedClinicId`  — the clinic whose data is being accessed (from the URL).
 *
 * owner_admin may access any clinic; all other roles are restricted to their
 * homeClinicId.  When Roster support arrives, replace the simple homeClinicId
 * check with a roster-membership lookup so rostered staff can access the clinic
 * they are working at on a given shift.
 */
export function resolveTenantClinicId(
  user: AuthenticatedUser,
  requestedClinicId?: string,
): string {
  if (user.role === "owner_admin") {
    return requestedClinicId ?? user.homeClinicId;
  }

  if (requestedClinicId && requestedClinicId !== user.homeClinicId) {
    throw new AppError(
      403,
      "TENANT_ACCESS_DENIED",
      "You do not have access to this clinic's data",
    );
  }

  return user.homeClinicId;
}

/**
 * SQL session variable used with PostgreSQL RLS policies (Module 13).
 * Call before tenant-scoped queries: SET app.current_clinic_id = '<uuid>'
 */
export const TENANT_SESSION_VAR = "app.current_clinic_id";

export function buildTenantSessionStatement(clinicId: string): string {
  return `SET ${TENANT_SESSION_VAR} = '${clinicId}'`;
}
