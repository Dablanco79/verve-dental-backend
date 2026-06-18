/**
 * rlsIsolation.test.ts — PostgreSQL Row-Level Security Integration Tests
 *
 * PURPOSE
 * ───────
 * These tests prove that PostgreSQL RLS policies (migration 015) reject
 * cross-tenant data access at the database level, independent of any
 * application-layer filtering.
 *
 * Each test:
 *   1. Sets up a tenant context for Clinic A (or B) using withTenantContext.
 *   2. Runs a raw SQL query WITHOUT a WHERE clinic_id = ? filter.
 *   3. Verifies that the database only returns rows belonging to the
 *      active clinic context — NOT rows from the other clinic.
 *
 * This proves that even if application code forgot to add a WHERE clause,
 * RLS would still prevent cross-tenant data leaks.
 *
 * SKIP BEHAVIOUR
 * ──────────────
 * All tests are automatically skipped when DATABASE_URL is not set.
 * They require a real PostgreSQL instance with the full schema applied
 * (migrations 003–015).
 *
 * ISOLATION STRATEGY
 * ──────────────────
 * Each test uses fixed UUIDs from the existing seed data (SEED_CLINIC_A_ID,
 * SEED_CLINIC_B_ID) and inserts minimal additional rows scoped to those
 * clinics.  A beforeAll/afterAll block manages the lifecycle of test fixtures
 * using separate connections that bypass RLS via BEGIN + set_config to
 * owner_admin mode for INSERT/DELETE operations.
 *
 * SUBJECTS TESTED
 * ───────────────
 * ✓ clinic_inventory_items   — Clinic A cannot read Clinic B inventory
 * ✓ draft_purchase_orders    — Clinic A cannot read Clinic B purchase orders
 * ✓ timesheet_entries        — Clinic A cannot read Clinic B timesheets
 * ✓ invoices                 — Clinic A cannot read Clinic B billing data
 * ✓ leave_requests           — Clinic A cannot read Clinic B leave requests
 * ✓ audit_events             — Clinic A cannot read Clinic B audit events
 * ✓ owner_admin bypass       — owner_admin mode grants cross-clinic read
 * ✓ context reset            — queries without any context return 0 rows
 *   (i.e. RLS blocks even uncontextualised sessions)
 */

import pg from "pg";
import { withTenantContext } from "../../db/tenantContext.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../userRepository.js";
import { SEED_MASTER_CATALOG_IDS } from "../seed/inventorySeed.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL = process.env["DATABASE_URL"];
const SKIP = !DB_URL;

// Fixed catalog item UUID from the seed data — matches SEED_MASTER_CATALOG_IDS.nitrileGloves
// in inventorySeed.ts (the value used by seedInventory() when populating master_catalog_items).
const SEED_GLOVES_ITEM_ID = SEED_MASTER_CATALOG_IDS.nitrileGloves;

let pool: pg.Pool;

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture UUIDs — random but stable within a test run
// ─────────────────────────────────────────────────────────────────────────────

const FX = {
  // clinic_inventory_items
  invItemA: "f1111111-f111-4111-8111-f11111111111",
  invItemB: "f2222222-f222-4222-8222-f22222222222",
  // draft_purchase_orders
  poA: "f3333333-f333-4333-8333-f33333333333",
  poB: "f4444444-f444-4444-8444-f44444444444",
  // timesheet_entries — roster_entry_id intentionally null (hourly_manual)
  tsA: "f5555555-f555-4555-8555-f55555555555",
  tsB: "f6666666-f666-4666-8666-f66666666666",
  // invoices
  invA: "f7777777-f777-4777-8777-f77777777777",
  invB: "f8888888-f888-4888-8888-f88888888888",
  // leave_requests
  leaveA: "f9999999-f999-4999-8999-f99999999999",
  leaveB: "fa000000-fa00-4a00-8a00-fa0000000000",
  // audit_events
  auditA: "fb111111-fb11-4b11-8b11-fb1111111111",
  auditB: "fb222222-fb22-4b22-8b22-fb2222222222",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs SQL as owner_admin (bypasses RLS) so fixtures can be inserted/deleted
 * without the test context restrictions.
 */
async function asOwnerAdmin<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantContext(pool, SEED_CLINIC_A_ID, fn, true /* ownerAdmin */);
}

