import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierContractPriceInput,
  SupplierContractPrice,
  SupplierContractPriceType,
  UpdateSupplierContractPriceInput,
} from "../types/supplierContractPrice.js";
import type { SupplierContractPriceRepository } from "./supplierContractPriceRepository.js";

// ─── DB row shape ──────────────────────────────────────────────────────────────

type SupplierContractPriceRow = {
  id: string;
  supplier_contract_id: string;
  master_catalog_item_id: string;
  price_type: string;
  unit_price_cents: number;
  effective_from: Date;
  effective_to: Date | null;
  minimum_quantity: number | null;
  maximum_quantity: number | null;
  currency_code: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, supplier_contract_id, master_catalog_item_id,
  price_type, unit_price_cents,
  effective_from, effective_to,
  minimum_quantity, maximum_quantity,
  currency_code, notes, created_at, updated_at
`.trim();

function toSupplierContractPrice(
  row: SupplierContractPriceRow,
): SupplierContractPrice {
  return {
    id: row.id,
    supplierContractId: row.supplier_contract_id,
    masterCatalogItemId: row.master_catalog_item_id,
    priceType: row.price_type as SupplierContractPriceType,
    unitPriceCents: row.unit_price_cents,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    minimumQuantity: row.minimum_quantity,
    maximumQuantity: row.maximum_quantity,
    currencyCode: row.currency_code,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

export function createPostgresSupplierContractPriceRepository(
  pool: DatabasePool,
): SupplierContractPriceRepository {
  return {
    async listByContract(
      contractId: string,
    ): Promise<SupplierContractPrice[]> {
      const { rows } = await pool.query<SupplierContractPriceRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contract_prices
         WHERE supplier_contract_id = $1
         ORDER BY effective_from DESC`,
        [contractId],
      );
      return rows.map(toSupplierContractPrice);
    },

    async getById(
      priceId: string,
    ): Promise<SupplierContractPrice | null> {
      const { rows } = await pool.query<SupplierContractPriceRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contract_prices
         WHERE id = $1`,
        [priceId],
      );
      return rows[0] ? toSupplierContractPrice(rows[0]) : null;
    },

    async create(
      contractId: string,
      input: CreateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice> {
      const { rows } = await pool.query<SupplierContractPriceRow>(
        `INSERT INTO supplier_contract_prices
           (supplier_contract_id, master_catalog_item_id, price_type,
            unit_price_cents, effective_from, effective_to,
            minimum_quantity, maximum_quantity, currency_code, notes)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${SELECT_COLUMNS}`,
        [
          contractId,
          input.masterCatalogItemId,
          input.priceType ?? "contract",
          input.unitPriceCents,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.minimumQuantity ?? null,
          input.maximumQuantity ?? null,
          input.currencyCode ?? "AUD",
          input.notes ?? null,
        ],
      );

      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create supplier contract price");
      }
      return toSupplierContractPrice(row);
    },

    async update(
      priceId: string,
      input: UpdateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.priceType !== undefined) push("price_type", input.priceType);
      if (input.unitPriceCents !== undefined)
        push("unit_price_cents", input.unitPriceCents);
      if (input.effectiveFrom !== undefined)
        push("effective_from", input.effectiveFrom);
      if (input.effectiveTo !== undefined)
        push("effective_to", input.effectiveTo);
      if (input.minimumQuantity !== undefined)
        push("minimum_quantity", input.minimumQuantity);
      if (input.maximumQuantity !== undefined)
        push("maximum_quantity", input.maximumQuantity);
      if (input.currencyCode !== undefined)
        push("currency_code", input.currencyCode);
      if (input.notes !== undefined) push("notes", input.notes);

      if (sets.length === 1) {
        return this.getById(priceId);
      }

      params.push(priceId);

      const { rows } = await pool.query<SupplierContractPriceRow>(
        `UPDATE supplier_contract_prices
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );
      return rows[0] ? toSupplierContractPrice(rows[0]) : null;
    },

    async expire(priceId: string): Promise<SupplierContractPrice | null> {
      const { rows } = await pool.query<SupplierContractPriceRow>(
        `UPDATE supplier_contract_prices
         SET effective_to = CURRENT_DATE, updated_at = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [priceId],
      );
      return rows[0] ? toSupplierContractPrice(rows[0]) : null;
    },

    async findCurrentPrice(
      contractId: string,
      masterCatalogItemId: string,
      options: {
        asOf?: Date;
        quantity?: number;
        priceType?: SupplierContractPriceType;
      } = {},
    ): Promise<SupplierContractPrice | null> {
      const asOf = options.asOf ?? new Date();
      const { quantity, priceType } = options;

      const params: unknown[] = [contractId, masterCatalogItemId, asOf, asOf];
      let p = 5;
      const extraClauses: string[] = [];

      if (priceType !== undefined) {
        extraClauses.push(`price_type = $${String(p++)}`);
        params.push(priceType);
      }

      if (quantity !== undefined) {
        extraClauses.push(
          `(minimum_quantity IS NULL OR minimum_quantity <= $${String(p)})`,
        );
        params.push(quantity);
        p++;
        extraClauses.push(
          `(maximum_quantity IS NULL OR maximum_quantity >= $${String(p)})`,
        );
        params.push(quantity);
        p++;
      }

      const extraWhere =
        extraClauses.length > 0 ? ` AND ${extraClauses.join(" AND ")}` : "";

      const { rows } = await pool.query<SupplierContractPriceRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contract_prices
         WHERE supplier_contract_id = $1
           AND master_catalog_item_id = $2
           AND effective_from <= $3
           AND (effective_to IS NULL OR effective_to >= $4)
           ${extraWhere}
         ORDER BY effective_from DESC
         LIMIT 1`,
        params,
      );
      return rows[0] ? toSupplierContractPrice(rows[0]) : null;
    },
  };
}
