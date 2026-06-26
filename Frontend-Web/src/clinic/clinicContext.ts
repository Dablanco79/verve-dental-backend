import { createContext } from "react";

import type { ClinicData } from "../types/clinic.js";
import type { AuthUser } from "../types/index.js";

export type ClinicOption = Pick<ClinicData, "id" | "name">;

export type ClinicContextValue = {
  selectedClinic: ClinicOption | null;
  availableClinics: ClinicOption[];
  canSwitchClinics: boolean;
  isLoadingClinics: boolean;
  clinicError: string | null;
  hasClinicProvider: boolean;
  setSelectedClinicId: (clinicId: string) => void;
};

export const ClinicContext = createContext<ClinicContextValue | null>(null);

export function homeClinicOption(user: AuthUser): ClinicOption {
  return {
    id: user.homeClinicId,
    name: user.homeClinicName,
  };
}
