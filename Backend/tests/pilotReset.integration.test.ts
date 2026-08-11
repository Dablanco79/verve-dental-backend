/**
 * pilotReset.integration.test.ts
 *
 * Real PostgreSQL integration tests for the Pilot Reset repository.
 *
 * DATABASE_URL BEHAVIOUR
 * ─────────────────────
 * • Absent  → entire suite is skipped (safe local dev without a DB).
 * • Present → ALL tests MUST execute against the test database.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Uses TWO dedicated integration-test clinic IDs (INT_CLINIC_A_ID, INT_CLINIC_B_ID)
 *   that are NOT the seeded SEED_CLINIC_A_ID / SEED_CLINIC_B_ID.
 * • All fixtures are inserted / deleted within this file only.
 * • NEVER touches production, staging, or owner data.
 *
 * TESTS COVERED
 * ─────────────
 * Test 1 — Operational Reset:  proves Clinic A operational records deleted;
 *           Clinic B and global data unchanged.
 * Test 2 — Full Pilot Reset:   proves all Clinic A data deleted / soft-zeroed;
 *           Clinic B, global suppliers, global master products unchanged;
 *           inventory_adjustments preserved.
 * Test 3 — Transaction Rollback: forces a real PostgreSQL error mid-transaction;
 *           proves ALL Clinic A records are restored (no partial deletion).
 * Test 4 — Idempotency:        resets an already-empty clinic twice; proves no
 *           SQL errors and zero delete counts.
 * Test 5 — Global Shared Data: proves shared supplier / master product survive
 *           a full pilot reset of Clinic A while Clinic B keeps its relationships.
 *
 * BEFORE RUNNING
 * ──────────────
 * Apply migrations and seed:
 *   DATABASE_URL=<url> npm run test:db:setup --workspace=@verve/backend
 * Then run:
 *   DATABASE_URL=<url> npx jest pilotReset.integration --runInBand --workspace=@verve/backend
 */

import pg from "pg";
import { withTenantContext } from "../src/db/tenantContext.js";
import {
  createPostgresPilotResetRepository,
} from "../src/repositories/pilotResetRepository.postgres.js";
import { SEED_USER_IDS } from "../src/repositories/userRepository.js";

// ── Test gate ─────────────────────────────────────────────────────────────────

const DB_URL = process.env["DATABASE_URL"];
const SKIP = !DB_URL;

// ── Test-specific clinic IDs (NOT the main seed clinics) ──────────────────────

const INT_CLINIC_A_ID = "a9a00000-0000-4000-8000-000000000001";
const INT_CLINIC_B_ID = "a9b00000-0000-4000-8000-000000000001";

// ── Fixed fixture UUIDs ───────────────────────────────────────────────────────
//
// All UUIDs start with "a900" — visually distinct from seed data ("cccc", "dddd").
// This makes it easy to identify integration-test rows in the database.

const FX = {
  // ── Global (shared between clinics) ────────────────────────────────────────
  supplier:          "a9000000-0000-4000-8000-100000000001",
  masterProduct:     "a9000000-0000-4000-8000-100000000002",  // used by clinicInvA_base + Clinic B
  masterProduct2:    "a9000000-0000-4000-8000-100000000005",  // used by clinicInvA_noAdj (separate item)
  masterProduct3:    "a9000000-0000-4000-8000-100000000006",  // used by clinicInvA_withAdj (separate item)
  suppCatalogue:     "a9000000-0000-4000-8000-100000000003",

  // ── Clinic A — base inventory item (preserved in operational reset) ─────────
  clinicInvA_base:   "a9000000-0000-4000-8000-200000000001",

  // ── Clinic A — operational fixtures ────────────────────────────────────────
  invoiceA:          "a9000000-0000-4000-8000-200000000002",
  invoiceLineA:      "a9000000-0000-4000-8000-200000000003",
  priceHistA:        "a9000000-0000-4000-8000-200000000004",
  purchDraftA:       "a9000000-0000-4000-8000-200000000005",
  draftPoA:          "a9000000-0000-4000-8000-200000000006",
  draftPoLineA:      "a9000000-0000-4000-8000-200000000007",
  stockSessA:        "a9000000-0000-4000-8000-200000000008",
  stockLineA:        "a9000000-0000-4000-8000-200000000009",

  // ── Clinic A — full pilot specific ─────────────────────────────────────────
  clinicInvA_noAdj:  "a9000000-0000-4000-8000-300000000001", // no adjustments → hard delete
  clinicInvA_withAdj:"a9000000-0000-4000-8000-300000000002", // has adjustment → soft zero
  adjA:              "a9000000-0000-4000-8000-300000000003",
  supplRelA:         "a9000000-0000-4000-8000-300000000004",
  supplContractA:    "a9000000-0000-4000-8000-300000000005",
  supplContractPriceA:"a9000000-0000-4000-8000-300000000006",
  procPolicyA:       "a9000000-0000-4000-8000-300000000007",
  prodSuppA:         "a9000000-0000-4000-8000-300000000008",

  // ── Clinic B — sentinel fixtures ────────────────────────────────────────────
  clinicInvB:        "a9000000-0000-4000-8000-400000000001",
  invoiceB:          "a9000000-0000-4000-8000-400000000002",
  invoiceLineB:      "a9000000-0000-4000-8000-400000000003",
  supplRelB:         "a9000000-0000-4000-8000-400000000004",
} as const;

