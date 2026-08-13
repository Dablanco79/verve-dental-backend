/**
 * pilotResetRls.integration.test.ts
 *
 * Production-equivalent FORCE ROW LEVEL SECURITY regression tests for the
 * Pilot Reset Utility.
 *
 * WHY THESE TESTS EXIST
 * ─────────────────────
 * The original integration tests ran as a PostgreSQL SUPERUSER (embedded-postgres
 * initial user).  Superusers bypass ALL RLS — including FORCE ROW LEVEL SECURITY.
 * This masked a critical defect: getPreviewCounts() and verifyPostReset() called
 * bare pool.query() without any GUC tenant context, which on Render's managed
 * non-superuser database caused every FORCE-RLS table to return 0 rows.
 *
 * WHAT THESE TESTS PROVE
 * ──────────────────────
 * Test 1 — Regression proof: using SET LOCAL ROLE verve_app (NOSUPERUSER), FORCE
 *           RLS tables return 0 without GUC context; with app_is_owner_admin='true'
 *           they return correct counts.
 * Test 2 — Correct preview: installRlsPoolHook + runWithTenantContext(ownerAdmin=true)
 *           produces accurate getPreviewCounts() for all FORCE-RLS tables.
 * Test 3 — Preview/Execute consistency: preview counts equal actual deleted/updated
 *           row counts from executeFullPilotReset().
 * Test 4 — Other-clinic isolation: resetting Clinic A leaves Clinic B unchanged.
 * Test 5 — Global data preservation: master products, suppliers, clinics table intact.
 * Test 6 — Audit event verification: verifyPostReset() with ownerAdmin context finds
 *           the audit event (PASS); non-existent ID correctly fails.
 * Test 7 — Clinic inventory semantics: no-adj item is hard-deleted; adj item is
 *           soft-zeroed; inventory_adjustments are preserved.
 * Test 8 — Preview scoping: ownerAdmin context + WHERE clause scopes counts to the
 *           selected clinic only.
 *
 * PREREQUISITES
 * ─────────────
 * DATABASE_URL must point to a disposable test database with:
 *   • All migrations applied (npm run test:db:setup --workspace=@verve/backend)
 *   • verve_app NOSUPERUSER role created by setupTestDb.ts
 *   • Demo seed users (SEED_USER_IDS.clinicAAdmin must exist)
 *
 * Run:
 *   DATABASE_URL=<url> npx jest pilotResetRls.integration --runInBand --workspace=@verve/backend
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  withTenantContext,
  installRlsPoolHook,
  runWithTenantContext,
} from "../src/db/tenantContext.js";
import {
  createPostgresPilotResetRepository,
} from "../src/repositories/pilotResetRepository.postgres.js";
import { SEED_USER_IDS } from "../src/repositories/userRepository.js";

// ── Test gate ─────────────────────────────────────────────────────────────────

const DB_URL = process.env["DATABASE_URL"];
const SKIP = !DB_URL;

// When DATABASE_URL is absent every suite is registered as skipped (not omitted).
// Jest requires at least one test per file; omitting describe blocks entirely
// (via `if (SKIP) return` at describe level) violates that rule and causes:
// "Your test suite must contain at least one test."
// Using describe.skip registers the suites as pending — normal CI sees them as
// skipped, integration CI (with DATABASE_URL) runs them in full.
const suite = SKIP ? describe.skip : describe;

// ── Test-specific IDs — prefix "b0c0" to avoid any collision with other suites ─

const RLS_CLINIC_A_ID = "b0c00000-0000-4000-8000-000000000001";
const RLS_CLINIC_B_ID = "b0c00000-0000-4000-8000-000000000002";

const FX = {
  // Global — different SKUs from the main integration test suite
  master1:      "b0c00000-0000-4000-8000-100000000001", // used by invA_noAdj
  master2:      "b0c00000-0000-4000-8000-100000000002", // used by invA_withAdj
  masterB:      "b0c00000-0000-4000-8000-100000000003", // used by invB
  supplier:     "b0c00000-0000-4000-8000-100000000004",

  // Clinic A
  invA_noAdj:   "b0c00000-0000-4000-8000-200000000001", // no adjustment → hard-delete
  invA_withAdj: "b0c00000-0000-4000-8000-200000000002", // has adjustment → soft-zero
  adjA:         "b0c00000-0000-4000-8000-200000000003",
  purchDraftA:  "b0c00000-0000-4000-8000-200000000004",
  draftPoA:     "b0c00000-0000-4000-8000-200000000005",
  invoiceA:     "b0c00000-0000-4000-8000-200000000006",
  invoiceLineA: "b0c00000-0000-4000-8000-200000000007",
  prodSuppA:    "b0c00000-0000-4000-8000-200000000008",

  // Clinic B — sentinel records
  invB:         "b0c00000-0000-4000-8000-300000000001",
  draftPoB:     "b0c00000-0000-4000-8000-300000000002",
  purchDraftB:  "b0c00000-0000-4000-8000-300000000003",
  invoiceB:     "b0c00000-0000-4000-8000-300000000004",
  invoiceLineB: "b0c00000-0000-4000-8000-300000000005",
  prodSuppB:    "b0c00000-0000-4000-8000-300000000006",

  actor: SEED_USER_IDS.clinicAAdmin,
} as const;

// ── Pool + repo ────────────────────────────────────────────────────────────────

let pool: pg.Pool;
let repo: ReturnType<typeof createPostgresPilotResetRepository>;
let hookInstalled = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Runs a callback inside a withTenantContext(ownerAdmin=true) transaction.
 *  Used for fixture setup — bypasses RLS WITH CHECK policies. */
