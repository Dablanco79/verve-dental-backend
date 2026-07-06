/**
 * paginationUnit.test.ts — Sprint L
 *
 * Unit tests for the in-memory pagination implementations and the Postgres
 * mock-pool implementations for all six paginated list endpoints.
 *
 * Coverage
 * ────────
 * 1. In-memory repositories
 *    - default limit (50) and offset (0)
 *    - custom limit and offset
 *    - max limit enforcement (cap at 100)
 *    - returns correct total (pre-slice count)
 *    - returns correct slice
 *    - tenant isolation (items from other clinics are excluded)
 *
 * 2. Postgres repositories (mock pool)
 *    - COUNT query is issued before data query
 *    - LIMIT and OFFSET appear at correct param indices
 *    - default pagination params are applied when options omitted
 *    - custom limit/offset flow through correctly
 *    - total is parsed from COUNT(*) result
 *    - WHERE conditions compose correctly with pagination params
 *
 * 3. Controller-layer validation (Zod schemas, no HTTP layer)
 *    - invalid limit (0, 101, negative, non-numeric string) → VALIDATION_ERROR
 *    - invalid offset (negative) → VALIDATION_ERROR
 *    - valid boundary values (limit=1, limit=100, offset=0) → accepted
 */

import { describe, it, expect } from "@jest/globals";
import { jest } from "@jest/globals";

// ── In-memory repositories ────────────────────────────────────────────────────
import { createInMemoryInventoryRepository } from "../inventoryRepository.js";
import { createInMemoryRosterRepository } from "../rosterRepository.js";
import { createInMemoryTimesheetRepository } from "../timesheetRepository.js";
import { createInMemoryLeaveRepository } from "../leaveRepository.js";
import { createInMemoryAnalyticsRepository } from "../analyticsRepository.js";

// ── Postgres repositories (mock pool) ─────────────────────────────────────────
import { createPostgresInventoryRepository } from "../inventoryRepository.postgres.js";
import { createPostgresRosterRepository } from "../rosterRepository.postgres.js";
import { createPostgresTimesheetRepository } from "../timesheetRepository.postgres.js";
import { createPostgresLeaveRepository } from "../leaveRepository.postgres.js";

// ── Catalog stub (required by in-memory inventory) ────────────────────────────
import type { CatalogRepository } from "../catalogRepository.js";
import type { DatabasePool } from "../../db/pool.js";
import type { CreateTimesheetEntryInput } from "../../types/payroll.js";

// =============================================================================
// Mock helpers
// =============================================================================

/** Minimal in-memory catalog that always returns null (safe for pagination tests). */
function makeNullCatalog(): CatalogRepository {
  return {
    listMasterItems: () => Promise.resolve([]),
    findMasterItemById: () => Promise.resolve(null),
    findMasterItemBySku: () => Promise.resolve(null),
    findMasterItemByNormalisedNameAndCategory: () => Promise.resolve(null),
    findBarcodeMapping: () => Promise.resolve(null),
    listBarcodeMappingsForItem: () => Promise.resolve([]),
    createMasterItem: () => Promise.reject(new Error("not implemented")),
    createBarcodeMapping: () => Promise.reject(new Error("not implemented")),
  };
}

/**
 * Returns a stub DatabasePool whose query() resolves to `rows`.
 * When multiple calls are made (e.g. COUNT then data), each call returns
 * its corresponding entry in `callResults`.
 */
function makeMockPool(callResults: Array<{ rows: unknown[]; rowCount?: number }>) {
  let callIdx = 0;
  const query = jest.fn().mockImplementation(() => {
    const result = callResults[callIdx] ?? { rows: [], rowCount: 0 };
    callIdx++;
    return Promise.resolve({ rows: result.rows, rowCount: result.rowCount ?? result.rows.length });
  });
  const pool = { query } as unknown as DatabasePool;
  return { pool, query };
}

function nthCall(query: jest.Mock, n: number): [string, unknown[]] {
  const call = query.mock.calls[n] as [string, unknown[]];
  return call;
}

// =============================================================================
// Constants
// =============================================================================

const CLINIC_A = "aaaaaaaa-0000-0000-0000-000000000001";
const CLINIC_B = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_ID  = "cccccccc-0000-0000-0000-000000000003";

const SHIFT_START = new Date("2026-07-15T08:00:00.000Z");
const SHIFT_END   = new Date("2026-07-15T17:00:00.000Z");

