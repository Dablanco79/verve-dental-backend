/**
 * receivingEngine.unitConversion.test.ts
 *
 * Tests for the shared receiving engine's unit conversion logic via the
 * PO service (in-memory path, no database required).
 *
 * Seed data:
 *   diamondBurs   — stockUnit: "Pack",    receivingUnit: "Case",   unitsPerReceivingUnit: 6
 *   nitrileGloves — stockUnit: "Box",     receivingUnit: "Carton", unitsPerReceivingUnit: 10
 *   compositeResin — stockUnit: "Syringe", receivingUnit: "Pack",  unitsPerReceivingUnit: 5
 *
 * Test IDs for Clinic A:
 *   clinicABurs     → diamondBurs (6 packs per case)
 *   clinicAGloves   → nitrileGloves (10 boxes per carton)
 *   clinicAComposite → compositeResin (5 syringes per pack)
 *
 * Also directly tests resolveConversionFactorFromCatalogItem for:
 *   - 1:1 unit (stock unit == receiving unit)
 *   - box-to-unit conversion
 *   - UNIT_MISMATCH when a line's receiving_unit doesn't match
 *   - INVALID_CONVERSION_FACTOR when unitsPerReceivingUnit is invalid
 */
import { describe, it, expect } from "@jest/globals";
import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createPurchaseOrderService } from "../src/services/purchaseOrderService.js";
import { resolveConversionFactorFromCatalogItem } from "../src/services/receivingEngine.js";
import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import {
  SEED_CLINIC_INVENTORY_IDS,
  SEED_MASTER_CATALOG_IDS,
} from "../src/repositories/seed/inventorySeed.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ACTOR_EMAIL = "test@clinic.test";

// Diamond Burs: Pack (stock) / Case (receiving), 6 packs per case.
const BURS_CATALOG_ID = SEED_MASTER_CATALOG_IDS.diamondBurs;
const BURS_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicABurs;

// Nitrile Gloves: Box (stock) / Carton (receiving), 10 boxes per carton.
const GLOVES_CATALOG_ID = SEED_MASTER_CATALOG_IDS.nitrileGloves;
const GLOVES_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicAGloves;

// Composite Resin: Syringe (stock) / Pack (receiving), 5 syringes per pack.
const COMPOSITE_CATALOG_ID = SEED_MASTER_CATALOG_IDS.compositeResin;
const COMPOSITE_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicAComposite;

// ─── Helper ───────────────────────────────────────────────────────────────────

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
  const auditWriter = {
    recordEvent: (): Promise<void> => Promise.resolve(),
  };
  const service = createPurchaseOrderService(
    inventoryRepo,
    catalogRepo,
    auditService as unknown as Parameters<typeof createPurchaseOrderService>[2],
    auditWriter,
  );
  return { service, inventoryRepo, catalogRepo };
}

async function setupSubmittedPo(
  service: ReturnType<typeof makeService>["service"],
  catalogItemId: string,
  inventoryItemId: string,
  orderedQty: number,
  receivingUnit?: string,
) {
  const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
    supplierId: "supplier-1",
  });
  const line = await service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
    masterCatalogItemId: catalogItemId,
    clinicInventoryItemId: inventoryItemId,
    quantity: orderedQty,
    receivingUnit: receivingUnit ?? null,
  });
  await service.submitPurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL);
  return { po, line };
}

// ─── resolveConversionFactorFromCatalogItem unit tests ────────────────────────

describe("resolveConversionFactorFromCatalogItem", () => {
  it("returns 1 when lineReceivingUnit equals stockUnit", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "unit", receivingUnit: "carton", unitsPerReceivingUnit: 100 },
      "unit", // matches stock unit → 1:1
    );
    expect(result.conversionFactor).toBe(1);
    expect(result.stockUnit).toBe("unit");
  });

  it("returns unitsPerReceivingUnit when lineReceivingUnit equals receivingUnit", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: 10 },
      "Carton",
    );
    expect(result.conversionFactor).toBe(10);
  });

  it("uses catalog default when lineReceivingUnit is null", () => {
    const result = resolveConversionFactorFromCatalogItem(
      { stockUnit: "Pack", receivingUnit: "Case", unitsPerReceivingUnit: 6 },
      null,
    );
    expect(result.conversionFactor).toBe(6);
  });

  it("throws UNIT_MISMATCH when lineReceivingUnit matches neither unit", () => {
    expect(() =>
      resolveConversionFactorFromCatalogItem(
        { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: 10 },
        "Pallet", // unknown unit
      ),
    ).toThrow(/does not match catalog stock unit/);
  });

  it("throws INVALID_CONVERSION_FACTOR when unitsPerReceivingUnit is zero", () => {
    expect(() =>
      resolveConversionFactorFromCatalogItem(
        { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: 0 },
        "Carton",
      ),
    ).toThrow(/invalid unitsPerReceivingUnit/);
  });

  it("throws INVALID_CONVERSION_FACTOR when unitsPerReceivingUnit is negative", () => {
    expect(() =>
      resolveConversionFactorFromCatalogItem(
        { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: -5 },
        "Carton",
      ),
    ).toThrow(/invalid unitsPerReceivingUnit/);
  });

  it("throws INVALID_CONVERSION_FACTOR when unitsPerReceivingUnit is not an integer", () => {
    expect(() =>
      resolveConversionFactorFromCatalogItem(
        { stockUnit: "Box", receivingUnit: "Carton", unitsPerReceivingUnit: 1.5 },
        "Carton",
      ),
    ).toThrow(/invalid unitsPerReceivingUnit/);
  });
});

// ─── PO receiving with unit conversion (in-memory path) ──────────────────────