// ── Pool ──────────────────────────────────────────────────────────────────────

let pool: pg.Pool;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Runs SQL as owner_admin (bypasses RLS) for fixture setup/teardown. */
async function asOwnerAdmin<T>(
  clinicId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantContext(pool, clinicId, fn, true);
}

/** Returns the integer count of matching rows for a COUNT(*) result. */
async function countRows(query: string, params: unknown[] = []): Promise<number> {
  const res = await pool.query<{ count: string }>(query, params);
  return parseInt(res.rows[0]?.count ?? "0", 10);
}

// ── Fixture builders ──────────────────────────────────────────────────────────

/**
 * Inserts global fixtures (supplier, master product, supplier_catalogue).
 * Idempotent — uses ON CONFLICT DO NOTHING.
 */
async function insertGlobalFixtures(): Promise<void> {
  await pool.query(
    `INSERT INTO suppliers (id, supplier_name, active)
     VALUES ($1, 'Integration Test Supplier', true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.supplier],
  );
  await pool.query(
    `INSERT INTO master_catalog_items
       (id, sku, name, category, stock_unit, receiving_unit, units_per_receiving_unit,
        unit_of_measure, default_unit_cost_cents, is_active)
     VALUES ($1, 'INT-SKU-9001', 'Integration Test Product', 'PPE',
             'Box', 'Box', 1, 'box', 1000, true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.masterProduct],
  );
  // masterProduct2: used exclusively by clinicInvA_noAdj (no-adjustment → hard-delete scenario)
  await pool.query(
    `INSERT INTO master_catalog_items
       (id, sku, name, category, stock_unit, receiving_unit, units_per_receiving_unit,
        unit_of_measure, default_unit_cost_cents, is_active)
     VALUES ($1, 'INT-SKU-9002', 'Integration Test Product 2', 'PPE',
             'Box', 'Box', 1, 'box', 800, true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.masterProduct2],
  );
  // masterProduct3: used exclusively by clinicInvA_withAdj (has adjustment → soft-zero scenario)
  await pool.query(
    `INSERT INTO master_catalog_items
       (id, sku, name, category, stock_unit, receiving_unit, units_per_receiving_unit,
        unit_of_measure, default_unit_cost_cents, is_active)
     VALUES ($1, 'INT-SKU-9003', 'Integration Test Product 3', 'PPE',
             'Box', 'Box', 1, 'box', 900, true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.masterProduct3],
  );
  await pool.query(
    `INSERT INTO supplier_catalogue
       (id, supplier_id, master_catalog_item_id, supplier_sku, unit_cost_cents, active)
     VALUES ($1, $2, $3, 'SUPP-SKU-9001', 1000, true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.suppCatalogue, FX.supplier, FX.masterProduct],
  );
}

/** Inserts both integration-test clinics (idempotent). */
async function insertTestClinics(): Promise<void> {
  await pool.query(
    `INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
     VALUES
       ($1, 'Pilot Reset Integration Clinic A', 'Australia/Sydney', 'standard', true),
       ($2, 'Pilot Reset Integration Clinic B', 'Australia/Sydney', 'standard', true)
     ON CONFLICT (id) DO NOTHING`,
    [INT_CLINIC_A_ID, INT_CLINIC_B_ID],
  );
}

/**
 * Inserts Clinic A operational fixtures:
 * - supplier_invoices + lines + price_history
 * - purchasing_drafts → draft_purchase_orders → draft_po_lines
 * - stocktake_sessions → stocktake_lines
 */
async function insertClinicAOperationalFixtures(): Promise<void> {
  const userId = SEED_USER_IDS.clinicAAdmin;

  await asOwnerAdmin(INT_CLINIC_A_ID, async (c) => {
    // Base inventory item (used by draft_po_lines and stocktake_lines FKs)
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point)
       VALUES ($1, $2, $3, 20, 5)
       ON CONFLICT (id) DO NOTHING`,
      [FX.clinicInvA_base, INT_CLINIC_A_ID, FX.masterProduct],
    );

    // Supplier invoice (status 'pending_review' — avoids blocker check on 'uploaded'/'processing')
    await c.query(
      `INSERT INTO supplier_invoices
         (id, clinic_id, status, ocr_provider, original_filename, file_mime_type,
          imported_by_user_id, imported_by_email)
       VALUES ($1, $2, 'pending_review', 'test_ocr', 'inv-test.pdf', 'application/pdf', $3, 'test@integration.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceA, INT_CLINIC_A_ID, userId],
    );

    // Supplier invoice line
    await c.query(
      `INSERT INTO supplier_invoice_lines
         (id, clinic_id, supplier_invoice_id, ocr_description, quantity,
          unit_price_cents, subtotal_cents, tax_cents, total_cents)
       VALUES ($1, $2, $3, 'Integration test line', 10, 1000, 10000, 1000, 11000)
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceLineA, INT_CLINIC_A_ID, FX.invoiceA],
    );

    // Supplier price history (global table, no clinic_id — scoped via source_reference_id → invoice)
    await c.query(
      `INSERT INTO supplier_price_history
         (id, supplier_catalogue_id, supplier_id, master_catalog_item_id,
          old_unit_cost_cents, new_unit_cost_cents, source,
          source_reference_id, changed_by_user_id, changed_by_email, effective_date)
       VALUES ($1, $2, $3, $4, 1000, 1200, 'supplier_invoice_ocr', $5, $6, 'test@integration.au', '2026-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [FX.priceHistA, FX.suppCatalogue, FX.supplier, FX.masterProduct, FX.invoiceA, userId],
    );

    // Purchasing draft
    await c.query(
      `INSERT INTO purchasing_drafts (id, clinic_id, draft_reference, created_by_user_id)
       VALUES ($1, $2, 'INT-DRAFT-001', $3)
       ON CONFLICT (id) DO NOTHING`,
      [FX.purchDraftA, INT_CLINIC_A_ID, userId],
    );

    // Draft purchase order (status 'draft')
    await c.query(
      `INSERT INTO draft_purchase_orders
         (id, clinic_id, status, created_by_user_id, purchasing_draft_id)
       VALUES ($1, $2, 'draft', $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [FX.draftPoA, INT_CLINIC_A_ID, userId, FX.purchDraftA],
    );

    // Draft PO line (references base inventory item)
    await c.query(
      `INSERT INTO draft_po_lines
         (id, draft_purchase_order_id, master_catalog_item_id, clinic_inventory_item_id, quantity, reason)
       VALUES ($1, $2, $3, $4, 5, 'Integration test reorder')
       ON CONFLICT (id) DO NOTHING`,
      [FX.draftPoLineA, FX.draftPoA, FX.masterProduct, FX.clinicInvA_base],
    );

    // Stocktake session
    await c.query(
      `INSERT INTO stocktake_sessions
         (id, clinic_id, name, status, created_by_user_id, created_by_email)
       VALUES ($1, $2, 'Integration Test Stocktake', 'draft', $3, 'test@integration.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.stockSessA, INT_CLINIC_A_ID, userId],
    );

    // Stocktake line (references base inventory item; product_name/category/stock_unit required by migration 038)
    await c.query(
      `INSERT INTO stocktake_lines
         (id, session_id, clinic_id, clinic_inventory_item_id, master_catalog_item_id,
          expected_quantity, unit_cost_cents, product_name, category, stock_unit)
       VALUES ($1, $2, $3, $4, $5, 20, 1000, 'Integration Test Product', 'PPE', 'Box')
       ON CONFLICT (id) DO NOTHING`,
      [FX.stockLineA, FX.stockSessA, INT_CLINIC_A_ID, FX.clinicInvA_base, FX.masterProduct],
    );
  });
}

/**
 * Inserts Clinic A full-pilot-specific fixtures:
 * - clinic_inventory_items (one with adjustment → soft-zero, one without → hard delete)
 * - inventory_adjustment
 * - supplier_relationship → procurement_policy + supplier_contract → contract_price
 * - product_supplier
 */
async function insertClinicAFullPilotFixtures(): Promise<void> {
  const userId = SEED_USER_IDS.clinicAAdmin;

  await asOwnerAdmin(INT_CLINIC_A_ID, async (c) => {
    // Inventory item WITHOUT adjustments → will be hard-deleted in full pilot reset.
    // Uses FX.masterProduct2 to satisfy UNIQUE (clinic_id, master_catalog_item_id).
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point,
          unit_cost_override_cents, supplier_preference)
       VALUES ($1, $2, $3, 15, 3, 950, 'Integration Test Supplier')
       ON CONFLICT (id) DO NOTHING`,
      [FX.clinicInvA_noAdj, INT_CLINIC_A_ID, FX.masterProduct2],
    );

    // Inventory item WITH an adjustment → will be soft-zeroed in full pilot reset.
    // Uses FX.masterProduct3 to satisfy UNIQUE (clinic_id, master_catalog_item_id).
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point,
          unit_cost_override_cents, supplier_preference)
       VALUES ($1, $2, $3, 8, 2, 920, 'Integration Test Supplier')
       ON CONFLICT (id) DO NOTHING`,
      [FX.clinicInvA_withAdj, INT_CLINIC_A_ID, FX.masterProduct3],
    );

    // Inventory adjustment referencing the item above (makes it append-only / soft-zero candidate)
    await c.query(
      `INSERT INTO inventory_adjustments
         (id, clinic_id, clinic_inventory_item_id, master_catalog_item_id,
          adjustment_type, quantity_delta, quantity_before, quantity_after,
          performed_by_user_id, performed_by_email)
       VALUES ($1, $2, $3, $4, 'manual_adjust', 8, 0, 8, $5, 'test@integration.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.adjA, INT_CLINIC_A_ID, FX.clinicInvA_withAdj, FX.masterProduct3, userId],
    );

    // Supplier relationship (Clinic A ↔ shared supplier)
    await c.query(
      `INSERT INTO supplier_relationships (id, supplier_id, clinic_id, relationship_status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [FX.supplRelA, FX.supplier, INT_CLINIC_A_ID],
    );

    // Procurement policy (must be deleted BEFORE supplier_relationship due to RESTRICT FK)
    await c.query(
      `INSERT INTO procurement_policies
         (id, clinic_id, supplier_relationship_id, policy_name, policy_status, priority)
       VALUES ($1, $2, $3, 'Integration Test Policy', 'active', 1)
       ON CONFLICT (id) DO NOTHING`,
      [FX.procPolicyA, INT_CLINIC_A_ID, FX.supplRelA],
    );

    // Supplier contract (must be deleted BEFORE supplier_relationship due to RESTRICT FK)
    await c.query(
      `INSERT INTO supplier_contracts
         (id, supplier_relationship_id, contract_name, start_date, end_date, status, payment_terms)
       VALUES ($1, $2, 'Integration Test Contract', '2026-01-01', '2026-12-31', 'active', 'Net 30')
       ON CONFLICT (id) DO NOTHING`,
      [FX.supplContractA, FX.supplRelA],
    );

    // Contract price (must be deleted BEFORE supplier_contract due to FK)
    await c.query(
      `INSERT INTO supplier_contract_prices
         (id, supplier_contract_id, master_catalog_item_id, price_type, unit_price_cents, effective_from)
       VALUES ($1, $2, $3, 'contract', 950, '2026-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [FX.supplContractPriceA, FX.supplContractA, FX.masterProduct],
    );

    // Product supplier link
    await c.query(
      `INSERT INTO product_suppliers
         (id, clinic_id, product_id, supplier_id, is_preferred, active)
       VALUES ($1, $2, $3, $4, true, true)
       ON CONFLICT (id) DO NOTHING`,
      [FX.prodSuppA, INT_CLINIC_A_ID, FX.masterProduct, FX.supplier],
    );
  });
}

