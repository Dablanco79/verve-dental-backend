import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { CreatePayRateRequest, StaffPayRate } from "../types/index.js";

const apiClient = createApiClient(loadConfig());

export type UsePayRatesResult = {
  rates: StaffPayRate[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createRate: (payload: CreatePayRateRequest) => Promise<StaffPayRate>;
};

/**
 * Fetches the pay rate history for a specific staff member from
 * GET /clinics/:clinicId/users/:userId/pay-rates.
 *
 * Requires payroll:rates:read permission on the caller.
 * Re-fetches automatically when clinicId or userId changes.
 */
export function usePayRates(
  clinicId: string | null,
  userId: string | null,
): UsePayRatesResult {
  const [rates, setRates] = useState<StaffPayRate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    if (!clinicId || !userId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .listPayRates(clinicId, userId)
      .then((result) => {
        setRates(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load pay rates");
        setRates([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const createRate = useCallback(
    async (payload: CreatePayRateRequest): Promise<StaffPayRate> => {
      if (!clinicId || !userId) {
        throw new Error("clinicId and userId are required to create a pay rate");
      }
      const newRate = await apiClient.createPayRate(clinicId, userId, payload);
      // Refetch to get the full updated list (including the newly-closed old rate).
      fetch();
      return newRate;
    },
    [clinicId, userId, fetch],
  );

  return { rates, isLoading, error, refetch: fetch, createRate };
}
