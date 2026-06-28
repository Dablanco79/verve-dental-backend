/**
 * useOperationalClinic — single source of truth for operational pages.
 *
 * Returns the clinic that should drive API calls on clinic-specific pages.
 * When the user has selected "All Clinics" scope, `clinicId` and `clinicName`
 * are `undefined` and `isAllClinicsScope` is true.  Pages should render a
 * "select a clinic" guard instead of making API calls with a wrong clinic ID.
 *
 * For non-owner_admin roles the provider always resolves to the user's home
 * clinic, so `isAllClinicsScope` is always false for those roles.
 */

import type { ClinicOption } from "./clinicContext.js";
import { useSelectedClinic } from "./useSelectedClinic.js";

export type OperationalClinicResult = {
  clinicId: string | undefined;
  clinicName: string | undefined;
  selectedClinic: ClinicOption | null;
  isAllClinicsScope: boolean;
};

export function useOperationalClinic(): OperationalClinicResult {
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  return {
    clinicId: isAllClinicsScope ? undefined : (selectedClinic?.id ?? undefined),
    clinicName: isAllClinicsScope ? undefined : (selectedClinic?.name ?? undefined),
    selectedClinic: isAllClinicsScope ? null : selectedClinic,
    isAllClinicsScope,
  };
}
