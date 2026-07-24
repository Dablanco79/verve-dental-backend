/**
 * receivingEngine.ts
 *
 * Shared transactional inventory-receiving logic used by both
 * Workflow 1.0 (supplier-invoice receiving) and Workflow 1.1 (PO receiving).
 *
 * Responsibilities of this module
 * ─────────────────────────────────
 * ✓ Receiving-unit → stock-unit conversion (authoritative calculation)
 * ✓ Inventory-row locking (SELECT … FOR UPDATE)
 * ✓ Inventory quantity mutation (UPDATE clinic_inventory_items)
 * ✓ Inventory-adjustment creation (INSERT inventory_adjustments)
 * ✓ Common quantity validation
 * ✓ Common adjustment metadata
 *
 * Responsibilities of the callers (invoice / PO service)
 * ───────────────────────────────────────────────────────
 * ✗ Source lifecycle (invoice status, PO status)
 * ✗ Source-row locking (invoice lock, PO lock)
 * ✗ Source-specific received quantities (PO line received_quantity)
 * ✗ Source-specific audit events
 *
 * Transaction model
 * ──────────────────
 * Both exported functions accept a live PoolClient from an existing
 * withTenantContext call.  They execute within that transaction —
 * no new transaction is opened.  If either function throws, the caller's
 * transaction is rolled back automatically.
 */

import type { PoolClient } from "pg";
import { AppError } from "../types/errors.js";
import type { InventoryAdjustment } from "../types/inventory.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Input for one inventory receiving line, expressed in the receiving/ordering unit.
 *
 * conversionFactor  — caller-supplied; must be a positive integer.
 *   • For PO receiving: the value returned by lookupConversionFactor().
 *   • For invoice receiving: pass 1 (invoices report in stock units).
 *
 * stockQtyDelta = quantityDeltaInReceivingUnits * conversionFactor
 */
export type ReceiveInventoryLineInput = {
  clinicInventoryItemId: string;
  /** Quantity being received, expressed in the receiving/ordering unit. */
  quantityDeltaInReceivingUnits: number;
  /**
   * Conversion factor: how many stock units equal one receiving unit.
   * Must be a positive integer (≥ 1).
   * Pass 1 when the receiving unit equals the stock unit.
   */
  conversionFactor: number;
  reason: string;
  performedByUserId: string;
  performedByEmail: string;
  /** The source document ID (invoiceId or poId). */
  referenceId: string;
};

export type ConversionResolution = {
  conversionFactor: number;
  stockUnit: string;
  catalogReceivingUnit: string;
};

// ─── Local row types (private) ───────────────────────────────────────────────

