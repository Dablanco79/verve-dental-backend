/**
 * supplierInvoiceReceiving.integration.test.ts
 *
 * Real PostgreSQL integration tests for Workflow 1.0 invoice-receiving safety gate.
 *
 * DATABASE_URL behaviour
 * ─────────────────────
 * • Absent  → entire suite is skipped (safe local dev without a DB).
 * • Present → ALL six tests MUST execute.  If the seeded inventory items that
 *   the tests depend on are not found, beforeAll throws — the suite fails fast
 *   with a clear message rather than silently passing with zero assertions.
 *
 * Use the dedicated script to run these tests:
 *   DATABASE_URL=<url> npm run test:receiving-integration --workspace=@verve/backend
 *
 * Before running, seed the database:
 *   DATABASE_URL=<url> npm run test:db:setup --workspace=@verve/backend
 *
 * Coverage:
 *   A. Successful atomic receive — quantities, adjustments, lifecycle, audit all commit.
 *   B. Rollback after later-line failure — invalid 2nd item triggers DB 404; 1st line rolls back.
 *   C. Invoice lifecycle update failure — injected failure on UPDATE supplier_invoices rolls back.
 *   D. Concurrent receiving — row lock ensures exactly one succeeds, one gets 409.
 *   E. RLS / clinic isolation — cross-clinic invoice access denied; no mutation.
 *   F. Audit insert failure — injected failure on INSERT INTO audit_events rolls back everything.
 *
 * Infrastructure pattern mirrors tests/rlsHardening.test.ts:
 *   - Real pg.Pool connected to DATABASE_URL
 *   - withTenantContext for data setup / verification
 *   - Raw pool (superuser path) for fixture INSERT / DELETE
 *   - if (SKIP) return — zero-cost skip when DATABASE_URL is absent
 */

import pg from "pg";
import { randomUUID } from "node:crypto";
import { withTenantContext } from "../src/db/tenantContext.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createSupplierInvoiceService } from "../src/services/supplierInvoiceService.js";
import { createInMemorySupplierInvoiceRepository } from "../src/repositories/supplierInvoiceRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import { createInMemorySupplierRepository } from "../src/repositories/supplierRepository.js";
import { createAuditService } from "../src/services/auditService.js";
import { createLogger } from "../src/utils/logger.js";
import { loadConfig } from "../src/config/index.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { DatabasePool } from "../src/db/pool.js";
import type { SupplierInvoiceService } from "../src/services/supplierInvoiceService.js";
import type { OcrProvider } from "../src/services/ocr/OcrProvider.js";

// ── Test gate ─────────────────────────────────────────────────────────────────

const DB_URL = process.env["DATABASE_URL"];
const SKIP = !DB_URL;

// ── Caller fixtures ───────────────────────────────────────────────────────────

const CLINIC_A_MANAGER: AuthenticatedUser = {
  id: SEED_USER_IDS.clinicAManager,
  email: "manager@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: SEED_CLINIC_A_ID,
  homeClinicName: "Clinic A",
  firstName: "Test",
  lastName: "Manager",
  displayName: null,
  permissions: [],
};

const CLINIC_B_CALLER: AuthenticatedUser = {
  id: SEED_USER_IDS.clinicBAdmin,
  email: "admin@clinic-b.au",
  role: "group_practice_manager",
  homeClinicId: SEED_CLINIC_B_ID,
  homeClinicName: "Clinic B",
  firstName: "Test",
  lastName: "Admin B",
  displayName: null,
  permissions: [],
};

// ── Shared pool and seeded inventory items ────────────────────────────────────

let pool: pg.Pool;
let itemAId: string = ""; // first seeded clinic_inventory_item for Clinic A
let itemBId: string = ""; // second seeded clinic_inventory_item for Clinic A

