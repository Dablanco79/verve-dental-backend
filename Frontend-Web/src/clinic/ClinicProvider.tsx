import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { loadConfig } from "../config/index.js";
import {
  ClinicContext,
  homeClinicOption,
  type ClinicContextValue,
  type ClinicOption,
} from "./clinicContext.js";

const apiClient = createApiClient(loadConfig());
const STORAGE_KEY_PREFIX = "verve:selectedClinicId:";

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

export function ClinicProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [availableClinics, setAvailableClinics] = useState<ClinicOption[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<ClinicOption | null>(null);
  const [isLoadingClinics, setIsLoadingClinics] = useState(false);
  const [clinicError, setClinicError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setAvailableClinics([]);
      setSelectedClinic(null);
      setIsLoadingClinics(false);
      setClinicError(null);
      return;
    }

    let cancelled = false;
    const homeClinic = homeClinicOption(user);

    if (user.role !== "owner_admin") {
      setAvailableClinics([homeClinic]);
      setSelectedClinic(homeClinic);
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

        setAvailableClinics(clinicOptions.length > 0 ? clinicOptions : [homeClinic]);
        setSelectedClinic(nextSelectedClinic);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setAvailableClinics([homeClinic]);
        setSelectedClinic(homeClinic);
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
      setStoredClinicId(user.id, nextClinic.id);
    },
    [availableClinics, user],
  );

  const value = useMemo<ClinicContextValue>(
    () => ({
      selectedClinic,
      availableClinics,
      canSwitchClinics: user?.role === "owner_admin" && availableClinics.length > 1,
      isLoadingClinics,
      clinicError,
      hasClinicProvider: true,
      setSelectedClinicId,
    }),
    [
      availableClinics,
      clinicError,
      isLoadingClinics,
      selectedClinic,
      setSelectedClinicId,
      user?.role,
    ],
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}
