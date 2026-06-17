import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { LaborForecastSummary } from "../types/forecast.js";

const apiClient = createApiClient(loadConfig());

export type UseLaborForecastResult = {
  data: LaborForecastSummary | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Fetches the labor cost forecast for a clinic from
 * GET /clinics/:clinicId/forecast/labor?forecastDays=N.
 *
 * Re-fetches automatically when clinicId or forecastDays changes.
 * forecastDays is bounded [1, 90] by both the hook (clamped) and the API (Zod validated).
 */
export function useLaborForecast(
  clinicId: string | undefined,
  forecastDays: number,
): UseLaborForecastResult {
  const [data, setData] = useState<LaborForecastSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clampedDays = Math.min(90, Math.max(1, Math.round(forecastDays)));

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .getLaborForecast(clinicId, clampedDays)
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load labor forecast");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, clampedDays]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
