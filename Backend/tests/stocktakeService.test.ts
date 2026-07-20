/**
 * StocktakeService unit tests — Workflow 2.1: Stocktake & Inventory Reconciliation.
 *
 * Uses in-memory repositories — no DB or real API key needed.
 *
 * Coverage:
 *  1.  createSession — manager can create a draft session
 *  2.  createSession — clinical_staff is rejected (403)
 *  3.  startSession — transitions draft → in_progress, creates lines
 *  4.  startSession — rejects if session is already in_progress
 *  5.  startSession — rejects if no inventory exists
 *  6.  updateLine — staff can update a count on an in_progress session
 *  7.  updateLine — rejects negative countedQuantity
 *  8.  updateLine — rejects update on a completed session
 *  9.  cancelSession — manager can cancel a draft session
 *  10. cancelSession — manager can cancel an in_progress session
 *  11. cancelSession — clinical_staff is rejected (403)
 *  12. completeSession — applies adjustments for variance lines (all lines counted)
 *  13. completeSession — rejects if session is not in_progress
 *  14. listSessions — returns paginated results scoped to clinic
 *  15. Cross-tenant isolation — session in clinic B is not visible to clinic A
 *
 *  Sprint 1.1 additions (pilot-readiness findings):
 *  16. completeSession — BLOCKED when any line is uncounted (UNCOUNTED_LINES)
 *  17. completeSession — succeeds when all lines have been counted
 *  18. updateLine — countedQuantity = 0 is valid (not treated as uncounted)
 *  19. startSession — snapshot fields are populated from inventory at session-start
 */

import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createInMemoryStocktakeRepository } from "../src/repositories/stocktakeRepository.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createStocktakeService } from "../src/services/stocktakeService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../src/repositories/userRepository.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// CLINIC_A and CLINIC_B map to the in-memory seed data which pre-populates
// inventory items. Tests that require an empty clinic use CLINIC_EMPTY.
const CLINIC_A = SEED_CLINIC_A_ID;
const CLINIC_B = SEED_CLINIC_B_ID;
const CLINIC_EMPTY = "00000000-0000-0000-0000-ffffffffffff";

