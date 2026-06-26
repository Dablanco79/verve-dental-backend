import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { loadConfig } from "../config/index.js";
import {
  ALL_CLINICS_DASHBOARD_SCOPE,
  ClinicContext,
  homeClinicOption,
  type DashboardScope,
  type DashboardScopeSelection,
  type ClinicContextValue,
  type ClinicOption,
} from "./clinicContext.js";

const apiClient = createApiClient(loadConfig());
const STORAGE_KEY_PREFIX = "verve:selectedClinicId:";
const DASHBOARD_SCOPE_STORAGE_KEY_PREFIX = "verve:dashboardScope:";

function getStoredClinicId(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
}

function setStoredClinicId(userId: string, clinicId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, clinicId);
}

function getStoredDashboardScope(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(`${DASHBOARD_SCOPE_STORAGE_KEY_PREFIX}${userId}`);
}

function setStoredDashboardScope(userId: string, scope: DashboardScopeSelection): void {
  if (typeof window === "undefined") {
    return;
  }
  const value =
    scope.type === "all_clinics"
      ? ALL_CLINICS_DASHBOARD_SCOPE
      : `clinic:${scope.clinicId}`;
  window.localStorage.setItem(`${DASHBOARD_SCOPE_STORAGE_KEY_PREFIX}${userId}`, value);
}

function selectDefaultClinic(
  clinics: ClinicOption[],
  homeClinic: ClinicOption,
  storedClinicId: string | null,
): ClinicOption {
  return (
    clinics.find((clinic) => clinic.id === storedClinicId) ??
    clinics.find((clinic) => clinic.id === homeClinic.id) ??
    clinics[0] ??
    homeClinic
  );
}

function selectDefaultDashboardScope(
  clinics: ClinicOption[],
  selectedClinic: ClinicOption,
  storedScope: string | null,
): DashboardScope {
  if (storedScope?.startsWith("clinic:")) {
    const storedClinicId = storedScope.slice("clinic:".length);
    const clinic = clinics.find((item) => item.id === storedClinicId);
    if (clinic) {
      return { type: "clinic", clinic };
    }
  }

  if (storedScope === ALL_CLINICS_DASHBOARD_SCOPE || clinics.length > 1) {
    return { type: "all_clinics" };
  }

  return { type: "clinic", clinic: selectedClinic };
}

export function ClinicProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [availableClinics, setAvailableClinics] = useState<ClinicOption[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<ClinicOption | null>(null);
  const [selectedDashboardScope, setSelectedDashboardScope] = useState<DashboardScope | null>(null);
  const [isLoadingClinics, setIsLoadingClinics] = useState(false);
  const [clinicError, setClinicError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setAvailableClinics([]);
      setSelectedClinic(null);
      setSelectedDashboardScope(null);
      setIsLoadingClinics(false);
      setClinicError(null);
      return;
    }

    let cancelled = false;
    const homeClinic = homeClinicOption(user);

    if (user.role !== "owner_admin") {
      setAvailableClinics([homeClinic]);
      setSelectedClinic(homeClinic);
      setSelectedDashboardScope({ type: "clinic", clinic: homeClinic });
      setIsLoadingClinics(false);
      setClinicError(null);
      return;
    }

    setIsLoadingClinics(true);
    setClinicError(null);

    void apiClient
      .listClinics()
      .then((clinics) => {
        if (cancelled) {
          return;
        }

        const clinicOptions = clinics.map((clinic) => ({
          id: clinic.id,
          name: clinic.name,
        }));
        const nextSelectedClinic = selectDefaultClinic(
          clinicOptions,
          homeClinic,
          getStoredClinicId(user.id),
        );
        const nextAvailableClinics = clinicOptions.length > 0 ? clinicOptions : [homeClinic];
        const nextDashboardScope = selectDefaultDashboardScope(
          nextAvailableClinics,
          nextSelectedClinic,
          getStoredDashboardScope(user.id),
        );

        setAvailableClinics(nextAvailableClinics);
        setSelectedClinic(nextSelectedClinic);
        setSelectedDashboardScope(nextDashboardScope);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setAvailableClinics([homeClinic]);
        setSelectedClinic(homeClinic);
        setSelectedDashboardScope({ type: "clinic", clinic: homeClinic });
        setClinicError(err instanceof Error ? err.message : "Unable to load clinics.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingClinics(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setSelectedClinicId = useCallback(
    (clinicId: string) => {
      if (!user || user.role !== "owner_admin") {
        return;
      }

      const nextClinic = availableClinics.find((clinic) => clinic.id === clinicId);
      if (!nextClinic) {
        return;
      }

      setSelectedClinic(nextClinic);
      setSelectedDashboardScope({ type: "clinic", clinic: nextClinic });
      setStoredClinicId(user.id, nextClinic.id);
      setStoredDashboardScope(user.id, { type: "clinic", clinicId: nextClinic.id });
    },
    [availableClinics, user],
  );

  const setDashboardScope = useCallback(
    (scope: DashboardScopeSelection) => {
      if (!user || user.role !== "owner_admin") {
        return;
      }

      if (scope.type === "all_clinics") {
        setSelectedDashboardScope({ type: "all_clinics" });
        setStoredDashboardScope(user.id, scope);
        return;
      }

      const nextClinic = availableClinics.find((clinic) => clinic.id === scope.clinicId);
      if (!nextClinic) {
        return;
      }

      setSelectedClinic(nextClinic);
      setSelectedDashboardScope({ type: "clinic", clinic: nextClinic });
      setStoredClinicId(user.id, nextClinic.id);
      setStoredDashboardScope(user.id, scope);
    },
    [availableClinics, user],
  );

  const value = useMemo<ClinicContextValue>(
    () => ({
      selectedClinic,
      selectedDashboardScope,
      availableClinics,
      canSwitchClinics: user?.role === "owner_admin" && availableClinics.length > 1,
      canSelectAllClinics: user?.role === "owner_admin",
      isLoadingClinics,
      clinicError,
      hasClinicProvider: true,
      setSelectedClinicId,
      setDashboardScope,
    }),
    [
      availableClinics,
      clinicError,
      isLoadingClinics,
      selectedClinic,
      selectedDashboardScope,
      setDashboardScope,
      setSelectedClinicId,
      user?.role,
    ],
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}
