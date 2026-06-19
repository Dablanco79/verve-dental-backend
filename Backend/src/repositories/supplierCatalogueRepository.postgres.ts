import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierProductInput,
  SupplierProduct,
  UpdateSupplierProductInput,
} from "../types/supplier.js";
import type { SupplierCatalogueRepository } from "./supplierCatalogueRepository.js";

// ─── Row type ─────────────────────────────────────────────────────────────────

type SupplierCatalogueRow = {
  id: string;
  supplier_id: string;
  master_catalog_item_id: string;
  supplier_sku: string | null;
  supplier_description: string | null;
  unit_cost_cents: number;
  unit_of_measure: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapSupplierProduct(row: SupplierCatalogueRow): SupplierProduct {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.master_catalog_item_id,
    supplierSku: row.supplier_sku,
    supplierDescription: row.supplier_description,
    unitCostCents: row.unit_cost_cents,
    unitOfMeasure: row.unit_of_measure,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPostgresSupplierCatalogueRepository(
  pool: DatabasePool,
): SupplierCatalogueRepository {
  return {
    async listSupplierProducts(options = {}): Promise<SupplierProduct[]> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (options.supplierId !== undefined) {
        params.push(options.supplierId);
        conditions.push(`supplier_id = $${String(idx++)}`);
      }
      if (options.productId !== undefined) {
        params.push(options.productId);
        conditions.push(`master_catalog_item_id = $${String(idx++)}`);
      }
      if (options.active !== undefined) {
        params.push(options.active);
        conditions.push(`active = $${String(idx++)}`);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await pool.query<SupplierCatalogueRow>(
        `SELECT * FROM supplier_catalogue ${where} ORDER BY created_at`,
        params,
      );
      return rows.map(mapSupplierProduct);
    },

    async findSupplierProductById(
      supplierProductId: string,
    ): Promise<SupplierProduct | null> {
      const { rows } = await pool.query<SupplierCatalogueRow>(
        `SELECT * FROM supplier_catalogue WHERE id = $1`,
        [supplierProductId],
      );
      return rows[0] ? mapSupplierProduct(rows[0]) : null;
    },

    async findSupplierProductByPair(
      supplierId: string,
      productId: string,
    ): Promise<SupplierProduct | null> {
      const { rows } = await pool.query<SupplierCatalogueRow>(
        `SELECT * FROM supplier_catalogue
         WHERE supplier_id = $1
           AND master_catalog_item_id = $2
           AND active = true
         LIMIT 1`,
        [supplierId, productId],
      );
      return rows[0] ? mapSupplierProduct(rows[0]) : null;
    },

    async listPricingForProduct(productId: string): Promise<SupplierProduct[]> {
      const { rows } = await pool.query<SupplierCatalogueRow>(
        `SELECT * FROM supplier_catalogue
         WHERE master_catalog_item_id = $1
           AND active = true
         ORDER BY unit_cost_cents`,
        [productId],
      );
      return rows.map(mapSupplierProduct);
    },

    async createSupplierProduct(
      input: CreateSupplierProductInput,
    ): Promise<SupplierProduct> {
      const { rows } = await pool.query<SupplierCatalogueRow>(
        `INSERT INTO supplier_catalogue
           (supplier_id, master_catalog_item_id, supplier_sku, supplier_description,
            unit_cost_cents, unit_of_measure)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.supplierId,
          input.productId,
          input.supplierSku ?? null,
          input.supplierDescription ?? null,
          input.unitCostCents,
          input.unitOfMeasure ?? null,
        ],
      );
      if (!rows[0]) throw new Error("INSERT supplier_catalogue returned no rows");
      return mapSupplierProduct(rows[0]);
    },

    async updateSupplierProduct(
      supplierProductId: string,
      input: UpdateSupplierProductInput,
    ): Promise<SupplierProduct | null> {
      const setClauses: string[] = [];
      const params: unknown[] = [];

      let idx = 1;
      const addField = (col: string, val: unknown) => {
        params.push(val);
        setClauses.push(`${col} = $${String(idx++)}`);
      };

      if (input.supplierSku !== undefined) addField("supplier_sku", input.supplierSku);
      if (input.supplierDescription !== undefined)
        addField("supplier_description", input.supplierDescription);
      if (input.unitCostCents !== undefined) addField("unit_cost_cents", input.unitCostCents);
      if (input.unitOfMeasure !== undefined) addField("unit_of_measure", input.unitOfMeasure);
      if (input.active !== undefined) addField("active", input.active);

      if (setClauses.length === 0) {
        return this.findSupplierProductById(supplierProductId);
      }

      setClauses.push(`updated_at = now()`);
      params.push(supplierProductId);

      const { rows } = await pool.query<SupplierCatalogueRow>(
        `UPDATE supplier_catalogue
         SET ${setClauses.join(", ")}
         WHERE id = $${String(idx)}
         RETURNING *`,
        params,
      );
      return rows[0] ? mapSupplierProduct(rows[0]) : null;
    },

    async upsertSupplierProduct(input: CreateSupplierProductInput): Promise<{
      record: SupplierProduct;
      created: boolean;
    }> {
      // Atomic upsert: deactivate any existing active entry then insert the new one.
      // Using ON CONFLICT on the partial unique index (supplier_id, master_catalog_item_id)
      // WHERE active = true.
      const { rows } = await pool.query<SupplierCatalogueRow>(
        `INSERT INTO supplier_catalogue
           (supplier_id, master_catalog_item_id, supplier_sku, supplier_description,
            unit_cost_cents, unit_of_measure, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (supplier_id, master_catalog_item_id)
           WHERE active = true
         DO UPDATE SET
           supplier_sku         = EXCLUDED.supplier_sku,
           supplier_description = EXCLUDED.supplier_description,
           unit_cost_cents      = EXCLUDED.unit_cost_cents,
           unit_of_measure      = EXCLUDED.unit_of_measure,
           updated_at           = now()
         RETURNING *, (xmax = 0) AS inserted`,
        [
          input.supplierId,
          input.productId,
          input.supplierSku ?? null,
          input.supplierDescription ?? null,
          input.unitCostCents,
          input.unitOfMeasure ?? null,
        ],
      );

      if (!rows[0]) throw new Error("UPSERT supplier_catalogue returned no rows");

      const row = rows[0] as SupplierCatalogueRow & { inserted: boolean };
      return {
        record: mapSupplierProduct(row),
        created: row.inserted,
      };
    },
  };
}
