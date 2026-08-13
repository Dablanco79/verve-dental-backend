/**
 * Pilot Reset Repository — PostgreSQL implementation.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Every destructive query MUST include WHERE clinic_id = $targetClinicId
 *   or an equivalent JOIN predicate.  The clinic_id predicate is the primary
 *   safety boundary for all destructive operations.
 * • Execute methods accept a PoolClient so they run inside the caller's
 *   explicit transaction (BEGIN / COMMIT / ROLLBACK managed by the service).
 * • Preview methods are read-only COUNT queries; they run outside a
 *   transaction for speed (no writes occur).
 * • inventory_adjustments are PRESERVED: FORCE RLS (append-only) blocks
 *   DELETE even for the owner_admin role.  clinic_inventory_items that ARE
 *   referenced by inventory_adjustments are soft-zeroed (quantities → 0)
 *   rather than hard-deleted.
 */

import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type {
  ActiveBlocker,
  PilotResetClinic,
  PilotResetDeleteCounts,
  PilotResetMode,
  PostResetCheck,
} from "../types/pilotReset.js";
import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "./userRepository.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PilotResetRepository = {
  /** Resolves a clinic by ID.  Returns null when not found. */
  findClinicById(clinicId: string): Promise<PilotResetClinic | null>;

  /** Returns all active process blockers for the target clinic. */
  checkActiveBlockers(clinicId: string): Promise<ActiveBlocker[]>;

  /** COUNT-only preview — no deletes performed. */
  getPreviewCounts(
    clinicId: string,
    mode: PilotResetMode,
  ): Promise<PilotResetDeleteCounts>;

  /** Count of globally orphaned master products that WOULD result from a Full Pilot Reset. */
  getOrphanMasterProductCandidates(clinicId: string): Promise<number>;

  /**
   * Runs all Operational Reset deletes within the provided client transaction.
   * Returns the actual row counts deleted.
   */
  executeOperationalReset(
    client: PoolClient,
    clinicId: string,
  ): Promise<PilotResetDeleteCounts>;

  /**
   * Runs Full Pilot Reset deletes (Operational + clinic config) within the
   * provided client transaction.  Returns actual row counts.
   */
  executeFullPilotReset(
    client: PoolClient,
    clinicId: string,
  ): Promise<PilotResetDeleteCounts>;

  /** Post-reset validation checks run after COMMIT. */
  verifyPostReset(
    pool: DatabasePool,
    clinicId: string,
    mode: PilotResetMode,
    auditEventId: string,
  ): Promise<PostResetCheck[]>;
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function rowCount(result: { rowCount: number | null }): number {
  return result.rowCount ?? 0;
}

// ─── Operational Reset deletes (shared by both modes) ────────────────────────

async function deleteOperationalRecords(
  client: PoolClient,
  clinicId: string,
): Promise<Omit<PilotResetDeleteCounts,
  | "productSuppliers"
  | "supplierContractPrices"
  | "supplierContracts"
  | "procurementPolicies"
  | "supplierRelationships"
  | "clinicInventoryItemsDeleted"
  | "clinicInventoryItemsSoftZeroed"
  | "draftPurchaseOrdersOperational"
  | "draftPurchaseOrdersEmpty"
  | "draftPoLinesActive"
  | "draftPoLinesHistorical"