/**
 * Runs `fn` inside a tenant context with the non-superuser `verve_app` role so
 * FORCE ROW LEVEL SECURITY policies are exercised even when the CI DATABASE_URL
 * connects as a PostgreSQL superuser (which bypasses all RLS by design).
 *
 * The GitHub Actions postgres service creates POSTGRES_USER as a superuser.
 * SET LOCAL ROLE switches to verve_app (non-superuser) within the transaction
 * so RLS policies are evaluated rather than bypassed.
 *
 * Use this helper for all test assertions that verify RLS enforcement.
 * Use `asOwnerAdmin` (superuser) for fixture setup/teardown only.
 */
async function withRlsCtx<T>(
  clinicId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  ownerAdmin = false,
): Promise<T> {
  return withTenantContext(pool, clinicId, async (c) => {
    await c.query("SET LOCAL ROLE verve_app");
    return fn(c);
  }, ownerAdmin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;

  pool = new pg.Pool({ connectionString: DB_URL });

  // Ensure clinics table has our seed clinics (idempotent upsert)
  await asOwnerAdmin(async (client) => {
    await client.query(`
      INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
      VALUES
        ($1, 'Test Clinic A', 'Australia/Sydney', 'standard', true),
        ($2, 'Test Clinic B', 'Australia/Sydney', 'standard', true)
      ON CONFLICT (id) DO NOTHING
    `, [SEED_CLINIC_A_ID, SEED_CLINIC_B_ID]);

    // clinic_inventory_items — one per clinic pointing at the gloves catalog item
    await client.query(`
      INSERT INTO clinic_inventory_items
        (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point)
      VALUES
        ($1, $3, $5, 10, 3),
        ($2, $4, $5, 20, 5)
      ON CONFLICT (id) DO NOTHING
    `, [FX.invItemA, FX.invItemB, SEED_CLINIC_A_ID, SEED_CLINIC_B_ID, SEED_GLOVES_ITEM_ID]);

    // draft_purchase_orders — one per clinic
    await client.query(`
      INSERT INTO draft_purchase_orders (id, clinic_id, status, created_by_user_id)
      VALUES
        ($1, $3, 'draft', $5),
        ($2, $4, 'draft', $6)
      ON CONFLICT (id) DO NOTHING
    `, [FX.poA, FX.poB, SEED_CLINIC_A_ID, SEED_CLINIC_B_ID,
        SEED_USER_IDS.clinicAAdmin, SEED_USER_IDS.clinicBAdmin]);

    // timesheet_entries — hourly_manual, no roster_entry_id
    const today = new Date().toISOString().slice(0, 10);
    await client.query(`
      INSERT INTO timesheet_entries (
        id, payroll_type, staff_user_id, staff_email,
        clinic_id, rostered_clinic_id, rostered_clinic_name,
        shift_date, shift_start_at, shift_end_at,
        attendance_status, timesheet_status, generated_by
      ) VALUES
        ($1, 'hourly_manual', $3, 'admin@clinic-a.au',
         $5, $5, 'Test Clinic A',
         $7, $7::date + interval '8 hours', $7::date + interval '17 hours',
         'present', 'draft', 'manager_manual'),
        ($2, 'hourly_manual', $4, 'admin@clinic-b.au',
         $6, $6, 'Test Clinic B',
         $7, $7::date + interval '8 hours', $7::date + interval '17 hours',
         'present', 'draft', 'manager_manual')
      ON CONFLICT (id) DO NOTHING
    `, [FX.tsA, FX.tsB, SEED_USER_IDS.clinicAAdmin, SEED_USER_IDS.clinicBAdmin,
        SEED_CLINIC_A_ID, SEED_CLINIC_B_ID, today]);

    // invoices — one per clinic
    await client.query(`
      INSERT INTO invoices (
        id, clinic_id, patient_name, status,
        subtotal_cents, tax_cents, discount_cents, total_cents,
        paid_cents, outstanding_cents, tax_rate_basis_points,
        created_by_user_id, created_by_email
      ) VALUES
        ($1, $3, 'Patient A1', 'draft', 10000, 1000, 0, 11000, 0, 11000, 1000, $5, 'admin@clinic-a.au'),
        ($2, $4, 'Patient B1', 'draft', 20000, 2000, 0, 22000, 0, 22000, 1000, $6, 'admin@clinic-b.au')
      ON CONFLICT (id) DO NOTHING
    `, [FX.invA, FX.invB, SEED_CLINIC_A_ID, SEED_CLINIC_B_ID,
        SEED_USER_IDS.clinicAAdmin, SEED_USER_IDS.clinicBAdmin]);

    // leave_requests — one per clinic
    await client.query(`
      INSERT INTO leave_requests (
        id, staff_user_id, staff_email, clinic_id,
        leave_type, start_date, end_date, total_days, status
      ) VALUES
        ($1, $3, 'admin@clinic-a.au', $5, 'annual', current_date, current_date, 1, 'pending'),
        ($2, $4, 'admin@clinic-b.au', $6, 'annual', current_date, current_date, 1, 'pending')
      ON CONFLICT (id) DO NOTHING
    `, [FX.leaveA, FX.leaveB, SEED_USER_IDS.clinicAAdmin, SEED_USER_IDS.clinicBAdmin,
        SEED_CLINIC_A_ID, SEED_CLINIC_B_ID]);

    // audit_events — one per clinic
    await client.query(`
      INSERT INTO audit_events (id, clinic_id, entity_type, entity_id, action, actor_id, actor_email)
      VALUES
        ($1, $3, 'invoice', $1, 'created', $5, 'admin@clinic-a.au'),
        ($2, $4, 'invoice', $2, 'created', $6, 'admin@clinic-b.au')
      ON CONFLICT (id) DO NOTHING
    `, [FX.auditA, FX.auditB, SEED_CLINIC_A_ID, SEED_CLINIC_B_ID,
        SEED_USER_IDS.clinicAAdmin, SEED_USER_IDS.clinicBAdmin]);
  });
});