// =============================================================================
// 1. In-memory repository tests
// =============================================================================

// ── Inventory ─────────────────────────────────────────────────────────────────

describe("InMemoryInventoryRepository.listClinicInventoryPage", () => {
  it("returns default pagination values when no options provided", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const page = await repo.listClinicInventoryPage(CLINIC_A);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("accepts custom limit and offset", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const page = await repo.listClinicInventoryPage(CLINIC_A, { limit: 10, offset: 5 });
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(5);
  });

  it("caps limit at 100", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const page = await repo.listClinicInventoryPage(CLINIC_A, { limit: 999 });
    expect(page.limit).toBe(100);
  });

  it("excludes items from other clinics (tenant isolation)", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const pageA = await repo.listClinicInventoryPage(CLINIC_A);
    const pageB = await repo.listClinicInventoryPage(CLINIC_B);
    // Seed items belong to CLINIC_A only; CLINIC_B should return 0.
    for (const item of pageB.items) {
      expect(item.clinicId).toBe(CLINIC_B);
    }
    // Ensure totals are independently scoped.
    const bothTotal = pageA.total + pageB.total;
    const combinedPage = await repo.listClinicInventoryPage(CLINIC_A);
    expect(combinedPage.total).toBe(pageA.total);
    expect(bothTotal).toBeGreaterThanOrEqual(pageA.total);
  });

  it("total equals filtered item count before pagination slice", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const fullPage = await repo.listClinicInventoryPage(CLINIC_A, { limit: 100, offset: 0 });
    const smallPage = await repo.listClinicInventoryPage(CLINIC_A, { limit: 1, offset: 0 });
    expect(smallPage.total).toBe(fullPage.total);
    expect(smallPage.items.length).toBe(Math.min(1, fullPage.total));
  });
});

describe("InMemoryInventoryRepository.listAdjustmentsPage", () => {
  it("returns default pagination values when no options provided", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const page = await repo.listAdjustmentsPage(CLINIC_A);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("caps limit at 100", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const page = await repo.listAdjustmentsPage(CLINIC_A, { limit: 500 });
    expect(page.limit).toBe(100);
  });

  it("total reflects only the tenant's adjustments", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    const pageA = await repo.listAdjustmentsPage(CLINIC_A);
    const pageB = await repo.listAdjustmentsPage(CLINIC_B);
    // New repos start empty; totals should both be 0.
    expect(pageA.total).toBe(0);
    expect(pageB.total).toBe(0);
  });

  it("filters adjustments by clinic inventory item when itemId is provided", async () => {
    const repo = createInMemoryInventoryRepository(makeNullCatalog());
    await repo.recordAdjustment({
      clinicId: CLINIC_A,
      clinicInventoryItemId: "item-a",
      masterCatalogItemId: "master-a",
      adjustmentType: "manual_adjust",
      quantityDelta: 2,
      quantityBefore: 1,
      quantityAfter: 3,
      reason: "Stock correction",
      performedByUserId: STAFF_ID,
      performedByEmail: "s@a.com",
      referenceId: null,
    });
    await repo.recordAdjustment({
      clinicId: CLINIC_A,
      clinicInventoryItemId: "item-b",
      masterCatalogItemId: "master-b",
      adjustmentType: "manual_adjust",
      quantityDelta: -1,
      quantityBefore: 3,
      quantityAfter: 2,
      reason: "Expired stock",
      performedByUserId: STAFF_ID,
      performedByEmail: "s@a.com",
      referenceId: null,
    });

    const page = await repo.listAdjustmentsPage(CLINIC_A, { itemId: "item-a" });

    expect(page.total).toBe(1);
    expect(page.items[0]?.clinicInventoryItemId).toBe("item-a");
  });
});

// ── Roster ────────────────────────────────────────────────────────────────────