async function asOwnerAdmin<T>(
  clinicId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantContext(
    pool,
    clinicId,
    fn,
    true,
  );
}

/** Direct COUNT via superuser pool (no RLS filter — for verifying real DB state). */
async function countDirect(sql: string, params: unknown[] = []): Promise<number> {
  const res = await pool.query<{ count: string }>(sql, params);
  return parseInt(res.rows[0]?.count ?? "0", 10);
}

/**
 * Runs a COUNT query as verve_app (NOSUPERUSER role).
 * FORCE ROW LEVEL SECURITY is fully enforced.
 *
 * @param gucContext  Optional GUC values to inject before the COUNT.
 *                    Providing { ownerAdmin: true } simulates owner-admin context.
 */
async function countAsVerveApp(
  sql: string,
  params: unknown[],
  gucContext?: { ownerAdmin?: boolean; clinicId?: string },
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE verve_app");
    if (gucContext?.ownerAdmin) {
      await client.query(`SELECT set_config('app.owner_admin_mode', 'true', true)`);
    }
    if (gucContext?.clinicId) {
      await client.query(`SELECT set_config('app.current_clinic_id', $1, true)`, [gucContext.clinicId]);
    }
    const res = await client.query<{ count: string }>(sql, params);
    const count = parseInt(res.rows[0]?.count ?? "0", 10);
    await client.query("ROLLBACK");
    return count;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Installs installRlsPoolHook exactly once on the test pool. */
function ensureHookInstalled(): void {
  if (!hookInstalled) {
    installRlsPoolHook(pool);
    hookInstalled = true;
  }
}

/**
 * Calls getPreviewCounts with owner-admin context established via
 * installRlsPoolHook + runWithTenantContext.
 *
 * This is the same mechanism that the fixed rlsTenantContextMiddleware
 * now applies to every /admin/pilot-reset request.
 */
async function previewAsOwnerAdmin(
  clinicId: string,
  mode: "operational" | "full_pilot",
): Promise<import("../src/types/pilotReset.js").PilotResetDeleteCounts> {
  ensureHookInstalled();
  return runWithTenantContext(
    RLS_CLINIC_A_ID, // homeClinicId value — irrelevant since ownerAdmin bypasses RLS clinic filter
    true,
    () => repo.getPreviewCounts(clinicId, mode),
  );
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function insertClinics(): Promise<void> {
  await pool.query(
    `INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
     VALUES
       ($1, 'RLS Test Clinic A', 'Australia/Sydney', 'standard', true),
       ($2, 'RLS Test Clinic B', 'Australia/Sydney', 'standard', true)
     ON CONFLICT (id) DO NOTHING`,
    [RLS_CLINIC_A_ID, RLS_CLINIC_B_ID],
  );
}

async function insertGlobalFixtures(): Promise<void> {
  await pool.query(
    `INSERT INTO suppliers (id, supplier_name, active)
     VALUES ($1, 'RLS Test Supplier', true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.supplier],
  );

  await pool.query(
    `INSERT INTO master_catalog_items
       (id, sku, name, category, stock_unit, receiving_unit, units_per_receiving_unit,
        unit_of_measure, default_unit_cost_cents, is_active)
     VALUES
       ($1, 'RLS-SKU-9001', 'RLS Product One',   'PPE', 'Box', 'Box', 1, 'box', 1000, true),
       ($2, 'RLS-SKU-9002', 'RLS Product Two',   'PPE', 'Box', 'Box', 1, 'box', 2000, true),
       ($3, 'RLS-SKU-9003', 'RLS Product Three', 'PPE', 'Box', 'Box', 1, 'box', 1500, true)
     ON CONFLICT (id) DO NOTHING`,
    [FX.master1, FX.master2, FX.masterB],
  );
}

/** Inserts Clinic A's full-pilot fixtures.  Safe to call repeatedly (ON CONFLICT DO NOTHING). */
async function insertClinicAFixtures(): Promise<void> {
  await asOwnerAdmin(RLS_CLINIC_A_ID, async (c) => {
    // clinic_inventory_items (FORCE RLS) — two items to test hard-delete vs soft-zero
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point,
          unit_cost_override_cents, supplier_preference)
       VALUES ($1, $2, $3, 15, 3, 950, 'RLS Supplier')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invA_noAdj, RLS_CLINIC_A_ID, FX.master1],
    );
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point,
          unit_cost_override_cents, supplier_preference)
       VALUES ($1, $2, $3, 8, 2, 1200, 'RLS Pref Supplier')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invA_withAdj, RLS_CLINIC_A_ID, FX.master2],
    );

    // inventory_adjustments (FORCE RLS, append-only) — makes invA_withAdj a soft-zero candidate
    await c.query(
      `INSERT INTO inventory_adjustments
         (id, clinic_id, clinic_inventory_item_id, master_catalog_item_id,
          adjustment_type, quantity_delta, quantity_before, quantity_after,
          performed_by_user_id, performed_by_email)
       VALUES ($1, $2, $3, $4, 'manual_adjust', 8, 0, 8, $5, 'rls-test@verve.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.adjA, RLS_CLINIC_A_ID, FX.invA_withAdj, FX.master2, FX.actor],
    );

    // purchasing_drafts (ENABLE RLS only) — must be inserted before draft_purchase_orders
    await c.query(
      `INSERT INTO purchasing_drafts (id, clinic_id, draft_reference, created_by_user_id)
       VALUES ($1, $2, 'RLS-DRAFT-001', $3)
       ON CONFLICT (id) DO NOTHING`,
      [FX.purchDraftA, RLS_CLINIC_A_ID, FX.actor],
    );

    // draft_purchase_orders (FORCE RLS) — requires purchasing_draft_id FK
    await c.query(
      `INSERT INTO draft_purchase_orders
         (id, clinic_id, status, created_by_user_id, purchasing_draft_id)
       VALUES ($1, $2, 'draft', $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [FX.draftPoA, RLS_CLINIC_A_ID, FX.actor, FX.purchDraftA],
    );

    // supplier_invoices (FORCE RLS)
    await c.query(
      `INSERT INTO supplier_invoices
         (id, clinic_id, status, ocr_provider, original_filename, file_mime_type,
          imported_by_user_id, imported_by_email)
       VALUES ($1, $2, 'pending_review', 'test_ocr', 'rls-inv.pdf', 'application/pdf', $3, 'rls-test@verve.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceA, RLS_CLINIC_A_ID, FX.actor],
    );

    // supplier_invoice_lines (FORCE RLS)
    await c.query(
      `INSERT INTO supplier_invoice_lines
         (id, clinic_id, supplier_invoice_id, ocr_description, quantity,
          unit_price_cents, subtotal_cents, tax_cents, total_cents)
       VALUES ($1, $2, $3, 'RLS test line', 5, 2000, 10000, 1000, 11000)
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceLineA, RLS_CLINIC_A_ID, FX.invoiceA],
    );

    // product_suppliers (FORCE RLS)
    await c.query(
      `INSERT INTO product_suppliers
         (id, clinic_id, product_id, supplier_id, is_preferred, active)
       VALUES ($1, $2, $3, $4, true, true)
       ON CONFLICT (id) DO NOTHING`,
      [FX.prodSuppA, RLS_CLINIC_A_ID, FX.master1, FX.supplier],
    );
  });
}

/** Inserts Clinic B sentinel fixtures (FORCE RLS tables). */
async function insertClinicBFixtures(): Promise<void> {
  await asOwnerAdmin(RLS_CLINIC_B_ID, async (c) => {
    await c.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point)
       VALUES ($1, $2, $3, 30, 10)
       ON CONFLICT (id) DO NOTHING`,
      [FX.invB, RLS_CLINIC_B_ID, FX.masterB],
    );

    await c.query(
      `INSERT INTO purchasing_drafts (id, clinic_id, draft_reference, created_by_user_id)
       VALUES ($1, $2, 'RLS-DRAFT-B-001', $3)
       ON CONFLICT (id) DO NOTHING`,
      [FX.purchDraftB, RLS_CLINIC_B_ID, FX.actor],
    );

    await c.query(
      `INSERT INTO draft_purchase_orders
         (id, clinic_id, status, created_by_user_id, purchasing_draft_id)
       VALUES ($1, $2, 'draft', $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [FX.draftPoB, RLS_CLINIC_B_ID, FX.actor, FX.purchDraftB],
    );

    await c.query(
      `INSERT INTO supplier_invoices
         (id, clinic_id, status, ocr_provider, original_filename, file_mime_type,
          imported_by_user_id, imported_by_email)
       VALUES ($1, $2, 'pending_review', 'test_ocr', 'rls-inv-b.pdf', 'application/pdf', $3, 'rls-b-test@verve.au')
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceB, RLS_CLINIC_B_ID, FX.actor],
    );

    await c.query(
      `INSERT INTO supplier_invoice_lines
         (id, clinic_id, supplier_invoice_id, ocr_description, quantity,
          unit_price_cents, subtotal_cents, tax_cents, total_cents)
       VALUES ($1, $2, $3, 'RLS Clinic B line', 3, 1000, 3000, 300, 3300)
       ON CONFLICT (id) DO NOTHING`,
      [FX.invoiceLineB, RLS_CLINIC_B_ID, FX.invoiceB],
    );

    await c.query(
      `INSERT INTO product_suppliers
         (id, clinic_id, product_id, supplier_id, is_preferred, active)
       VALUES ($1, $2, $3, $4, true, true)
       ON CONFLICT (id) DO NOTHING`,
      [FX.prodSuppB, RLS_CLINIC_B_ID, FX.masterB, FX.supplier],
    );
  });
}

/**
 * Deletes all Clinic A RLS-test fixtures in safe FK order.
 * Uses superuser direct pool.query — bypasses FORCE RLS for cleanup.
 */
async function cleanupClinicAFixtures(): Promise<void> {
  // Child rows before parent rows
  await pool.query(`DELETE FROM supplier_invoice_lines WHERE id = $1`, [FX.invoiceLineA]);
  await pool.query(`DELETE FROM supplier_invoices WHERE id = $1`, [FX.invoiceA]);
  await pool.query(`DELETE FROM product_suppliers WHERE id = $1`, [FX.prodSuppA]);
  await pool.query(`DELETE FROM draft_purchase_orders WHERE id = $1`, [FX.draftPoA]);
  await pool.query(`DELETE FROM purchasing_drafts WHERE id = $1`, [FX.purchDraftA]);
  // inventory_adjustments before clinic_inventory_items (superuser bypasses FORCE RLS append-only policy)
  await pool.query(`DELETE FROM inventory_adjustments WHERE id = $1`, [FX.adjA]);
  await pool.query(
    `DELETE FROM clinic_inventory_items WHERE id IN ($1, $2)`,
    [FX.invA_noAdj, FX.invA_withAdj],
  );
}

/** Deletes Clinic B sentinel fixtures in FK order. */
async function cleanupClinicBFixtures(): Promise<void> {
  await pool.query(`DELETE FROM supplier_invoice_lines WHERE id = $1`, [FX.invoiceLineB]);
  await pool.query(`DELETE FROM supplier_invoices WHERE id = $1`, [FX.invoiceB]);
  await pool.query(`DELETE FROM product_suppliers WHERE id = $1`, [FX.prodSuppB]);
  await pool.query(`DELETE FROM draft_purchase_orders WHERE id = $1`, [FX.draftPoB]);
  await pool.query(`DELETE FROM purchasing_drafts WHERE id = $1`, [FX.purchDraftB]);
  await pool.query(`DELETE FROM clinic_inventory_items WHERE id = $1`, [FX.invB]);
}

async function cleanupGlobalFixtures(): Promise<void> {
  await pool.query(`DELETE FROM master_catalog_items WHERE id IN ($1, $2, $3)`, [FX.master1, FX.master2, FX.masterB]);
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [FX.supplier]);
}

