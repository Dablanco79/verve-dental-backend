import { createContext } from "react";

import type { ClinicData } from "../types/clinic.js";
import type { AuthUser } from "../types/index.js";

export type ClinicOption = Pick<ClinicData, "id" | "name">;

export const ALL_CLINICS_DASHBOARD_SCOPE = "all_clinics";

export type DashboardScope =
  | { type: "all_clinics" }
  | { type: "clinic"; clinic: ClinicOption };

export type DashboardScopeSelection =
  | { type: "all_clinics" }
  | { type: "clinic"; clinicId: string };

export type ClinicContextValue = {
  selectedClinic: ClinicOption | null;
  selectedDashboardScope: DashboardScope | null;
  availableClinics: ClinicOption[];
  canSwitchClinics: boolean;
  canSelectAllClinics: boolean;
  isLoadingClinics: boolean;
  clinicError: string | null;
  hasClinicProvider: boolean;
  setSelectedClinicId: (clinicId: string) => void;
  setDashboardScope: (scope: DashboardScopeSelection) => void;
};

export const ClinicContext = createContext<ClinicContextValue | null>(null);

export function homeClinicOption(user: AuthUser): ClinicOption {
  return {
    id: user.homeClinicId,
    name: user.homeClinicName,
  };
}
