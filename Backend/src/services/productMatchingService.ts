/**
 * Product Matching Service — Sprint O.
 *
 * Matches an incoming catalogue row to a master catalog item using a
 * priority-ordered strategy:
 *
 *   1. Barcode match  — most reliable (unique barcode → item)
 *   2. SKU match      — reliable if supplier uses our master SKU
 *   3. Exact name     — normalised case-insensitive equality
 *   4. Manual         — returned when caller provides an explicit productId
 *   5. Unmatched      — no match found; row needs manual intervention
 *
 * No fuzzy matching.  No AI matching.  No OCR.
 */

import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { ProductMatchResult } from "../types/supplier.js";

export function createProductMatchingService(
  catalogRepository: CatalogRepository,
) {
  return {
    /**
     * Attempt to match a catalogue row to a master catalog item.
     *
     * @param row.supplierSku   — may equal our master SKU (strategy 2)
     * @param row.description   — used for exact name match (strategy 3)
     * @param row.barcodeValue  — primary barcode value (strategy 1)
     * @param row.manualProductId — caller-supplied override (strategy 4)
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
  };
}

export type ProductMatchingService = ReturnType<
  typeof createProductMatchingService
>;