// ── Suite setup ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;

  pool = new pg.Pool({ connectionString: DB_URL });
  repo = createPostgresPilotResetRepository(
    pool,
  );

  // Install the pool hook before any tests run.  With no AsyncLocalStorage context
  // active the hook is a no-op; it only injects GUCs when runWithTenantContext is
  // active on the same call stack.
  ensureHookInstalled();

  await insertClinics();
  await insertGlobalFixtures();
});

afterAll(async () => {
  if (SKIP) return;
  await cleanupGlobalFixtures();
  await pool.query(`DELETE FROM clinics WHERE id IN ($1, $2)`, [RLS_CLINIC_A_ID, RLS_CLINIC_B_ID]);
  await pool.end();
});

// =============================================================================
// TEST 1 — FORCE RLS regression proof (NOSUPERUSER, no GUC → 0 rows)
// =============================================================================

suite("Test 1: FORCE RLS blocks NOSUPERUSER queries without GUC tenant context", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("clinic_inventory_items (FORCE RLS) — verve_app without GUC context returns 0", async () => {
    const count = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(0);
  });

  it("draft_purchase_orders (FORCE RLS) — verve_app without GUC context returns 0", async () => {
    const count = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(0);
  });

  it("supplier_invoices (FORCE RLS) — verve_app without GUC context returns 0", async () => {
    const count = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(0);
  });

  it("product_suppliers (FORCE RLS) — verve_app without GUC context returns 0", async () => {
    const count = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(0);
  });

  it("inventory_adjustments (FORCE RLS) — verve_app without GUC context returns 0", async () => {
    const count = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM inventory_adjustments WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(0);
  });

  it("all FORCE-RLS tables return correct counts when app_is_owner_admin='true' GUC is set", async () => {
    const inv = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { ownerAdmin: true },
    );
    expect(inv).toBe(2); // invA_noAdj + invA_withAdj

    const po = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { ownerAdmin: true },
    );
    expect(po).toBe(1);

    const si = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { ownerAdmin: true },
    );
    expect(si).toBe(1);

    const ps = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { ownerAdmin: true },
    );
    expect(ps).toBe(1);

    const adj = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM inventory_adjustments WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { ownerAdmin: true },
    );
    expect(adj).toBe(1);
  });

  it("clinic-scoped GUC (without ownerAdmin) makes FORCE-RLS rows visible for that clinic only", async () => {
    const inv = await countAsVerveApp(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
      { clinicId: RLS_CLINIC_A_ID },
    );
    // clinic_id = app_current_clinic_id() → rows visible
    expect(inv).toBe(2);
  });
});

