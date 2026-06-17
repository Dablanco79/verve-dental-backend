import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { DashboardKpis } from "../types/analytics.js";

const apiClient = createApiClient(loadConfig());

export type UseAnalyticsDashboardResult = {
  data: DashboardKpis | null;
  isLoading: boolean;
  error: string | null;
  periodDays: number;
  setPeriodDays: (days: number) => void;
  refetch: () => void;
};

/**
 * Fetches the analytics KPI dashboard for a clinic.
 *
 * `periodDays` controls the trailing-day window sent to the backend.
 * Updating it via `setPeriodDays` automatically re-triggers the fetch.
 * The hook is a no-op while `clinicId` is undefined (e.g. auth not yet loaded).
 */
export function useAnalyticsDashboard(
  clinicId: string | undefined,
  initialPeriodDays = 30,
): UseAnalyticsDashboardResult {
  const [data, setData] = useState<DashboardKpis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState(initialPeriodDays);

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .getAnalyticsDashboard(clinicId, { periodDays })
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load analytics dashboard");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, periodDays]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, periodDays, setPeriodDays, refetch: fetch };
}
