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
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import { createInMemorySupplierRepository } from "../src/repositories/supplierRepository.js";
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

/**
 * Service variant with a real supplier catalogue and supplier repos wired in.
 * Required for tests that verify estimatedUnitCostCents / estimatedLineCostCents
 * enrichment from either the stored snapshot or the supplier catalogue fallback.
 */
function makeServiceWithPricing() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const supplierCatalogueRepo = createInMemorySupplierCatalogueRepository();
  const supplierRepo = createInMemorySupplierRepository();
  const auditService = makeFakeAuditService();
  const auditWriter = { recordEvent: (): Promise<void> => Promise.resolve() };
  const service = createPurchaseOrderService(
    inventoryRepo,
    catalogRepo,
    auditService as unknown as Parameters<typeof createPurchaseOrderService>[2],
    auditWriter,
    supplierCatalogueRepo,
    supplierRepo,
  );
  return { service, inventoryRepo, catalogRepo, supplierCatalogueRepo, supplierRepo, auditService };
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

// ─── ARCHITECTURAL CORRECTION SPRINT tests ───────────────────────────────────

// TEST 1 — Manual PO requires supplier
describe("createManualPurchaseOrder — supplier required (RULE 3)", () => {
  it("rejects creating a manual PO without a supplierId", async () => {
    const { service } = makeService();
    await expect(
      service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {}),
    ).rejects.toMatchObject({ statusCode: 400, code: "PO_NO_SUPPLIER" });
  });

  it("rejects when supplierId is explicitly null", async () => {
    const { service } = makeService();
    await expect(
      service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, { supplierId: null }),
    ).rejects.toMatchObject({ statusCode: 400, code: "PO_NO_SUPPLIER" });
  });

  // TEST 2 — Valid manual PO creation (supplier provided)
  it("creates successfully when supplierId is provided", async () => {
    const { service } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    expect(po.status).toBe("draft");
    expect(po.supplierId).toBe("supplier-1");
  });
});

// TEST 4 — Multi-supplier Purchasing Draft creates separate child POs
describe("createPurchasingDraft — multi-supplier produces separate child POs", () => {
  it("two supplier groups produce two child POs, no mixed supplier lines", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [bursGroup(), glovesGroup()],
    });
    expect(result.childPos).toHaveLength(2);
    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const bursPos = pos.filter((p) => p.supplierId === "supplier-burs");
    const glovePos = pos.filter((p) => p.supplierId === "supplier-gloves");
    expect(bursPos).toHaveLength(1);
    expect(glovePos).toHaveLength(1);
    // Verify no mixed lines: burs PO only has burs lines
    const bursPo = bursPos[0];
    const glovesPo = glovePos[0];
    if (!bursPo || !glovesPo) throw new Error("Expected exactly one PO per supplier group");
    const bursLines = await inventoryRepo.listPoLinesByPoId(bursPo.id);
    expect(bursLines.every((l) => l.masterCatalogItemId === BURS_CATALOG_ID)).toBe(true);
    // Gloves PO only has gloves lines
    const glovesLines = await inventoryRepo.listPoLinesByPoId(glovesPo.id);
    expect(glovesLines.every((l) => l.masterCatalogItemId === GLOVES_CATALOG_ID)).toBe(true);
  });
});

// TEST 5 — Unresolved supplier group in Purchasing Draft
describe("createPurchasingDraft — unresolved supplier groups", () => {
  it("skips null-supplier groups and returns them as unresolvedGroups", async () => {
    const { service } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        bursGroup(),
        {
          supplierId: null,
          supplierName: "No supplier assigned",
          lines: [
            { masterCatalogItemId: GLOVES_CATALOG_ID, clinicInventoryItemId: GLOVES_INV_ID, quantity: 1 },
          ],
        },
      ],
    });
    // Only the resolved supplier group gets a child PO
    expect(result.childPos).toHaveLength(1);
    // The null-supplier group is returned for UI to handle
    expect(result.unresolvedGroups).toHaveLength(1);
    expect(result.unresolvedGroups[0]?.supplierName).toBe("No supplier assigned");
    expect(result.unresolvedGroups[0]?.lineCount).toBe(1);
  });

  it("rejects when ALL groups are null-supplier", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
        supplierGroups: [
          {
            supplierId: null,
            supplierName: "No supplier",
            lines: [{ masterCatalogItemId: BURS_CATALOG_ID, clinicInventoryItemId: BURS_INV_ID, quantity: 1 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("resolved groups produce child POs even when some groups are unresolved", async () => {
    const { service, inventoryRepo } = makeService();
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        bursGroup(),
        {
          supplierId: null,
          supplierName: "Unresolved supplier",
          lines: [{ masterCatalogItemId: GLOVES_CATALOG_ID, clinicInventoryItemId: GLOVES_INV_ID, quantity: 2 }],
        },
      ],
    });
    expect(result.childPos).toHaveLength(1);
    const pos = await inventoryRepo.listPurchaseOrders(CLINIC_A);
    const bursPos = pos.find((p) => p.supplierId === "supplier-burs");
    expect(bursPos).toBeDefined();
    // Verify no supplier-less child PO was created for the unresolved group
    const nullSupplierPos = pos.filter((p) => p.supplierId === null);
    expect(nullSupplierPos).toHaveLength(0);
  });
});

