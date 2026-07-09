/**
 * Product Matching Service — v1 (Product Matching Engine).
 *
 * matchProduct — original Sprint O strategy (used by catalogue import preview):
 *   1. Barcode match  — most reliable (unique barcode → item)
 *   2. SKU match      — reliable if supplier uses our master SKU
 *   3. Exact name     — normalised case-insensitive equality
 *   4. Manual         — returned when caller provides an explicit productId
 *   5. Unmatched      — no match found; row needs manual intervention
 *
 * suggestMatches — new ranked suggestion engine:
 *   1. Existing supplier-SKU mapping (confidence 100 — strongest)
 *   2. Exact normalised displayName match (confidence 95)
 *   3. Token Jaccard similarity against displayName (scaled 0–80)
 *   4. Category match boost (+5)
 *   5. Brand match boost (+5)
 *   6. Unit match boost (+3)
 *   Returns up to 5 suggestions with confidence >= 20, sorted by confidence desc.
 *
 * Safety invariants:
 *   — Never touches clinic_inventory_items, inventory_adjustments, or stock qty.
 *   — Never calls inventoryRepository, scan, or receiving APIs.
 */

import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type {
  ConfirmMatchInput,
  ProductMatchReason,
  ProductMatchResult,
  ProductMatchSuggestion,
  SuggestMatchesInput,
  SuggestMatchesResult,
} from "../types/supplier.js";

// ─── Text normalisation helpers ───────────────────────────────────────────────

function normaliseText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "at", "to", "by",
]);

