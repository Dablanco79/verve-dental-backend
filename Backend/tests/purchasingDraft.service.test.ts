/**
 * purchasingDraft.service.test.ts
 *
 * Tests for Workflow 1.1 operational findings:
 *
 *   Finding 4 — Purchasing Draft parent / child PO architecture
 *     - createPurchasingDraft creates parent + one child PO per supplier group
 *     - References are PD-YYYYMMDD-NNNN (parent) / PO-YYYYMMDD-NNNN-01 (child)
 *     - Each child is linked to the parent via purchasingDraftId
 *     - Different supplier groups produce separate child POs
 *     - Empty supplier groups are rejected
 *     - Zero / negative quantities are rejected
 *     - Derived status: draft → partially_submitted → ordered → partially_received → complete
 *     - Derived status: all cancelled → cancelled
 *     - listPurchasingDrafts is clinic-scoped
 *     - findPurchasingDraftById returns null for wrong clinic (isolation)
 *     - Existing standalone POs (no purchasingDraftId) are unaffected
 *     - Audit events emitted for PD creation and each child PO
 *
 *   Finding 5 — In-draft / on-order quantities on inventory view
 *     - inDraftQuantity reflects lines on draft POs
 *     - onOrderQuantity reflects outstanding quantity on submitted/partially_received POs
 *     - Partial receipt reduces onOrderQuantity correctly
 *     - Full receipt zeroes onOrderQuantity
 *     - Cancelled PO lines are excluded from both quantities
 *     - activePurchasingDocuments links to PD reference when available
 *
 *   Finding 3 — Unit UoM: Unit → Unit resolves to 1:1 conversion
 *
 *   Finding 1 — createPurchasingDraft from low-stock queue (service reuse)
 *
 *   Regression — standalone (non-PD) manual PO creation still works
 */

import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createPurchaseOrderService } from "../src/services/purchaseOrderService.js";
import { derivePurchasingDraftStatus } from "../src/repositories/inventoryRepository.js";
import { resolveConversionFactorFromCatalogItem } from "../src/services/receivingEngine.js";
import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "../src/repositories/userRepository.js";
import {
  SEED_CLINIC_INVENTORY_IDS,
  SEED_MASTER_CATALOG_IDS,
} from "../src/repositories/seed/inventorySeed.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const CLINIC_B = SEED_CLINIC_B_ID;
const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000099";
const ACTOR_EMAIL = "test.pd@clinic.test";

const BURS_CATALOG_ID = SEED_MASTER_CATALOG_IDS.diamondBurs;
const BURS_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicABurs;

const GLOVES_CATALOG_ID = SEED_MASTER_CATALOG_IDS.nitrileGloves;
const GLOVES_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicAGloves;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeAuditService() {
  const events: Array<{ event: string; meta: unknown }> = [];
  return {
    logEvent: (event: string, meta: unknown) => { events.push({ event, meta }); },
    getEvents: () => events,
    recordEvent: (): Promise<void> => Promise.resolve(),
  };
}

function makeService() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const auditService = makeFakeAuditService();
  const auditWriter = { recordEvent: (): Promise<void> => Promise.resolve() };
  const service = createPurchaseOrderService(
    inventoryRepo,
    catalogRepo,
    auditService as unknown as Parameters<typeof createPurchaseOrderService>[2],
    auditWriter,
  );
  return { service, inventoryRepo, auditService };
}

/** Minimum valid supplier group for burs */
const bursGroup = () => ({
  supplierId: "supplier-burs",
  supplierName: "BurDirect",
  lines: [
    {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2,
    },
  ],
});

/** Minimum valid supplier group for gloves */
const glovesGroup = () => ({
  supplierId: "supplier-gloves",
  supplierName: "GloveCo",
  lines: [
    {
      masterCatalogItemId: GLOVES_CATALOG_ID,
      clinicInventoryItemId: GLOVES_INV_ID,
      quantity: 3,
    },
  ],
});

// ─── Finding 4: Purchasing Draft parent / child architecture ──────────────────