// TEST 7 — PO receiving lifecycle regression (Test 10 in spec)
describe("PO receiving lifecycle — partial then full", () => {
  it("transitions draft → submitted → partially_received → received", async () => {
    const { service } = makeService();
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 4,
    });
    const submitted = await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    expect(submitted.purchaseOrder.status).toBe("submitted");

    // Partial receipt
    const partial = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 2 },
    ]);
    expect(partial.purchaseOrder.status).toBe("partially_received");

    // Remaining receipt
    const full = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 2 },
    ]);
    expect(full.purchaseOrder.status).toBe("received");
  });
});

// TEST 8 — Unit conversion regression (Test 11 in spec)
describe("Unit conversion regression — Carton to Box", () => {
  it("2 Cartons of burs (6 packs/carton) = 12 stock units received", async () => {
    const { service, inventoryRepo } = makeService();

    // Get initial stock level for burs
    const itemsBefore = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursBefore = itemsBefore.find((i) => i.id === BURS_INV_ID);
    const stockBefore = bursBefore?.quantityOnHand ?? 0;

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
      masterCatalogItemId: BURS_CATALOG_ID,
      clinicInventoryItemId: BURS_INV_ID,
      quantity: 2, // 2 receiving units (Cases in seed data)
    });
    await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: line.id, quantityDelta: 2 },
    ]);

    const itemsAfter = await inventoryRepo.listClinicInventory(CLINIC_A);
    const bursAfter = itemsAfter.find((i) => i.id === BURS_INV_ID);
    // Burs seed: receivingUnit=Case, unitsPerReceivingUnit=6, stockUnit=Pack
    // 2 Cases × 6 packs/case = 12 stock units
    expect(bursAfter?.quantityOnHand).toBe(stockBefore + 12);
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

// ─── SPRINT TEST 7 — Bibs pricing: stored snapshot used for estimatedCost ──────
//
// Root cause: enrichWithCostEstimation previously ignored line.unitCostCents and
// went straight to the supplier catalogue, returning null if no entry existed.
// After the fix, the stored snapshot is priority 1.