/**
 * Inserts Clinic B sentinel fixtures (must survive all Clinic A resets).
 */
async function insertClinicBFixtures(): Promise<void> {
  const userId = SEED_USER_IDS.clinicBAdmin;

  await asOwnerAdmin(INT_CLINIC_B_ID, async (c) => {
    // Clinic B inventory item (should remain after any Clinic A reset)
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point)
       VALUES ($1, $2, $3, 30, 10)
       ON CONFLICT (id) DO NOTHING`,
      [FX.clinicInvB, INT_CLINIC_B_ID, FX.masterProduct],
    );

    // Clinic B supplier invoice
    await c.query(
      `INSERT INTO supplier_invoices
         (id, clinic_id, status, ocr_provider, original_filename, file_mime_type,
          imported_by_user_id, imported_by_email)
       VALUES ($1, $2, 'pending_review', 'test_ocr', 'inv-b-test.pdf', 'application/pdf', $3, 'testb@integration.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceB, INT_CLINIC_B_ID, userId],
    );

    // Clinic B supplier invoice line
    await c.query(
      `INSERT INTO supplier_invoice_lines
         (id, clinic_id, supplier_invoice_id, ocr_description, quantity,
          unit_price_cents, subtotal_cents, tax_cents, total_cents)
       VALUES ($1, $2, $3, 'Clinic B test line', 5, 1000, 5000, 500, 5500)
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceLineB, INT_CLINIC_B_ID, FX.invoiceB],
    );

    // Clinic B supplier relationship (shared global supplier)
    await c.query(
      `INSERT INTO supplier_relationships (id, supplier_id, clinic_id, relationship_status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [FX.supplRelB, FX.supplier, INT_CLINIC_B_ID],
    );
  });
}

