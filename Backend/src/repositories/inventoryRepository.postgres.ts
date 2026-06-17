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
 *   supplier_preference      → supplierPreference
 *   created_at / updated_at  → createdAt / updatedAt
 */

import type { DatabasePool } from "../db/pool.js";
import type {
  AdjustmentType,
  ClinicInventoryItem,
  ClinicInventoryItemView,
  DraftPoLine,
  DraftPoStatus,
  DraftPurchaseOrder,
  InventoryAdjustment,
} from "../types/inventory.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
} from "../types/purchaseOrderErrors.js";
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
    (ci.quantity_on_hand < ci.reorder_point)                         AS is_below_reorder_point
  FROM clinic_inventory_items ci
  JOIN master_catalog_items mci ON mci.id = ci.master_catalog_item_id
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
      if (!row) throw new Error(`Clinic inventory item not found: ${itemId}`);
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
      if (!row) throw new Error("Failed to record adjustment — no row returned");
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
      if (!row) throw new Error("Failed to create draft PO — no row returned");
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
      if (!row) throw new Error("Failed to add draft PO line — no row returned");
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
      if (!row) throw new Error("Failed to create clinic inventory item — no row returned");
      return rowToClinicInventoryItem(row);
    },
  };
}