// =============================================================================
// TEST 2 — Correct preview counts via fixed middleware path
// =============================================================================

suite("Test 2: getPreviewCounts() returns accurate counts with owner-admin pool-hook context", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("full_pilot preview counts all FORCE-RLS tables correctly", async () => {
    const counts = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "full_pilot");

    // clinic_inventory_items partitioned into hard-delete + soft-zero
    expect(counts.clinicInventoryItemsDeleted).toBe(1);    // invA_noAdj
    expect(counts.clinicInventoryItemsSoftZeroed).toBe(1); // invA_withAdj

    // Procurement / invoicing
    expect(counts.draftPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(counts.purchasingDrafts).toBeGreaterThanOrEqual(1);
    expect(counts.supplierInvoices).toBe(1);
    expect(counts.supplierInvoiceLines).toBe(1);
    expect(counts.productSuppliers).toBe(1);

    // PO breakdown: the fixture creates draftPoA with NO lines, so it is empty.
    // Operational = POs with ≥1 line; Empty = POs with 0 lines.
    expect(counts.draftPurchaseOrdersOperational).toBe(0);
    expect(counts.draftPurchaseOrdersEmpty).toBeGreaterThanOrEqual(1); // at least draftPoA
    expect(counts.draftPurchaseOrders).toBe(
      counts.draftPurchaseOrdersOperational + counts.draftPurchaseOrdersEmpty,
    );

    // Line breakdown: no lines exist in these fixtures
    expect(counts.draftPoLines).toBe(0);
    expect(counts.draftPoLinesActive).toBe(0);
    expect(counts.draftPoLinesHistorical).toBe(0);
    expect(counts.draftPoLines).toBe(counts.draftPoLinesActive + counts.draftPoLinesHistorical);
  });

  it("operational preview counts zero for inventory (operational mode preserves inventory)", async () => {
    const counts = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "operational");

    expect(counts.clinicInventoryItemsDeleted).toBe(0);
    expect(counts.clinicInventoryItemsSoftZeroed).toBe(0);
    expect(counts.productSuppliers).toBe(0);

    // Operational records ARE counted
    expect(counts.draftPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(counts.supplierInvoices).toBe(1);
  });
});