function makeManager(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-manager-1",
    email: "manager@clinic.au",
    role: "group_practice_manager",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeStaff(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-staff-1",
    email: "staff@clinic.au",
    role: "clinical_staff",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

// ─── Setup helpers ─────────────────────────────────────────────────────────────

function buildService() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const stocktakeRepo = createInMemoryStocktakeRepository();
  const service = createStocktakeService(stocktakeRepo, inventoryRepo);
  return { service, inventoryRepo, stocktakeRepo };
}

/**
 * Helper: start a session, then count every line so the session can be completed.
 * An optional overrideCount function lets individual tests change specific counts.
 */
async function startAndCountAll(
  service: ReturnType<typeof buildService>["service"],
  stocktakeRepo: ReturnType<typeof buildService>["stocktakeRepo"],
  clinicId: string,
  sessionId: string,
  actor: { id: string; email: string; role: string },
  overrideCount?: (lineId: string, expectedQty: number) => number | null,
) {
  await service.startSession(clinicId, sessionId, actor);
  const lines = await stocktakeRepo.listLines(clinicId, sessionId);

  for (const line of lines) {
    const countedQuantity = overrideCount
      ? overrideCount(line.id, line.expectedQuantity)
      : line.expectedQuantity; // default: count exactly equals expected (zero variance)

    await service.updateLine(clinicId, sessionId, line.id, {
      countedQuantity,
      notes: null,
    }, actor);
  }

  return lines;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("StocktakeService", () => {
  // 1. createSession — manager can create
  it("creates a draft session for a manager", async () => {
    const { service } = buildService();
    const manager = makeManager();

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Test Stocktake",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      { id: manager.id, email: manager.email, role: manager.role },
    );

    expect(session.status).toBe("draft");
    expect(session.name).toBe("Test Stocktake");
    expect(session.clinicId).toBe(CLINIC_A);
  });

  // 2. createSession — clinical_staff is rejected
  it("rejects createSession for clinical_staff", async () => {
    const { service } = buildService();
    const staff = makeStaff();

    await expect(
      service.createSession(
        {
          clinicId: CLINIC_A,
          name: "Staff Session",
          createdByUserId: staff.id,
          createdByEmail: staff.email,
        },
        { id: staff.id, email: staff.email, role: staff.role },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // 3. startSession — transitions draft → in_progress, creates lines
  it("starts a session and creates lines from inventory", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Start Test",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      { id: manager.id, email: manager.email, role: manager.role },
    );

    const started = await service.startSession(CLINIC_A, session.id, {
      id: manager.id,
      email: manager.email,
      role: manager.role,
    });

    expect(started.status).toBe("in_progress");
    expect(started.startedByUserId).toBe(manager.id);

    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    expect(lines.length).toBeGreaterThan(0);
  });

  // 4. startSession — rejects if already in_progress
  it("rejects starting an already in_progress session", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Duplicate Start",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    await service.startSession(CLINIC_A, session.id, actor);

    await expect(
      service.startSession(CLINIC_A, session.id, actor),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  // 5. startSession — rejects if no inventory
  it("rejects starting a session when clinic has no inventory", async () => {
    const { service } = buildService();
    const manager = makeManager(CLINIC_EMPTY);
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_EMPTY,
        name: "Empty Clinic",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    await expect(
      service.startSession(CLINIC_EMPTY, session.id, actor),
    ).rejects.toMatchObject({ code: "NO_INVENTORY" });
  });

  // 6. updateLine — staff can update a count
  it("allows clinical_staff to update a line count", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const staff = makeStaff();
    const managerActor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Count Test",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      managerActor,
    );

    await service.startSession(CLINIC_A, session.id, managerActor);

    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    expect(lines.length).toBeGreaterThan(0);
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Expected at least one line");

    const updated = await service.updateLine(
      CLINIC_A,
      session.id,
      firstLine.id,
      { countedQuantity: 5, notes: "Checked twice" },
      { id: staff.id, email: staff.email, role: staff.role },
    );

    expect(updated.countedQuantity).toBe(5);
    expect(updated.notes).toBe("Checked twice");
    expect(updated.variance).toBe(5 - firstLine.expectedQuantity);
  });

  // 7. updateLine — rejects negative countedQuantity
  it("rejects a negative countedQuantity", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Negative Test",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    await service.startSession(CLINIC_A, session.id, actor);

    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    expect(lines.length).toBeGreaterThan(0);
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Expected at least one line");

    await expect(
      service.updateLine(
        CLINIC_A,
        session.id,
        firstLine.id,
        { countedQuantity: -1, notes: null },
        actor,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // 8. updateLine — rejects on completed session
  // All lines must be counted before completion (Sprint 1.1).
  it("rejects updating a line on a completed session", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Complete Block Test",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    const lines = await startAndCountAll(service, stocktakeRepo, CLINIC_A, session.id, actor);
    await service.completeSession(CLINIC_A, session.id, actor);

    expect(lines.length).toBeGreaterThan(0);
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Expected at least one line");

    await expect(
      service.updateLine(
        CLINIC_A,
        session.id,
        firstLine.id,
        { countedQuantity: 5, notes: null },
        actor,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  // 9. cancelSession — manager can cancel draft
  it("cancels a draft session", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Cancel Draft",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    const cancelled = await service.cancelSession(CLINIC_A, session.id, actor);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledByUserId).toBe(manager.id);
  });

  // 10. cancelSession — manager can cancel in_progress
  it("cancels an in_progress session", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Cancel In Progress",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    await service.startSession(CLINIC_A, session.id, actor);
    const cancelled = await service.cancelSession(CLINIC_A, session.id, actor);
    expect(cancelled.status).toBe("cancelled");
  });

  // 11. cancelSession — clinical_staff is rejected
  it("rejects cancelSession for clinical_staff", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const staff = makeStaff();
    const managerActor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Staff Cancel",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      managerActor,
    );

    await expect(
      service.cancelSession(CLINIC_A, session.id, {
        id: staff.id,
        email: staff.email,
        role: staff.role,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // 12. completeSession — applies adjustments for variance lines (all lines counted)
  it("completes session and applies adjustments for variance", async () => {
    const { service, stocktakeRepo, inventoryRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Complete Variance",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    // Count every line; override the first line to introduce a variance.
    let firstLineId: string | undefined;
    let firstLineExpected = 0;

    const lines = await startAndCountAll(
      service, stocktakeRepo, CLINIC_A, session.id, actor,
      (lineId, expectedQty) => {
        if (!firstLineId) {
          firstLineId = lineId;
          firstLineExpected = expectedQty;
          return expectedQty + 3; // variance of +3 on the first line
        }
        return expectedQty; // zero variance for all others
      },
    );

    expect(lines.length).toBeGreaterThan(0);
    if (!firstLineId) throw new Error("Expected a first line");

    const result = await service.completeSession(CLINIC_A, session.id, actor);

    expect(result.session.status).toBe("completed");
    expect(result.adjustmentsApplied).toBeGreaterThanOrEqual(1);

    // Verify the inventory was updated for the first line.
    const firstLine = lines.find((l) => l.id === firstLineId);
    if (!firstLine) throw new Error("Could not find first line");

    const item = await inventoryRepo.findClinicInventoryItem(
      CLINIC_A,
      firstLine.clinicInventoryItemId,
    );
    expect(item?.quantityOnHand).toBe(firstLineExpected + 3);
  });

  // 13. completeSession — rejects if not in_progress
  it("rejects completing a draft session", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      {
        clinicId: CLINIC_A,
        name: "Complete Draft Reject",
        createdByUserId: manager.id,
        createdByEmail: manager.email,
      },
      actor,
    );

    await expect(
      service.completeSession(CLINIC_A, session.id, actor),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  // 14. listSessions — returns paginated results
  it("lists sessions with pagination", async () => {
    const { service } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    await service.createSession(
      { clinicId: CLINIC_A, name: "Session A", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );
    await service.createSession(
      { clinicId: CLINIC_A, name: "Session B", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );

    const page = await service.listSessions(CLINIC_A, { limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(2);
  });

  // 15. Cross-tenant isolation
  it("does not expose clinic B sessions to clinic A queries", async () => {
    const { service } = buildService();
    const managerB = makeManager(CLINIC_B);

    await service.createSession(
      { clinicId: CLINIC_B, name: "Clinic B Session", createdByUserId: managerB.id, createdByEmail: managerB.email },
      { id: managerB.id, email: managerB.email, role: managerB.role },
    );

    const page = await service.listSessions(CLINIC_A, {});
    expect(page.items.every((s) => s.clinicId === CLINIC_A)).toBe(true);
    expect(page.total).toBe(0);
  });

  // ── Sprint 1.1: Pilot-readiness tests ────────────────────────────────────────

  // 16. completeSession — BLOCKED when any line is uncounted
  it("blocks completion when at least one line is uncounted", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      { clinicId: CLINIC_A, name: "Partial Count", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );

    await service.startSession(CLINIC_A, session.id, actor);

    // Count only the first line — leave all others uncounted.
    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    expect(lines.length).toBeGreaterThan(1); // Need at least 2 lines for this test.
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Expected at least one line");

    await service.updateLine(
      CLINIC_A, session.id, firstLine.id,
      { countedQuantity: firstLine.expectedQuantity, notes: null },
      actor,
    );

    // Completion must fail with UNCOUNTED_LINES.
    await expect(
      service.completeSession(CLINIC_A, session.id, actor),
    ).rejects.toMatchObject({ code: "UNCOUNTED_LINES" });
  });

  // 17. completeSession — succeeds when every line has been counted
  it("succeeds when all lines are counted before completion", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      { clinicId: CLINIC_A, name: "Full Count", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );

    await startAndCountAll(service, stocktakeRepo, CLINIC_A, session.id, actor);

    const result = await service.completeSession(CLINIC_A, session.id, actor);
    expect(result.session.status).toBe("completed");
  });

  // 18. updateLine — countedQuantity = 0 is valid (not treated as uncounted)
  it("accepts countedQuantity = 0 as a valid count", async () => {
    const { service, stocktakeRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      { clinicId: CLINIC_A, name: "Zero Count", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );

    await service.startSession(CLINIC_A, session.id, actor);
    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Expected at least one line");

    // Set counted = 0 — should be accepted and stored.
    const updated = await service.updateLine(
      CLINIC_A, session.id, firstLine.id,
      { countedQuantity: 0, notes: null },
      actor,
    );

    expect(updated.countedQuantity).toBe(0);
    // Variance should be 0 - expectedQuantity (negative if expected > 0).
    expect(updated.variance).toBe(0 - firstLine.expectedQuantity);

    // Count all remaining lines, then complete — should succeed.
    const remaining = lines.filter((l) => l.id !== firstLine.id);
    for (const line of remaining) {
      await service.updateLine(
        CLINIC_A, session.id, line.id,
        { countedQuantity: line.expectedQuantity, notes: null },
        actor,
      );
    }

    const result = await service.completeSession(CLINIC_A, session.id, actor);
    expect(result.session.status).toBe("completed");
  });

  // 19. startSession — snapshot fields are populated at session-start
  it("stores product snapshot fields (name, category, stockUnit) when session starts", async () => {
    const { service, stocktakeRepo, inventoryRepo } = buildService();
    const manager = makeManager();
    const actor = { id: manager.id, email: manager.email, role: manager.role };

    const session = await service.createSession(
      { clinicId: CLINIC_A, name: "Snapshot Test", createdByUserId: manager.id, createdByEmail: manager.email },
      actor,
    );

    // Read inventory items before starting to get the expected snapshot values.
    const inventoryItems = await inventoryRepo.listClinicInventory(CLINIC_A);
    expect(inventoryItems.length).toBeGreaterThan(0);

    await service.startSession(CLINIC_A, session.id, actor);

    const lines = await stocktakeRepo.listLines(CLINIC_A, session.id);
    expect(lines.length).toBe(inventoryItems.length);

    // Each line must store the productName, category, and stockUnit that matched
    // the corresponding inventory item at session-start time.
    for (const line of lines) {
      const sourceItem = inventoryItems.find(
        (item) => item.id === line.clinicInventoryItemId,
      );
      if (!sourceItem) throw new Error(`No inventory item for line ${line.id}`);

      expect(line.productName).toBe(sourceItem.name);
      expect(line.category).toBe(sourceItem.category);
      expect(line.stockUnit).toBe(sourceItem.stockUnit);
      // primaryBarcode is null in in-memory repo (no barcode lookup); that is expected.
      expect(line.primaryBarcode).toBeNull();
    }
  });
});