describe("createPurchasingDraft — reference format", () => {
  it("returns a PD- prefixed draft reference and at least one PO- prefixed child", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    expect(result.purchasingDraft.draftReference).toMatch(/^PD-\d{8}-\d{4}$/);
    expect(result.childPos).toHaveLength(1);
    const firstChild = result.childPos[0];
    expect(firstChild?.purchaseOrder.poReference).toMatch(/^PO-\d{8}-\d{4}-01$/);
  });

  it("shares the numeric suffix between the PD and all child POs", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });

    const pdRef = result.purchasingDraft.draftReference; // PD-YYYYMMDD-NNNN
    const suffix = pdRef.slice(3); // YYYYMMDD-NNNN
    for (const child of result.childPos) {
      expect(child.purchaseOrder.poReference).toContain(`PO-${suffix}-`);
    }
  });

  it("numbers child POs sequentially: -01, -02, …", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });

    const refs = result.childPos.map((c) => c.purchaseOrder.poReference ?? "");
    expect(refs[0]).toMatch(/-01$/);
    expect(refs[1]).toMatch(/-02$/);
  });
});

describe("createPurchasingDraft — child PO-per-supplier integrity", () => {
  it("creates exactly one child PO for a single supplier group", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });
    expect(result.childPos).toHaveLength(1);
  });

  it("creates exactly two child POs for two distinct supplier groups", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });
    expect(result.childPos).toHaveLength(2);
  });

  it("each child PO carries the correct supplier ID from its group", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });

    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const pdPos = pos.filter(
      (po) => po.purchasingDraftId === result.purchasingDraft.id,
    );
    const supplierIds = pdPos.map((po) => po.supplierId);
    expect(supplierIds).toContain("supplier-burs");
    expect(supplierIds).toContain("supplier-gloves");
  });

  it("each child PO is linked to the parent Purchasing Draft", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });

    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const childPos = pos.filter(
      (po) => po.purchasingDraftId === result.purchasingDraft.id,
    );
    expect(childPos).toHaveLength(2);
    for (const po of childPos) {
      expect(po.purchasingDraftId).toBe(result.purchasingDraft.id);
    }
  });

  it("standalone manual PO has no purchasingDraftId (backward compatibility)", async () => {
    const { service, inventoryRepo } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const found = pos.find((p) => p.id === po.id);
    expect(found?.purchasingDraftId ?? null).toBeNull();
  });
});