type ItemRow = {
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

type AdjRow = {
  id: string;
  clinic_id: string;
  clinic_inventory_item_id: string;
  master_catalog_item_id: string;
  adjustment_type: string;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  reason: string | null;
  performed_by_user_id: string;
  performed_by_email: string;
  reference_id: string | null;
  created_at: Date;
};

type MasterRow = {
  stock_unit: string;
  receiving_unit: string;
  units_per_receiving_unit: number | null;
};

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Look up the authoritative conversion factor for a master-catalog item.
 *
 * Logic:
 *   1. Fetch stock_unit, receiving_unit, units_per_receiving_unit from master_catalog_items.
 *   2. If lineReceivingUnit is provided:
 *        - If it equals stock_unit  → 1:1 conversion (factor = 1).
 *        - If it equals catalog's receiving_unit → factor = units_per_receiving_unit.
 *        - Otherwise → AppError 422 UNIT_MISMATCH.
 *   3. If lineReceivingUnit is null → use catalog default (units_per_receiving_unit).
 *   4. If units_per_receiving_unit is invalid (null / ≤ 0) → AppError 422.
 *
 * Must be called within a withTenantContext transaction (uses the passed client).
 */
export async function lookupConversionFactor(
  client: PoolClient,
  masterCatalogItemId: string,
  lineReceivingUnit: string | null,
): Promise<ConversionResolution> {
  const { rows } = await client.query<MasterRow>(
    `SELECT stock_unit, receiving_unit, units_per_receiving_unit
     FROM master_catalog_items
     WHERE id = $1`,
    [masterCatalogItemId],
  );

  const row = rows[0];
  if (!row) {
    throw new AppError(
      404,
      "CATALOG_ITEM_NOT_FOUND",
      `Master catalog item not found: ${masterCatalogItemId}`,
    );
  }

  const catalogStockUnit = row.stock_unit;
  const catalogReceivingUnit = row.receiving_unit;
  const catalogFactor = row.units_per_receiving_unit;

  // Determine which unit the PO line is ordering in.
  const effectiveReceivingUnit = lineReceivingUnit ?? catalogReceivingUnit;

  let conversionFactor: number;

  if (effectiveReceivingUnit === catalogStockUnit) {
    // 1:1 — receiving unit equals stock unit (e.g. both "unit").
    conversionFactor = 1;
  } else if (effectiveReceivingUnit === catalogReceivingUnit) {
    // Use the catalog's authoritative conversion factor.
    if (catalogFactor === null || catalogFactor <= 0 || !Number.isInteger(catalogFactor)) {
      throw new AppError(
        422,
        "INVALID_CONVERSION_FACTOR",
        `Master catalog item ${masterCatalogItemId} has an invalid units_per_receiving_unit (${String(catalogFactor)}). Update the catalog item before receiving.`,
      );
    }
    conversionFactor = catalogFactor;
  } else {
    throw new AppError(
      422,
      "UNIT_MISMATCH",
      `PO line receiving unit '${effectiveReceivingUnit}' does not match catalog stock unit '${catalogStockUnit}' or receiving unit '${catalogReceivingUnit}' for item ${masterCatalogItemId}.`,
    );
  }

  return { conversionFactor, stockUnit: catalogStockUnit, catalogReceivingUnit };
}

/**
 * Apply one inventory receiving line within an existing transaction.
 *
 * Steps:
 *   1. Lock the clinic_inventory_items row FOR UPDATE.
 *   2. Compute stockQtyDelta = quantityDeltaInReceivingUnits * conversionFactor.
 *   3. UPDATE clinic_inventory_items.quantity_on_hand.
 *   4. INSERT into inventory_adjustments (quantity_delta is in stock units).
 *   5. Return the InventoryAdjustment record.
 *
 * Throws if the inventory item is not found (404 INVENTORY_ITEM_NOT_FOUND).
 * Throws if conversionFactor is invalid (422 INVALID_CONVERSION_FACTOR).
 */
export async function receiveInventoryLine(
  client: PoolClient,
  clinicId: string,
  line: ReceiveInventoryLineInput,
): Promise<InventoryAdjustment> {
  if (!Number.isInteger(line.conversionFactor) || line.conversionFactor <= 0) {
    throw new AppError(
      422,
      "INVALID_CONVERSION_FACTOR",
      `conversionFactor must be a positive integer, got ${String(line.conversionFactor)}`,
    );
  }

  // Lock the inventory row (prevents concurrent QoH drift).
  const { rows: itemRows } = await client.query<ItemRow>(
    `SELECT id, clinic_id, master_catalog_item_id, quantity_on_hand,
            reorder_point, unit_cost_override_cents, supplier_preference,
            created_at, updated_at
     FROM clinic_inventory_items
     WHERE id = $1 AND clinic_id = $2
     FOR UPDATE`,
    [line.clinicInventoryItemId, clinicId],
  );

  const item = itemRows[0];
  if (!item) {
    throw new AppError(
      404,
      "INVENTORY_ITEM_NOT_FOUND",
      `Inventory item not found: ${line.clinicInventoryItemId}`,
    );
  }

  // Convert from receiving units → stock units.
  const stockQtyDelta = line.quantityDeltaInReceivingUnits * line.conversionFactor;
  const quantityBefore = item.quantity_on_hand;
  const quantityAfter = quantityBefore + stockQtyDelta;

  // Mutate inventory quantity.
  await client.query(
    `UPDATE clinic_inventory_items
     SET quantity_on_hand = $1, updated_at = now()
     WHERE id = $2 AND clinic_id = $3`,
    [quantityAfter, line.clinicInventoryItemId, clinicId],
  );

  // Record adjustment (quantity_delta is in stock units).
  // masterCatalogItemId is sourced from the locked row — not from caller input —
  // so it is always authoritative.
  const { rows: adjRows } = await client.query<AdjRow>(
    `INSERT INTO inventory_adjustments
       (clinic_id, clinic_inventory_item_id, master_catalog_item_id,
        adjustment_type, quantity_delta, quantity_before, quantity_after,
        reason, performed_by_user_id, performed_by_email, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      clinicId,
      line.clinicInventoryItemId,
      item.master_catalog_item_id,
      "receive",
      stockQtyDelta,
      quantityBefore,
      quantityAfter,
      line.reason,
      line.performedByUserId,
      line.performedByEmail,
      line.referenceId,
    ],
  );

  const adjRow = adjRows[0];
  if (!adjRow) {
    throw new AppError(500, "INTERNAL_ERROR", "Failed to record inventory adjustment");
  }

  return {
    id: adjRow.id,
    clinicId: adjRow.clinic_id,
    clinicInventoryItemId: adjRow.clinic_inventory_item_id,
    masterCatalogItemId: adjRow.master_catalog_item_id,
    adjustmentType: "receive",
    quantityDelta: adjRow.quantity_delta,
    quantityBefore: adjRow.quantity_before,
    quantityAfter: adjRow.quantity_after,
    reason: adjRow.reason,
    performedByUserId: adjRow.performed_by_user_id,
    performedByEmail: adjRow.performed_by_email,
    referenceId: adjRow.reference_id,
    createdAt: adjRow.created_at,
  };
}

/**
 * In-memory equivalent of lookupConversionFactor.
 *
 * Uses a CatalogRepository (not a PoolClient) — for the in-memory test path
 * and unit tests that run without a database.
 */
export function resolveConversionFactorFromCatalogItem(
  item: {
    stockUnit: string;
    receivingUnit: string;
    unitsPerReceivingUnit: number;
  },
  lineReceivingUnit: string | null,
): ConversionResolution {
  const effectiveReceivingUnit = lineReceivingUnit ?? item.receivingUnit;

  if (effectiveReceivingUnit === item.stockUnit) {
    return {
      conversionFactor: 1,
      stockUnit: item.stockUnit,
      catalogReceivingUnit: item.receivingUnit,
    };
  }

  if (effectiveReceivingUnit === item.receivingUnit) {
    if (!Number.isInteger(item.unitsPerReceivingUnit) || item.unitsPerReceivingUnit <= 0) {
      throw new AppError(
        422,
        "INVALID_CONVERSION_FACTOR",
        `Catalog item has invalid unitsPerReceivingUnit: ${String(item.unitsPerReceivingUnit)}`,
      );
    }
    return {
      conversionFactor: item.unitsPerReceivingUnit,
      stockUnit: item.stockUnit,
      catalogReceivingUnit: item.receivingUnit,
    };
  }

  throw new AppError(
    422,
    "UNIT_MISMATCH",
    `Line receiving unit '${effectiveReceivingUnit}' does not match catalog stock unit '${item.stockUnit}' or receiving unit '${item.receivingUnit}'.`,
  );
}
