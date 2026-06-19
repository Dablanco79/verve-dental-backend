/**
 * Materials forecast types — mirrors the backend forecastService.ts output shapes.
 *
 * SkuDemandProjection and MaterialShortfallAlert match the server response exactly
 * so no client-side forecast calculations are performed.
 *
 * EnrichedProjection extends the raw projection with cost and status fields
 * derived by joining with InventoryItem data (unit cost, supplier preference).
 */

// ── Raw API response types (match backend forecastService.ts) ─────────────────

/** Full SKU-level demand projection returned by GET /forecast/materials. */
export type SkuDemandProjection = {
  masterCatalogItemId: string;
  /** Canonical stock-keeping unit identifier (e.g. "VRV-GLV-001"). */
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  /** Quantity currently on hand at this clinic. */
  currentStock: number;
  /** Minimum stock level triggering a reorder alert. */
  reorderPoint: number;
  /** Non-cancelled upcoming roster shifts in the forecast window. */
  scheduledShiftCount: number;
  /** Verified-present attendance log entries in the historical lookback window. */
  historicalPresentShiftCount: number;
  /** Total scan_deduct units consumed in the lookback window for this SKU. */
  historicalConsumption: number;
  /** Average units consumed per verified-present shift. */
  avgUsagePerShift: number;
  /** Projected total units consumed during the forecast window. */
  projectedUsage: number;
  /** Estimated stock remaining after the forecast window. */
  projectedStockRemaining: number;
  /** True when projectedStockRemaining falls below the clinic reorder point. */
  willBreachSafetyThreshold: boolean;
};

export type AlertSeverity = "critical" | "warning";

/** Actionable shortage alert returned by GET /forecast/alerts. */
export type MaterialShortfallAlert = {
  severity: AlertSeverity;
  masterCatalogItemId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  currentStock: number;
  reorderPoint: number;
  projectedUsage: number;
  projectedStockRemaining: number;
  /** Units by which projected remaining stock falls below the reorder point. */
  shortfallUnits: number;
  /**
   * Estimated calendar days until stock reaches zero based on average daily
   * consumption rate. Null when no historical consumption data is available.
   */
  daysUntilStockout: number | null;
};

// ── Frontend display types ────────────────────────────────────────────────────

/**
 * Display status for a forecast row — derived from API fields only.
 *
 * critical        → projectedStockRemaining ≤ 0 (stockout expected)
 * reorder_required → projectedStockRemaining > 0 but below reorderPoint
 * low_soon        → currentStock already at or below reorderPoint (today)
 * healthy         → no immediate risk detected
 */
export type ForecastStatus = "healthy" | "low_soon" | "reorder_required" | "critical";

/**
 * Projection enriched with clinic inventory cost and supplier data.
 * Cost fields are null when the inventory item has no pricing configured.
 */
export type EnrichedProjection = SkuDemandProjection & {
  /** Effective unit cost in cents (override preferred; null when unavailable). */
  effectiveUnitCostCents: number | null;
  /** Supplier name from clinic inventory preference field. */
  supplierName: string | null;
  /**
   * Units to reorder to restore projected stock above the reorder point.
   * Zero for healthy items; derived from (reorderPoint − projectedStockRemaining).
   */
  recommendedReorderQty: number;
  /** Estimated reorder cost in cents. Null when no pricing is available. */
  estimatedReorderCostCents: number | null;
  /** Computed display status for the planning table. */
  forecastStatus: ForecastStatus;
};

/** Aggregated KPIs for the summary cards bar. */
export type MaterialsForecastSummary = {
  totalProducts: number;
  /** Products with scheduled usage > 0 in the forecast window. */
  productsWithConsumption: number;
  /** Products whose projected stock will remain above the reorder point. */
  productsAtSafeLevel: number;
  /** Products whose projected stock will breach the reorder point. */
  productsAtRisk: number;
  /** Products needing a reorder action (same as productsAtRisk). */
  recommendedReorderCount: number;
  /**
   * Sum of estimated reorder costs in cents for at-risk items with pricing.
   * Null when no at-risk items have pricing configured.
   */
  estimatedReorderCostCents: number | null;
  /** True when some (but not all) at-risk items have pricing available. */
  hasPartialPricing: boolean;
};