describe("createPurchasingDraft — validation", () => {
  it("rejects when supplierGroups is empty", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, { supplierGroups: [] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects when a supplier group has no lines", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
        supplierGroups: [{ ...bursGroup(), lines: [] }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects when a line has zero quantity", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
        supplierGroups: [
          {
            ...bursGroup(),
            lines: [{ masterCatalogItemId: BURS_CATALOG_ID, clinicInventoryItemId: BURS_INV_ID, quantity: 0 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects when a line has a negative quantity", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
        supplierGroups: [
          {
            ...bursGroup(),
            lines: [{ masterCatalogItemId: BURS_CATALOG_ID, clinicInventoryItemId: BURS_INV_ID, quantity: -1 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("createPurchasingDraft — audit events", () => {
  it("emits purchasing_draft.created for the parent PD", async () => {
    const { service, auditService } = makeService();
    await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });
    const ev = auditService.getEvents().find((e) => e.event === "purchasing_draft.created");
    expect(ev).toBeDefined();
    expect((ev?.meta as { clinicId: string } | undefined)?.clinicId).toBe(CLINIC_A);
  });

  it("emits purchase_order.created for each child PO", async () => {
    const { service, auditService } = makeService();
    await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });
    const poEvents = auditService.getEvents().filter((e) => e.event === "purchase_order.created");
    expect(poEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("emits purchase_order.line_added for each line in each child PO", async () => {
    const { service, auditService } = makeService();
    await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        {
          ...bursGroup(),
          lines: [
            { masterCatalogItemId: BURS_CATALOG_ID, clinicInventoryItemId: BURS_INV_ID, quantity: 1 },
          ],
        },
        {
          ...glovesGroup(),
          lines: [
            { masterCatalogItemId: GLOVES_CATALOG_ID, clinicInventoryItemId: GLOVES_INV_ID, quantity: 1 },
          ],
        },
      ],
    });
    const lineEvents = auditService.getEvents().filter((e) => e.event === "purchase_order.line_added");
    expect(lineEvents.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Finding 4: Derived parent status ─────────────────────────────────────────

describe("derivePurchasingDraftStatus", () => {
  it("returns 'draft' when there are no children", () => {
    expect(derivePurchasingDraftStatus([])).toBe("draft");
  });

  it("returns 'draft' when all children are draft", () => {
    expect(derivePurchasingDraftStatus(["draft", "draft"])).toBe("draft");
  });

  it("returns 'partially_submitted' when some are submitted and some draft", () => {
    expect(derivePurchasingDraftStatus(["submitted", "draft"])).toBe("partially_submitted");
  });

  it("returns 'ordered' when all are submitted", () => {
    expect(derivePurchasingDraftStatus(["submitted", "submitted"])).toBe("ordered");
  });

  it("returns 'partially_received' when some are received/partially_received", () => {
    expect(derivePurchasingDraftStatus(["submitted", "partially_received"])).toBe("partially_received");
    expect(derivePurchasingDraftStatus(["submitted", "received"])).toBe("partially_received");
  });

  it("returns 'complete' when all non-cancelled are received", () => {
    expect(derivePurchasingDraftStatus(["received", "received"])).toBe("complete");
  });

  it("returns 'complete' ignoring cancelled siblings when rest are received", () => {
    expect(derivePurchasingDraftStatus(["received", "cancelled"])).toBe("complete");
  });

  it("returns 'cancelled' when all children are cancelled", () => {
    expect(derivePurchasingDraftStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });
});

describe("listPurchasingDrafts — derived status integration", () => {
  it("returns 'ordered' after all child POs are submitted", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const childPo = pos.find((po) => po.purchasingDraftId === result.purchasingDraft.id);
    if (!childPo) throw new Error("Expected child PO to exist");

    // Add a line first to allow submission
    await service.addPoLine(CLINIC_A, childPo.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 1,
    });
    await service.submitPurchaseOrder(CLINIC_A, childPo.id, ACTOR_ID, ACTOR_EMAIL);

    const drafts = await service.listPurchasingDrafts(CLINIC_A);
    const pd = drafts.find((d) => d.id === result.purchasingDraft.id);
    expect(pd?.derivedStatus).toBe("ordered");
  });
});

// ─── Finding 4: Clinic isolation ──────────────────────────────────────────────

describe("listPurchasingDrafts — clinic isolation", () => {
  it("does not return drafts from another clinic", async () => {
    const { service } = makeService();
    await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const clinicBDrafts = await service.listPurchasingDrafts(CLINIC_B);
    expect(clinicBDrafts).toHaveLength(0);
  });
});

describe("getPurchasingDraftDetail — clinic isolation", () => {
  it("throws 404 when accessing a PD from the wrong clinic", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    await expect(
      service.getPurchasingDraftDetail(CLINIC_B, result.purchasingDraft.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── Finding 5: In-draft and on-order quantity tracking ───────────────────────

describe("inDraftQuantity — inventory view", () => {
  it("reflects lines on draft POs in inDraftQuantity (in stock units)", async () => {
    const { service, inventoryRepo } = makeService();

    // Diamond burs: receivingUnit=Case, 6 packs per case (stock unit = Pack)
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2, // 2 cases × 6 packs = 12 stock units
    });

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.inDraftQuantity).toBe(12);
    expect(bursItem?.onOrderQuantity).toBe(0);
  });

  it("reflects zero inDraftQuantity when PO is submitted", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 1,
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.inDraftQuantity).toBe(0);
  });
});

describe("onOrderQuantity — inventory view", () => {
  it("reflects outstanding quantity after submission (in stock units)", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 3, // 3 cases × 6 packs = 18 stock units
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.onOrderQuantity).toBe(18);
  });

  it("reduces onOrderQuantity after partial receipt", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2, // 2 cases = 12 stock units
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);

    // Receive 1 case (6 packs) — outstanding 1 case = 6 stock units
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 1 },
    ]);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.onOrderQuantity).toBe(6);
  });

  it("zeroes onOrderQuantity after full receipt", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2,
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 2 },
    ]);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.onOrderQuantity).toBe(0);
    expect(bursItem?.inDraftQuantity).toBe(0);
  });

  it("excludes cancelled PO lines from onOrderQuantity and inDraftQuantity", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2,
    });
    await service.cancelPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.inDraftQuantity).toBe(0);
    expect(bursItem?.onOrderQuantity).toBe(0);
  });
});

