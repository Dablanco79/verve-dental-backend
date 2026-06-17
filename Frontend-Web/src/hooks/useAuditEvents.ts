import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { AuditEventsFilters, AuditEventsPage } from "../types/analytics.js";

const apiClient = createApiClient(loadConfig());

const DEFAULT_LIMIT = 25;

export type UseAuditEventsResult = {
  data: AuditEventsPage | null;
  isLoading: boolean;
  error: string | null;
  filters: AuditEventsFilters;
  /** Merge one or more filter fields and reset to page 0. */
  setFilters: (partial: Omit<AuditEventsFilters, "offset">) => void;
  /** Replace all filters wholesale (offset included — use for direct page jumps). */
  replaceFilters: (next: AuditEventsFilters) => void;
  nextPage: () => void;
  prevPage: () => void;
  refetch: () => void;
};

/**
 * Fetches a paginated, filterable audit-event log for a clinic.
 *
 * `setFilters` merges new filter fields and resets the page offset to 0
 * so a filter change always starts from the first page.
 *
 * `nextPage` / `prevPage` increment/decrement the offset by the active
 * limit.  `prevPage` is a no-op when already on the first page.
 * `nextPage` is a no-op when all records have been returned.
 *
 * The hook is a no-op while `clinicId` is undefined.
 */
export function useAuditEvents(
  clinicId: string | undefined,
  initialFilters: AuditEventsFilters = {},
): UseAuditEventsResult {
  const [data, setData] = useState<AuditEventsPage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<AuditEventsFilters>({
    limit: DEFAULT_LIMIT,
    offset: 0,
    ...initialFilters,
  });

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .listAuditEvents(clinicId, filters)
      .then((result) => {
        setData(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load audit events");
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, filters]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  /** Merge partial filter fields and reset offset to 0 (new filter = page 1). */
  const setFilters = useCallback(
    (partial: Omit<AuditEventsFilters, "offset">) => {
      setFiltersState((prev) => ({ ...prev, ...partial, offset: 0 }));
    },
    [],
  );

  /** Replace all filters wholesale — useful for direct page-number jumps. */
  const replaceFilters = useCallback((next: AuditEventsFilters) => {
    setFiltersState(next);
  }, []);

  const nextPage = useCallback(() => {
    if (!data) return;
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const currentOffset = filters.offset ?? 0;
    // Guard: do not advance past the last page.
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
    replaceFilters,
    nextPage,
    prevPage,
    refetch: fetch,
  };
}
