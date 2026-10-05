import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { GroupLaborCostAnalysis, LaborCostAnalysis } from "../types/forecast.js";

const apiClient = createApiClient(loadConfig());

export type DateRangeParams =
  | { mode: "range"; from: string; to: string }
  | { mode: "days"; forecastDays: number };

export type UseLaborForecastResult = {
  data: LaborCostAnalysis | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Fetches the labour cost analysis for a clinic.
 *
 * Supports two modes:
 *   - { mode: "range", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 *     Fetches a specific date range (may be historical, future, or mixed).
 *   - { mode: "days", forecastDays: N }
 *     Legacy/quick mode: forward-only window of N days from today (1–90).
 *
 * Re-fetches automatically when clinicId or params change.
 */
export function useLaborForecast(
  clinicId: string | undefined,
  params: DateRangeParams,
): UseLaborForecastResult {
  const [data, setData] = useState<LaborCostAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize params for stable dependency tracking
  const paramsKey =
    params.mode === "range"
      ? `range:${params.from}:${params.to}`
      : `days:${String(Math.min(90, Math.max(1, Math.round(params.forecastDays))))}`;

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    const apiParams =
      params.mode === "range"
        ? { from: params.from, to: params.to }
        : { forecastDays: Math.min(90, Math.max(1, Math.round(params.forecastDays))) };

    void apiClient
      .getLaborForecast(clinicId, apiParams)
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load labour cost analysis");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, paramsKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}

export type UseGroupLaborForecastResult = {
  data: GroupLaborCostAnalysis | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Fetches the group labour cost analysis (all clinics) for owner_admin.
 * Only fires when enabled=true (i.e. when All Clinics scope is active).
 */
export function useGroupLaborForecast(
  params: DateRangeParams,
  enabled: boolean,
): UseGroupLaborForecastResult {
  const [data, setData] = useState<GroupLaborCostAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paramsKey =
    params.mode === "range"
      ? `range:${params.from}:${params.to}`
      : `days:${String(Math.min(90, Math.max(1, Math.round(params.forecastDays))))}`;

  const fetch = useCallback(() => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    const apiParams: { from: string; to: string } | undefined =
      params.mode === "range"
        ? { from: params.from, to: params.to }
        : undefined;

    void apiClient
      .getGroupLaborForecast(apiParams)
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load group labour cost analysis");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paramsKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