function tokenise(text: string): Set<string> {
  return new Set(
    normaliseText(text)
      .split(" ")
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersectionCount = 0;
  for (const token of a) {
    if (b.has(token)) intersectionCount++;
  }
  const unionSize = a.size + b.size - intersectionCount;
  return intersectionCount / unionSize;
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createProductMatchingService(
  catalogRepository: CatalogRepository,
  supplierCatalogueRepository?: SupplierCatalogueRepository,
) {
  return {
    /**
     * Sprint O strategy: barcode → SKU → exact name → manual → unmatched.
     * Used by structured catalogue import preview.
     */
    async matchProduct(row: {
      supplierSku?: string | null;
      description?: string | null;
      barcodeValue?: string | null;
      manualProductId?: string | null;
    }): Promise<ProductMatchResult> {
      // Strategy 4 — manual mapping (explicit caller override)
      if (row.manualProductId) {
        const item = await catalogRepository.findMasterItemById(
          row.manualProductId,
        );
        if (item) {
          return {
            productId: item.id,
            productName: item.name,
            productSku: item.sku,
            matchStatus: "manual",
          };
        }
      }

      // Strategy 1 — barcode match
      if (row.barcodeValue?.trim()) {
        const mapping = await catalogRepository.findBarcodeMapping(
          row.barcodeValue.trim(),
        );
        if (mapping) {
          const item = await catalogRepository.findMasterItemById(
            mapping.masterCatalogItemId,
          );
          if (item) {
            return {
              productId: item.id,
              productName: item.name,
              productSku: item.sku,
              matchStatus: "barcode",
            };
          }
        }
      }

      // Strategy 2 — SKU match (supplier SKU treated as potential master SKU)
      if (row.supplierSku?.trim()) {
        const item = await catalogRepository.findMasterItemBySku(
          row.supplierSku.trim(),
        );
        if (item) {
          return {
            productId: item.id,
            productName: item.name,
            productSku: item.sku,
            matchStatus: "sku",
          };
        }
      }

      // Strategy 3 — exact name match (case-insensitive)
      if (row.description?.trim()) {
        const normalized = row.description.trim().toLowerCase();
        const allItems = await catalogRepository.listMasterItems();
        const match = allItems.find(
          (item) => item.name.trim().toLowerCase() === normalized,
        );
        if (match) {
          return {
            productId: match.id,
            productName: match.name,
            productSku: match.sku,
            matchStatus: "name",
          };
        }
      }

      return {
        productId: null,
        productName: null,
        productSku: null,
        matchStatus: "unmatched",
      };
    },

    /**
     * Product Matching Engine v1 — ranked multi-signal suggestions.
     *
     * Returns up to 5 suggestions sorted by confidence (highest first).
     * Suggestions with confidence < 20 are omitted.
     */
    async suggestMatches(
      input: SuggestMatchesInput,
    ): Promise<SuggestMatchesResult> {
      type ScoredSuggestion = ProductMatchSuggestion & { _score: number };
      const scored: ScoredSuggestion[] = [];
      const seenIds = new Set<string>();

      // Strategy 1 — existing supplier-SKU mapping (strongest signal, 100 %)
      if (
        supplierCatalogueRepository &&
        input.supplierId &&
        input.supplierSku?.trim()
      ) {
        const mapping = await supplierCatalogueRepository.findSupplierProductBySupplierSku(
          input.supplierId,
          input.supplierSku.trim(),
        );
        if (mapping) {
          const item = await catalogRepository.findMasterItemById(mapping.productId);
          if (item) {
            seenIds.add(item.id);
            scored.push({
              masterProductId: item.id,
              displayName: item.name,
              sku: item.sku,
              category: item.category,
              brand: item.brand,
              stockUnit: item.stockUnit,
              confidence: 100,
              reasons: ["supplier_sku_mapping"],
              _score: 100,
            });
          }
        }
      }

      // Strategies 2–6 — scan all active master products
      const allItems = await catalogRepository.listMasterItems();

      const descTokens =
        input.supplierDescription?.trim()
          ? tokenise(input.supplierDescription)
          : null;

      const normDesc =
        input.supplierDescription?.trim()
          ? normaliseText(input.supplierDescription)
          : null;

      for (const item of allItems) {
        if (seenIds.has(item.id)) continue;

        const reasons: ProductMatchReason[] = [];
        let score = 0;

        const normName = normaliseText(item.name);

        // Strategy 2 — exact normalised name (95 %)
        if (normDesc !== null && normDesc === normName) {
          reasons.push("exact_name");
          score = 95;
        } else if (descTokens !== null && descTokens.size > 0) {
          // Strategy 3 — token Jaccard similarity (scaled to 0–80)
          const itemTokens = tokenise(item.name);
          const sim = jaccardSimilarity(descTokens, itemTokens);
          if (sim >= 0.25) {
            reasons.push("token_similarity");
            score = Math.round(sim * 80);
          }
        }

        // Strategy 4 — category boost (+5 capped at 99)
        if (
          input.category?.trim() &&
          normaliseText(input.category) === normaliseText(item.category)
        ) {
          reasons.push("category_boost");
          score = Math.min(score + 5, 99);
        }

        // Strategy 5 — brand boost (+5 capped at 99)
        if (
          input.brand?.trim() &&
          item.brand &&
          normaliseText(input.brand) === normaliseText(item.brand)
        ) {
          reasons.push("brand_boost");
          score = Math.min(score + 5, 99);
        }

        // Strategy 6 — unit boost (+3 capped at 99)
        if (
          input.unit?.trim() &&
          normaliseText(input.unit) === normaliseText(item.stockUnit)
        ) {
          reasons.push("unit_boost");
          score = Math.min(score + 3, 99);
        }

        if (score >= 20 && reasons.length > 0) {
          scored.push({
            masterProductId: item.id,
            displayName: item.name,
            sku: item.sku,
            category: item.category,
            brand: item.brand,
            stockUnit: item.stockUnit,
            confidence: score,
            reasons,
            _score: score,
          });
        }
      }

      const suggestions = scored
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .map(({ masterProductId, displayName, sku, category, brand, stockUnit, confidence, reasons }) => ({
          masterProductId,
          displayName,
          sku,
          category,
          brand,
          stockUnit,
          confidence,
          reasons,
        }));

      return { suggestions };
    },

    /**
     * Validates that the required entities exist before confirming a match.
     * Actual persistence is performed by the calling service / controller
     * using SupplierCatalogueRepository.upsertSupplierProduct.
     */
    async validateMatchConfirmation(
      input: ConfirmMatchInput,
    ): Promise<{ valid: true } | { valid: false; reason: string }> {
      const item = await catalogRepository.findMasterItemById(input.masterProductId);
      if (!item) {
        return { valid: false, reason: `Master product ${input.masterProductId} not found` };
      }
      if (item.status === "archived") {
        return {
          valid: false,
          reason: `Master product "${item.name}" is archived and cannot be linked`,
        };
      }
      return { valid: true };
    },
  };
}

export type ProductMatchingService = ReturnType<
  typeof createProductMatchingService
>;
