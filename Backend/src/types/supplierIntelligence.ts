/**
 * Supplier Intelligence — Domain Types (Sprint 3).
 *
 * Shapes the read-only intelligence report produced by
 * GET /api/v1/clinics/:clinicId/supplier-intelligence.
 *
 * All monetary values are integer CENTS (AUD).
 * annualUsage / annualSaving are null when insufficient data exists.
 */

// ── Confidence level ──────────────────────────────────────────────────────────

export const INTELLIGENCE_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "catalogue_only",
  "insufficient_data",
] as const;

export type IntelligenceConfidence =
  (typeof INTELLIGENCE_CONFIDENCE_LEVELS)[number];

// ── Per-product intelligence row ──────────────────────────────────────────────

/**
 * Intelligence result for a single master catalog product.
 *
 * currentSupplierId / currentUnitPriceCents — derived from the most recent
 * confirmed supplier invoice line for this clinic where is_matched=true.
 * Null if no confirmed purchase has been recorded.
 *
 * bestSupplierId / bestUnitPriceCents — derived from the active supplier_catalogue
 * entry with the lowest unit_cost_cents for this product (global, not clinic-scoped).
 * Null if no supplier catalogue entries exist.
 *
 * savingPerUnit — currentUnitPriceCents − bestUnitPriceCents, only set when
 * both values exist and best < current (otherwise null).
 *
 * estimatedAnnualUsage — total units deducted via scan_deduct adjustments
 * in the past 12 months for this clinic.  Null when no adjustment records exist.
 *
 * estimatedAnnualSaving — savingPerUnit × estimatedAnnualUsage.
 * Null when either input is null.
 */
export type SupplierIntelligenceRow = {
  productId: string;
  productName: string;
  productSku: string;
  currentSupplierId: string | null;
  currentSupplierName: string | null;
  currentUnitPriceCents: number | null;
  bestSupplierId: string | null;
  bestSupplierName: string | null;
  bestUnitPriceCents: number | null;
  savingPerUnit: number | null;
  estimatedAnnualUsage: number | null;
  estimatedAnnualSaving: number | null;
  confidence: IntelligenceConfidence;
  reason: string;
  /** Number of active catalogue entries for this product (across all suppliers). */
  supplierCatalogueCount: number;
};

// ── Summary KPIs ──────────────────────────────────────────────────────────────

export type SupplierIntelligenceSummary = {
  /** Total potential annual saving across all products (cents). */
  totalPotentialAnnualSavingCents: number;
  /** Products where a cheaper alternative supplier exists. */
  productsWithSaving: number;
  /** Average price variance percentage (current vs best), across products with both. */
  averagePriceVariancePct: number | null;
  /** Products that cannot be compared due to missing data. */
  productsNeedingAttention: number;
};

// ── Full response ─────────────────────────────────────────────────────────────

export type SupplierIntelligenceResult = {
  clinicId: string;
  generatedAt: string;
  summary: SupplierIntelligenceSummary;
  /** Products with saving opportunities (sorted by estimated annual saving DESC). */
  opportunities: SupplierIntelligenceRow[];
  /** Products where comparison is not possible. */
  needsAttention: SupplierIntelligenceRow[];
};
