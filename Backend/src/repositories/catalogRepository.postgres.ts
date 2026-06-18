/**
 * PostgreSQL-backed CatalogRepository.
 *
 * Implements the same CatalogRepository interface as the in-memory version so
 * it can be swapped in transparently via createAppDependencies() when a
 * DATABASE_URL is present.
 *
 * Column → field mapping:
 *   sku                     → sku
 *   unit_of_measure         → unitOfMeasure
 *   default_unit_cost_cents → defaultUnitCostCents
 *   is_active               → isActive
 *   created_at / updated_at → createdAt / updatedAt
 *   master_catalog_item_id  → masterCatalogItemId
 *   barcode_value           → barcodeValue
 *   barcode_format          → barcodeFormat
 *   is_primary              → isPrimary
 */

import type { DatabasePool } from "../db/pool.js";
import type { BarcodeFormat, BarcodeMapping, MasterCatalogItem } from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import type { CatalogRepository } from "./catalogRepository.js";

type MasterCatalogRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unit_of_measure: string;
  default_unit_cost_cents: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type BarcodeMappingRow = {
  id: string;
  master_catalog_item_id: string;
  barcode_value: string;
  barcode_format: BarcodeFormat;
  is_primary: boolean;
  created_at: Date;
};

function rowToMasterItem(row: MasterCatalogRow): MasterCatalogItem {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    unitOfMeasure: row.unit_of_measure,
    defaultUnitCostCents: row.default_unit_cost_cents,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBarcodeMapping(row: BarcodeMappingRow): BarcodeMapping {
  return {
    id: row.id,
    masterCatalogItemId: row.master_catalog_item_id,
    barcodeValue: row.barcode_value,
    barcodeFormat: row.barcode_format,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export function createPostgresCatalogRepository(pool: DatabasePool): CatalogRepository {
  return {
    async listMasterItems(): Promise<MasterCatalogItem[]> {
      const { rows } = await pool.query<MasterCatalogRow>(
        "SELECT * FROM master_catalog_items WHERE is_active = true ORDER BY name",
      );
      return rows.map(rowToMasterItem);
    },

    async findMasterItemById(id: string): Promise<MasterCatalogItem | null> {
      const { rows } = await pool.query<MasterCatalogRow>(
        "SELECT * FROM master_catalog_items WHERE id = $1 LIMIT 1",
        [id],
      );
      return rows[0] ? rowToMasterItem(rows[0]) : null;
    },

    async findMasterItemBySku(sku: string): Promise<MasterCatalogItem | null> {
      const { rows } = await pool.query<MasterCatalogRow>(
        "SELECT * FROM master_catalog_items WHERE UPPER(sku) = UPPER($1) LIMIT 1",
        [sku.trim()],
      );
      return rows[0] ? rowToMasterItem(rows[0]) : null;
    },

    async findBarcodeMapping(barcodeValue: string): Promise<BarcodeMapping | null> {
      const { rows } = await pool.query<BarcodeMappingRow>(
        "SELECT * FROM barcode_mappings WHERE barcode_value = $1 LIMIT 1",
        [barcodeValue.trim()],
      );
      return rows[0] ? rowToBarcodeMapping(rows[0]) : null;
    },

    async listBarcodeMappingsForItem(
      masterCatalogItemId: string,
    ): Promise<BarcodeMapping[]> {
      const { rows } = await pool.query<BarcodeMappingRow>(
        "SELECT * FROM barcode_mappings WHERE master_catalog_item_id = $1",
        [masterCatalogItemId],
      );
      return rows.map(rowToBarcodeMapping);
    },

    async createMasterItem(
      item: Omit<MasterCatalogItem, "id" | "isActive" | "createdAt" | "updatedAt">,
    ): Promise<MasterCatalogItem> {
      const { rows } = await pool.query<MasterCatalogRow>(
        `INSERT INTO master_catalog_items
           (sku, name, description, category, unit_of_measure, default_unit_cost_cents)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          item.sku,
          item.name,
          item.description ?? null,
          item.category,
          item.unitOfMeasure,
          item.defaultUnitCostCents,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create master catalog item");
      return rowToMasterItem(row);
    },

    async createBarcodeMapping(
      mapping: Omit<BarcodeMapping, "id" | "createdAt">,
    ): Promise<BarcodeMapping> {
      const { rows } = await pool.query<BarcodeMappingRow>(
        `INSERT INTO barcode_mappings
           (master_catalog_item_id, barcode_value, barcode_format, is_primary)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          mapping.masterCatalogItemId,
          mapping.barcodeValue,
          mapping.barcodeFormat,
          mapping.isPrimary,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create barcode mapping");
      return rowToBarcodeMapping(row);
    },
  };
}
