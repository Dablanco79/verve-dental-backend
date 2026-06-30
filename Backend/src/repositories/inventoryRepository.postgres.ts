/**
 * PostgreSQL-backed InventoryRepository.
 *
 * Implements the same InventoryRepository interface as the in-memory version so
 * it can be swapped in transparently via createAppDependencies() when a
 * DATABASE_URL is present.
 *
 * listClinicInventory and findClinicInventoryItem JOIN master_catalog_items to
 * produce ClinicInventoryItemView directly in SQL, avoiding the extra catalog
 * repo call required by the in-memory implementation.
 *
 * Column → field mapping (clinic_inventory_items):
 *   clinic_id                → clinicId
 *   master_catalog_item_id   → masterCatalogItemId
 *   quantity_on_hand         → quantityOnHand
 *   reorder_point            → reorderPoint
 *   unit_cost_override_cents → unitCostOverrideCents
 *   supplier_preference      → supplierPreference (legacy fallback only)
 *   created_at / updated_at  → createdAt / updatedAt
 */

import type { DatabasePool } from "../db/pool.js";
import type {
  AdjustmentType,
  AdjustmentsPage,
  ClinicInventoryItem,
  ClinicInventoryItemView,
  DraftPoLine,
  DraftPoStatus,
  DraftPurchaseOrder,
  InventoryAdjustment,
  InventoryPage,
  ProductSupplier,
} from "../types/inventory.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
} from "../types/purchaseOrderErrors.js";
import { AppError } from "../types/errors.js";
import type { InventoryRepository } from "./inventoryRepository.js";

// ─── Row types ───────────────────────────────────────────────────────────────

type ClinicInventoryRow = {
  id: string;
  clinic_id: string;
  master_catalog_item_id: string;
  quantity_on_hand: number;
  reorder_point: number;
  unit_cost_override_cents: number | null;
  supplier_preference: string | null;
  created_at: Date;
  updated_at: Date;
};

type ClinicInventoryViewRow = ClinicInventoryRow & {
  master_sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  unit_cost_cents: number;
  is_below_reorder_point: boolean;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
};