describe("PO receiving — unit conversion", () => {
  it("1:1 unit receipt: stockUnit == receivingUnit adds quantity directly", async () => {
    const { service, inventoryRepo, catalogRepo } = makeService();
    // Confirm catalog item's stockUnit (used as the line receivingUnit for 1:1 behavior).
    const existingItem = await catalogRepo.findMasterItemById(BURS_CATALOG_ID);
    if (!existingItem) throw new Error("Catalog item not found in test setup");
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    // Create a catalog item variant with Pack == Pack (1:1).
    const { po, line } = await setupSubmittedPo(service, BURS_CATALOG_ID, BURS_INV_ID, 3, existingItem.stockUnit);
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    // Receive 2 in stock units (1:1).
    const result = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 2 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    // 1:1 → stockQtyDelta = 2 * 1 = 2
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 2);
    expect(result.adjustments[0]?.quantityDelta).toBe(2);
    expect(result.purchaseOrder.status).toBe("partially_received");
  });

  it("carton-to-unit conversion: 2 Cases × 6 packs/case = 12 packs added to stock", async () => {
    const { service, inventoryRepo } = makeService();
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    // Diamond Burs: receivingUnit=Case, unitsPerReceivingUnit=6.
    // Order 4 Cases, receive 2 Cases.
    const { po, line } = await setupSubmittedPo(service, BURS_CATALOG_ID, BURS_INV_ID, 4, "Case");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    const result = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 2 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    // 2 Cases × 6 packs/case = 12 packs
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 12);
    expect(result.adjustments[0]?.quantityDelta).toBe(12);
  });

  it("partial receipt conversion: 1 Carton × 10 boxes = 10 boxes added, PO status = partially_received", async () => {
    const { service, inventoryRepo } = makeService();
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    // Nitrile Gloves: unitsPerReceivingUnit=10.  Order 3 Cartons, receive 1.
    const { po, line } = await setupSubmittedPo(service, GLOVES_CATALOG_ID, GLOVES_INV_ID, 3, "Carton");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    const result = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 1 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 10); // 1 × 10
    expect(result.purchaseOrder.status).toBe("partially_received");
    expect(result.adjustments[0]?.quantityDelta).toBe(10);
  });

  it("cumulative receipt conversion: two sessions each receiving 1 Carton = +10 then +10 boxes", async () => {
    const { service, inventoryRepo } = makeService();
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    const { po, line } = await setupSubmittedPo(service, GLOVES_CATALOG_ID, GLOVES_INV_ID, 3, "Carton");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    // First session: 1 Carton = 10 Boxes
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 1 },
    ]);
    // Second session: another 1 Carton
    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 1 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 20); // 2 × 10
  });

  it("full receipt conversion: 3 Cartons × 10 = 30 boxes, PO status = received", async () => {
    const { service, inventoryRepo } = makeService();
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    const { po, line } = await setupSubmittedPo(service, GLOVES_CATALOG_ID, GLOVES_INV_ID, 3, "Carton");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    const result = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 3 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, GLOVES_INV_ID);
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 30);
    expect(result.purchaseOrder.status).toBe("received");
  });

  it("over-receipt validation is based on receiving units (not stock units)", async () => {
    const { service } = makeService();
    // Order 2 Cases (= 12 packs stock), try to receive 3 Cases.
    const { po, line } = await setupSubmittedPo(service, BURS_CATALOG_ID, BURS_INV_ID, 2, "Case");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    await expect(
      service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
        { poLineId: submittedLine.id, quantityDelta: 3 }, // 3 > 2 outstanding
      ]),
    ).rejects.toThrow(/only 2 outstanding/);
  });

  it("inventory adjustment quantityDelta is in stock units", async () => {
    const { service } = makeService();
    // compositeResin: 5 syringes per pack.  Receive 2 packs.
    const { po, line } = await setupSubmittedPo(service, COMPOSITE_CATALOG_ID, COMPOSITE_INV_ID, 4, "Pack");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    const result = await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 2 },
    ]);

    // 2 packs × 5 syringes/pack = 10 syringes
    expect(result.adjustments[0]?.quantityDelta).toBe(10);
    expect(result.adjustments[0]?.adjustmentType).toBe("receive");
  });

  it("UNIT_MISMATCH: throws when line receiving_unit does not match catalog stock or receiving unit", async () => {
    const { service } = makeService();
    // Use "Pallet" which is not a valid unit for diamond burs.
    const { po, line } = await setupSubmittedPo(service, BURS_CATALOG_ID, BURS_INV_ID, 2, "Pallet");
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    await expect(
      service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
        { poLineId: submittedLine.id, quantityDelta: 1 },
      ]),
    ).rejects.toThrow(/does not match catalog stock unit/);
  });

  it("default conversion applies when PO line receivingUnit is null", async () => {
    const { service, inventoryRepo } = makeService();
    const inv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    const initialQoH = inv?.quantityOnHand ?? 0;

    // No receivingUnit on the line → falls back to catalog default (Case, factor=6).
    const { po, line } = await setupSubmittedPo(service, BURS_CATALOG_ID, BURS_INV_ID, 3, undefined);
    const detail = await service.getPurchaseOrderDetail(CLINIC_A, po.id);
    const submittedLine = detail.lines[0] ?? line;

    await service.receivePurchaseOrder(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, [
      { poLineId: submittedLine.id, quantityDelta: 1 },
    ]);

    const updatedInv = await inventoryRepo.findClinicInventoryItem(CLINIC_A, BURS_INV_ID);
    expect(updatedInv?.quantityOnHand).toBe(initialQoH + 6); // 1 × 6 (catalog default)
  });
});