/**
 * Deletes all Clinic A test fixtures in safe dependency order.
 * Uses raw superuser connection — bypasses RLS for cleanup.
 */
async function cleanupClinicAFixtures(): Promise<void> {
  // Dependency order is critical: child rows must be deleted before parent rows.

  // 1. supplier_contract_prices → supplier_contracts (children first)
  await pool.query(`DELETE FROM supplier_contract_prices WHERE id = $1`, [FX.supplContractPriceA]);
  await pool.query(`DELETE FROM supplier_contracts WHERE id = $1`, [FX.supplContractA]);
  await pool.query(`DELETE FROM procurement_policies WHERE id = $1`, [FX.procPolicyA]);
  await pool.query(`DELETE FROM supplier_relationships WHERE id = $1`, [FX.supplRelA]);
  await pool.query(`DELETE FROM product_suppliers WHERE id = $1`, [FX.prodSuppA]);

  // 2. Operational: stocktake_lines before sessions
  await pool.query(`DELETE FROM stocktake_lines WHERE id = $1`, [FX.stockLineA]);
  await pool.query(`DELETE FROM stocktake_sessions WHERE id = $1`, [FX.stockSessA]);

  // 3. draft_po_lines BEFORE clinic_inventory_items
  //    (draft_po_lines.clinic_inventory_item_id REFERENCES clinic_inventory_items → RESTRICT)
  await pool.query(`DELETE FROM draft_po_lines WHERE id = $1`, [FX.draftPoLineA]);
  await pool.query(`DELETE FROM draft_purchase_orders WHERE id = $1`, [FX.draftPoA]);
  await pool.query(`DELETE FROM purchasing_drafts WHERE id = $1`, [FX.purchDraftA]);

  // 4. inventory_adjustments BEFORE clinic_inventory_items
  //    Superuser connection bypasses RLS (no FORCE RLS on inventory_adjustments).
  await pool.query(`DELETE FROM inventory_adjustments WHERE id = $1`, [FX.adjA]);

  // 5. Now safe to delete clinic_inventory_items (no FK children remain)
  await pool.query(`DELETE FROM clinic_inventory_items WHERE id IN ($1, $2, $3)`,
    [FX.clinicInvA_noAdj, FX.clinicInvA_withAdj, FX.clinicInvA_base]);

  // 6. supplier_price_history BEFORE supplier_catalogue
  //    (supplier_price_history.supplier_catalogue_id REFERENCES supplier_catalogue)
  await pool.query(`DELETE FROM supplier_price_history WHERE id = $1`, [FX.priceHistA]);

  // 7. Supplier invoice lines cascade from invoices; delete explicitly for clarity
  await pool.query(`DELETE FROM supplier_invoice_lines WHERE id = $1`, [FX.invoiceLineA]);
  await pool.query(`DELETE FROM supplier_invoices WHERE id = $1`, [FX.invoiceA]);
}

