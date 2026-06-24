/**
 * Supplier Intelligence Service — Sprint 3.
 *
 * Computes per-product saving opportunities by joining:
 *   - clinic_inventory_items  → which products this clinic stocks
 *   - supplier_invoice_lines  → most recent confirmed purchase price
 *   - supplier_catalogue      → all active supplier prices (global)
 *   - inventory_adjustments   → annual usage from scan_deduct events
 *   - suppliers               → supplier names
 *
 * All data is real stored data — no mock values, no guesses.
 * When data is missing the row is returned with null fields and
 * confidence = "insufficient_data".
 */

import type { DatabasePool } from "../db/pool.js";
import type {
  IntelligenceConfidence,
  SupplierIntelligenceResult,
  SupplierIntelligenceRow,
  SupplierIntelligenceSummary,
} from "../types/supplierIntelligence.js";

// ── Raw SQL row returned by the intelligence query ────────────────────────────

type IntelligenceQueryRow = {
  product_id: string;
  product_name: string;
  product_sku: string;
  current_supplier_id: string | null;
  current_supplier_name: string | null;
  current_unit_price_cents: string | null;
  best_supplier_id: string | null;
  best_supplier_name: string | null;
  best_unit_cost_cents: string | null;
  supplier_catalogue_count: string;
  annual_usage_units: string | null;
};

// ── Intelligence query ────────────────────────────────────────────────────────

const INTELLIGENCE_SQL = `
WITH
  -- All products stocked by this clinic
  inventory_products AS (
    SELECT
      ci.master_catalog_item_id,
      mci.sku,
      mci.name
    FROM clinic_inventory_items ci
    JOIN master_catalog_items mci ON mci.id = ci.master_catalog_item_id
    WHERE ci.clinic_id = $1
  ),

  -- Most recent confirmed purchase per product for this clinic
  -- Only uses matched lines that have a resolved master_catalog_item_id
  recent_purchase AS (
    SELECT DISTINCT ON (sil.master_catalog_item_id)
      sil.master_catalog_item_id,
      si.supplier_id       AS current_supplier_id,
      sil.unit_price_cents AS current_unit_price_cents
    FROM supplier_invoice_lines sil
    JOIN supplier_invoices si
      ON si.id = sil.supplier_invoice_id
    WHERE si.clinic_id            = $1
      AND si.status               = 'confirmed'
      AND sil.is_matched          = true
      AND sil.master_catalog_item_id IS NOT NULL
    ORDER BY
      sil.master_catalog_item_id,
      si.invoice_date   DESC NULLS LAST,
      si.confirmed_at   DESC NULLS LAST
  ),

  -- Best (lowest) active catalogue price per product across all suppliers
  best_price AS (
    SELECT DISTINCT ON (sc.master_catalog_item_id)
      sc.master_catalog_item_id,
      sc.supplier_id       AS best_supplier_id,
      sc.unit_cost_cents   AS best_unit_cost_cents
    FROM supplier_catalogue sc
    WHERE sc.active = true
    ORDER BY sc.master_catalog_item_id, sc.unit_cost_cents ASC
  ),

  -- Count of active catalogue entries per product (measures comparison richness)
  catalogue_count AS (
    SELECT
      master_catalog_item_id,
      COUNT(*)::text AS cnt
    FROM supplier_catalogue
    WHERE active = true
    GROUP BY master_catalog_item_id
  ),

  -- Annual usage from scan_deduct inventory adjustments (past 12 months)
  annual_usage AS (
    SELECT
      master_catalog_item_id,
      SUM(ABS(quantity_delta))::text AS units_consumed
    FROM inventory_adjustments
    WHERE clinic_id       = $1
      AND adjustment_type = 'scan_deduct'
      AND created_at      >= NOW() - INTERVAL '12 months'
    GROUP BY master_catalog_item_id
  )

SELECT
  ip.master_catalog_item_id                        AS product_id,
  ip.name                                          AS product_name,
  ip.sku                                           AS product_sku,
  rp.current_supplier_id,
  curr_s.supplier_name                             AS current_supplier_name,
  rp.current_unit_price_cents::text                AS current_unit_price_cents,
  bp.best_supplier_id,
  best_s.supplier_name                             AS best_supplier_name,
  bp.best_unit_cost_cents::text                    AS best_unit_cost_cents,
  COALESCE(cc.cnt, '0')                            AS supplier_catalogue_count,
  au.units_consumed                                AS annual_usage_units
FROM inventory_products ip
LEFT JOIN recent_purchase rp
  ON rp.master_catalog_item_id = ip.master_catalog_item_id
LEFT JOIN suppliers curr_s
  ON curr_s.id = rp.current_supplier_id
LEFT JOIN best_price bp
  ON bp.master_catalog_item_id = ip.master_catalog_item_id
LEFT JOIN suppliers best_s
  ON best_s.id = bp.best_supplier_id
LEFT JOIN catalogue_count cc
  ON cc.master_catalog_item_id = ip.master_catalog_item_id
LEFT JOIN annual_usage au
  ON au.master_catalog_item_id = ip.master_catalog_item_id
ORDER BY ip.name ASC
`;

// ── Row processor ─────────────────────────────────────────────────────────────