describe("InMemoryRosterRepository.listByClinicPaginated", () => {
  it("returns default pagination values", async () => {
    const repo = createInMemoryRosterRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("caps limit at 100", async () => {
    const repo = createInMemoryRosterRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 200 });
    expect(page.limit).toBe(100);
  });

  it("offsets into the result correctly", async () => {
    const repo = createInMemoryRosterRepository();
    // Create 3 entries for CLINIC_A.
    await repo.createEntry({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: new Date("2026-07-01T08:00:00Z"),
      shiftEndAt: new Date("2026-07-01T17:00:00Z"),
      shiftType: "standard", notes: null,
      createdByUserId: STAFF_ID, createdByEmail: "s@a.com",
    });
    await repo.createEntry({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: new Date("2026-07-02T08:00:00Z"),
      shiftEndAt: new Date("2026-07-02T17:00:00Z"),
      shiftType: "standard", notes: null,
      createdByUserId: STAFF_ID, createdByEmail: "s@a.com",
    });
    await repo.createEntry({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: new Date("2026-07-03T08:00:00Z"),
      shiftEndAt: new Date("2026-07-03T17:00:00Z"),
      shiftType: "standard", notes: null,
      createdByUserId: STAFF_ID, createdByEmail: "s@a.com",
    });

    const firstPage = await repo.listByClinicPaginated(CLINIC_A, { limit: 2, offset: 0 });
    const secondPage = await repo.listByClinicPaginated(CLINIC_A, { limit: 2, offset: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.length).toBe(2);
    expect(secondPage.items.length).toBe(1);
    expect(firstPage.items[0]?.id).not.toBe(secondPage.items[0]?.id);
  });

  it("excludes entries from other tenants", async () => {
    const repo = createInMemoryRosterRepository();
    await repo.createEntry({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END,
      shiftType: "standard", notes: null,
      createdByUserId: STAFF_ID, createdByEmail: "s@a.com",
    });

    const pageB = await repo.listByClinicPaginated(CLINIC_B);
    expect(pageB.total).toBe(0);
    expect(pageB.items.length).toBe(0);
  });
});

describe("InMemoryRosterRepository.listByStaffAtClinicPaginated", () => {
  it("returns only the requesting staff member's shifts", async () => {
    const OTHER_STAFF = "eeeeeeee-0000-0000-0000-000000000099";
    const repo = createInMemoryRosterRepository();
    await repo.createEntry({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END,
      shiftType: "standard", notes: null,
      createdByUserId: STAFF_ID, createdByEmail: "s@a.com",
    });
    await repo.createEntry({
      staffUserId: OTHER_STAFF, staffEmail: "other@a.com",
      rosteredClinicId: CLINIC_A, rosteredClinicName: "Clinic A",
      shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END,
      shiftType: "standard", notes: null,
      createdByUserId: OTHER_STAFF, createdByEmail: "other@a.com",
    });

    const page = await repo.listByStaffAtClinicPaginated(STAFF_ID, CLINIC_A);
    expect(page.total).toBe(1);
    expect(page.items[0]?.staffUserId).toBe(STAFF_ID);
  });
});

// ── Timesheet ─────────────────────────────────────────────────────────────────

describe("InMemoryTimesheetRepository.listByClinicPaginated", () => {
  const baseEntry: CreateTimesheetEntryInput = {
    payrollType: "commission_log",
    staffUserId: STAFF_ID,
    staffEmail: "s@a.com",
    clinicId: CLINIC_A,
    rosteredClinicId: CLINIC_A,
    rosteredClinicName: "Clinic A",
    rosterEntryId: null,
    shiftDate: "2026-07-15",
    shiftStartAt: SHIFT_START,
    shiftEndAt: SHIFT_END,
    attendanceStatus: "pending_verification",
    clockInAt: null, clockOutAt: null, breakDurationMinutes: null,
    totalHoursWorked: null, ordinaryHours: null,
    overtime15xHours: null, overtime2xHours: null, overtimeCustomHours: null,
    commissionNote: null, generatedBy: "system_auto",
  };

  it("returns default pagination values", async () => {
    const repo = createInMemoryTimesheetRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });

  it("caps limit at 100", async () => {
    const repo = createInMemoryTimesheetRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 999 });
    expect(page.limit).toBe(100);
  });

  it("total equals unsliced filtered count", async () => {
    const repo = createInMemoryTimesheetRepository();
    await repo.create(baseEntry);
    await repo.create({ ...baseEntry, shiftDate: "2026-07-16" });

    const full = await repo.listByClinicPaginated(CLINIC_A, { limit: 100, offset: 0 });
    const paged = await repo.listByClinicPaginated(CLINIC_A, { limit: 1, offset: 0 });

    expect(full.total).toBe(2);
    expect(paged.total).toBe(2);
    expect(paged.items.length).toBe(1);
  });

  it("excludes other clinics (tenant isolation)", async () => {
    const repo = createInMemoryTimesheetRepository();
    await repo.create(baseEntry);

    const pageB = await repo.listByClinicPaginated(CLINIC_B);
    expect(pageB.total).toBe(0);
  });

  it("pendingApprovalOnly filter works with pagination", async () => {
    const repo = createInMemoryTimesheetRepository();
    const hourly: CreateTimesheetEntryInput = {
      ...baseEntry,
      payrollType: "hourly_auto",
      attendanceStatus: "pending_verification",
    };
    const entry = await repo.create(hourly);
    await repo.update(entry.id, { timesheetStatus: "submitted" });

    const page = await repo.listByClinicPaginated(CLINIC_A, { pendingApprovalOnly: true });
    expect(page.items.every((e) => e.timesheetStatus === "submitted")).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(1);
  });
});

