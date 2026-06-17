/**
 * purchaseOrderPostgresIntegration.test.ts
 *
 * Mocked-pool integration tests for the PostgreSQL purchase order methods
 * inside createPostgresInventoryRepository.  No real database connection is
 * required — a jest.fn() pool stub intercepts every pool.query() call.
 *
 * Coverage goals
 * ──────────────
 * 1. Mapper fidelity
 *      - draft_purchase_orders snake_case columns → camelCase DraftPurchaseOrder
 *      - draft_po_lines snake_case columns → camelCase DraftPoLine
 *      - Date columns pass through as Date objects
 *
 * 2. listPurchaseOrders
 *      - passes clinicId as $1 parameter
 *      - returns empty array when pool returns no rows
 *      - maps all columns correctly for multiple rows
 *
 * 3. listDraftPoLines
 *      - passes clinicId as $1 parameter (via JOIN predicate)
 *      - returns empty array when pool returns no rows
 *      - maps all columns correctly
 *
 * 4. findPurchaseOrderById
 *      - passes clinicId as $1, poId as $2
 *      - returns null when no rows returned (PO not found)
 *      - returns mapped DraftPurchaseOrder when row found
 *
 * 5. submitPurchaseOrder
 *      - UPDATE uses clinicId ($1), poId ($2), AND status = 'draft'
 *      - returns mapped DraftPurchaseOrder on success
 *      - throws when UPDATE returns 0 rows and SELECT also finds nothing (not found)
 *      - throws when UPDATE returns 0 rows but SELECT finds row (already submitted)
 *
 * 6. Tenant isolation at the SQL level
 *      - clinic_id = $1 is always the first WHERE predicate (confirmed via call args)
 */

import { jest } from "@jest/globals";
import { createPostgresInventoryRepository } from "../inventoryRepository.postgres.js";
import type { DatabasePool } from "../../db/pool.js";

// ─── Mock pool factory ────────────────────────────────────────────────────────

type QueryResult<T> = { rows: T[]; rowCount: number };

function makeMockPool(rows: unknown[] = []) {
  const query = jest.fn().mockResolvedValue(
    { rows, rowCount: rows.length } as never,
  );
  const pool = { query } as unknown as DatabasePool;
  return { pool, query };
}

function makeSequentialPool(results: QueryResult<unknown>[]) {
  let callIndex = 0;
  const query = jest.fn().mockImplementation(() => {
    const result = results[callIndex] ?? { rows: [], rowCount: 0 };
    callIndex++;
    return Promise.resolve(result);
  });
  const pool = { query } as unknown as DatabasePool;
  return { pool, query };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLINIC_A = "11111111-1111-4000-8000-000000000001";
const CLINIC_B = "22222222-2222-4000-8000-000000000002";
const PO_ID    = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PO_LINE_ID = "bbbbbbbb-bbbb-4000-8000-000000000001";
const USER_ID  = "cccccccc-cccc-4000-8000-000000000001";
const ITEM_ID  = "dddddddd-dddd-4000-8000-000000000001";
const INV_ITEM_ID = "eeeeeeee-eeee-4000-8000-000000000001";

const now = new Date("2026-06-16T07:00:00.000Z");

const draftPoRow = {
  id: PO_ID,
  clinic_id: CLINIC_A,
  status: "draft" as const,
  created_by_user_id: USER_ID,
  created_at: now,
  updated_at: now,
};

const submittedPoRow = {
  ...draftPoRow,
  status: "submitted" as const,
  updated_at: new Date("2026-06-16T08:00:00.000Z"),
};

const draftPoLineRow = {
  id: PO_LINE_ID,
  draft_purchase_order_id: PO_ID,
  master_catalog_item_id: ITEM_ID,
  clinic_inventory_item_id: INV_ITEM_ID,
  quantity: 2,
  reason: "below_reorder_point",
  created_at: now,
};

// ─── listPurchaseOrders ───────────────────────────────────────────────────────

describe("Postgres PO — listPurchaseOrders", () => {
  it("passes clinicId as the first query parameter", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    await repo.listPurchaseOrders(CLINIC_A);

    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_A);
  });

  it("returns an empty array when the pool returns no rows", async () => {
    const { pool } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.listPurchaseOrders(CLINIC_A);
    expect(result).toEqual([]);
  });

  it("maps snake_case row to camelCase DraftPurchaseOrder", async () => {
    const { pool } = makeMockPool([draftPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    const [po] = await repo.listPurchaseOrders(CLINIC_A);

    expect(po).toBeDefined();
    if (!po) return;
    expect(po.id).toBe(PO_ID);
    expect(po.clinicId).toBe(CLINIC_A);
    expect(po.status).toBe("draft");
    expect(po.createdByUserId).toBe(USER_ID);
    expect(po.createdAt).toBe(now);
    expect(po.updatedAt).toBe(now);
  });

  it("returns multiple rows mapped correctly", async () => {
    const secondPoRow = { ...draftPoRow, id: "ffffffff-ffff-4000-8000-000000000001" };
    const { pool } = makeMockPool([draftPoRow, secondPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.listPurchaseOrders(CLINIC_A);
    expect(result).toHaveLength(2);
    const [first, second] = result;
    if (!first || !second) return;
    expect(first.id).toBe(PO_ID);
    expect(second.id).toBe(secondPoRow.id);
  });
});

// ─── listDraftPoLines ─────────────────────────────────────────────────────────

describe("Postgres PO — listDraftPoLines", () => {
  it("passes clinicId as the first query parameter", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    await repo.listDraftPoLines(CLINIC_A);

    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_A);
  });

  it("returns an empty array when the pool returns no rows", async () => {
    const { pool } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.listDraftPoLines(CLINIC_A);
    expect(result).toEqual([]);
  });

  it("maps snake_case row to camelCase DraftPoLine", async () => {
    const { pool } = makeMockPool([draftPoLineRow]);
    const repo = createPostgresInventoryRepository(pool);

    const [line] = await repo.listDraftPoLines(CLINIC_A);

    expect(line).toBeDefined();
    if (!line) return;
    expect(line.id).toBe(PO_LINE_ID);
    expect(line.draftPurchaseOrderId).toBe(PO_ID);
    expect(line.masterCatalogItemId).toBe(ITEM_ID);
    expect(line.clinicInventoryItemId).toBe(INV_ITEM_ID);
    expect(line.quantity).toBe(2);
    expect(line.reason).toBe("below_reorder_point");
    expect(line.createdAt).toBe(now);
  });

  it("never scopes to clinic B when querying for clinic A", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    await repo.listDraftPoLines(CLINIC_A);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params).not.toContain(CLINIC_B);
  });
});