function processRow(raw: IntelligenceQueryRow): SupplierIntelligenceRow {
  const currentPrice =
    raw.current_unit_price_cents !== null
      ? parseInt(raw.current_unit_price_cents, 10)
      : null;
  const bestPrice =
    raw.best_unit_cost_cents !== null
      ? parseInt(raw.best_unit_cost_cents, 10)
      : null;
  const catalogueCount = parseInt(raw.supplier_catalogue_count, 10);
  const annualUsage =
    raw.annual_usage_units !== null
      ? parseInt(raw.annual_usage_units, 10)
      : null;

  // Saving exists only when best price is strictly lower than current price
  const savingPerUnit =
    currentPrice !== null && bestPrice !== null && bestPrice < currentPrice
      ? currentPrice - bestPrice
      : null;

  const estimatedAnnualSaving =
    savingPerUnit !== null && annualUsage !== null
      ? savingPerUnit * annualUsage
      : null;

  const { confidence, reason } = deriveConfidence({
    currentSupplierId: raw.current_supplier_id,
    currentPrice,
    bestSupplierId: raw.best_supplier_id,
    catalogueCount,
    savingPerUnit,
  });

  return {
    productId: raw.product_id,
    productName: raw.product_name,
    productSku: raw.product_sku,
    currentSupplierId: raw.current_supplier_id,
    currentSupplierName: raw.current_supplier_name,
    currentUnitPriceCents: currentPrice,
    bestSupplierId: raw.best_supplier_id,
    bestSupplierName: raw.best_supplier_name,
    bestUnitPriceCents: bestPrice,
    savingPerUnit,
    estimatedAnnualUsage: annualUsage,
    estimatedAnnualSaving,
    confidence,
    reason,
    supplierCatalogueCount: catalogueCount,
  };
}

// ── Confidence derivation ─────────────────────────────────────────────────────

function deriveConfidence(args: {
  currentSupplierId: string | null;
  currentPrice: number | null;
  bestSupplierId: string | null;
  catalogueCount: number;
  savingPerUnit: number | null;
}): { confidence: IntelligenceConfidence; reason: string } {
  const {
    currentSupplierId,
    currentPrice,
    bestSupplierId,
    catalogueCount,
    savingPerUnit,
  } = args;

  if (catalogueCount === 0) {
    return {
      confidence: "insufficient_data",
      reason: "No active supplier catalogue entries found for this product.",
    };
  }

  if (catalogueCount === 1 && currentSupplierId === null) {
    return {
      confidence: "catalogue_only",
      reason:
        "Only one supplier in catalogue and no confirmed purchase history. Cannot compare.",
    };
  }

  if (currentPrice === null) {
    if (catalogueCount >= 2) {
      return {
        confidence: "catalogue_only",
        reason:
          "No confirmed purchase invoices yet. Comparison based on catalogue prices only.",
      };
    }
    return {
      confidence: "insufficient_data",
      reason: "No confirmed purchase history and only one catalogue entry.",
    };
  }

  // We have a confirmed purchase price
  if (bestSupplierId === null) {
    return {
      confidence: "insufficient_data",
      reason:
        "Current price known from confirmed invoice, but no catalogue prices available to compare.",
    };
  }

  if (savingPerUnit !== null && savingPerUnit > 0) {
    return {
      confidence: "high",
      reason: `Better price available from confirmed supplier catalogue. Current invoice price vs best catalogue price.`,
    };
  }

  if (currentSupplierId === bestSupplierId) {
    return {
      confidence: "medium",
      reason:
        "Current supplier already offers the best catalogued price for this product.",
    };
  }

  return {
    confidence: "medium",
    reason:
      "Multiple suppliers available in catalogue. Current confirmed price is competitive.",
  };
}

// ── Summary computation ───────────────────────────────────────────────────────

function buildSummary(rows: SupplierIntelligenceRow[]): SupplierIntelligenceSummary {
  let totalSavingCents = 0;
  let productsWithSaving = 0;
  let varianceSum = 0;
  let varianceCount = 0;
  let productsNeedingAttention = 0;

  for (const row of rows) {
    if (
      row.estimatedAnnualSaving !== null &&
      row.estimatedAnnualSaving > 0
    ) {
      totalSavingCents += row.estimatedAnnualSaving;
      productsWithSaving++;
    }

    if (
      row.currentUnitPriceCents !== null &&
      row.bestUnitPriceCents !== null &&
      row.currentUnitPriceCents > 0
    ) {
      const variancePct =
        ((row.currentUnitPriceCents - row.bestUnitPriceCents) /
          row.currentUnitPriceCents) *
        100;
      varianceSum += variancePct;
      varianceCount++;
    }

    if (
      row.confidence === "insufficient_data" ||
      row.confidence === "catalogue_only"
    ) {
      productsNeedingAttention++;
    }
  }

  return {
    totalPotentialAnnualSavingCents: totalSavingCents,
    productsWithSaving,
    averagePriceVariancePct:
      varianceCount > 0
        ? Math.round((varianceSum / varianceCount) * 10) / 10
        : null,
    productsNeedingAttention,
  };
}

// ── Service factory ───────────────────────────────────────────────────────────

export function createSupplierIntelligenceService(pool: DatabasePool) {
  return {
    async getIntelligence(clinicId: string): Promise<SupplierIntelligenceResult> {
      const { rows } = await pool.query<IntelligenceQueryRow>(
        INTELLIGENCE_SQL,
        [clinicId],
      );

      const allRows = rows.map(processRow);

      const opportunities = allRows
        .filter(
          (r) =>
            r.savingPerUnit !== null &&
            r.savingPerUnit > 0,
        )
        .sort(
          (a, b) =>
            (b.estimatedAnnualSaving ?? 0) - (a.estimatedAnnualSaving ?? 0),
        );

      const needsAttention = allRows.filter(
        (r) =>
          r.confidence === "insufficient_data" ||
          r.confidence === "catalogue_only" ||
          r.supplierCatalogueCount === 0,
      );

      const summary = buildSummary(allRows);

      return {
        clinicId,
        generatedAt: new Date().toISOString(),
        summary,
        opportunities,
        needsAttention,
      };
    },
  };
}

export type SupplierIntelligenceService = ReturnType<
  typeof createSupplierIntelligenceService
>;