>> {
  // 1. PO lines (no clinic_id; scoped via parent PO)
  const poLines = await client.query(
    `DELETE FROM draft_po_lines
     WHERE draft_purchase_order_id IN (
       SELECT id FROM draft_purchase_orders WHERE clinic_id = $1
     )`,
    [clinicId],
  );

  // 2. Draft purchase orders
  const draftPos = await client.query(
    `DELETE FROM draft_purchase_orders WHERE clinic_id = $1`,
    [clinicId],
  );

  // 3. Purchasing drafts (AFTER POs so no RESTRICT violation from PO → PD SET NULL)
  const purchasingDrafts = await client.query(
    `DELETE FROM purchasing_drafts WHERE clinic_id = $1`,
    [clinicId],
  );

  // 4. Stocktake lines (clinic_id column exists directly)
  const stocktakeLines = await client.query(
    `DELETE FROM stocktake_lines WHERE clinic_id = $1`,
    [clinicId],
  );

  // 5. Stocktake sessions
  const stocktakeSessions = await client.query(
    `DELETE FROM stocktake_sessions WHERE clinic_id = $1`,
    [clinicId],
  );

  // 6. Supplier price history linked to this clinic's invoices
  //    (global table, no clinic_id — scoped via source_reference_id → invoice)
  const supplierPriceHistory = await client.query(
    `DELETE FROM supplier_price_history
     WHERE source_reference_id IN (
       SELECT id FROM supplier_invoices WHERE clinic_id = $1
     )`,
    [clinicId],
  );

  // 7. Supplier invoice lines (clinic_id exists directly; CASCADE from invoice
  //    would handle this but explicit delete gives auditable counts)
  const invoiceLines = await client.query(
    `DELETE FROM supplier_invoice_lines WHERE clinic_id = $1`,
    [clinicId],
  );

  // 8. Supplier invoices
  const invoices = await client.query(
    `DELETE FROM supplier_invoices WHERE clinic_id = $1`,
    [clinicId],
  );

  return {
    draftPoLines: rowCount(poLines),
    draftPurchaseOrders: rowCount(draftPos),
    purchasingDrafts: rowCount(purchasingDrafts),
    stocktakeLines: rowCount(stocktakeLines),
    stocktakeSessions: rowCount(stocktakeSessions),
    supplierPriceHistory: rowCount(supplierPriceHistory),
    supplierInvoiceLines: rowCount(invoiceLines),
    supplierInvoices: rowCount(invoices),
  };
}

// ─── Postgres implementation ──────────────────────────────────────────────────

