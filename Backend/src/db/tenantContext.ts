import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";

/**
 * Resolves the clinic_id scope for application-layer queries.
 * Owner/admin may access any clinic when an explicit target is provided.
 */
export function resolveTenantClinicId(
  user: AuthenticatedUser,
  requestedClinicId?: string,
): string {
  if (user.role === "owner_admin") {
    return requestedClinicId ?? user.clinicId;
  }

  if (requestedClinicId && requestedClinicId !== user.clinicId) {
    throw new AppError(
      403,
      "TENANT_ACCESS_DENIED",
      "You do not have access to this clinic's data",
    );
  }

  return user.clinicId;
}

/**
 * SQL session variable used with PostgreSQL RLS policies (Module 13).
 * Call before tenant-scoped queries: SET app.current_clinic_id = '<uuid>'
 */
export const TENANT_SESSION_VAR = "app.current_clinic_id";

export function buildTenantSessionStatement(clinicId: string): string {
  return `SET ${TENANT_SESSION_VAR} = '${clinicId}'`;
}
