import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import {
  SEED_CLINIC_INVENTORY_IDS,
  SEED_MASTER_CATALOG_IDS,
} from "../src/repositories/seed/inventorySeed.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";

describe("Inventory repositories (Session 1)", () => {
  const catalogRepository = createInMemoryCatalogRepository();
  const inventoryRepository = createInMemoryInventoryRepository(catalogRepository);

  it("seeds five master catalog items", async () => {
    const items = await catalogRepository.listMasterItems();
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.sku)).toEqual(
      expect.arrayContaining([
        "VRV-GLV-001",
        "VRV-BUR-001",
        "VRV-CMP-001",
        "VRV-EJT-001",
        "VRV-MSK-001",
      ]),
    );
  });

  it("resolves barcode mappings to master catalog items", async () => {
    const mapping = await catalogRepository.findBarcodeMapping("9301234567890");
    expect(mapping).not.toBeNull();
    expect(mapping?.barcodeFormat).toBe("ean13");

    const master = await catalogRepository.findMasterItemById(
      mapping?.masterCatalogItemId ?? "",
    );
    expect(master?.sku).toBe("VRV-GLV-001");
  });

  it("lists clinic inventory scoped to the requested clinic", async () => {
    const clinicA = await inventoryRepository.listClinicInventory(SEED_CLINIC_A_ID);
    const clinicB = await inventoryRepository.listClinicInventory(SEED_CLINIC_B_ID);

    expect(clinicA).toHaveLength(5);
    expect(clinicB).toHaveLength(5);
    expect(clinicA.every((item) => item.clinicId === SEED_CLINIC_A_ID)).toBe(true);
    expect(clinicB.every((item) => item.clinicId === SEED_CLINIC_B_ID)).toBe(true);
    expect(clinicA[0]?.clinicId).not.toBe(clinicB[0]?.clinicId);
  });

  it("flags items below reorder point in inventory views", async () => {
    const clinicA = await inventoryRepository.listClinicInventory(SEED_CLINIC_A_ID);
    const gloves = clinicA.find((item) => item.id === SEED_CLINIC_INVENTORY_IDS.clinicAGloves);
    const masks = clinicA.find((item) => item.id === SEED_CLINIC_INVENTORY_IDS.clinicAMasks);
    const ejectors = clinicA.find(
      (item) => item.id === SEED_CLINIC_INVENTORY_IDS.clinicAEjectors,
    );

    expect(gloves?.quantityOnHand).toBe(3);
    expect(gloves?.reorderPoint).toBe(5);
    expect(gloves?.isBelowReorderPoint).toBe(true);
    expect(masks?.isBelowReorderPoint).toBe(true);
    expect(ejectors?.isBelowReorderPoint).toBe(false);
  });

  it("records immutable inventory adjustments", async () => {
    const item = await inventoryRepository.findClinicInventoryItem(
      SEED_CLINIC_A_ID,
      SEED_CLINIC_INVENTORY_IDS.clinicABurs,
    );

    expect(item).not.toBeNull();

    const adjustment = await inventoryRepository.recordAdjustment({
      clinicId: SEED_CLINIC_A_ID,
      clinicInventoryItemId: item?.id ?? "",
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      adjustmentType: "manual_adjust",
      quantityDelta: -1,
      quantityBefore: item?.quantityOnHand ?? 0,
      quantityAfter: (item?.quantityOnHand ?? 0) - 1,
      reason: "Used in procedure",
      performedByUserId: SEED_USER_IDS.clinicAStaff,
      performedByEmail: "staff@clinic-a.au",
      referenceId: null,
    });

    const history = await inventoryRepository.listAdjustments(SEED_CLINIC_A_ID);

    expect(adjustment.id).toEqual(expect.any(String));
    expect(history).toHaveLength(1);
    expect(history[0]?.adjustmentType).toBe("manual_adjust");
  });

  it("creates draft purchase order lines for a clinic", async () => {
    const draftPo = await inventoryRepository.findOrCreateDraftPo(
      SEED_CLINIC_B_ID,
      SEED_USER_IDS.clinicBAdmin,
    );

    await inventoryRepository.addDraftPoLine({
      draftPurchaseOrderId: draftPo.id,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      clinicInventoryItemId: SEED_CLINIC_INVENTORY_IDS.clinicBBurs,
      quantity: 2,
      reason: "below_reorder_point",
    });

    const lines = await inventoryRepository.listDraftPoLines(SEED_CLINIC_B_ID);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.reason).toBe("below_reorder_point");
  });
});