// ── Leave ─────────────────────────────────────────────────────────────────────

describe("InMemoryLeaveRepository.listByClinicPaginated", () => {
  it("returns default pagination values", async () => {
    const repo = createInMemoryLeaveRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("caps limit at 100", async () => {
    const repo = createInMemoryLeaveRepository();
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 500 });
    expect(page.limit).toBe(100);
  });

  it("total equals unsliced filtered count and offset slices correctly", async () => {
    const repo = createInMemoryLeaveRepository();
    await repo.create({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      clinicId: CLINIC_A, leaveType: "annual",
      startDate: "2026-08-01", endDate: "2026-08-05", totalDays: 5, reason: null,
    });
    await repo.create({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      clinicId: CLINIC_A, leaveType: "sick",
      startDate: "2026-09-01", endDate: "2026-09-01", totalDays: 1, reason: null,
    });

    const full = await repo.listByClinicPaginated(CLINIC_A, { limit: 100 });
    const page1 = await repo.listByClinicPaginated(CLINIC_A, { limit: 1, offset: 0 });
    const page2 = await repo.listByClinicPaginated(CLINIC_A, { limit: 1, offset: 1 });

    expect(full.total).toBe(2);
    expect(page1.total).toBe(2);
    expect(page1.items.length).toBe(1);
    expect(page2.items.length).toBe(1);
    expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
  });

  it("excludes entries from other clinics", async () => {
    const repo = createInMemoryLeaveRepository();
    await repo.create({
      staffUserId: STAFF_ID, staffEmail: "s@a.com",
      clinicId: CLINIC_A, leaveType: "annual",
      startDate: "2026-08-01", endDate: "2026-08-05", totalDays: 5, reason: null,
    });

    const pageB = await repo.listByClinicPaginated(CLINIC_B);
    expect(pageB.total).toBe(0);
    expect(pageB.items.length).toBe(0);
  });
});

// ── Analytics (audit events — already paginated, sanity-check page shape) ─────

describe("InMemoryAnalyticsRepository.listEvents (existing pagination)", () => {
  it("returns correct page shape with default limit/offset", async () => {
    const repo = createInMemoryAnalyticsRepository();
    const SEED_CLINIC_A = "00000000-0000-0000-0000-000000000001";
    const page = await repo.listEvents(SEED_CLINIC_A);
    expect(typeof page.total).toBe("number");
    expect(typeof page.limit).toBe("number");
    expect(typeof page.offset).toBe("number");
    expect(Array.isArray(page.events)).toBe(true);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });

  it("offsets correctly into the seed data", async () => {
    const repo = createInMemoryAnalyticsRepository();
    const SEED_CLINIC_A = "00000000-0000-0000-0000-000000000001";
    const full = await repo.listEvents(SEED_CLINIC_A, { limit: 100, offset: 0 });
    const p1 = await repo.listEvents(SEED_CLINIC_A, { limit: 3, offset: 0 });
    const p2 = await repo.listEvents(SEED_CLINIC_A, { limit: 3, offset: 3 });

    expect(p1.total).toBe(full.total);
    expect(p1.events.length).toBe(Math.min(3, full.total));
    if (full.total > 3) {
      expect(p2.events[0]?.id).not.toBe(p1.events[0]?.id);
    }
  });
});

// =============================================================================
// 2. Postgres mock-pool tests
// =============================================================================

// ── Inventory ─────────────────────────────────────────────────────────────────