/** Deletes Clinic B sentinel fixtures. */
async function cleanupClinicBFixtures(): Promise<void> {
  await pool.query(`DELETE FROM supplier_relationships WHERE id = $1`, [FX.supplRelB]);
  await pool.query(`DELETE FROM supplier_invoice_lines WHERE id = $1`, [FX.invoiceLineB]);
  await pool.query(`DELETE FROM supplier_invoices WHERE id = $1`, [FX.invoiceB]);
  await pool.query(`DELETE FROM clinic_inventory_items WHERE id = $1`, [FX.clinicInvB]);
}

/** Deletes global fixtures. */
async function cleanupGlobalFixtures(): Promise<void> {
  await pool.query(`DELETE FROM supplier_catalogue WHERE id = $1`, [FX.suppCatalogue]);
  // master_catalog_items and suppliers have FK cascades or RESTRICT chains —
  // they are safe to delete here because all clinic-specific rows referencing them
  // were already cleaned up above.
  await pool.query(`DELETE FROM master_catalog_items WHERE id = $1`, [FX.masterProduct]);
  await pool.query(`DELETE FROM master_catalog_items WHERE id = $1`, [FX.masterProduct2]);
  await pool.query(`DELETE FROM master_catalog_items WHERE id = $1`, [FX.masterProduct3]);
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [FX.supplier]);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;

  pool = new pg.Pool({
    connectionString: DB_URL,
    connectionTimeoutMillis: 10_000,
    max: 5,
  });

  await insertTestClinics();
  await insertGlobalFixtures();
  await insertClinicBFixtures();
});