describe("SPRINT TEST 7 — pricing snapshot: stored unitCostCents drives estimatedLineCostCents", () => {
  it("uses stored unitCostCents (2625) from the PD line when no supplier catalogue entry exists", async () => {
    const { service } = makeServiceWithPricing();

    // Create a PD with a known unit cost on the line (simulates Bibs at $26.25)
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        {
          supplierId: "supplier-burs",
          supplierName: "Adam Dental",
          lines: [
            {
              masterCatalogItemId: BURS_CATALOG_ID,
              clinicInventoryItemId: BURS_INV_ID,
              quantity: 1,
              unitCostCents: 2625,  // $26.25 per stock unit (Bibs scenario)
            },
          ],
        },
      ],
    });

    // Load the full PD detail — this triggers enrichWithCostEstimation
    const detail = await service.getPurchasingDraftDetail(CLINIC_A, result.purchasingDraft.id);
    const firstChild = detail.childPos[0];
    if (!firstChild) throw new Error("Expected at least one child PO");
    const line = firstChild.lines[0];
    if (!line) throw new Error("Expected at least one PO line");

    // Burs: stockUnit=Pack, receivingUnit=Case, unitsPerReceivingUnit=6
    // estimatedUnitCostCents = 2625 × 6 = 15750 ($157.50 per Case)
    // estimatedLineCostCents = 15750 × 1 = 15750
    expect(line.estimatedUnitCostCents).toBe(2625 * 6); // per receiving unit (Case)
    expect(line.estimatedLineCostCents).toBe(2625 * 6 * 1); // qty=1 Case
    expect(line.estimatedUnitCostCents).not.toBeNull();
    expect(line.estimatedLineCostCents).not.toBeNull();
  });

  it("uses 1:1 conversion when receivingUnit equals stockUnit (Bibs box=box scenario)", async () => {
    // Build a fresh service backed by a catalogue repo that has a 1:1 Bibs item
    const catalogRepo = createInMemoryCatalogRepository();
    const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
    const supplierCatalogueRepo = createInMemorySupplierCatalogueRepository();
    const supplierRepo = createInMemorySupplierRepository();
    const auditWriter = { recordEvent: (): Promise<void> => Promise.resolve() };
    const svc = createPurchaseOrderService(
      inventoryRepo,
      catalogRepo,
      makeFakeAuditService() as unknown as Parameters<typeof createPurchaseOrderService>[2],
      auditWriter,
      supplierCatalogueRepo,
      supplierRepo,
    );

    // Create a catalog item with 1:1 unit conversion (Bibs: Box = Box)
    const bibs = await catalogRepo.createMasterItem({
      sku: "ADA201",
      name: "Bibs",
      description: "Dental bibs",
      category: "Consumables",
      stockUnit: "Box",
      receivingUnit: "Box",
      unitsPerReceivingUnit: 1,
      defaultUnitCostCents: 2625,
    });

    const result = await svc.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        {
          supplierId: "supplier-adam-dental",
          supplierName: "Adam Dental",
          lines: [
            {
              masterCatalogItemId: bibs.id,
              clinicInventoryItemId: "bibs-clinic-inv-id",
              quantity: 1,
              unitCostCents: 2625, // $26.25 per Box — the stored snapshot
            },
          ],
        },
      ],
    });

    const detail = await svc.getPurchasingDraftDetail(CLINIC_A, result.purchasingDraft.id);
    const line = detail.childPos[0]?.lines[0];
    if (!line) throw new Error("Expected PO line");

    // 1:1 conversion: estimatedUnitCostCents = 2625 × 1 = 2625
    // estimatedLineCostCents = 2625 × 1 = 2625
    expect(line.estimatedUnitCostCents).toBe(2625);
    expect(line.estimatedLineCostCents).toBe(2625);
  });

  it("estimated total is correct with conversion factor (Box/Carton scenario)", async () => {
    const { service } = makeServiceWithPricing();

    // Burs: unitsPerReceivingUnit=6 (Case), unitCostCents=800 per Pack (stock unit)
    // Order 3 Cases: estimatedUnitCost = 800×6 = 4800, estimatedLine = 4800×3 = 14400
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        {
          supplierId: "supplier-burs",
          supplierName: "BurDirect",
          lines: [
            {
              masterCatalogItemId: BURS_CATALOG_ID,
              clinicInventoryItemId: BURS_INV_ID,
              quantity: 3,
              unitCostCents: 800, // $8.00 per stock unit (Pack)
            },
          ],
        },
      ],
    });

    const detail = await service.getPurchasingDraftDetail(CLINIC_A, result.purchasingDraft.id);
    const line = detail.childPos[0]?.lines[0];
    if (!line) throw new Error("Expected PO line");

    // 3 Cases × 6 Packs/Case × $8/Pack = $144 total
    expect(line.estimatedUnitCostCents).toBe(800 * 6);   // $48/Case
    expect(line.estimatedLineCostCents).toBe(800 * 6 * 3); // $144 total
  });
});

// ─── SPRINT TEST 8 — Pricing snapshot: altering source cost does not change PO ─

describe("SPRINT TEST 8 — pricing snapshot stability: existing PO lines are unaffected by catalogue changes", () => {
  it("changing a supplier catalogue price after PD creation does not alter existing PO lines", async () => {
    const { service, supplierCatalogueRepo } = makeServiceWithPricing();

    // Step 1: Add a catalogue entry at $26.25
    await supplierCatalogueRepo.createSupplierProduct({
      supplierId: "supplier-burs",
      productId: BURS_CATALOG_ID,
      unitCostCents: 2625,
      supplierSku: "ADA201",
    });

    // Step 2: Create PD with stored snapshot of $26.25
    const result = await service.createPurchasingDraft(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierGroups: [
        {
          supplierId: "supplier-burs",
          supplierName: "Adam Dental",
          lines: [
            {
              masterCatalogItemId: BURS_CATALOG_ID,
              clinicInventoryItemId: BURS_INV_ID,
              quantity: 1,
              unitCostCents: 2625,
            },
          ],
        },
      ],
    });

    // Step 3: Change the catalogue price to $50.00
    const entries = await supplierCatalogueRepo.listSupplierProducts({
      supplierId: "supplier-burs",
      productId: BURS_CATALOG_ID,
    });
    if (entries[0]) {
      await supplierCatalogueRepo.updateSupplierProduct(entries[0].id, {
        unitCostCents: 5000,
      });
    }

    // Step 4: Reload the PD — the existing line must still show $26.25 (snapshot preserved)
    const detail = await service.getPurchasingDraftDetail(CLINIC_A, result.purchasingDraft.id);
    const line = detail.childPos[0]?.lines[0];
    if (!line) throw new Error("Expected PO line");

    // The stored snapshot (2625 × convFactor) must win over the updated catalogue (5000)
    // Burs convFactor = 6, so: estimatedUnitCostCents = 2625 × 6 = 15750
    expect(line.estimatedUnitCostCents).toBe(2625 * 6);
    expect(line.estimatedLineCostCents).toBe(2625 * 6 * 1);
    expect(line.estimatedUnitCostCents).not.toBe(5000 * 6);
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
    // Supplier is now required for new manual POs (RULE 3).
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: "supplier-1",
    });
    const result = await service.cancelPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
    expect(result.status).toBe("cancelled");
  });
});