// =============================================================================
// TEST 3 — Preview / Execute consistency
// =============================================================================

suite("Test 3: Preview counts match actual execute row counts", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("full_pilot: every preview category matches execute rowcount exactly", async () => {
    const preview = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "full_pilot");

    const executed = await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    expect(executed.clinicInventoryItemsDeleted).toBe(preview.clinicInventoryItemsDeleted);
    expect(executed.clinicInventoryItemsSoftZeroed).toBe(preview.clinicInventoryItemsSoftZeroed);
    expect(executed.draftPurchaseOrders).toBe(preview.draftPurchaseOrders);
    expect(executed.purchasingDrafts).toBe(preview.purchasingDrafts);
    expect(executed.supplierInvoices).toBe(preview.supplierInvoices);
    expect(executed.supplierInvoiceLines).toBe(preview.supplierInvoiceLines);
    expect(executed.productSuppliers).toBe(preview.productSuppliers);
    expect(executed.stocktakeSessions).toBe(preview.stocktakeSessions);
    expect(executed.stocktakeLines).toBe(preview.stocktakeLines);
  });

  it("operational: every preview category matches execute rowcount exactly", async () => {
    const preview = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "operational");

    const executed = await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeOperationalReset(c, RLS_CLINIC_A_ID),
      true,
    );

    expect(executed.draftPurchaseOrders).toBe(preview.draftPurchaseOrders);
    expect(executed.purchasingDrafts).toBe(preview.purchasingDrafts);
    expect(executed.supplierInvoices).toBe(preview.supplierInvoices);
    expect(executed.supplierInvoiceLines).toBe(preview.supplierInvoiceLines);
    // Operational mode leaves clinic_inventory_items unchanged
    expect(preview.clinicInventoryItemsDeleted).toBe(0);
    expect(preview.clinicInventoryItemsSoftZeroed).toBe(0);
  });
});