afterAll(async () => {
  if (SKIP) return;

  await cleanupClinicBFixtures().catch(() => undefined);
  await cleanupClinicAFixtures().catch(() => undefined);
  await cleanupGlobalFixtures().catch(() => undefined);

  // Remove integration test clinics
  await pool.query(
    `DELETE FROM clinics WHERE id IN ($1, $2)`,
    [INT_CLINIC_A_ID, INT_CLINIC_B_ID],
  ).catch(() => undefined);

  await pool.end().catch(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — OPERATIONAL RESET
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 1 — Operational Reset", () => {
  const repo = () => createPostgresPilotResetRepository(pool);

  beforeAll(async () => {
    if (SKIP) return;
    await insertClinicAOperationalFixtures();
    await insertClinicAFullPilotFixtures();
  });

  afterAll(async () => {
    if (SKIP) return;
    // Operational reset preserves inventory items, relationships, etc.
    // Clean up what was NOT deleted by the reset.
    await cleanupClinicAFixtures().catch(() => undefined);
  });

  it("TEST 1.A: preview counts equal rows that will be deleted", async () => {
    if (SKIP) return;

    const previewCounts = await repo().getPreviewCounts(INT_CLINIC_A_ID, "operational");

    // Verify preview matches actual fixture counts before executing reset
    const actualInvoices = await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    const actualPOs = await countRows(
      `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    const actualPDs = await countRows(
      `SELECT COUNT(*)::text AS count FROM purchasing_drafts WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    const actualStocktakes = await countRows(
      `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );

    expect(previewCounts.supplierInvoices).toBe(actualInvoices);
    expect(previewCounts.draftPurchaseOrders).toBe(actualPOs);
    expect(previewCounts.purchasingDrafts).toBe(actualPDs);
    expect(previewCounts.stocktakeSessions).toBe(actualStocktakes);
  });

  it("TEST 1.B: executes operational reset — removes Clinic A operational records", async () => {
    if (SKIP) return;

    const deletedCounts = await withTenantContext(
      pool,
      INT_CLINIC_A_ID,
      (client) => repo().executeOperationalReset(client, INT_CLINIC_A_ID),
      true,
    );

    // Supplier invoices and lines removed
    expect(deletedCounts.supplierInvoices).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.supplierInvoiceLines).toBeGreaterThanOrEqual(1);

    // Price history removed (scoped via source_reference_id → invoice for this clinic)
    expect(deletedCounts.supplierPriceHistory).toBeGreaterThanOrEqual(1);

    // POs and lines removed
    expect(deletedCounts.draftPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.draftPoLines).toBeGreaterThanOrEqual(1);

    // Purchasing drafts removed
    expect(deletedCounts.purchasingDrafts).toBeGreaterThanOrEqual(1);

    // Stocktakes removed
    expect(deletedCounts.stocktakeSessions).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.stocktakeLines).toBeGreaterThanOrEqual(1);

    // DB assertions: zero rows remain for Clinic A operational records
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_price_history WHERE source_reference_id = $1`,
      [FX.invoiceA],
    )).toBe(0);
  });

  it("TEST 1.C: clinic_inventory_items are PRESERVED after operational reset", async () => {
    if (SKIP) return;

    const invCount = await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    // base + noAdj + withAdj items were inserted; operational reset must NOT touch them
    expect(invCount).toBeGreaterThanOrEqual(3);
  });

  it("TEST 1.D: Clinic B sentinel — all Clinic B records remain unchanged", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });

  it("TEST 1.E: global suppliers and master products are preserved", async () => {
    if (SKIP) return;

    // Our specific test supplier still exists
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM suppliers WHERE id = $1`,
      [FX.supplier],
    )).toBe(1);

    // Our specific test master product still exists
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id = $1`,
      [FX.masterProduct],
    )).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — FULL PILOT RESET
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 2 — Full Pilot Reset", () => {
  const repo = () => createPostgresPilotResetRepository(pool);

  beforeAll(async () => {
    if (SKIP) return;
    await insertClinicAOperationalFixtures();
    await insertClinicAFullPilotFixtures();
  });

  afterAll(async () => {
    if (SKIP) return;
    // Full pilot reset removes almost everything for Clinic A.
    // Only adjustment-referenced inventory items remain (soft-zeroed).
    // Clean up those remaining items using superuser (bypasses RLS).
    await pool.query(`DELETE FROM inventory_adjustments WHERE id = $1`, [FX.adjA]).catch(() => undefined);
    await pool.query(`DELETE FROM clinic_inventory_items WHERE id IN ($1, $2, $3)`,
      [FX.clinicInvA_noAdj, FX.clinicInvA_withAdj, FX.clinicInvA_base]).catch(() => undefined);
  });

  it("TEST 2.A: executes full pilot reset — all Clinic A operational records removed", async () => {
    if (SKIP) return;

    const deletedCounts = await withTenantContext(
      pool,
      INT_CLINIC_A_ID,
      (client) => repo().executeFullPilotReset(client, INT_CLINIC_A_ID),
      true,
    );

    // Operational records removed
    expect(deletedCounts.supplierInvoices).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.draftPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.stocktakeSessions).toBeGreaterThanOrEqual(1);

    // Full pilot specific: relationships, contracts, policies removed
    expect(deletedCounts.supplierRelationships).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.supplierContracts).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.supplierContractPrices).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.procurementPolicies).toBeGreaterThanOrEqual(1);
    expect(deletedCounts.productSuppliers).toBeGreaterThanOrEqual(1);

    // DB assertions
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM procurement_policies WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(0);
  });

  it("TEST 2.B: unreferenced clinic_inventory_items are hard-deleted", async () => {
    if (SKIP) return;

    // clinicInvA_noAdj had no adjustment → should be gone
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE id = $1`,
      [FX.clinicInvA_noAdj],
    )).toBe(0);

    // clinicInvA_base had no adjustment → should also be gone
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE id = $1`,
      [FX.clinicInvA_base],
    )).toBe(0);
  });

  it("TEST 2.C: adjustment-referenced inventory items are soft-zeroed; adjustments preserved", async () => {
    if (SKIP) return;

    // clinicInvA_withAdj had an adjustment → must still exist but with zeroed fields
    const row = await pool.query<{
      quantity_on_hand: number;
      reorder_point: number;
      unit_cost_override_cents: number | null;
      supplier_preference: string | null;
    }>(
      `SELECT quantity_on_hand, reorder_point, unit_cost_override_cents, supplier_preference
       FROM clinic_inventory_items WHERE id = $1`,
      [FX.clinicInvA_withAdj],
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.quantity_on_hand).toBe(0);
    expect(row.rows[0]?.reorder_point).toBe(0);
    expect(row.rows[0]?.unit_cost_override_cents).toBeNull();
    expect(row.rows[0]?.supplier_preference).toBeNull();

    // Inventory adjustment record must still exist (append-only, never deleted)
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM inventory_adjustments WHERE id = $1`,
      [FX.adjA],
    )).toBe(1);
  });

  it("TEST 2.D: supplier_price_history for Clinic A invoices is removed", async () => {
    if (SKIP) return;

    // Price history row was scoped to Clinic A's invoice via source_reference_id
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_price_history WHERE id = $1`,
      [FX.priceHistA],
    )).toBe(0);
  });

  it("TEST 2.E: Clinic B records remain completely unchanged", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });

  it("TEST 2.F: global supplier and master product are preserved", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM suppliers WHERE id = $1`,
      [FX.supplier],
    )).toBe(1);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id = $1`,
      [FX.masterProduct],
    )).toBe(1);
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_catalogue WHERE id = $1`,
      [FX.suppCatalogue],
    )).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — TRANSACTION ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 3 — Transaction Rollback (no partial deletion)", () => {
  beforeAll(async () => {
    if (SKIP) return;
    await insertClinicAOperationalFixtures();
  });

  afterAll(async () => {
    if (SKIP) return;
    // Rollback restored all data — clean it up manually.
    await cleanupClinicAFixtures().catch(() => undefined);
  });

  it("TEST 3.A: rollback restores ALL Clinic A records when a PostgreSQL error occurs mid-reset", async () => {
    if (SKIP) return;

    // Count rows before the (aborted) reset attempt
    const invoicesBefore = await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    const posBefore = await countRows(
      `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );
    const stocktakesBefore = await countRows(
      `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );

    expect(invoicesBefore).toBeGreaterThanOrEqual(1);

    // Simulate a partial reset that fails halfway through:
    // Open a transaction, delete some rows, then force a PostgreSQL error,
    // which triggers ROLLBACK via withTenantContext's catch block.
    let errorWasThrown = false;
    try {
      await withTenantContext(
        pool,
        INT_CLINIC_A_ID,
        async (client) => {
          // Step 1: delete draft PO lines (first delete in operational reset)
          await client.query(
            `DELETE FROM draft_po_lines
             WHERE draft_purchase_order_id IN (
               SELECT id FROM draft_purchase_orders WHERE clinic_id = $1
             )`,
            [INT_CLINIC_A_ID],
          );

          // Step 2: delete draft purchase orders
          await client.query(
            `DELETE FROM draft_purchase_orders WHERE clinic_id = $1`,
            [INT_CLINIC_A_ID],
          );

          // Verify within the transaction that POs are gone (mid-transaction state)
          const midTxCount = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
            [INT_CLINIC_A_ID],
          );
          // Within the transaction, POs should appear deleted
          expect(parseInt(midTxCount.rows[0]?.count ?? "0", 10)).toBe(0);

          // Step 3: force a real PostgreSQL error (violate NOT NULL constraint)
          await client.query(
            `INSERT INTO suppliers (id, supplier_name) VALUES (NULL, NULL)`,
          );

          // This line should never execute — the INSERT above throws
          throw new Error("Should not reach this point");
        },
        true,
      );
    } catch {
      errorWasThrown = true;
    }

    expect(errorWasThrown).toBe(true);

    // After the ROLLBACK, ALL Clinic A records must be fully restored
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(invoicesBefore);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(posBefore);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM stocktake_sessions WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    )).toBe(stocktakesBefore);
  });

  it("TEST 3.B: Clinic B data is unaffected by the rolled-back Clinic A transaction", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — IDEMPOTENCY
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 4 — Idempotency (reset an already-empty clinic twice)", () => {
  const repo = () => createPostgresPilotResetRepository(pool);

  it("TEST 4.A: second full-pilot reset produces zero delete counts and no SQL errors", async () => {
    if (SKIP) return;

    // INT_CLINIC_A_ID is empty (all data deleted by Test 2 / Test 3 cleanup).
    // Run the full pilot reset twice.

    const firstRun = await withTenantContext(
      pool,
      INT_CLINIC_A_ID,
      (client) => repo().executeFullPilotReset(client, INT_CLINIC_A_ID),
      true,
    );

    // First run on empty clinic: all counts are 0 — no errors
    expect(firstRun.supplierInvoices).toBe(0);
    expect(firstRun.draftPurchaseOrders).toBe(0);
    expect(firstRun.stocktakeSessions).toBe(0);
    expect(firstRun.supplierRelationships).toBe(0);
    expect(firstRun.clinicInventoryItemsDeleted).toBe(0);

    const secondRun = await withTenantContext(
      pool,
      INT_CLINIC_A_ID,
      (client) => repo().executeFullPilotReset(client, INT_CLINIC_A_ID),
      true,
    );

    // Second run: still all zeros — no SQL errors on empty state
    expect(secondRun.supplierInvoices).toBe(0);
    expect(secondRun.draftPurchaseOrders).toBe(0);
    expect(secondRun.supplierRelationships).toBe(0);
  });

  it("TEST 4.B: Clinic B data unchanged after two Clinic A idempotency runs", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });

  it("TEST 4.C: global data unchanged after idempotency runs", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM suppliers WHERE id = $1`,
      [FX.supplier],
    )).toBe(1);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id = $1`,
      [FX.masterProduct],
    )).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — GLOBAL SHARED DATA (supplier / master product used by both clinics)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 5 — Global Shared Data preservation", () => {
  const repo = () => createPostgresPilotResetRepository(pool);

  beforeAll(async () => {
    if (SKIP) return;
    // Insert operational + full-pilot fixtures for Clinic A.
    // The shared global supplier (FX.supplier) and master product (FX.masterProduct)
    // are ALREADY used by Clinic B (via FX.supplRelB in beforeAll).
    await insertClinicAOperationalFixtures();
    await insertClinicAFullPilotFixtures();
  });

  afterAll(async () => {
    if (SKIP) return;
    // After full pilot reset, soft-zeroed inventory item remains — clean up.
    await pool.query(`DELETE FROM inventory_adjustments WHERE id = $1`, [FX.adjA]).catch(() => undefined);
    await pool.query(`DELETE FROM clinic_inventory_items WHERE id IN ($1, $2, $3)`,
      [FX.clinicInvA_noAdj, FX.clinicInvA_withAdj, FX.clinicInvA_base]).catch(() => undefined);
  });

  it("TEST 5.A: full pilot reset of Clinic A — shared supplier remains", async () => {
    if (SKIP) return;

    await withTenantContext(
      pool,
      INT_CLINIC_A_ID,
      (client) => repo().executeFullPilotReset(client, INT_CLINIC_A_ID),
      true,
    );

    // Shared global supplier must still exist
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM suppliers WHERE id = $1`,
      [FX.supplier],
    )).toBe(1);
  });

  it("TEST 5.B: shared master product remains after Clinic A full pilot reset", async () => {
    if (SKIP) return;

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id = $1`,
      [FX.masterProduct],
    )).toBe(1);
  });

  it("TEST 5.C: Clinic B relationship with shared supplier is preserved", async () => {
    if (SKIP) return;

    // Clinic B's supplier_relationship (using shared supplier) must still exist
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE id = $1`,
      [FX.supplRelB],
    )).toBe(1);

    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });

  it("TEST 5.D: Clinic A clinic-specific relationships are removed; Clinic B unchanged", async () => {
    if (SKIP) return;

    // Clinic A's relationship was deleted
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_relationships WHERE id = $1`,
      [FX.supplRelA],
    )).toBe(0);

    // Clinic A's procurement policy was deleted
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM procurement_policies WHERE id = $1`,
      [FX.procPolicyA],
    )).toBe(0);

    // Clinic B's invoice still exists
    expect(await countRows(
      `SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_B_ID],
    )).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — TENANT CONTEXT / CONNECTION SAFETY
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 6 — Tenant Context & Connection Safety", () => {
  it("TEST 6.A: set_config with is_local=true does not leak between transactions", async () => {
    if (SKIP) return;

    // Set clinic A context in transaction 1
    let capturedClinicId: string | null = null;
    await withTenantContext(pool, INT_CLINIC_A_ID, async (client) => {
      const res = await client.query<{ val: string }>(
        `SELECT current_setting('app.current_clinic_id', true) AS val`,
      );
      capturedClinicId = res.rows[0]?.val ?? null;
    }, true);

    expect(capturedClinicId).toBe(INT_CLINIC_A_ID);

    // After COMMIT, the same pooled connection is released.
    // A new withTenantContext call MUST NOT see the previous clinic's context
    // because set_config(..., true) = is_local=true → session var resets at transaction end.
    const outsideCtx = await pool.query<{ val: string | null }>(
      `SELECT current_setting('app.current_clinic_id', true) AS val`,
    );
    // Outside a transaction on a fresh connection, the GUC returns '' or NULL
    const outsideValue = outsideCtx.rows[0]?.val ?? "";
    expect(outsideValue).not.toBe(INT_CLINIC_A_ID);
  });

  it("TEST 6.B: withTenantContext sets correct clinic context inside the transaction", async () => {
    if (SKIP) return;

    await withTenantContext(pool, INT_CLINIC_A_ID, async (client) => {
      const res = await client.query<{ val: string }>(
        `SELECT current_setting('app.current_clinic_id', true) AS val`,
      );
      expect(res.rows[0]?.val).toBe(INT_CLINIC_A_ID);
    }, true);
  });

  it("TEST 6.C: ownerAdmin=true sets app.owner_admin_mode to true inside the transaction", async () => {
    if (SKIP) return;

    await withTenantContext(pool, INT_CLINIC_A_ID, async (client) => {
      const res = await client.query<{ val: string }>(
        `SELECT current_setting('app.owner_admin_mode', true) AS val`,
      );
      expect(res.rows[0]?.val).toBe("true");
    }, true);
  });

  it("TEST 6.D: explicit clinic predicates — queries for Clinic A do not return Clinic B rows", async () => {
    if (SKIP) return;

    // All destructive queries use WHERE clinic_id = $1.
    // Prove that querying Clinic A's invoices does not accidentally return Clinic B rows.
    const result = await pool.query<{ clinic_id: string }>(
      `SELECT clinic_id FROM supplier_invoices WHERE clinic_id = $1`,
      [INT_CLINIC_A_ID],
    );

    for (const row of result.rows) {
      expect(row.clinic_id).toBe(INT_CLINIC_A_ID);
      expect(row.clinic_id).not.toBe(INT_CLINIC_B_ID);
    }
  });
});
