/**
 * useClinicTimezone — fetches and caches the IANA timezone string for a clinic.
 *
 * The clinic's authoritative timezone is stored server-side on the clinic record.
 * This hook ensures that date-range calculations on clinic-specific pages (e.g.
 * Labour Cost Analysis) use the clinic's calendar date, not the device's local
 * timezone — which may differ when an owner/admin is travelling overseas.
 *
 * Returns "Australia/Sydney" as a safe default while the clinic record is loading
 * or when clinicId is undefined.
 */

import { useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";

const apiClient = createApiClient(loadConfig());

const DEFAULT_TIMEZONE = "Australia/Sydney";

export function useClinicTimezone(clinicId: string | undefined): string {
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);

  useEffect(() => {
    if (!clinicId) {
      setTimezone(DEFAULT_TIMEZONE);
      return;
    }
    void apiClient
      .getClinic(clinicId)
      .then((c) => { setTimezone(c.timezone); })
      .catch(() => {
        // Keep the default on error — do not surface a UI error for timezone lookup.
      });
  }, [clinicId]);

  return timezone;
}
