import { useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { MASTER_PRODUCT_CATEGORIES } from "../constants/categories.js";
import { loadConfig } from "../config/index.js";

const apiClient = createApiClient(loadConfig());

type UseCategoriesOptions = {
  /**
   * When true (default), the hook falls back to the compile-time constant if
   * the API fails.  Safe for read-only display.
   *
   * When false, the hook keeps `categories` empty on failure and exposes the
   * `error` string.  The caller must disable creation/submission when
   * `error` is non-null.  Use this for any form that writes permanent data.
   */
  allowFallback?: boolean;
};

type UseCategoriesResult = {
  /** Live list fetched from GET /api/v1/master-products/categories. */
  categories: string[];
  isLoading: boolean;
  /**
   * Non-null when the fetch failed.
   * - allowFallback=true:  categories falls back to the compile-time constant.
   * - allowFallback=false: categories stays empty; callers must disable saves.
   */
  error: string | null;
};

/**
 * Fetches the canonical Master Product category list from the backend.
 *
 * For creation / edit forms pass `{ allowFallback: false }` so that an API
 * failure blocks submission rather than silently using stale local data.
 */
export function useCategories(options?: UseCategoriesOptions): UseCategoriesResult {
  const allowFallback = options?.allowFallback ?? true;
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void apiClient
      .listCategories()
      .then((list) => {
        if (!cancelled) {
          setCategories(list);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Unable to load categories";
          setError(message);
          if (allowFallback) {
            // Display fallback only — must not be used to permit saves.
            setCategories([...MASTER_PRODUCT_CATEGORIES]);
          }
          // When allowFallback=false, keep categories=[] so callers can
          // disable submission entirely.
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allowFallback]);

  return { categories, isLoading, error };
}
