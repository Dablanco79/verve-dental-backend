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
  PoLineNotFoundError,
  PoInvalidTransitionError,
} from "../types/purchaseOrderErrors.js";
import { PO_VALID_TRANSITIONS } from "../types/inventory.js";
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
  stock_unit?: string | null;
  receiving_unit?: string | null;
  units_per_receiving_unit?: number | null;
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
  supplier_id: string | null;
  notes: string | null;
  po_reference: string | null;
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
  unit_cost_cents: number | null;
  receiving_unit: string | null;
  received_quantity: number;
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
    stockUnit: row.stock_unit ?? row.unit_of_measure,
    receivingUnit: row.receiving_unit ?? row.unit_of_measure,
    unitsPerReceivingUnit: row.units_per_receiving_unit ?? 1,
    unitOfMeasure: row.stock_unit ?? row.unit_of_measure,
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
    supplierId: row.supplier_id,
    notes: row.notes,
    poReference: row.po_reference,
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
    unitCostCents: row.unit_cost_cents,
    receivingUnit: row.receiving_unit,
    receivedQuantity: row.received_quantity,
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
    mci.stock_unit,
    mci.receiving_unit,
    mci.units_per_receiving_unit,
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
      options?: { limit?: number; itemId?: string },
    ): Promise<InventoryAdjustment[]> {
      const limit = options?.limit ?? 50;
      const params: Array<string | number> = [clinicId];
      const itemFilter = options?.itemId
        ? ` AND clinic_inventory_item_id = $${String(params.push(options.itemId))}`
        : "";
      const limitParam = params.push(limit);
      const { rows } = await pool.query<AdjustmentRow>(
        `SELECT * FROM inventory_adjustments
         WHERE clinic_id = $1
         ${itemFilter}
         ORDER BY created_at DESC
         LIMIT $${String(limitParam)}`,
        params,
      );
      return rows.map(rowToAdjustment);
    },

    async listAdjustmentsPage(
      clinicId: string,
      options?: { limit?: number; offset?: number; itemId?: string },
    ): Promise<AdjustmentsPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const whereParams: string[] = [clinicId];
      const itemFilter = options?.itemId
        ? ` AND clinic_inventory_item_id = $${String(whereParams.push(options.itemId))}`
        : "";

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM inventory_adjustments WHERE clinic_id = $1${itemFilter}`,
        whereParams,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const dataParams: Array<string | number> = [...whereParams];
      const limitParam = dataParams.push(limit);
      const offsetParam = dataParams.push(offset);
      const { rows } = await pool.query<AdjustmentRow>(
        `SELECT * FROM inventory_adjustments
         WHERE clinic_id = $1
         ${itemFilter}
         ORDER BY created_at DESC
         LIMIT $${String(limitParam)} OFFSET $${String(offsetParam)}`,
        dataParams,
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

    async createManualPurchaseOrder(input: {
      clinicId: string;
      createdByUserId: string;
      supplierId: string | null;
      notes: string | null;
      poReference: string | null;
    }): Promise<DraftPurchaseOrder> {
      const { rows } = await pool.query<DraftPoRow>(
        `INSERT INTO draft_purchase_orders
           (clinic_id, status, created_by_user_id, supplier_id, notes, po_reference)
         VALUES ($1, 'draft', $2, $3, $4, $5)
         RETURNING *`,
        [input.clinicId, input.createdByUserId, input.supplierId, input.notes, input.poReference],
      );
      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create purchase order");
      return rowToDraftPo(row);
    },

    async updatePurchaseOrder(
      clinicId: string,
      poId: string,
      patch: { supplierId?: string | null; notes?: string | null; poReference?: string | null },
    ): Promise<DraftPurchaseOrder> {
      const sets: string[] = ["updated_at = now()"];
      const params: (string | null | number)[] = [];

      if (patch.supplierId !== undefined) {
        params.push(patch.supplierId);
        sets.push(`supplier_id = $${String(params.length)}`);
      }
      if (patch.notes !== undefined) {
        params.push(patch.notes);
        sets.push(`notes = $${String(params.length)}`);
      }
      if (patch.poReference !== undefined) {
        params.push(patch.poReference);
        sets.push(`po_reference = $${String(params.length)}`);
      }

      params.push(clinicId);
      const clinicParam = params.length;
      params.push(poId);
      const poParam = params.length;

      const { rows } = await pool.query<DraftPoRow>(
        `UPDATE draft_purchase_orders
         SET ${sets.join(", ")}
         WHERE clinic_id = $${String(clinicParam)} AND id = $${String(poParam)}
         RETURNING *`,
        params,
      );
      const row = rows[0];
      if (!row) throw new PoNotFoundError(poId);
      return rowToDraftPo(row);
    },

    async addDraftPoLine(
      line: Omit<DraftPoLine, "id" | "createdAt" | "receivedQuantity">,
    ): Promise<DraftPoLine> {
      const { rows } = await pool.query<DraftPoLineRow>(
        `INSERT INTO draft_po_lines
           (draft_purchase_order_id, master_catalog_item_id,
            clinic_inventory_item_id, quantity, reason, unit_cost_cents, receiving_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          line.draftPurchaseOrderId,
          line.masterCatalogItemId,
          line.clinicInventoryItemId,
          line.quantity,
          line.reason,
          line.unitCostCents ?? null,
          line.receivingUnit ?? null,
        ],
      );

      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to add draft PO line");
      return rowToDraftPoLine(row);
    },

    async updatePoLine(
      lineId: string,
      patch: { quantity?: number; unitCostCents?: number | null; receivingUnit?: string | null },
    ): Promise<DraftPoLine> {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.quantity !== undefined) {
        params.push(patch.quantity);
        sets.push(`quantity = $${String(params.length)}`);
      }
      if (patch.unitCostCents !== undefined) {
        params.push(patch.unitCostCents);
        sets.push(`unit_cost_cents = $${String(params.length)}`);
      }
      if (patch.receivingUnit !== undefined) {
        params.push(patch.receivingUnit);
        sets.push(`receiving_unit = $${String(params.length)}`);
      }

      if (sets.length === 0) {
        const { rows: existing } = await pool.query<DraftPoLineRow>(
          `SELECT * FROM draft_po_lines WHERE id = $1 LIMIT 1`,
          [lineId],
        );
        const row = existing[0];
        if (!row) throw new PoLineNotFoundError(lineId);
        return rowToDraftPoLine(row);
      }

      params.push(lineId);
      const { rows } = await pool.query<DraftPoLineRow>(
        `UPDATE draft_po_lines SET ${sets.join(", ")} WHERE id = $${String(params.length)} RETURNING *`,
        params,
      );
      const row = rows[0];
      if (!row) throw new PoLineNotFoundError(lineId);
      return rowToDraftPoLine(row);
    },

    async removePoLine(lineId: string): Promise<void> {
      const { rowCount } = await pool.query(
        `DELETE FROM draft_po_lines WHERE id = $1`,
        [lineId],
      );
      if (!rowCount || rowCount === 0) throw new PoLineNotFoundError(lineId);
    },

    async findPoLineById(lineId: string): Promise<DraftPoLine | null> {
      const { rows } = await pool.query<DraftPoLineRow>(
        `SELECT * FROM draft_po_lines WHERE id = $1 LIMIT 1`,
        [lineId],
      );
      return rows[0] ? rowToDraftPoLine(rows[0]) : null;
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

    async listPoLinesByPoId(poId: string): Promise<DraftPoLine[]> {
      const { rows } = await pool.query<DraftPoLineRow>(
        `SELECT * FROM draft_po_lines WHERE draft_purchase_order_id = $1 ORDER BY created_at ASC`,
        [poId],
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

    async cancelPurchaseOrder(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder> {
      const { rows: existing } = await pool.query<DraftPoRow>(
        `SELECT * FROM draft_purchase_orders WHERE clinic_id = $1 AND id = $2 LIMIT 1`,
        [clinicId, poId],
      );
      const po = existing[0];
      if (!po) throw new PoNotFoundError(poId);

      const allowed = PO_VALID_TRANSITIONS[po.status];
      if (!allowed.includes("cancelled")) {
        throw new PoInvalidTransitionError(po.status, "cancelled");
      }

      const { rows } = await pool.query<DraftPoRow>(
        `UPDATE draft_purchase_orders
         SET status = 'cancelled', updated_at = now()
         WHERE clinic_id = $1 AND id = $2
         RETURNING *`,
        [clinicId, poId],
      );
      const row = rows[0];
      if (!row) throw new PoNotFoundError(poId);
      return rowToDraftPo(row);
    },

    async transitionPoStatus(
      clinicId: string,
      poId: string,
      toStatus: import("../types/inventory.js").DraftPoStatus,
    ): Promise<DraftPurchaseOrder> {
      const { rows: existing } = await pool.query<DraftPoRow>(
        `SELECT * FROM draft_purchase_orders WHERE clinic_id = $1 AND id = $2 LIMIT 1`,
        [clinicId, poId],
      );
      const po = existing[0];
      if (!po) throw new PoNotFoundError(poId);

      const allowed = PO_VALID_TRANSITIONS[po.status];
      if (!allowed.includes(toStatus)) {
        throw new PoInvalidTransitionError(po.status, toStatus);
      }

      const { rows } = await pool.query<DraftPoRow>(
        `UPDATE draft_purchase_orders
         SET status = $1, updated_at = now()
         WHERE clinic_id = $2 AND id = $3
         RETURNING *`,
        [toStatus, clinicId, poId],
      );
      const row = rows[0];
      if (!row) throw new PoNotFoundError(poId);
      return rowToDraftPo(row);
    },

    async incrementPoLineReceivedQty(
      clinicId: string,
      lineId: string,
      delta: number,
    ): Promise<DraftPoLine> {
      // Validate via a join to ensure the line belongs to the authorised clinic.
      const { rows } = await pool.query<DraftPoLineRow>(
        `UPDATE draft_po_lines dpl
         SET received_quantity = dpl.received_quantity + $1
         FROM draft_purchase_orders dpo
         WHERE dpl.id = $2
           AND dpl.draft_purchase_order_id = dpo.id
           AND dpo.clinic_id = $3
         RETURNING dpl.*`,
        [delta, lineId, clinicId],
      );
      const row = rows[0];
      if (!row) throw new PoLineNotFoundError(lineId);
      return rowToDraftPoLine(row);
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