beforeAll(async () => {
  if (SKIP) return;

  pool = new pg.Pool({
    connectionString: DB_URL,
    connectionTimeoutMillis: 10_000,
    max: 10, // extra headroom for concurrent test D
  });

  // Fetch two seeded inventory items for Clinic A (created by setupTestDb.ts → seedInventory).
  const { rows } = await withTenantContext(
    pool,
    SEED_CLINIC_A_ID,
    (c) =>
      c.query<{ id: string }>(
        "SELECT id FROM clinic_inventory_items WHERE clinic_id = $1 ORDER BY created_at LIMIT 2",
        [SEED_CLINIC_A_ID],
      ),
  );

  itemAId = rows[0]?.id ?? "";
  itemBId = rows[1]?.id ?? "";

  // When DATABASE_URL is present, tests A–F MUST execute.  Missing seed items
  // mean the database was not set up correctly — fail immediately rather than
  // allowing tests to silently pass with no assertions.
  if (!itemAId || !itemBId) {
    throw new Error(
      `Receiving integration tests require at least two seeded clinic_inventory_items ` +
        `for clinic ${SEED_CLINIC_A_ID} but found ${String(rows.length)}. ` +
        `Run: DATABASE_URL=<url> npm run test:db:setup --workspace=@verve/backend`,
    );
  }
});