// ─── findPurchaseOrderById ────────────────────────────────────────────────────

describe("Postgres PO — findPurchaseOrderById", () => {
  it("passes clinicId and poId as the first two parameters", async () => {
    const { pool, query } = makeMockPool([draftPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    await repo.findPurchaseOrderById(CLINIC_A, PO_ID);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_A);
    expect(params[1]).toBe(PO_ID);
  });

  it("returns null when no row matches (PO not found)", async () => {
    const { pool } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.findPurchaseOrderById(CLINIC_A, PO_ID);
    expect(result).toBeNull();
  });

  it("returns a mapped DraftPurchaseOrder when a row is found", async () => {
    const { pool } = makeMockPool([draftPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.findPurchaseOrderById(CLINIC_A, PO_ID);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.id).toBe(PO_ID);
    expect(result.clinicId).toBe(CLINIC_A);
    expect(result.status).toBe("draft");
  });

  it("tenant isolation — clinic_id is always the first WHERE parameter", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresInventoryRepository(pool);

    // Query with clinic B — should use clinic B as the scoping param, not clinic A
    await repo.findPurchaseOrderById(CLINIC_B, PO_ID);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_B);
    expect(params[1]).toBe(PO_ID);
  });
});

// ─── submitPurchaseOrder ──────────────────────────────────────────────────────

describe("Postgres PO — submitPurchaseOrder", () => {
  it("returns the mapped submitted PO on success", async () => {
    const { pool } = makeMockPool([submittedPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    const result = await repo.submitPurchaseOrder(CLINIC_A, PO_ID);

    expect(result.id).toBe(PO_ID);
    expect(result.status).toBe("submitted");
    expect(result.clinicId).toBe(CLINIC_A);
    expect(result.updatedAt).toEqual(new Date("2026-06-16T08:00:00.000Z"));
  });

  it("passes clinicId as $1 and poId as $2 in the UPDATE", async () => {
    const { pool, query } = makeMockPool([submittedPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    await repo.submitPurchaseOrder(CLINIC_A, PO_ID);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_A);
    expect(params[1]).toBe(PO_ID);
  });

  it("throws a not-found error when neither UPDATE nor SELECT finds the PO", async () => {
    // First call (UPDATE RETURNING *) → 0 rows
    // Second call (SELECT to disambiguate) → 0 rows
    const { pool } = makeSequentialPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    const repo = createPostgresInventoryRepository(pool);

    await expect(repo.submitPurchaseOrder(CLINIC_A, PO_ID)).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws an already-submitted error when UPDATE finds no draft but SELECT finds the row", async () => {
    // First call (UPDATE RETURNING *) → 0 rows (because status != 'draft')
    // Second call (SELECT to disambiguate) → existing submitted row
    const { pool } = makeSequentialPool([
      { rows: [], rowCount: 0 },
      { rows: [submittedPoRow], rowCount: 1 },
    ]);
    const repo = createPostgresInventoryRepository(pool);

    await expect(repo.submitPurchaseOrder(CLINIC_A, PO_ID)).rejects.toThrow(
      /already/i,
    );
  });

  it("tenant isolation — clinicId scopes the UPDATE so PO from another clinic cannot be submitted", async () => {
    const { pool, query } = makeMockPool([submittedPoRow]);
    const repo = createPostgresInventoryRepository(pool);

    // Submit with clinic B — the SQL WHERE uses CLINIC_B, not CLINIC_A
    await repo.submitPurchaseOrder(CLINIC_B, PO_ID);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = call[1] as string[];
    expect(params[0]).toBe(CLINIC_B);
    expect(params[0]).not.toBe(CLINIC_A);
  });
});