export function createPostgresPilotResetRepository(
  pool: DatabasePool,
): PilotResetRepository {
  return {
    async findClinicById(clinicId: string): Promise<PilotResetClinic | null> {
      const result = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM clinics WHERE id = $1`,
        [clinicId],
      );
      return result.rows[0] ?? null;
    },

    async checkActiveBlockers(clinicId: string): Promise<ActiveBlocker[]> {
      const blockers: ActiveBlocker[] = [];

      // Active / in-progress OCR processing
      const ocrResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM supplier_invoices
         WHERE clinic_id = $1
           AND status IN ('uploaded', 'processing')`,
        [clinicId],
      );
      const ocrCount = parseInt(ocrResult.rows[0]?.count ?? "0", 10);
      if (ocrCount > 0) {
        blockers.push({
          type: "active_ocr_processing",
          message: `${String(ocrCount)} supplier invoice(s) are currently being processed by OCR. Wait for processing to complete before resetting.`,
        });
      }

      // In-progress stocktake
      const stocktakeResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM stocktake_sessions
         WHERE clinic_id = $1
           AND status = 'in_progress'`,
        [clinicId],
      );
      const stocktakeCount = parseInt(stocktakeResult.rows[0]?.count ?? "0", 10);
      if (stocktakeCount > 0) {
        blockers.push({
          type: "active_stocktake",
          message: `${String(stocktakeCount)} stocktake session(s) are currently in progress. Complete or cancel them before resetting.`,
        });
      }

      return blockers;
    },

    async getPreviewCounts(
      clinicId: string,
      mode: PilotResetMode,
    ): Promise<PilotResetDeleteCounts> {
      // All queries are read-only COUNTs — run directly on the pool
      const [
        poLinesResult,
        draftPosResult,
        purchasingDraftsResult,
        stocktakeLinesResult,
        stocktakeSessionsResult,
        supplierPriceHistoryResult,
        invoiceLinesResult,
        invoicesResult,
        posWithLinesResult,
        emptyPosResult,
        activeLinesResult,
        historicalLinesResult,
      ] = await Promise.all([
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM draft_po_lines
           WHERE draft_purchase_order_id IN (
             SELECT id FROM draft_purchase_orders WHERE clinic_id = $1
           )`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM purchasing_drafts WHERE clinic_id = $1`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM stocktake_lines WHERE clinic_id = $1`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM supplier_price_history
           WHERE source_reference_id IN (
             SELECT id FROM supplier_invoices WHERE clinic_id = $1
           )`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM supplier_invoice_lines WHERE clinic_id = $1`,
          [clinicId],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
          [clinicId],
        ),
        // POs that have at least one line — visible as PO cards in the Purchase Orders UI
        pool.query<{ count: string }>(
          `SELECT COUNT(DISTINCT dpo.id)::text AS count
           FROM draft_purchase_orders dpo
           JOIN draft_po_lines dpl ON dpl.draft_purchase_order_id = dpo.id
           WHERE dpo.clinic_id = $1`,
          [clinicId],
        ),
        // POs with zero lines — invisible in the UI (built from line groupings); still deleted
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM draft_purchase_orders dpo
           WHERE dpo.clinic_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM draft_po_lines dpl
               WHERE dpl.draft_purchase_order_id = dpo.id
             )`,
          [clinicId],
        ),
        // Lines on non-cancelled, non-received POs — matches the UI's "Total Product Lines" stat
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM draft_po_lines dpl
           JOIN draft_purchase_orders dpo ON dpo.id = dpl.draft_purchase_order_id
           WHERE dpo.clinic_id = $1
             AND dpo.status NOT IN ('cancelled', 'received')`,
          [clinicId],
        ),
        // Lines on cancelled or received POs — excluded from the UI stat but still deleted
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM draft_po_lines dpl
           JOIN draft_purchase_orders dpo ON dpo.id = dpl.draft_purchase_order_id
           WHERE dpo.clinic_id = $1
             AND dpo.status IN ('cancelled', 'received')`,
          [clinicId],
        ),
      ]);

      const baseResult: PilotResetDeleteCounts = {
        draftPoLines: parseInt(poLinesResult.rows[0]?.count ?? "0", 10),
        draftPurchaseOrders: parseInt(draftPosResult.rows[0]?.count ?? "0", 10),
        draftPurchaseOrdersOperational: parseInt(posWithLinesResult.rows[0]?.count ?? "0", 10),
        draftPurchaseOrdersEmpty: parseInt(emptyPosResult.rows[0]?.count ?? "0", 10),
        draftPoLinesActive: parseInt(activeLinesResult.rows[0]?.count ?? "0", 10),
        draftPoLinesHistorical: parseInt(historicalLinesResult.rows[0]?.count ?? "0", 10),
        purchasingDrafts: parseInt(purchasingDraftsResult.rows[0]?.count ?? "0", 10),
        stocktakeLines: parseInt(stocktakeLinesResult.rows[0]?.count ?? "0", 10),
        stocktakeSessions: parseInt(stocktakeSessionsResult.rows[0]?.count ?? "0", 10),
        supplierPriceHistory: parseInt(supplierPriceHistoryResult.rows[0]?.count ?? "0", 10),
        supplierInvoiceLines: parseInt(invoiceLinesResult.rows[0]?.count ?? "0", 10),
        supplierInvoices: parseInt(invoicesResult.rows[0]?.count ?? "0", 10),
        productSuppliers: 0,
        supplierContractPrices: 0,
        supplierContracts: 0,
        procurementPolicies: 0,
        supplierRelationships: 0,
        clinicInventoryItemsDeleted: 0,
        clinicInventoryItemsSoftZeroed: 0,
      };

      if (mode === "full_pilot") {
        const [
          productSuppliersResult,
          contractPricesResult,
          contractsResult,
          policiesResult,
          relationshipsResult,
          inventoryDeleteResult,
          inventorySoftZeroResult,
        ] = await Promise.all([
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1`,
            [clinicId],
          ),
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM supplier_contract_prices
             WHERE supplier_contract_id IN (
               SELECT id FROM supplier_contracts
               WHERE supplier_relationship_id IN (
                 SELECT id FROM supplier_relationships WHERE clinic_id = $1
               )
             )`,
            [clinicId],
          ),
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM supplier_contracts
             WHERE supplier_relationship_id IN (
               SELECT id FROM supplier_relationships WHERE clinic_id = $1
             )`,
            [clinicId],
          ),
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM procurement_policies WHERE clinic_id = $1`,
            [clinicId],
          ),
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
            [clinicId],
          ),
          // clinic_inventory_items that CAN be hard-deleted (no adj references)
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM clinic_inventory_items cii
             WHERE cii.clinic_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_adjustments ia
                 WHERE ia.clinic_inventory_item_id = cii.id
               )`,
            [clinicId],
          ),
          // clinic_inventory_items that must be soft-zeroed (have adj references)
          pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM clinic_inventory_items cii
             WHERE cii.clinic_id = $1
               AND EXISTS (
                 SELECT 1 FROM inventory_adjustments ia
                 WHERE ia.clinic_inventory_item_id = cii.id
               )`,
            [clinicId],
          ),
        ]);

        baseResult.productSuppliers = parseInt(productSuppliersResult.rows[0]?.count ?? "0", 10);
        baseResult.supplierContractPrices = parseInt(contractPricesResult.rows[0]?.count ?? "0", 10);
        baseResult.supplierContracts = parseInt(contractsResult.rows[0]?.count ?? "0", 10);
        baseResult.procurementPolicies = parseInt(policiesResult.rows[0]?.count ?? "0", 10);
        baseResult.supplierRelationships = parseInt(relationshipsResult.rows[0]?.count ?? "0", 10);
        baseResult.clinicInventoryItemsDeleted = parseInt(inventoryDeleteResult.rows[0]?.count ?? "0", 10);
        baseResult.clinicInventoryItemsSoftZeroed = parseInt(inventorySoftZeroResult.rows[0]?.count ?? "0", 10);
      }

      return baseResult;
    },

    async getOrphanMasterProductCandidates(clinicId: string): Promise<number> {
      // After a Full Pilot Reset, master products ONLY referenced by this clinic
      // would be globally unreferenced. Count them as candidates (not auto-deleted).
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM master_catalog_items mci
         WHERE mci.is_active = true
           AND EXISTS (
             SELECT 1 FROM clinic_inventory_items cii
             WHERE cii.master_catalog_item_id = mci.id
               AND cii.clinic_id = $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM clinic_inventory_items cii2
             WHERE cii2.master_catalog_item_id = mci.id
               AND cii2.clinic_id != $1
           )`,
        [clinicId],
      );
      return parseInt(result.rows[0]?.count ?? "0", 10);
    },

    async executeOperationalReset(
      client: PoolClient,
      clinicId: string,
    ): Promise<PilotResetDeleteCounts> {
      const operational = await deleteOperationalRecords(client, clinicId);

      return {
        ...operational,
        // Breakdown fields are 0 in the execute response: the delete removes all rows
        // atomically, so per-category breakdowns no longer apply post-delete.
        draftPurchaseOrdersOperational: 0,
        draftPurchaseOrdersEmpty: 0,
        draftPoLinesActive: 0,
        draftPoLinesHistorical: 0,
        productSuppliers: 0,
        supplierContractPrices: 0,
        supplierContracts: 0,
        procurementPolicies: 0,
        supplierRelationships: 0,
        clinicInventoryItemsDeleted: 0,
        clinicInventoryItemsSoftZeroed: 0,
      };
    },

    async executeFullPilotReset(
      client: PoolClient,
      clinicId: string,
    ): Promise<PilotResetDeleteCounts> {
      // Phase 1: all operational records (same as operational reset)
      const operational = await deleteOperationalRecords(client, clinicId);

      // Phase 2: clinic product/supplier configuration

      // 9. product_suppliers for target clinic
      const productSuppliers = await client.query(
        `DELETE FROM product_suppliers WHERE clinic_id = $1`,
        [clinicId],
      );

      // 10. supplier_contract_prices (via contract → relationship chain)
      const contractPrices = await client.query(
        `DELETE FROM supplier_contract_prices
         WHERE supplier_contract_id IN (
           SELECT sc.id FROM supplier_contracts sc
           JOIN supplier_relationships sr ON sc.supplier_relationship_id = sr.id
           WHERE sr.clinic_id = $1
         )`,
        [clinicId],
      );

      // 11. supplier_contracts (via relationship chain)
      const contracts = await client.query(
        `DELETE FROM supplier_contracts
         WHERE supplier_relationship_id IN (
           SELECT id FROM supplier_relationships WHERE clinic_id = $1
         )`,
        [clinicId],
      );

      // 12. procurement_policies (before relationships due to RESTRICT FK)
      const policies = await client.query(
        `DELETE FROM procurement_policies WHERE clinic_id = $1`,
        [clinicId],
      );

      // 13. supplier_relationships (AFTER contracts and policies to avoid RESTRICT)
      const relationships = await client.query(
        `DELETE FROM supplier_relationships WHERE clinic_id = $1`,
        [clinicId],
      );

      // 14. clinic_inventory_items — hard delete only those NOT referenced by
      //     inventory_adjustments (which are append-only and cannot be deleted).
      const inventoryDeleted = await client.query(
        `DELETE FROM clinic_inventory_items
         WHERE clinic_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM inventory_adjustments ia
             WHERE ia.clinic_inventory_item_id = clinic_inventory_items.id
           )`,
        [clinicId],
      );

      // 15. Soft-zero clinic_inventory_items that ARE referenced by adjustments.
      //     Quantities reset to 0; configuration cleared to allow clean rebuild.
      const inventorySoftZeroed = await client.query(
        `UPDATE clinic_inventory_items
         SET quantity_on_hand          = 0,
             reorder_point             = 0,
             unit_cost_override_cents  = NULL,
             supplier_preference       = NULL,
             updated_at                = now()
         WHERE clinic_id = $1
           AND EXISTS (
             SELECT 1 FROM inventory_adjustments ia
             WHERE ia.clinic_inventory_item_id = clinic_inventory_items.id
           )`,
        [clinicId],
      );

      return {
        ...operational,
        draftPurchaseOrdersOperational: 0,
        draftPurchaseOrdersEmpty: 0,
        draftPoLinesActive: 0,
        draftPoLinesHistorical: 0,
        productSuppliers: rowCount(productSuppliers),
        supplierContractPrices: rowCount(contractPrices),
        supplierContracts: rowCount(contracts),
        procurementPolicies: rowCount(policies),
        supplierRelationships: rowCount(relationships),
        clinicInventoryItemsDeleted: rowCount(inventoryDeleted),
        clinicInventoryItemsSoftZeroed: rowCount(inventorySoftZeroed),
      };
    },

    async verifyPostReset(
      pool: DatabasePool,
      clinicId: string,
      mode: PilotResetMode,
      auditEventId: string,
    ): Promise<PostResetCheck[]> {
      const checks: PostResetCheck[] = [];

      const check = (name: string, passed: boolean, detail?: string): void => {
        checks.push({ name, passed, detail });
      };

      // 1. Clinic still exists and is active
      const clinicResult = await pool.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM clinics WHERE id = $1`,
        [clinicId],
      );
      const clinic = clinicResult.rows[0];
      check("Clinic exists", !!clinic, clinic ? undefined : "Clinic not found");
      check("Clinic is active", clinic?.is_active === true);

      // 2. No purchasing drafts
      const pdResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM purchasing_drafts WHERE clinic_id = $1`,
        [clinicId],
      );
      check("No purchasing drafts", parseInt(pdResult.rows[0]?.count ?? "0", 10) === 0);

      // 3. No draft purchase orders
      const poResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
        [clinicId],
      );
      check("No draft purchase orders", parseInt(poResult.rows[0]?.count ?? "0", 10) === 0);

      // 4. No orphan PO lines (all POs deleted → lines should be gone via cascade or explicit delete)
      const poLineResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM draft_po_lines
         WHERE draft_purchase_order_id IN (
           SELECT id FROM draft_purchase_orders WHERE clinic_id = $1
         )`,
        [clinicId],
      );
      check("No orphan PO lines", parseInt(poLineResult.rows[0]?.count ?? "0", 10) === 0);

      // 5. No supplier invoices
      const invResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
        [clinicId],
      );
      check("No supplier invoices", parseInt(invResult.rows[0]?.count ?? "0", 10) === 0);

      // 6. No stocktake sessions
      const ssResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
        [clinicId],
      );
      check("No stocktake sessions", parseInt(ssResult.rows[0]?.count ?? "0", 10) === 0);

      // 7. No orphan stocktake lines
      const slResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM stocktake_lines WHERE clinic_id = $1`,
        [clinicId],
      );
      check("No orphan stocktake lines", parseInt(slResult.rows[0]?.count ?? "0", 10) === 0);

      // 9. IN DRAFT purchasing quantity = 0
      //    Sum of line quantities for POs still in 'draft' status (should be 0 — all POs deleted).
      const inDraftResult = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(l.quantity), 0)::text AS total
         FROM draft_po_lines l
         JOIN draft_purchase_orders po ON po.id = l.draft_purchase_order_id
         WHERE po.clinic_id = $1 AND po.status = 'draft'`,
        [clinicId],
      );
      const inDraftQty = parseInt(inDraftResult.rows[0]?.total ?? "0", 10);
      check(
        "IN DRAFT purchasing quantity = 0",
        inDraftQty === 0,
        `in_draft_qty=${String(inDraftQty)}`,
      );

      // 10. ON ORDER purchasing quantity = 0
      //     Sum of line quantities for submitted POs (should be 0 — all POs deleted).
      const onOrderResult = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(l.quantity), 0)::text AS total
         FROM draft_po_lines l
         JOIN draft_purchase_orders po ON po.id = l.draft_purchase_order_id
         WHERE po.clinic_id = $1 AND po.status = 'submitted'`,
        [clinicId],
      );
      const onOrderQty = parseInt(onOrderResult.rows[0]?.total ?? "0", 10);
      check(
        "ON ORDER purchasing quantity = 0",
        onOrderQty === 0,
        `on_order_qty=${String(onOrderQty)}`,
      );

      // 11. Global master products remain
      const mpResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE is_active = true`,
      );
      const mpCount = parseInt(mpResult.rows[0]?.count ?? "0", 10);
      check("Global master products preserved", mpCount > 0, `${String(mpCount)} active master products`);

      // 12. Global suppliers remain
      const suppResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM suppliers WHERE active = true`,
      );
      const suppCount = parseInt(suppResult.rows[0]?.count ?? "0", 10);
      check("Global suppliers preserved", suppCount > 0, `${String(suppCount)} active suppliers`);

      // 13. Audit event for this reset exists
      const auditResult = await pool.query<{ id: string }>(
        `SELECT id FROM audit_events WHERE id = $1`,
        [auditEventId],
      );
      check("Audit event recorded", !!auditResult.rows[0]);

      // 14. RLS still enabled on key tables
      const rlsResult = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename IN ('supplier_invoices', 'clinic_inventory_items', 'draft_purchase_orders', 'inventory_adjustments')
           AND rowsecurity = true`,
      );
      check(
        "RLS enabled on key tables",
        rlsResult.rows.length >= 4,
        `${String(rlsResult.rows.length)}/4 key tables have RLS enabled`,
      );

      if (mode === "full_pilot") {
        // 15. No supplier relationships for clinic
        const srResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
          [clinicId],
        );
        check("No supplier relationships (full pilot)", parseInt(srResult.rows[0]?.count ?? "0", 10) === 0);

        // 16. No product_suppliers for clinic
        const psResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1`,
          [clinicId],
        );
        check("No product-supplier links (full pilot)", parseInt(psResult.rows[0]?.count ?? "0", 10) === 0);

        // 17. No procurement_policies for clinic
        const ppResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM procurement_policies WHERE clinic_id = $1`,
          [clinicId],
        );
        check("No procurement policies (full pilot)", parseInt(ppResult.rows[0]?.count ?? "0", 10) === 0);

        // 18a. No unreferenced clinic_inventory_items remain (all should be hard-deleted).
        const invUnrefResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM clinic_inventory_items
           WHERE clinic_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM inventory_adjustments ia
               WHERE ia.clinic_inventory_item_id = clinic_inventory_items.id
             )`,
          [clinicId],
        );
        check(
          "No unreferenced clinic inventory items remain (full pilot)",
          parseInt(invUnrefResult.rows[0]?.count ?? "0", 10) === 0,
        );

        // 18b. Remaining (adjustment-referenced) items are soft-zeroed — no non-zero quantities or config.
        const invNonZeroResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM clinic_inventory_items
           WHERE clinic_id = $1
             AND (
               quantity_on_hand != 0
               OR reorder_point != 0
               OR unit_cost_override_cents IS NOT NULL
               OR supplier_preference IS NOT NULL
             )`,
          [clinicId],
        );
        check(
          "Remaining clinic inventory items are soft-zeroed (full pilot)",
          parseInt(invNonZeroResult.rows[0]?.count ?? "0", 10) === 0,
        );
      }

      // 19. Other clinic sentinel — at least one other active clinic still exists,
      //     confirming the reset did not cascade across tenant boundaries.
      const sentinelResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM clinics WHERE id != $1 AND is_active = true`,
        [clinicId],
      );
      check(
        "Other clinic sentinel: at least one other active clinic exists",
        parseInt(sentinelResult.rows[0]?.count ?? "0", 10) > 0,
      );

      return checks;
    },
  };
}

