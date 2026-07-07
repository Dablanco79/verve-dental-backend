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
import type {
  CatalogRepository,
  CreateMasterCatalogItemInput,
  ListMasterItemsOptions,
  MasterItemsPage,
  UpdateMasterCatalogItemInput,
} from "./catalogRepository.js";

type MasterCatalogRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  stock_unit?: string | null;
  receiving_unit?: string | null;
  units_per_receiving_unit?: number | null;
  unit_of_measure: string;
  default_unit_cost_cents: number;
  is_active: boolean;
  subcategory?: string | null;
  brand?: string | null;
  variant_attributes?: string | null;
  notes?: string | null;
  status?: string | null;
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
    stockUnit: row.stock_unit ?? row.unit_of_measure,
    receivingUnit: row.receiving_unit ?? row.unit_of_measure,
    unitsPerReceivingUnit: row.units_per_receiving_unit ?? 1,
    unitOfMeasure: row.stock_unit ?? row.unit_of_measure,
    defaultUnitCostCents: row.default_unit_cost_cents,
    isActive: row.is_active,
    subcategory: row.subcategory ?? null,
    brand: row.brand ?? null,
    variantAttributes: row.variant_attributes ?? null,
    notes: row.notes ?? null,
    status: row.status ?? (row.is_active ? "active" : "inactive"),
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

    async listMasterItemsPage(options: ListMasterItemsOptions = {}): Promise<MasterItemsPage> {
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
      const offset = Math.max(options.offset ?? 0, 0);
      const statusFilter = options.status ?? "active";

      const params: unknown[] = [];
      const conditions: string[] = [];

      if (statusFilter !== "all") {
        params.push(statusFilter);
        conditions.push(`status = $${String(params.length)}`);
      }

      if (options.category) {
        params.push(options.category.trim());
        conditions.push(`LOWER(category) = LOWER($${String(params.length)})`);
      }

      if (options.search) {
        params.push(`%${options.search.trim().toLowerCase()}%`);
        const idx = params.length;
        conditions.push(
          `(LOWER(name) LIKE $${String(idx)}
             OR LOWER(sku) LIKE $${String(idx)}
             OR LOWER(category) LIKE $${String(idx)}
             OR LOWER(COALESCE(brand, '')) LIKE $${String(idx)}
             OR LOWER(COALESCE(subcategory, '')) LIKE $${String(idx)})`,
        );
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM master_catalog_items ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const { rows } = await pool.query<MasterCatalogRow>(
        `SELECT * FROM master_catalog_items ${where}
         ORDER BY name ASC
         LIMIT $${String(limitIdx)} OFFSET $${String(offsetIdx)}`,
        [...params, limit, offset],
      );

      return { items: rows.map(rowToMasterItem), total, limit, offset };
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

    async findMasterItemByNormalisedNameAndCategory(
      name: string,
      category: string,
    ): Promise<MasterCatalogItem | null> {
      const { rows } = await pool.query<MasterCatalogRow>(
        `SELECT * FROM master_catalog_items
         WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
           AND lower(regexp_replace(trim(category), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
         LIMIT 1`,
        [name, category],
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
      item: CreateMasterCatalogItemInput,
    ): Promise<MasterCatalogItem> {
      const stockUnit = "stockUnit" in item ? item.stockUnit : item.unitOfMeasure;
      const receivingUnit = "receivingUnit" in item ? item.receivingUnit : stockUnit;
      const unitsPerReceivingUnit =
        "unitsPerReceivingUnit" in item ? item.unitsPerReceivingUnit : 1;
      const status = item.status ?? "active";
      const { rows } = await pool.query<MasterCatalogRow>(
        `INSERT INTO master_catalog_items
           (sku, name, description, category, stock_unit, receiving_unit,
            units_per_receiving_unit, unit_of_measure, default_unit_cost_cents,
            subcategory, brand, variant_attributes, notes, status, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          item.sku,
          item.name,
          item.description ?? null,
          item.category,
          stockUnit,
          receivingUnit,
          unitsPerReceivingUnit,
          item.defaultUnitCostCents,
          item.subcategory ?? null,
          item.brand ?? null,
          item.variantAttributes ?? null,
          item.notes ?? null,
          status,
          status === "active",
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create master catalog item");
      return rowToMasterItem(row);
    },

    async updateMasterItem(
      id: string,
      input: UpdateMasterCatalogItemInput,
    ): Promise<MasterCatalogItem | null> {
      const setClauses: string[] = [];
      const params: unknown[] = [];

      let idx = 1;
      const addField = (col: string, val: unknown) => {
        params.push(val);
        setClauses.push(`${col} = $${String(idx++)}`);
      };

      if (input.sku !== undefined) addField("sku", input.sku);
      if (input.name !== undefined) addField("name", input.name);
      if (input.description !== undefined) addField("description", input.description);
      if (input.category !== undefined) addField("category", input.category);
      if (input.subcategory !== undefined) addField("subcategory", input.subcategory);
      if (input.brand !== undefined) addField("brand", input.brand);
      if (input.variantAttributes !== undefined) {
        addField("variant_attributes", input.variantAttributes);
      }
      if (input.stockUnit !== undefined) {
        addField("stock_unit", input.stockUnit);
        addField("unit_of_measure", input.stockUnit);
      }
      if (input.receivingUnit !== undefined) addField("receiving_unit", input.receivingUnit);
      if (input.notes !== undefined) addField("notes", input.notes);
      if (input.status !== undefined) {
        addField("status", input.status);
        addField("is_active", input.status === "active");
      }

      if (setClauses.length === 0) {
        return this.findMasterItemById(id);
      }

      setClauses.push("updated_at = now()");
      params.push(id);

      const { rows } = await pool.query<MasterCatalogRow>(
        `UPDATE master_catalog_items SET ${setClauses.join(", ")}
         WHERE id = $${String(idx)}
         RETURNING *`,
        params,
      );
      return rows[0] ? rowToMasterItem(rows[0]) : null;
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