type ProductSupplierRow = {
  id: string;
  clinic_id: string;
  product_id: string;
  supplier_id: string;
  supplier_name: string | null;
  supplier_sku: string | null;
  supplier_barcode: string | null;
  unit_cost_cents: number | null;
  pack_size: number | null;
  is_preferred: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type AdjustmentRow = {
  id: string;
  clinic_id: string;
  clinic_inventory_item_id: string;
  master_catalog_item_id: string;
  adjustment_type: AdjustmentType;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  reason: string | null;
  performed_by_user_id: string;
  performed_by_email: string;
  reference_id: string | null;
  created_at: Date;
};

type DraftPoRow = {
  id: string;
  clinic_id: string;
  status: DraftPoStatus;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type DraftPoLineRow = {
  id: string;
  draft_purchase_order_id: string;
  master_catalog_item_id: string;
  clinic_inventory_item_id: string;
  quantity: number;
  reason: string;
  created_at: Date;
};

// ─── Row → domain converters ─────────────────────────────────────────────────

function rowToClinicInventoryItem(row: ClinicInventoryRow): ClinicInventoryItem {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    masterCatalogItemId: row.master_catalog_item_id,
    quantityOnHand: row.quantity_on_hand,
    reorderPoint: row.reorder_point,
    unitCostOverrideCents: row.unit_cost_override_cents,
    supplierPreference: row.supplier_preference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToClinicInventoryView(row: ClinicInventoryViewRow): ClinicInventoryItemView {
  return {
    ...rowToClinicInventoryItem(row),
    masterSku: row.master_sku,
    name: row.name,
    category: row.category,
    unitOfMeasure: row.unit_of_measure,
    unitCostCents: row.unit_cost_cents,
    isBelowReorderPoint: row.is_below_reorder_point,
    preferredSupplierId: row.preferred_supplier_id,
    preferredSupplierName: row.preferred_supplier_name,
  };
}

function rowToProductSupplier(row: ProductSupplierRow): ProductSupplier {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    productId: row.product_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierSku: row.supplier_sku,
    supplierBarcode: row.supplier_barcode,
    unitCostCents: row.unit_cost_cents,
    packSize: row.pack_size,
    isPreferred: row.is_preferred,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAdjustment(row: AdjustmentRow): InventoryAdjustment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    clinicInventoryItemId: row.clinic_inventory_item_id,
    masterCatalogItemId: row.master_catalog_item_id,
    adjustmentType: row.adjustment_type,
    quantityDelta: row.quantity_delta,
    quantityBefore: row.quantity_before,
    quantityAfter: row.quantity_after,
    reason: row.reason,
    performedByUserId: row.performed_by_user_id,
    performedByEmail: row.performed_by_email,
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
}

function rowToDraftPo(row: DraftPoRow): DraftPurchaseOrder {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDraftPoLine(row: DraftPoLineRow): DraftPoLine {
  return {
    id: row.id,
    draftPurchaseOrderId: row.draft_purchase_order_id,
    masterCatalogItemId: row.master_catalog_item_id,
    clinicInventoryItemId: row.clinic_inventory_item_id,
    quantity: row.quantity,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

// ─── Shared VIEW query ────────────────────────────────────────────────────────

const INVENTORY_VIEW_SELECT = `
  SELECT
    ci.id,
    ci.clinic_id,
    ci.master_catalog_item_id,
    ci.quantity_on_hand,
    ci.reorder_point,
    ci.unit_cost_override_cents,
    ci.supplier_preference,
    ci.created_at,
    ci.updated_at,
    mci.sku                                                          AS master_sku,
    mci.name,
    mci.category,
    mci.unit_of_measure,
    COALESCE(ci.unit_cost_override_cents, mci.default_unit_cost_cents) AS unit_cost_cents,
    (ci.quantity_on_hand < ci.reorder_point)                         AS is_below_reorder_point,
    ps.supplier_id                                                   AS preferred_supplier_id,
    COALESCE(s.supplier_name, ci.supplier_preference)                 AS preferred_supplier_name
  FROM clinic_inventory_items ci
  JOIN master_catalog_items mci ON mci.id = ci.master_catalog_item_id
  LEFT JOIN product_suppliers ps
    ON ps.clinic_id = ci.clinic_id
   AND ps.product_id = ci.master_catalog_item_id
   AND ps.active = true
   AND ps.is_preferred = true
  LEFT JOIN suppliers s ON s.id = ps.supplier_id
`;

// ─── Repository factory ───────────────────────────────────────────────────────

export function createPostgresInventoryRepository(pool: DatabasePool): InventoryRepository {
  return {
    async listClinicInventory(clinicId: string): Promise<ClinicInventoryItemView[]> {
      const { rows } = await pool.query<ClinicInventoryViewRow>(
        `${INVENTORY_VIEW_SELECT} WHERE ci.clinic_id = $1 ORDER BY mci.name`,
        [clinicId],
      );
      return rows.map(rowToClinicInventoryView);
    },

    async listClinicInventoryPage(
      clinicId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<InventoryPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM clinic_inventory_items ci
         WHERE ci.clinic_id = $1`,
        [clinicId],
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const { rows } = await pool.query<ClinicInventoryViewRow>(
        `${INVENTORY_VIEW_SELECT} WHERE ci.clinic_id = $1 ORDER BY mci.name LIMIT $2 OFFSET $3`,
        [clinicId, limit, offset],
      );

      return { items: rows.map(rowToClinicInventoryView), total, limit, offset };
    },

    async findClinicInventoryItem(
      clinicId: string,
      itemId: string,
    ): Promise<ClinicInventoryItemView | null> {
      const { rows } = await pool.query<ClinicInventoryViewRow>(
        `${INVENTORY_VIEW_SELECT} WHERE ci.clinic_id = $1 AND ci.id = $2 LIMIT 1`,
        [clinicId, itemId],
      );
      return rows[0] ? rowToClinicInventoryView(rows[0]) : null;
    },

    async findClinicInventoryByMasterItemId(
      clinicId: string,
      masterCatalogItemId: string,
    ): Promise<ClinicInventoryItem | null> {
      const { rows } = await pool.query<ClinicInventoryRow>(
        `SELECT * FROM clinic_inventory_items
         WHERE clinic_id = $1 AND master_catalog_item_id = $2 LIMIT 1`,
        [clinicId, masterCatalogItemId],
      );
      return rows[0] ? rowToClinicInventoryItem(rows[0]) : null;
    },

    async updateQuantity(
      clinicId: string,
      itemId: string,
      newQuantity: number,
    ): Promise<ClinicInventoryItem> {
      const { rows } = await pool.query<ClinicInventoryRow>(
        `UPDATE clinic_inventory_items
         SET quantity_on_hand = $1, updated_at = now()
         WHERE clinic_id = $2 AND id = $3
         RETURNING *`,
        [newQuantity, clinicId, itemId],
      );

      const row = rows[0];
      if (!row) throw new AppError(404, "NOT_FOUND", `Inventory item not found: ${itemId}`);
      return rowToClinicInventoryItem(row);
    },

    async recordAdjustment(
      adjustment: Omit<InventoryAdjustment, "id" | "createdAt">,
    ): Promise<InventoryAdjustment> {
      const { rows } = await pool.query<AdjustmentRow>(
        `INSERT INTO inventory_adjustments
           (clinic_id, clinic_inventory_item_id, master_catalog_item_id,
            adjustment_type, quantity_delta, quantity_before, quantity_after,
            reason, performed_by_user_id, performed_by_email, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          adjustment.clinicId,
          adjustment.clinicInventoryItemId,
          adjustment.masterCatalogItemId,
          adjustment.adjustmentType,
          adjustment.quantityDelta,
          adjustment.quantityBefore,
          adjustment.quantityAfter,
          adjustment.reason ?? null,
          adjustment.performedByUserId,
          adjustment.performedByEmail,
          adjustment.referenceId ?? null,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to record adjustment");
      return rowToAdjustment(row);
    },

    async listAdjustments(
      clinicId: string,
      options?: { limit?: number },
    ): Promise<InventoryAdjustment[]> {
      const limit = options?.limit ?? 50;
      const { rows } = await pool.query<AdjustmentRow>(
        `SELECT * FROM inventory_adjustments
         WHERE clinic_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [clinicId, limit],
      );
      return rows.map(rowToAdjustment);
    },

    async listAdjustmentsPage(
      clinicId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<AdjustmentsPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM inventory_adjustments WHERE clinic_id = $1`,
        [clinicId],
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const { rows } = await pool.query<AdjustmentRow>(
        `SELECT * FROM inventory_adjustments
         WHERE clinic_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [clinicId, limit, offset],
      );

      return { items: rows.map(rowToAdjustment), total, limit, offset };
    },

    async getConsumptionVolume(
      clinicId: string,
      options: { type: AdjustmentType; since: Date },
    ): Promise<Map<string, number>> {
      type ConsumptionRow = { master_catalog_item_id: string; total_consumed: string };

      const { rows } = await pool.query<ConsumptionRow>(
        `SELECT master_catalog_item_id,
                SUM(ABS(quantity_delta))::text AS total_consumed
         FROM inventory_adjustments
         WHERE clinic_id       = $1
           AND adjustment_type = $2
           AND created_at      >= $3
         GROUP BY master_catalog_item_id`,
        [clinicId, options.type, options.since],
      );

      const result = new Map<string, number>();
      for (const row of rows) {
        result.set(row.master_catalog_item_id, parseFloat(row.total_consumed));
      }
      return result;
    },

    async findOrCreateDraftPo(
      clinicId: string,
      createdByUserId: string,
    ): Promise<DraftPurchaseOrder> {
      // Check for an existing open draft first.
      const { rows: existing } = await pool.query<DraftPoRow>(
        `SELECT * FROM draft_purchase_orders
         WHERE clinic_id = $1 AND status = 'draft'
         ORDER BY created_at DESC
         LIMIT 1`,
        [clinicId],
      );

      if (existing[0]) return rowToDraftPo(existing[0]);

      const { rows } = await pool.query<DraftPoRow>(
        `INSERT INTO draft_purchase_orders (clinic_id, status, created_by_user_id)
         VALUES ($1, 'draft', $2)
         RETURNING *`,
        [clinicId, createdByUserId],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create draft purchase order");
      return rowToDraftPo(row);
    },

    async addDraftPoLine(
      line: Omit<DraftPoLine, "id" | "createdAt">,
    ): Promise<DraftPoLine> {
      const { rows } = await pool.query<DraftPoLineRow>(
        `INSERT INTO draft_po_lines
           (draft_purchase_order_id, master_catalog_item_id,
            clinic_inventory_item_id, quantity, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          line.draftPurchaseOrderId,
          line.masterCatalogItemId,
          line.clinicInventoryItemId,
          line.quantity,
          line.reason,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to add draft PO line");
      return rowToDraftPoLine(row);
    },

    async listDraftPoLines(clinicId: string): Promise<DraftPoLine[]> {
      const { rows } = await pool.query<DraftPoLineRow>(
        `SELECT dpl.*
         FROM draft_po_lines dpl
         JOIN draft_purchase_orders dpo ON dpo.id = dpl.draft_purchase_order_id
         WHERE dpo.clinic_id = $1
         ORDER BY dpl.created_at DESC`,
        [clinicId],
      );
      return rows.map(rowToDraftPoLine);
    },

    async listPurchaseOrders(clinicId: string): Promise<DraftPurchaseOrder[]> {
      const { rows } = await pool.query<DraftPoRow>(
        `SELECT * FROM draft_purchase_orders
         WHERE clinic_id = $1
         ORDER BY created_at DESC`,
        [clinicId],
      );
      return rows.map(rowToDraftPo);
    },

    async findPurchaseOrderById(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder | null> {
      const { rows } = await pool.query<DraftPoRow>(
        `SELECT * FROM draft_purchase_orders
         WHERE clinic_id = $1 AND id = $2 LIMIT 1`,
        [clinicId, poId],
      );
      return rows[0] ? rowToDraftPo(rows[0]) : null;
    },

    async submitPurchaseOrder(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder> {
      const { rows } = await pool.query<DraftPoRow>(
        `UPDATE draft_purchase_orders
         SET status = 'submitted', updated_at = now()
         WHERE clinic_id = $1 AND id = $2 AND status = 'draft'
         RETURNING *`,
        [clinicId, poId],
      );

      if (!rows[0]) {
        // Distinguish not-found from already-submitted.
        const { rows: existing } = await pool.query<DraftPoRow>(
          `SELECT * FROM draft_purchase_orders WHERE clinic_id = $1 AND id = $2 LIMIT 1`,
          [clinicId, poId],
        );
        if (!existing[0]) {
          throw new PoNotFoundError(poId);
        }
        throw new PoAlreadySubmittedError();
      }

      return rowToDraftPo(rows[0]);
    },

    async createClinicInventoryItem(
      item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">,
    ): Promise<ClinicInventoryItem> {
      const { rows } = await pool.query<ClinicInventoryRow>(
        `INSERT INTO clinic_inventory_items
           (clinic_id, master_catalog_item_id, quantity_on_hand,
            reorder_point, unit_cost_override_cents, supplier_preference)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          item.clinicId,
          item.masterCatalogItemId,
          item.quantityOnHand,
          item.reorderPoint,
          item.unitCostOverrideCents ?? null,
          item.supplierPreference ?? null,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create clinic inventory item");
      return rowToClinicInventoryItem(row);
    },

    async createProductSupplier(
      productSupplier: Omit<ProductSupplier, "id" | "createdAt" | "updatedAt">,
    ): Promise<ProductSupplier> {
      if (productSupplier.isPreferred && productSupplier.active) {
        await pool.query(
          `UPDATE product_suppliers
           SET is_preferred = false, updated_at = now()
           WHERE clinic_id = $1
             AND product_id = $2
             AND active = true`,
          [productSupplier.clinicId, productSupplier.productId],
        );
      }

      const { rows } = await pool.query<ProductSupplierRow>(
        `INSERT INTO product_suppliers
           (clinic_id, product_id, supplier_id, supplier_sku, supplier_barcode,
            unit_cost_cents, pack_size, is_preferred, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
           product_suppliers.*,
           (SELECT supplier_name FROM suppliers WHERE suppliers.id = product_suppliers.supplier_id)
             AS supplier_name`,
        [
          productSupplier.clinicId,
          productSupplier.productId,
          productSupplier.supplierId,
          productSupplier.supplierSku,
          productSupplier.supplierBarcode,
          productSupplier.unitCostCents,
          productSupplier.packSize,
          productSupplier.isPreferred,
          productSupplier.active,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create product supplier");
      return rowToProductSupplier(row);
    },
  };
}