// =============================================================================
// TEST 4 — Other-clinic isolation
// =============================================================================

suite("Test 4: Resetting Clinic A leaves Clinic B completely unchanged", () => {

  beforeEach(async () => {
    await insertClinicAFixtures();
    await insertClinicBFixtures();
  });
  afterEach(async () => {
    await cleanupClinicAFixtures();
    await cleanupClinicBFixtures();
  });

  it("Clinic B clinic_inventory_items unchanged after Clinic A full-pilot reset", async () => {
    const before = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(before).toBe(1);

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const after = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(after).toBe(1);
  });

  it("Clinic B draft_purchase_orders unchanged after Clinic A full-pilot reset", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );
    const count = await countDirect(
      "SELECT COUNT(*)::text AS count FROM draft_purchase_orders WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(count).toBe(1);
  });

  it("Clinic B supplier_invoices unchanged after Clinic A full-pilot reset", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );
    const count = await countDirect(
      "SELECT COUNT(*)::text AS count FROM supplier_invoices WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(count).toBe(1);
  });

  it("Clinic B product_suppliers unchanged after Clinic A full-pilot reset", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );
    const count = await countDirect(
      "SELECT COUNT(*)::text AS count FROM product_suppliers WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(count).toBe(1);
  });
});

// =============================================================================
// TEST 5 — Global data preservation
// =============================================================================