// ─── In-memory implementation (tests / DATABASE_URL-less dev) ─────────────────

export function createInMemoryPilotResetRepository(): PilotResetRepository {
  const zeroCounts: PilotResetDeleteCounts = {
    draftPoLines: 0,
    draftPurchaseOrders: 0,
    draftPurchaseOrdersOperational: 0,
    draftPurchaseOrdersEmpty: 0,
    draftPoLinesActive: 0,
    draftPoLinesHistorical: 0,
    purchasingDrafts: 0,
    stocktakeLines: 0,
    stocktakeSessions: 0,
    supplierInvoices: 0,
    supplierInvoiceLines: 0,
    supplierPriceHistory: 0,
    productSuppliers: 0,
    supplierContractPrices: 0,
    supplierContracts: 0,
    procurementPolicies: 0,
    supplierRelationships: 0,
    clinicInventoryItemsDeleted: 0,
    clinicInventoryItemsSoftZeroed: 0,
  };

  return {
    findClinicById(clinicId: string): Promise<PilotResetClinic | null> {
      const seedClinics: Record<string, string> = {
        [SEED_CLINIC_A_ID]: "Verve Dental Clinic A",
        [SEED_CLINIC_B_ID]: "Verve Dental Clinic B",
      };
      const name = seedClinics[clinicId];
      if (!name) return Promise.resolve(null);
      return Promise.resolve({ id: clinicId, name });
    },

    checkActiveBlockers(): Promise<ActiveBlocker[]> {
      return Promise.resolve([]);
    },

    getPreviewCounts(): Promise<PilotResetDeleteCounts> {
      return Promise.resolve({ ...zeroCounts });
    },

    getOrphanMasterProductCandidates(): Promise<number> {
      return Promise.resolve(0);
    },

    executeOperationalReset(): Promise<PilotResetDeleteCounts> {
      return Promise.resolve({ ...zeroCounts });
    },

    executeFullPilotReset(): Promise<PilotResetDeleteCounts> {
      return Promise.resolve({ ...zeroCounts });
    },

    verifyPostReset(_pool: DatabasePool, _clinicId: string, mode: PilotResetMode): Promise<PostResetCheck[]> {
      const checks: PostResetCheck[] = [
        { name: "Clinic exists", passed: true },
        { name: "Clinic is active", passed: true },
        { name: "No purchasing drafts", passed: true },
        { name: "No draft purchase orders", passed: true },
        { name: "No orphan PO lines", passed: true },
        { name: "No supplier invoices", passed: true },
        { name: "No stocktake sessions", passed: true },
        { name: "No orphan stocktake lines", passed: true },
        { name: "IN DRAFT purchasing quantity = 0", passed: true },
        { name: "ON ORDER purchasing quantity = 0", passed: true },
        { name: "Global master products preserved", passed: true },
        { name: "Global suppliers preserved", passed: true },
        { name: "Audit event recorded", passed: true },
        { name: "RLS enabled on key tables", passed: true },
      ];
      if (mode === "full_pilot") {
        checks.push(
          { name: "No supplier relationships (full pilot)", passed: true },
          { name: "No product-supplier links (full pilot)", passed: true },
          { name: "No procurement policies (full pilot)", passed: true },
          { name: "No unreferenced clinic inventory items remain (full pilot)", passed: true },
          { name: "Remaining clinic inventory items are soft-zeroed (full pilot)", passed: true },
        );
      }
      checks.push({ name: "Other clinic sentinel: at least one other active clinic exists", passed: true });
      return Promise.resolve(checks);
    },
  };
}