describe("activePurchasingDocuments — inventory view", () => {
  it("includes active draft PO in activePurchasingDocuments", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 1,
    });

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.activePurchasingDocuments).toHaveLength(1);
    expect(bursItem?.activePurchasingDocuments[0]?.poId).toBe(po.id);
  });

  it("includes the parent draftReference when PO belongs to a Purchasing Draft", async () => {
    const { service, inventoryRepo } = makeService();

    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    const doc = bursItem?.activePurchasingDocuments[0];
    expect(doc?.purchasingDraftId).toBe(result.purchasingDraft.id);
    expect(doc?.draftReference).toBe(result.purchasingDraft.draftReference);
  });

  it("excludes received and cancelled POs from activePurchasingDocuments", async () => {
    const { service, inventoryRepo } = makeService();

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 1,
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 1 },
    ]);

    const items = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursItem = items.find((i) => i.id === BURS_INV_ID);
    expect(bursItem?.activePurchasingDocuments).toHaveLength(0);
  });
});

// ─── Finding 3: "Unit" → "Unit" = 1:1 conversion ─────────────────────────────

describe("resolveConversionFactorFromCatalogItem — Unit-to-Unit", () => {
  it("returns conversionFactor=1 when stockUnit and receivingUnit are both 'Unit'", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "Unit", receivingUnit: "Unit", unitsPerReceivingUnit: 1 },
      "Unit",
    );
    expect(result.conversionFactor).toBe(1);
    expect(result.stockUnit).toBe("Unit");
  });

  it("returns conversionFactor=1 when lineReceivingUnit is null and catalog uses Unit/Unit", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "Unit", receivingUnit: "Unit", unitsPerReceivingUnit: 1 },
      null,
    );
    expect(result.conversionFactor).toBe(1);
  });

  it("still correctly resolves Carton → Box with unitsPerReceivingUnit=10", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: 10 },
      "Carton",
    );
    expect(result.conversionFactor).toBe(10);
  });

  it("throws UNIT_MISMATCH for an unrecognised receiving unit", () => {
    expect(() =>
      resolveConversionFactorFromCatalogItem(
        { stockUnit: "Unit", receivingUnit: "Unit", unitsPerReceivingUnit: 1 },
        "Pallet",
      ),
    ).toThrow(/does not match catalog stock unit/);
  });
});

// ─── Finding 1: createPurchasingDraft reuses PO service (low-stock queue path) ─

describe("createPurchasingDraft — low-stock queue service reuse", () => {
  it("creates lines with reason='low_stock' by default when no reason is provided", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const childPo = pos.find((po) => po.id === result.childPos[0]?.purchaseOrder.id);
    if (!childPo) throw new Error("Expected child PO to exist");

    // Low stock items from the queue carry the low_stock reason
    const lines = await inventoryRepo.listPoLinesByPoId(childPo.id);
    expect(lines[0]?.reason).toBe("low_stock");
  });

  it("supports optional notes passed to child POs", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
      notes: "Urgent — low stock priority",
    });

    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const childPo = pos.find((po) => po.id === result.childPos[0]?.purchaseOrder.id);
    expect(childPo?.notes).toBe("Urgent — low stock priority");
  });

  it("a Purchasing Draft is returned by listPurchasingDrafts for the correct clinic", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const drafts = await service.listPurchasingDrafts(CLINIC_A);
    expect(drafts.some((d) => d.id === result.purchasingDraft.id)).toBe(true);
  });

  it("getPurchasingDraftDetail returns the full child PO and line information", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup()],
    });

    const detail = await service.getPurchasingDraftDetail(
      CLINIC_A,
      result.purchasingDraft.id,
    );
    expect(detail.purchasingDraft.id).toBe(result.purchasingDraft.id);
    expect(detail.childPos).toHaveLength(1);
    expect(detail.childPos[0]?.lines.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Regression: existing standalone PO operations remain unaffected ──────────

describe("regression — standalone PO creation and lifecycle", () => {
  it("createManualPurchaseOrder still works (no purchasingDraftId)", async () => {
    const { service } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
      poReference: "LEGACY-001",
    });
    expect(po.status).toBe("draft");
    expect(po.poReference).toBe("LEGACY-001");
  });

  it("addPoLine, submitPurchaseOrder, receivePurchaseOrder still work on standalone POs", async () => {
    const { service } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2,
    });
    const submitted = await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    expect(submitted.purchaseOrder.status).toBe("submitted");

    const received = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 2 },
    ]);
    expect(received.purchaseOrder.status).toBe("received");
  });

  it("cancelPurchaseOrder still works on a standalone draft PO", async () => {
    const { service } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {});
    const result = await service.cancelPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    expect(result.status).toBe("cancelled");
  });
});