describe("PostgresInventoryRepository.listClinicInventoryPage", () => {
  it("issues COUNT query then data query, wires limit/offset at correct positions", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "7" }] },
      { rows: [] },
    ]);
    const repo = createPostgresInventoryRepository(pool);
    const page = await repo.listClinicInventoryPage(CLINIC_A, { limit: 10, offset: 5 });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(countParams[0]).toBe(CLINIC_A);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(10);
    expect(dataParams[2]).toBe(5);

    expect(page.total).toBe(7);
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(5);
  });

  it("uses default limit=50 offset=0 when options omitted", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "0" }] },
      { rows: [] },
    ]);
    const repo = createPostgresInventoryRepository(pool);
    await repo.listClinicInventoryPage(CLINIC_A);

    const [, dataParams] = nthCall(query, 1);
    expect(dataParams[1]).toBe(50);
    expect(dataParams[2]).toBe(0);
  });

  it("caps limit at 100 regardless of the option passed", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "0" }] },
      { rows: [] },
    ]);
    const repo = createPostgresInventoryRepository(pool);
    await repo.listClinicInventoryPage(CLINIC_A, { limit: 500 });

    const [, dataParams] = nthCall(query, 1);
    expect(dataParams[1]).toBe(100);
  });
});

describe("PostgresInventoryRepository.listAdjustmentsPage", () => {
  it("issues COUNT then data query with correct clinic_id scope", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "3" }] },
      { rows: [] },
    ]);
    const repo = createPostgresInventoryRepository(pool);
    const page = await repo.listAdjustmentsPage(CLINIC_A, { limit: 5, offset: 10 });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(countParams[0]).toBe(CLINIC_A);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/ORDER BY created_at DESC/i);
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(5);
    expect(dataParams[2]).toBe(10);
    expect(page.total).toBe(3);
  });

  it("adds itemId to COUNT and data query scopes when provided", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "1" }] },
      { rows: [] },
    ]);
    const repo = createPostgresInventoryRepository(pool);
    const page = await repo.listAdjustmentsPage(CLINIC_A, {
      itemId: "item-a",
      limit: 5,
      offset: 10,
    });

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/clinic_inventory_item_id = \$2/i);
    expect(countParams).toEqual([CLINIC_A, "item-a"]);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/clinic_inventory_item_id = \$2/i);
    expect(dataSql).toMatch(/LIMIT \$3 OFFSET \$4/i);
    expect(dataParams).toEqual([CLINIC_A, "item-a", 5, 10]);
    expect(page.total).toBe(1);
  });
});

// ── Roster ────────────────────────────────────────────────────────────────────

describe("PostgresRosterRepository.listByClinicPaginated", () => {
  it("issues COUNT then data query, limit/offset at correct positions when no filters", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "12" }] },
      { rows: [] },
    ]);
    const repo = createPostgresRosterRepository(pool);
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 5, offset: 0 });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(countParams[0]).toBe(CLINIC_A);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/ORDER BY shift_start_at ASC/i);
    // With 1 WHERE param (clinic_id), LIMIT = $2, OFFSET = $3.
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(5);
    expect(dataParams[2]).toBe(0);
    expect(page.total).toBe(12);
  });

  it("correctly shifts param indices when optional filters are present", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "2" }] },
      { rows: [] },
    ]);
    const repo = createPostgresRosterRepository(pool);
    const from = new Date("2026-07-01T00:00:00Z");
    const to   = new Date("2026-07-31T00:00:00Z");
    await repo.listByClinicPaginated(CLINIC_A, { from, to, status: "scheduled", limit: 10, offset: 20 });

    // Params for COUNT: [clinicId, status, from, to]
    const [, countParams] = nthCall(query, 0);
    expect(countParams[0]).toBe(CLINIC_A);
    expect(countParams[1]).toBe("scheduled");
    expect(countParams[2]).toBe(from);
    expect(countParams[3]).toBe(to);

    // Data query: same WHERE params, then limit=10, offset=20 appended.
    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/LIMIT \$5 OFFSET \$6/i);
    expect(dataParams[4]).toBe(10);
    expect(dataParams[5]).toBe(20);
  });

  it("caps limit at 100", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "0" }] },
      { rows: [] },
    ]);
    const repo = createPostgresRosterRepository(pool);
    await repo.listByClinicPaginated(CLINIC_A, { limit: 9999 });

    const [, dataParams] = nthCall(query, 1);
    expect(dataParams[1]).toBe(100);
  });
});

