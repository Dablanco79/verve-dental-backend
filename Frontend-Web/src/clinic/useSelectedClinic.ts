import { useContext } from "react";

import { useAuth } from "../auth/useAuth.js";
import { ClinicContext, homeClinicOption, type ClinicContextValue } from "./clinicContext.js";

export function useSelectedClinic(): ClinicContextValue {
  const context = useContext(ClinicContext);
  const { user } = useAuth();

  if (context) {
    return context;
  }

  const fallbackClinic = user ? homeClinicOption(user) : null;
  return {
    selectedClinic: fallbackClinic,
    selectedDashboardScope: fallbackClinic ? { type: "clinic", clinic: fallbackClinic } : null,
    availableClinics: fallbackClinic ? [fallbackClinic] : [],
    canSwitchClinics: false,
    canSelectAllClinics: false,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: false,
    setSelectedClinicId: () => undefined,
    setDashboardScope: () => undefined,
  };
}
