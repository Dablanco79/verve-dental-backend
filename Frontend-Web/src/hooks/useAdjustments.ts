import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { AdjustmentsFilters, AdjustmentsPage } from "../types/inventory.js";

const apiClient = createApiClient(loadConfig());

const DEFAULT_LIMIT = 100;

export type UseAdjustmentsResult = {
  data: AdjustmentsPage | null;
  isLoading: boolean;
  error: string | null;
  filters: AdjustmentsFilters;
  setFilters: (partial: Omit<AdjustmentsFilters, "offset">) => void;
  nextPage: () => void;
  prevPage: () => void;
  refetch: () => void;
};

/**
 * Fetches a paginated inventory adjustment log for a clinic.
 *
 * Loads up to `DEFAULT_LIMIT` records per page so the page component can
 * apply client-side search / reason / date filters across the full result set.
 *
 * The hook is a no-op while `clinicId` is undefined.
 */
export function useAdjustments(
  clinicId: string | undefined,
  initialFilters: AdjustmentsFilters = {},
): UseAdjustmentsResult {
  const [data, setData] = useState<AdjustmentsPage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<AdjustmentsFilters>({
    limit: DEFAULT_LIMIT,
    offset: 0,
    ...initialFilters,
  });

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .listAdjustments(clinicId, filters)
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load adjustment history");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, filters]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const setFilters = useCallback(
    (partial: Omit<AdjustmentsFilters, "offset">) => {
      setFiltersState((prev) => ({ ...prev, ...partial, offset: 0 }));
    },
    [],
  );

  const nextPage = useCallback(() => {
    if (!data) return;
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const currentOffset = filters.offset ?? 0;
    if (currentOffset + limit >= data.total) return;
    setFiltersState((prev) => ({ ...prev, offset: currentOffset + limit }));
  }, [data, filters.limit, filters.offset]);

  const prevPage = useCallback(() => {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const currentOffset = filters.offset ?? 0;
    if (currentOffset === 0) return;
    setFiltersState((prev) => ({
      ...prev,
      offset: Math.max(0, currentOffset - limit),
    }));
  }, [filters.limit, filters.offset]);

  return {
    data,
    isLoading,
    error,
    filters,
    setFilters,
    nextPage,
    prevPage,
    refetch: fetch,
  };
}