afterAll(async () => {
  if (SKIP) return;
  await pool.end().catch(() => undefined);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Insert a fresh supplier_invoice in 'imported' status with received_at=NULL.
 * Uses the raw pool (superuser bypass) so FORCE RLS does not block fixture setup.
 */
async function createImportedInvoice(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO supplier_invoices
       (id, clinic_id, status, ocr_provider, original_filename, file_mime_type,
        imported_by_user_id, imported_by_email, supplier_name_raw, invoice_number)
     VALUES ($1, $2, 'imported', 'integration-test', 'integration-test.pdf',
             'application/pdf', $3, $4, 'Integration Test Supplier', $5)`,
    [
      id,
      SEED_CLINIC_A_ID,
      SEED_USER_IDS.clinicAManager,
      "manager@clinic-a.au",
      `INV-INTG-${id.slice(0, 8).toUpperCase()}`,
    ],
  );
  return id;
}

/**
 * Build the service wired to the real pool.
 * The repos that receiveInvoice does NOT call on the PG path are stubbed with
 * in-memory implementations (they are never invoked — the pool causes
 * executeAtomicReceivingPg to run raw SQL via the PoolClient).
 */
function buildService(realPool: DatabasePool): SupplierInvoiceService {
  const config = loadConfig();
  const logger = createLogger(config);
  // null analytics repo — the receiving audit INSERT is inside the transaction itself.
  const auditSvc = createAuditService(logger, null);
  const stubOcr: OcrProvider = {
    extractInvoice: () => Promise.reject(new Error("OCR not used in receiving integration tests")),
  };
  return createSupplierInvoiceService(
    createInMemorySupplierInvoiceRepository(), // never called — PG path uses raw SQL
    stubOcr,
    createInMemorySupplierCatalogueRepository(), // never called
    auditSvc,
    createInMemorySupplierRepository(), // never called
    undefined, // supplierRelationshipRepo
    undefined, // catalogRepository
    undefined, // inventoryRepository — not needed when pool is present
    realPool,
  );
}

/**
 * Wrap a real pool so that any client.query() call whose SQL matches
 * `shouldFail` rejects with a known error instead of hitting PostgreSQL.
 *
 * All other queries (including BEGIN, SET LOCAL, COMMIT, ROLLBACK) are
 * forwarded unchanged to the real DB, so withTenantContext can still perform
 * a genuine PostgreSQL ROLLBACK when the injected failure is thrown.
 */
function makeFailingPool(
  realPool: pg.Pool,
  shouldFail: (sql: string) => boolean,
): DatabasePool {
  return {
    connect: async () => {
      const realClient = await realPool.connect();
      // Proxy the client so only the targeted SQL is intercepted.
      return new Proxy(realClient, {
        get(target, prop) {
          if (prop === "query") {
            return (...args: unknown[]) => {
              const sql = args[0];
              if (typeof sql === "string" && shouldFail(sql)) {
                return Promise.reject(new Error("Injected test failure"));
              }
              return (target.query as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          // Bind all other methods (release, etc.) to the real client so that
          // 'this' references internal pg state correctly.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const value = Reflect.get(target, prop, target);
          if (typeof value === "function") {
            return (value as (...a: unknown[]) => unknown).bind(target);
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return value;
        },
      });
    },
  } as unknown as DatabasePool;
}

// ── A. Successful atomic receive ──────────────────────────────────────────────

describe("Integration A — Successful atomic receive", () => {
  test(
    "commits both inventory quantities, both adjustments, invoice lifecycle, and audit event",
    async () => {
      if (SKIP) return;

      const invoiceId = await createImportedInvoice();
      const service = buildService(pool);

      // Baseline quantities.
      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ id: string; quantity_on_hand: number }>(
            "SELECT id, quantity_on_hand FROM clinic_inventory_items WHERE id IN ($1, $2)",
            [itemAId, itemBId],
          ),
      );
      const qtyBeforeA = before.find((r) => r.id === itemAId)?.quantity_on_hand ?? 0;
      const qtyBeforeB = before.find((r) => r.id === itemBId)?.quantity_on_hand ?? 0;

      // Execute receiving via the production PostgreSQL path.
      const result = await service.receiveInvoice(
        CLINIC_A_MANAGER,
        SEED_CLINIC_A_ID,
        invoiceId,
        [
          { itemId: itemAId, quantityDelta: 3 },
          { itemId: itemBId, quantityDelta: 5 },
        ],
        "REF-INTG-A",
      );

      // 1. Invoice lifecycle committed.
      expect(result.invoice.receivedAt).not.toBeNull();
      expect(result.invoice.receivedByUserId).toBe(SEED_USER_IDS.clinicAManager);
      expect(result.invoice.receivedReference).toBe("REF-INTG-A");

      // 2. Both inventory quantities updated.
      const { rows: after } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ id: string; quantity_on_hand: number }>(
            "SELECT id, quantity_on_hand FROM clinic_inventory_items WHERE id IN ($1, $2)",
            [itemAId, itemBId],
          ),
      );
      expect(after.find((r) => r.id === itemAId)?.quantity_on_hand).toBe(qtyBeforeA + 3);
      expect(after.find((r) => r.id === itemBId)?.quantity_on_hand).toBe(qtyBeforeB + 5);

      // 3. Both adjustment rows exist.
      const { rows: adjs } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ clinic_inventory_item_id: string; quantity_delta: number }>(
            `SELECT clinic_inventory_item_id, quantity_delta
               FROM inventory_adjustments
              WHERE reference_id = $1
              ORDER BY created_at`,
            [invoiceId],
          ),
      );
      expect(adjs).toHaveLength(2);
      expect(adjs.find((a) => a.clinic_inventory_item_id === itemAId)?.quantity_delta).toBe(3);
      expect(adjs.find((a) => a.clinic_inventory_item_id === itemBId)?.quantity_delta).toBe(5);

      // 4. Audit event committed inside the same transaction.
      const { rows: auditRows } = await pool.query<{ action: string }>(
        `SELECT action FROM audit_events
          WHERE entity_id = $1
            AND action = 'supplier_invoice.received'`,
        [invoiceId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.action).toBe("supplier_invoice.received");

      // Cleanup.
      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});

// ── B. Rollback after later-line failure ──────────────────────────────────────

describe("Integration B — Rollback after later-line failure", () => {
  test(
    "invalid 2nd item ID causes INVENTORY_ITEM_NOT_FOUND; first item quantity stays unchanged",
    async () => {
      if (SKIP) return;

      const invoiceId = await createImportedInvoice();
      const service = buildService(pool);

      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      const qtyBefore = before[0]?.quantity_on_hand ?? 0;

      // randomUUID() is guaranteed not to exist in clinic_inventory_items.
      const NONEXISTENT = randomUUID();

      await expect(
        service.receiveInvoice(
          CLINIC_A_MANAGER,
          SEED_CLINIC_A_ID,
          invoiceId,
          [
            { itemId: itemAId, quantityDelta: 4 }, // valid
            { itemId: NONEXISTENT, quantityDelta: 2 }, // triggers DB 404
          ],
          null,
        ),
      ).rejects.toMatchObject({ code: "INVENTORY_ITEM_NOT_FOUND" });

      // First item quantity UNCHANGED (transaction rolled back).
      const { rows: after } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      expect(after[0]?.quantity_on_hand).toBe(qtyBefore);

      // Zero adjustment rows.
      const { rows: adjs } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) => c.query("SELECT id FROM inventory_adjustments WHERE reference_id = $1", [invoiceId]),
      );
      expect(adjs).toHaveLength(0);

      // Invoice still unreceived.
      const { rows: inv } = await pool.query<{ received_at: Date | null }>(
        "SELECT received_at FROM supplier_invoices WHERE id = $1",
        [invoiceId],
      );
      expect(inv[0]?.received_at).toBeNull();

      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});

// ── C. Invoice lifecycle update failure ───────────────────────────────────────

describe("Integration C — Invoice lifecycle update failure", () => {
  test(
    "injected failure on UPDATE supplier_invoices rolls back inventory changes",
    async () => {
      if (SKIP) return;

      const invoiceId = await createImportedInvoice();

      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      const qtyBefore = before[0]?.quantity_on_hand ?? 0;

      // Pool that fails specifically when the service tries to UPDATE supplier_invoices
      // to mark it received — simulating a lifecycle-update database error.
      const failingPool = makeFailingPool(
        pool,
        (sql) => sql.includes("UPDATE supplier_invoices") && sql.includes("received_at"),
      );
      const service = buildService(failingPool);

      await expect(
        service.receiveInvoice(
          CLINIC_A_MANAGER,
          SEED_CLINIC_A_ID,
          invoiceId,
          [{ itemId: itemAId, quantityDelta: 6 }],
          null,
        ),
      ).rejects.toThrow("Injected test failure");

      // Inventory unchanged (transaction rolled back).
      const { rows: after } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      expect(after[0]?.quantity_on_hand).toBe(qtyBefore);

      // Zero adjustment rows.
      const { rows: adjs } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) => c.query("SELECT id FROM inventory_adjustments WHERE reference_id = $1", [invoiceId]),
      );
      expect(adjs).toHaveLength(0);

      // Invoice still unreceived.
      const { rows: inv } = await pool.query<{ received_at: Date | null }>(
        "SELECT received_at FROM supplier_invoices WHERE id = $1",
        [invoiceId],
      );
      expect(inv[0]?.received_at).toBeNull();

      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});

// ── D. Concurrent receiving ───────────────────────────────────────────────────

describe("Integration D — Concurrent receiving", () => {
  test(
    "SELECT FOR UPDATE row-lock: exactly one request succeeds, one gets 409; inventory increases once",
    async () => {
      if (SKIP) return;

      const invoiceId = await createImportedInvoice();
      const service = buildService(pool);

      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      const qtyBefore = before[0]?.quantity_on_hand ?? 0;

      // Fire two concurrent receiving requests targeting the same invoice.
      // PostgreSQL row-level locking (SELECT ... FOR UPDATE) ensures only
      // one transaction can proceed past the invoice lock at a time.
      const [r1, r2] = await Promise.allSettled([
        service.receiveInvoice(
          CLINIC_A_MANAGER,
          SEED_CLINIC_A_ID,
          invoiceId,
          [{ itemId: itemAId, quantityDelta: 7 }],
          "CONCURRENT-1",
        ),
        service.receiveInvoice(
          CLINIC_A_MANAGER,
          SEED_CLINIC_A_ID,
          invoiceId,
          [{ itemId: itemAId, quantityDelta: 7 }],
          "CONCURRENT-2",
        ),
      ]);

      const successes = [r1, r2].filter((r) => r.status === "fulfilled");
      const failures  = [r1, r2].filter((r) => r.status === "rejected");

      // Exactly one success.
      expect(successes).toHaveLength(1);

      // Exactly one failure — must be the duplicate-receive conflict code.
      expect(failures).toHaveLength(1);
      const rejected = failures[0];
      if (rejected?.status === "rejected") {
        expect(
          (rejected.reason as { code?: string }).code,
        ).toBe("INVOICE_ALREADY_RECEIVED");
      }

      // Inventory increased exactly once.
      const { rows: after } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      expect(after[0]?.quantity_on_hand).toBe(qtyBefore + 7);

      // Exactly one adjustment row.
      const { rows: adjs } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) => c.query("SELECT id FROM inventory_adjustments WHERE reference_id = $1", [invoiceId]),
      );
      expect(adjs).toHaveLength(1);

      // Invoice marked received exactly once.
      const { rows: inv } = await pool.query<{ received_at: Date | null }>(
        "SELECT received_at FROM supplier_invoices WHERE id = $1",
        [invoiceId],
      );
      expect(inv[0]?.received_at).not.toBeNull();

      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});

// ── E. RLS / clinic isolation ─────────────────────────────────────────────────

describe("Integration E — RLS / clinic isolation", () => {
  test(
    "receiving using another clinic's invoice ID returns 404; no inventory mutation",
    async () => {
      if (SKIP) return;

      // Invoice belongs to Clinic A.
      const invoiceId = await createImportedInvoice();

      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      const qtyBefore = before[0]?.quantity_on_hand ?? 0;

      // Clinic B caller uses Clinic B as the clinicId context.
      // The invoice SELECT inside the transaction uses
      //   WHERE id = $1 AND clinic_id = $2 (= SEED_CLINIC_B_ID)
      // which returns no rows → 404 NOT_FOUND.
      const service = buildService(pool);

      await expect(
        service.receiveInvoice(
          CLINIC_B_CALLER,
          SEED_CLINIC_B_ID,
          invoiceId,
          [{ itemId: itemAId, quantityDelta: 2 }],
          null,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });

      // Clinic A inventory unchanged.
      const { rows: after } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      expect(after[0]?.quantity_on_hand).toBe(qtyBefore);

      // Invoice still unreceived.
      const { rows: inv } = await pool.query<{ received_at: Date | null }>(
        "SELECT received_at FROM supplier_invoices WHERE id = $1",
        [invoiceId],
      );
      expect(inv[0]?.received_at).toBeNull();

      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});

// ── F. Audit insert failure rollback ─────────────────────────────────────────

describe("Integration F — Audit insert failure rolls back entire receiving operation", () => {
  test(
    "injected failure on INSERT INTO audit_events rolls back inventory, adjustments, and invoice",
    async () => {
      if (SKIP) return;

      const invoiceId = await createImportedInvoice();

      const { rows: before } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      const qtyBefore = before[0]?.quantity_on_hand ?? 0;

      // Pool that fails when the transaction tries to insert the audit event.
      // withTenantContext catches the error and issues a real PostgreSQL ROLLBACK.
      const failingPool = makeFailingPool(
        pool,
        (sql) => sql.includes("INSERT INTO audit_events"),
      );
      const service = buildService(failingPool);

      await expect(
        service.receiveInvoice(
          CLINIC_A_MANAGER,
          SEED_CLINIC_A_ID,
          invoiceId,
          [{ itemId: itemAId, quantityDelta: 8 }],
          null,
        ),
      ).rejects.toThrow("Injected test failure");

      // 1. Inventory unchanged.
      const { rows: afterItem } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) =>
          c.query<{ quantity_on_hand: number }>(
            "SELECT quantity_on_hand FROM clinic_inventory_items WHERE id = $1",
            [itemAId],
          ),
      );
      expect(afterItem[0]?.quantity_on_hand).toBe(qtyBefore);

      // 2. No adjustment rows.
      const { rows: adjs } = await withTenantContext(
        pool,
        SEED_CLINIC_A_ID,
        (c) => c.query("SELECT id FROM inventory_adjustments WHERE reference_id = $1", [invoiceId]),
      );
      expect(adjs).toHaveLength(0);

      // 3. Invoice still unreceived.
      const { rows: inv } = await pool.query<{ received_at: Date | null }>(
        "SELECT received_at FROM supplier_invoices WHERE id = $1",
        [invoiceId],
      );
      expect(inv[0]?.received_at).toBeNull();

      // 4. No audit event persisted (rollback removed the partial INSERT).
      const { rows: auditRows } = await pool.query(
        `SELECT id FROM audit_events
          WHERE entity_id = $1
            AND action = 'supplier_invoice.received'`,
        [invoiceId],
      );
      expect(auditRows).toHaveLength(0);

      await pool
        .query("DELETE FROM supplier_invoices WHERE id = $1", [invoiceId])
        .catch(() => undefined);
    },
  );
});
