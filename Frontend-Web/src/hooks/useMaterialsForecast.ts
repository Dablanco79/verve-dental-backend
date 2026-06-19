import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type {
  EnrichedProjection,
  ForecastStatus,
  MaterialShortfallAlert,
  MaterialsForecastSummary,
  SkuDemandProjection,
} from "../types/materialsForecast.js";

const apiClient = createApiClient(loadConfig());

export type UseMaterialsForecastResult = {
  projections: EnrichedProjection[] | null;
  alerts: MaterialShortfallAlert[] | null;
  summary: MaterialsForecastSummary | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Derives the display status for a projection row using only API-provided
 * fields — no independent forecasting logic is performed client-side.
 */
function computeStatus(p: SkuDemandProjection): ForecastStatus {
  if (p.projectedStockRemaining <= 0) return "critical";
  if (p.willBreachSafetyThreshold) return "reorder_required";
  if (p.currentStock <= p.reorderPoint) return "low_soon";
  return "healthy";
}

/**
 * Fetches and combines:
 *   GET /clinics/:id/forecast/materials  — SKU demand projections
 *   GET /clinics/:id/forecast/alerts     — actionable shortage alerts
 *   GET /clinics/:id/inventory           — unit cost + supplier data for cost visibility
 *
 * The three requests run in parallel.  Inventory items are joined on
 * masterCatalogItemId to attach cost and supplier fields to each projection.
 *
 * Re-fetches automatically when clinicId or forecastDays changes.
 * forecastDays is clamped [1, 90] matching the backend Zod schema.
 */
export function useMaterialsForecast(
  clinicId: string | undefined,
  forecastDays: number,
): UseMaterialsForecastResult {
  const [projections, setProjections] = useState<EnrichedProjection[] | null>(null);
  const [alerts, setAlerts] = useState<MaterialShortfallAlert[] | null>(null);
  const [summary, setSummary] = useState<MaterialsForecastSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clampedDays = Math.min(90, Math.max(1, Math.round(forecastDays)));

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void Promise.all([
      apiClient.getMaterialsForecast(clinicId, clampedDays),
      apiClient.getMaterialsAlerts(clinicId, clampedDays),
      apiClient.listInventory(clinicId),
    ])
      .then(([rawProjections, rawAlerts, inventoryItems]) => {
        // Build a cost lookup keyed on masterCatalogItemId.
        const costMap = new Map(
          inventoryItems.map((item) => [
            item.masterCatalogItemId,
            {
              effectiveUnitCostCents:
                item.unitCostOverrideCents !== null
                  ? item.unitCostOverrideCents
                  : item.unitCostCents > 0
                    ? item.unitCostCents
                    : null,
              supplierName: item.supplierPreference,
            },
          ]),
        );

        // Enrich projections with cost visibility and display status.
        const enriched: EnrichedProjection[] = rawProjections.map((p) => {
          const costInfo = costMap.get(p.masterCatalogItemId);
          const effectiveUnitCostCents = costInfo?.effectiveUnitCostCents ?? null;
          const supplierName = costInfo?.supplierName ?? null;

          // Units needed to restore projected stock to at least the reorder point.
          const recommendedReorderQty = p.willBreachSafetyThreshold
            ? Math.max(p.reorderPoint - p.projectedStockRemaining, 1)
            : 0;

          const estimatedReorderCostCents =
            effectiveUnitCostCents !== null && recommendedReorderQty > 0
              ? recommendedReorderQty * effectiveUnitCostCents
              : null;

          return {
            ...p,
            effectiveUnitCostCents,
            supplierName,
            recommendedReorderQty,
            estimatedReorderCostCents,
            forecastStatus: computeStatus(p),
          };
        });

        // Aggregate summary KPIs.
        const atRisk = enriched.filter((p) => p.willBreachSafetyThreshold);
        const pricedAtRisk = atRisk.filter((p) => p.estimatedReorderCostCents !== null);
        const estimatedReorderCostCents =
          pricedAtRisk.length > 0
            ? pricedAtRisk.reduce((acc, p) => acc + (p.estimatedReorderCostCents ?? 0), 0)
            : null;

        setSummary({
          totalProducts: enriched.length,
          productsWithConsumption: enriched.filter((p) => p.projectedUsage > 0).length,
          productsAtSafeLevel: enriched.filter((p) => !p.willBreachSafetyThreshold).length,
          productsAtRisk: atRisk.length,
          recommendedReorderCount: atRisk.length,
          estimatedReorderCostCents,
          hasPartialPricing: atRisk.length > 0 && pricedAtRisk.length < atRisk.length,
        });

        setProjections(enriched);
        setAlerts(rawAlerts);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load materials forecast");
        setProjections(null);
        setAlerts(null);
        setSummary(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [clinicId, clampedDays]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { projections, alerts, summary, isLoading, error, refetch: fetch };
}