afterAll(async () => {
  if (SKIP) return;

  // Clean up all inserted test fixtures using owner_admin bypass
  await asOwnerAdmin(async (client) => {
    await client.query(`DELETE FROM audit_events WHERE id IN ($1, $2)`, [FX.auditA, FX.auditB]);
    await client.query(`DELETE FROM leave_requests WHERE id IN ($1, $2)`, [FX.leaveA, FX.leaveB]);
    await client.query(`DELETE FROM invoices WHERE id IN ($1, $2)`, [FX.invA, FX.invB]);
    await client.query(`DELETE FROM timesheet_entries WHERE id IN ($1, $2)`, [FX.tsA, FX.tsB]);
    await client.query(`DELETE FROM draft_purchase_orders WHERE id IN ($1, $2)`, [FX.poA, FX.poB]);
    await client.query(`DELETE FROM clinic_inventory_items WHERE id IN ($1, $2)`, [FX.invItemA, FX.invItemB]);
  });

  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — clinic_inventory_items", () => {
  it("Clinic A context: fixture row for Clinic A IS visible", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM clinic_inventory_items WHERE id = $1", [FX.invItemA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("Clinic A context: fixture row for Clinic B is NOT visible (DB rejects)", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM clinic_inventory_items WHERE id = $1", [FX.invItemB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B context: fixture row for Clinic A is NOT visible (DB rejects)", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM clinic_inventory_items WHERE id = $1", [FX.invItemA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("No-filter query in Clinic A context returns ONLY Clinic A rows", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT clinic_id FROM clinic_inventory_items WHERE id IN ($1, $2)", [FX.invItemA, FX.invItemB]),
    );
    expect(rows.every((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_A_ID)).toBe(true);
    expect(rows.find((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_B_ID)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — PURCHASE ORDERS
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — draft_purchase_orders", () => {
  it("Clinic A cannot access Clinic B purchase orders", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM draft_purchase_orders WHERE id = $1", [FX.poB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B cannot access Clinic A purchase orders", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM draft_purchase_orders WHERE id = $1", [FX.poA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic A context returns ONLY Clinic A POs when no WHERE clause", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT clinic_id FROM draft_purchase_orders WHERE id IN ($1, $2)", [FX.poA, FX.poB]),
    );
    expect(rows.every((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_A_ID)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — TIMESHEETS
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — timesheet_entries", () => {
  it("Clinic A cannot access Clinic B timesheets", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM timesheet_entries WHERE id = $1", [FX.tsB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B cannot access Clinic A timesheets", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM timesheet_entries WHERE id = $1", [FX.tsA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Unfiltered query in Clinic A context returns only Clinic A timesheets", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT clinic_id FROM timesheet_entries WHERE id IN ($1, $2)", [FX.tsA, FX.tsB]),
    );
    expect(rows.every((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_A_ID)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — BILLING (invoices)
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — invoices (billing data)", () => {
  it("Clinic A cannot access Clinic B billing data", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM invoices WHERE id = $1", [FX.invB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B cannot access Clinic A billing data", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM invoices WHERE id = $1", [FX.invA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Unfiltered billing query in Clinic A returns ONLY Clinic A invoices", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT clinic_id FROM invoices WHERE id IN ($1, $2)", [FX.invA, FX.invB]),
    );
    expect(rows.every((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_A_ID)).toBe(true);
    expect(rows.find((r: { clinic_id: string }) => r.clinic_id === SEED_CLINIC_B_ID)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — LEAVE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — leave_requests", () => {
  it("Clinic A cannot access Clinic B leave requests", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM leave_requests WHERE id = $1", [FX.leaveB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B cannot access Clinic A leave requests", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM leave_requests WHERE id = $1", [FX.leaveA]),
    );
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — audit_events", () => {
  it("Clinic A cannot access Clinic B audit events", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_A_ID, (c) =>
      c.query("SELECT id FROM audit_events WHERE id = $1", [FX.auditB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("Clinic B cannot access Clinic A audit events", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(SEED_CLINIC_B_ID, (c) =>
      c.query("SELECT id FROM audit_events WHERE id = $1", [FX.auditA]),
    );
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — OWNER ADMIN BYPASS
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — owner_admin cross-clinic access", () => {
  it("owner_admin mode can read Clinic A inventory while Clinic B context is active", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(
      SEED_CLINIC_B_ID,
      (c) => c.query("SELECT id FROM clinic_inventory_items WHERE id = $1", [FX.invItemA]),
      true, // ownerAdmin = true
    );
    expect(rows).toHaveLength(1);
  });

  it("owner_admin mode can read both clinics' invoices in a single query", async () => {
    if (SKIP) return;
    const { rows } = await withRlsCtx(
      SEED_CLINIC_A_ID,
      (c) => c.query("SELECT id FROM invoices WHERE id IN ($1, $2)", [FX.invA, FX.invB]),
      true, // ownerAdmin = true
    );
    expect(rows).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — NO CONTEXT (empty session variable)
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS — no tenant context (session var empty)", () => {
  it("Query without any clinic context returns 0 rows from clinic_inventory_items", async () => {
    if (SKIP) return;
    // Explicitly set an empty context (no clinic, no owner_admin).
    // Switch to non-superuser role so FORCE ROW LEVEL SECURITY is exercised —
    // the CI DATABASE_URL connects as a PostgreSQL superuser which bypasses all RLS.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', '', true),
                set_config('app.owner_admin_mode', 'false', true)`,
      );
      const { rows } = await client.query(
        "SELECT id FROM clinic_inventory_items WHERE id IN ($1, $2)",
        [FX.invItemA, FX.invItemB],
      );
      expect(rows).toHaveLength(0);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it("Query without any clinic context returns 0 rows from invoices", async () => {
    if (SKIP) return;
    // Same rationale: use non-superuser role so RLS is enforced.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', '', true),
                set_config('app.owner_admin_mode', 'false', true)`,
      );
      const { rows } = await client.query(
        "SELECT id FROM invoices WHERE id IN ($1, $2)",
        [FX.invA, FX.invB],
      );
      expect(rows).toHaveLength(0);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
});