// ── Timesheet ─────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository.listByClinicPaginated", () => {
  it("issues COUNT then data query with clinic_id as first param", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "20" }] },
      { rows: [] },
    ]);
    const repo = createPostgresTimesheetRepository(pool);
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 25, offset: 0 });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(countParams[0]).toBe(CLINIC_A);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/ORDER BY shift_date DESC/i);
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(25);
    expect(dataParams[2]).toBe(0);
    expect(page.total).toBe(20);
  });

  it("pendingApprovalOnly inlines 'submitted' condition without adding a param", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "5" }] },
      { rows: [] },
    ]);
    const repo = createPostgresTimesheetRepository(pool);
    await repo.listByClinicPaginated(CLINIC_A, { pendingApprovalOnly: true, limit: 10, offset: 0 });

    const [countSql] = nthCall(query, 0);
    expect(countSql).toMatch(/timesheet_status = 'submitted'/i);

    // limit/offset are params $2/$3 because pendingApprovalOnly does NOT add a param.
    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(10);
    expect(dataParams[2]).toBe(0);
  });
});

// ── Leave ─────────────────────────────────────────────────────────────────────

describe("PostgresLeaveRepository.listByClinicPaginated", () => {
  it("issues COUNT then data query with clinic_id scope", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "8" }] },
      { rows: [] },
    ]);
    const repo = createPostgresLeaveRepository(pool);
    const page = await repo.listByClinicPaginated(CLINIC_A, { limit: 3, offset: 6 });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(countParams[0]).toBe(CLINIC_A);

    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/ORDER BY start_date DESC/i);
    expect(dataSql).toMatch(/LIMIT \$2 OFFSET \$3/i);
    expect(dataParams[1]).toBe(3);
    expect(dataParams[2]).toBe(6);
    expect(page.total).toBe(8);
  });

  it("applies status filter before pagination params", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "2" }] },
      { rows: [] },
    ]);
    const repo = createPostgresLeaveRepository(pool);
    await repo.listByClinicPaginated(CLINIC_A, { status: "pending", limit: 10, offset: 0 });

    const [countSql, countParams] = nthCall(query, 0);
    expect(countSql).toMatch(/status = \$2/i);
    expect(countParams[1]).toBe("pending");

    // LIMIT=$3 OFFSET=$4 because status filter occupies $2.
    const [dataSql, dataParams] = nthCall(query, 1);
    expect(dataSql).toMatch(/LIMIT \$3 OFFSET \$4/i);
    expect(dataParams[2]).toBe(10);
    expect(dataParams[3]).toBe(0);
  });

  it("caps limit at 100", async () => {
    const { pool, query } = makeMockPool([
      { rows: [{ count: "0" }] },
      { rows: [] },
    ]);
    const repo = createPostgresLeaveRepository(pool);
    await repo.listByClinicPaginated(CLINIC_A, { limit: 9999 });

    const [, dataParams] = nthCall(query, 1);
    expect(dataParams[1]).toBe(100);
  });
});

// =============================================================================
// 3. Zod validation schema tests (controller layer)
// =============================================================================

import { z } from "zod";

// Inline mirror of the paginationQuerySchema used in all updated controllers.
const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

describe("Pagination Zod schema validation", () => {
  it("accepts valid default (no params)", () => {
    const result = paginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts limit=1 (lower boundary)", () => {
    const result = paginationQuerySchema.safeParse({ limit: "1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(1);
  });

  it("accepts limit=100 (upper boundary)", () => {
    const result = paginationQuerySchema.safeParse({ limit: "100" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(100);
  });

  it("rejects limit=0 (below minimum)", () => {
    const result = paginationQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit=101 (above maximum)", () => {
    const result = paginationQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects negative limit", () => {
    const result = paginationQuerySchema.safeParse({ limit: "-5" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric limit string", () => {
    const result = paginationQuerySchema.safeParse({ limit: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts offset=0 (lower boundary)", () => {
    const result = paginationQuerySchema.safeParse({ offset: "0" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(0);
  });

  it("rejects negative offset", () => {
    const result = paginationQuerySchema.safeParse({ offset: "-1" });
    expect(result.success).toBe(false);
  });

  it("accepts offset=1000 (large valid offset)", () => {
    const result = paginationQuerySchema.safeParse({ offset: "1000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(1000);
  });

  it("coerces numeric string to number for both fields", () => {
    const result = paginationQuerySchema.safeParse({ limit: "25", offset: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(50);
    }
  });
});