suite("Test 5: Global/master data preserved after full pilot reset", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("master_catalog_items (global) are preserved", async () => {
    const before = await countDirect(
      "SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id IN ($1, $2)",
      [FX.master1, FX.master2],
    );
    expect(before).toBe(2);

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const after = await countDirect(
      "SELECT COUNT(*)::text AS count FROM master_catalog_items WHERE id IN ($1, $2)",
      [FX.master1, FX.master2],
    );
    expect(after).toBe(2);
  });

  it("suppliers (global) are preserved", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );
    const count = await countDirect(
      "SELECT COUNT(*)::text AS count FROM suppliers WHERE id = $1",
      [FX.supplier],
    );
    expect(count).toBe(1);
  });

  it("clinics table entry (RLS_CLINIC_A_ID) is preserved and active after reset", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );
    const count = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinics WHERE id = $1 AND is_active = true",
      [RLS_CLINIC_A_ID],
    );
    expect(count).toBe(1);
  });

  it("barcode_mappings row count is unchanged after reset", async () => {
    const before = await countDirect("SELECT COUNT(*)::text AS count FROM barcode_mappings");

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const after = await countDirect("SELECT COUNT(*)::text AS count FROM barcode_mappings");
    expect(after).toBe(before);
  });

  it("FORCE ROW LEVEL SECURITY remains enforced on key tables after reset", async () => {
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    // pg_class.relrowsecurity = true when RLS is enabled; relforcerowsecurity = true when FORCE
    const res = await pool.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT relname, relforcerowsecurity
       FROM pg_class
       WHERE relname IN (
         'clinic_inventory_items', 'draft_purchase_orders',
         'supplier_invoices', 'inventory_adjustments', 'audit_events'
       )
       AND relforcerowsecurity = true`,
    );
    // All five of these tables must remain under FORCE RLS
    expect(res.rows.length).toBe(5);
  });
});

// =============================================================================
// TEST 6 — Audit event verification
// =============================================================================

suite("Test 6: verifyPostReset() audit-event check with and without owner-admin context", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("PASSES 'Audit event recorded' when called with owner-admin pool-hook context", async () => {
    // Insert a known audit event directly as ownerAdmin
    const auditId = randomUUID();
    await asOwnerAdmin(RLS_CLINIC_A_ID, async (c) => {
      await c.query(
        `INSERT INTO audit_events
           (id, clinic_id, entity_type, entity_id, action, actor_id, actor_email, metadata)
         VALUES ($1, $2, 'auth', $2, 'pilot_reset.executed', $3, 'rls-test@verve.au', '{}')`,
        [auditId, RLS_CLINIC_A_ID, FX.actor],
      );
    });

    // Execute the reset so post-reset checks see a clean state
    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    // verifyPostReset WITH owner-admin context (simulating fixed middleware)
    const checks = await runWithTenantContext(
      RLS_CLINIC_A_ID,
      true,
      () => repo.verifyPostReset(
        pool,
        RLS_CLINIC_A_ID,
        "full_pilot",
        auditId,
      ),
    );

    const auditCheck = checks.find((c) => c.name === "Audit event recorded");
    expect(auditCheck).toBeDefined();
    expect(auditCheck?.passed).toBe(true);

    // Cleanup the audit event
    await pool.query(`DELETE FROM audit_events WHERE id = $1`, [auditId]);
  });

  it("FAILS 'Audit event recorded' for a non-existent audit ID (proves the check is real)", async () => {
    const nonExistentId = randomUUID();

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const checks = await runWithTenantContext(
      RLS_CLINIC_A_ID,
      true,
      () => repo.verifyPostReset(
        pool,
        RLS_CLINIC_A_ID,
        "full_pilot",
        nonExistentId,
      ),
    );

    const auditCheck = checks.find((c) => c.name === "Audit event recorded");
    // A random UUID should not be found → the check must fail
    expect(auditCheck?.passed).toBe(false);
  });
});

// =============================================================================
// TEST 7 — Clinic inventory hard-delete / soft-zero semantics
// =============================================================================

suite("Test 7: clinic_inventory_items hard-delete/soft-zero semantics are preserved", () => {

  beforeEach(async () => { await insertClinicAFixtures(); });
  afterEach(async () => { await cleanupClinicAFixtures(); });

  it("item WITHOUT adjustment history is hard-deleted by executeFullPilotReset", async () => {
    const before = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE id = $1",
      [FX.invA_noAdj],
    );
    expect(before).toBe(1);

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const after = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE id = $1",
      [FX.invA_noAdj],
    );
    expect(after).toBe(0); // hard-deleted
  });

  it("item WITH adjustment history is soft-zeroed — row preserved, operational fields cleared", async () => {
    const rowBefore = await pool.query<{
      quantity_on_hand: number;
      reorder_point: number;
      unit_cost_override_cents: number | null;
      supplier_preference: string | null;
    }>(
      `SELECT quantity_on_hand, reorder_point, unit_cost_override_cents, supplier_preference
       FROM clinic_inventory_items WHERE id = $1`,
      [FX.invA_withAdj],
    );
    expect(rowBefore.rows[0]?.quantity_on_hand).toBe(8);
    expect(rowBefore.rows[0]?.reorder_point).toBe(2);
    expect(rowBefore.rows[0]?.unit_cost_override_cents).toBe(1200);
    expect(rowBefore.rows[0]?.supplier_preference).toBe("RLS Pref Supplier");

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const rowAfter = await pool.query<{
      quantity_on_hand: number;
      reorder_point: number;
      unit_cost_override_cents: number | null;
      supplier_preference: string | null;
    }>(
      `SELECT quantity_on_hand, reorder_point, unit_cost_override_cents, supplier_preference
       FROM clinic_inventory_items WHERE id = $1`,
      [FX.invA_withAdj],
    );

    expect(rowAfter.rows.length).toBe(1); // row still exists
    expect(rowAfter.rows[0]?.quantity_on_hand).toBe(0);
    expect(rowAfter.rows[0]?.reorder_point).toBe(0);
    expect(rowAfter.rows[0]?.unit_cost_override_cents).toBeNull();
    expect(rowAfter.rows[0]?.supplier_preference).toBeNull();
  });

  it("inventory_adjustments are preserved (append-only, never deleted by pilot reset)", async () => {
    const before = await countDirect(
      "SELECT COUNT(*)::text AS count FROM inventory_adjustments WHERE id = $1",
      [FX.adjA],
    );
    expect(before).toBe(1);

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    const after = await countDirect(
      "SELECT COUNT(*)::text AS count FROM inventory_adjustments WHERE id = $1",
      [FX.adjA],
    );
    expect(after).toBe(1); // preserved
  });

  it("preview correctly partitions into hard-delete (1) and soft-zero (1) categories", async () => {
    const counts = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "full_pilot");
    expect(counts.clinicInventoryItemsDeleted).toBe(1);
    expect(counts.clinicInventoryItemsSoftZeroed).toBe(1);
  });
});

// =============================================================================
// TEST 8 — Preview selected-clinic scoping
// =============================================================================

suite("Test 8: Preview scoping — ownerAdmin sees all clinics; WHERE clause scopes to selected clinic", () => {

  beforeEach(async () => {
    await insertClinicAFixtures();
    await insertClinicBFixtures();
  });
  afterEach(async () => {
    await cleanupClinicAFixtures();
    await cleanupClinicBFixtures();
  });

  it("Clinic A preview counts only Clinic A clinic_inventory_items (not Clinic B)", async () => {
    const counts = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "full_pilot");
    const total = counts.clinicInventoryItemsDeleted + counts.clinicInventoryItemsSoftZeroed;
    expect(total).toBe(2); // Clinic A has 2 items; if scoping failed total would be 3
  });

  it("Clinic B preview counts only Clinic B clinic_inventory_items (not Clinic A)", async () => {
    const counts = await previewAsOwnerAdmin(RLS_CLINIC_B_ID, "full_pilot");
    const total = counts.clinicInventoryItemsDeleted + counts.clinicInventoryItemsSoftZeroed;
    expect(total).toBe(1); // Clinic B has 1 item
  });

  it("owner-admin context via runWithTenantContext can see BOTH clinics in unrestricted direct query", async () => {
    // Proves ownerAdmin context makes all rows visible — the WHERE clause is the sole boundary.
    ensureHookInstalled();
    const totalVisible = await runWithTenantContext(
      RLS_CLINIC_A_ID,
      true,
      async () => {
        const res = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM clinic_inventory_items
           WHERE clinic_id IN ($1, $2)`,
          [RLS_CLINIC_A_ID, RLS_CLINIC_B_ID],
        );
        return parseInt(res.rows[0]?.count ?? "0", 10);
      },
    );
    expect(totalVisible).toBe(3); // 2 from A + 1 from B — all visible with ownerAdmin
  });

  it("Clinic A supplier_invoices preview = 1; Clinic B supplier_invoices preview = 1 (independently correct)", async () => {
    const countsA = await previewAsOwnerAdmin(RLS_CLINIC_A_ID, "full_pilot");
    const countsB = await previewAsOwnerAdmin(RLS_CLINIC_B_ID, "full_pilot");
    expect(countsA.supplierInvoices).toBe(1);
    expect(countsB.supplierInvoices).toBe(1);
  });

  it("executing Clinic A reset does not delete Clinic B records (WHERE clause is the only scoping boundary)", async () => {
    const bInvBefore = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(bInvBefore).toBe(1);

    await withTenantContext(
      pool,
      RLS_CLINIC_A_ID,
      (c) => repo.executeFullPilotReset(c, RLS_CLINIC_A_ID),
      true,
    );

    // Clinic A: hard-deleted items gone, soft-zeroed item remains
    const aInvAfter = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_A_ID],
    );
    expect(aInvAfter).toBe(1); // invA_withAdj soft-zeroed (row kept)

    // Clinic B: completely untouched
    const bInvAfter = await countDirect(
      "SELECT COUNT(*)::text AS count FROM clinic_inventory_items WHERE clinic_id = $1",
      [RLS_CLINIC_B_ID],
    );
    expect(bInvAfter).toBe(1);
  });
});
