/**
 * Master Product Library Import Service unit tests —
 * Master Product Library Import Foundation.
 *
 * Confirms:
 *   - Valid rows create master_catalog_items only.
 *   - Duplicate display_name + category (in DB and within the same file) are skipped.
 *   - Missing required fields (display_name, category, status) are rejected.
 *   - Clinic inventory rows (when clinicId supplied) always start at quantityOnHand 0.
 *   - No stock movement is ever created — inventory_adjustments stays empty and
 *     updateQuantity/recordAdjustment are never invoked.
 */
import { jest } from "@jest/globals";

import { createMasterProductImportService } from "../src/services/masterProductImportService.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createAuditService } from "../src/services/auditService.js";
import { createLogger } from "../src/utils/logger.js";
import { getCurrentTenantCtx } from "../src/db/tenantContext.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { ClinicInventoryItem } from "../src/types/inventory.js";

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CLINIC_ID = "22222222-2222-4222-8222-222222222222";

const OWNER_ADMIN: AuthenticatedUser = {
  id: "user-owner-1",
  email: "owner@vervedental.com.au",
  role: "owner_admin",
  homeClinicId: CLINIC_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
  permissions: [],
};

const MANAGER: AuthenticatedUser = {
  id: "user-manager-1",
  email: "manager@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: CLINIC_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
  permissions: [],
};

const silentLogger = createLogger({ LOG_LEVEL: "silent" });

function buildService() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const auditService = createAuditService(silentLogger, null);

  const importService = createMasterProductImportService(
    catalogRepo,
    inventoryRepo,
    auditService,
  );

  return { importService, catalogRepo, inventoryRepo };
}

// ─── Happy path ────────────────────────────────────────────────────────────────

describe("MasterProductImportService — creates products", () => {
  it("creates a master catalog item for a valid row", async () => {
    const { importService, catalogRepo } = buildService();

    const csv =
      "display_name,category,subcategory,brand,variant_attributes,default_unit,status,notes\n" +
      "Nitrile Gloves Small,PPE,Gloves,Ansell,Size S,Box,active,Latex-free\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.totalRows).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.skippedInvalid).toBe(0);
    expect(result.rows[0]?.outcome).toBe("imported");

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Nitrile Gloves Small");
    expect(created).toBeDefined();
    expect(created?.category).toBe("PPE");
    expect(created?.subcategory).toBe("Gloves");
    expect(created?.brand).toBe("Ansell");
    expect(created?.variantAttributes).toBe("Size S");
    expect(created?.notes).toBe("Latex-free");
    expect(created?.status).toBe("active");
    expect(created?.isActive).toBe(true);
    expect(created?.defaultUnitCostCents).toBe(0);
    expect(created?.stockUnit).toBe("Box");
    expect(created?.receivingUnit).toBe("Box");
  });

  it("maps default_unit onto both stockUnit and receivingUnit", async () => {
    const { importService, catalogRepo } = buildService();

    const csv =
      "display_name,category,default_unit,status\n" +
      "Cotton Rolls,Consumables,Pack,active\n";

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Cotton Rolls");
    expect(created?.stockUnit).toBe("Pack");
    expect(created?.receivingUnit).toBe("Pack");
    expect(created?.unitsPerReceivingUnit).toBe(1);
  });

  it("falls back to 'Unit' for stockUnit/receivingUnit when default_unit is missing", async () => {
    const { importService, catalogRepo } = buildService();

    const csv = "display_name,category,status\nSterile Gauze,Consumables,active\n";

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Sterile Gauze");
    expect(created?.stockUnit).toBe("Unit");
    expect(created?.receivingUnit).toBe("Unit");
  });

  it("falls back to 'Unit' when default_unit is present but blank", async () => {
    const { importService, catalogRepo } = buildService();

    const csv = 'display_name,category,default_unit,status\nSterile Wipes,Consumables,"",active\n';

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Sterile Wipes");
    expect(created?.stockUnit).toBe("Unit");
    expect(created?.receivingUnit).toBe("Unit");
  });

  it("truncates an overlong default_unit to the 32-character column limit", async () => {
    const { importService, catalogRepo } = buildService();

    const overlongUnit = "A".repeat(50);
    const csv = `display_name,category,default_unit,status\nBulk Item,Consumables,${overlongUnit},active\n`;

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Bulk Item");
    expect(created?.stockUnit).toHaveLength(32);
    expect(created?.receivingUnit).toHaveLength(32);
  });

  it("imports multiple distinct rows from one file", async () => {
    const { importService } = buildService();

    const csv =
      "display_name,category,status\n" +
      "Product A,Category 1,active\n" +
      "Product B,Category 2,active\n" +
      "Product C,Category 1,inactive\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.imported).toBe(3);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.skippedInvalid).toBe(0);
  });
});

// ─── Validation ────────────────────────────────────────────────────────────────

describe("MasterProductImportService — validation", () => {
  it("rejects rows missing display_name", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\n,Category 1,active\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.imported).toBe(0);
    expect(result.skippedInvalid).toBe(1);
    expect(result.rows[0]?.outcome).toBe("skipped_invalid");
    expect(result.rows[0]?.errors).toContain("display_name is required");
  });

  it("rejects rows missing category", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nSome Product,,active\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.skippedInvalid).toBe(1);
    expect(result.rows[0]?.errors).toContain("category is required");
  });

  it("rejects rows missing status", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nSome Product,Category 1,\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.skippedInvalid).toBe(1);
    expect(result.rows[0]?.errors).toContain("status is required");
  });

  it("throws IMPORT_MISSING_COLUMN when required columns are absent", async () => {
    const { importService } = buildService();
    const csv = "display_name\nSome Product\n";

    await expect(
      importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv"),
    ).rejects.toMatchObject({ code: "IMPORT_MISSING_COLUMN" });
  });

  it("throws IMPORT_EMPTY for an empty file", async () => {
    const { importService } = buildService();

    await expect(
      importService.importLibrary(OWNER_ADMIN, Buffer.from(""), "csv"),
    ).rejects.toMatchObject({ code: "IMPORT_EMPTY" });
  });
});

// ─── Duplicate protection ──────────────────────────────────────────────────────

describe("MasterProductImportService — duplicate protection", () => {
  it("skips a row that duplicates an existing master product (normalised name + category)", async () => {
    const { importService, catalogRepo } = buildService();

    const csv1 = "display_name,category,status\n  Curated Composite Kit  ,Restorative,active\n";
    const first = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv1), "csv");
    expect(first.imported).toBe(1);

    // Same product, different casing/whitespace.
    const csv2 = "display_name,category,status\ncurated   composite kit,restorative,active\n";
    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv2), "csv");

    expect(result.imported).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.rows[0]?.outcome).toBe("skipped_duplicate");

    const items = await catalogRepo.listMasterItems();
    const matches = items.filter(
      (item) => item.name.toLowerCase() === "curated composite kit",
    );
    expect(matches).toHaveLength(1);
  });

  it("skips duplicates that appear twice within the same file", async () => {
    const { importService, catalogRepo } = buildService();

    const csv =
      "display_name,category,status\n" +
      "Diamond Burs FG,Rotary,active\n" +
      "Diamond Burs FG,Rotary,active\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.imported).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.rows[1]?.outcome).toBe("skipped_duplicate");

    const items = await catalogRepo.listMasterItems();
    expect(items.filter((item) => item.name === "Diamond Burs FG")).toHaveLength(1);
  });

  it("does not treat the same display_name in a different category as a duplicate", async () => {
    const { importService } = buildService();

    const csv =
      "display_name,category,status\n" +
      "Universal Kit,Restorative,active\n" +
      "Universal Kit,Surgical,active\n";

    const result = await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    expect(result.imported).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
  });
});

// ─── Stock quantity / no stock movement guarantees ─────────────────────────────

describe("MasterProductImportService — no stock movement", () => {
  it("does not create any clinic inventory rows when no clinicId is supplied", async () => {
    const { importService, inventoryRepo } = buildService();
    const csv = "display_name,category,status\nGauze Swabs,Consumables,active\n";

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv");

    const clinicAInventory = await inventoryRepo.listClinicInventory(CLINIC_ID);
    const created = clinicAInventory.find((item) => item.name === "Gauze Swabs");
    expect(created).toBeUndefined();
  });

  it("creates clinic inventory rows at quantityOnHand 0 when clinicId is supplied", async () => {
    const { importService, inventoryRepo, catalogRepo } = buildService();
    const csv = "display_name,category,status\nGauze Swabs,Consumables,active\n";

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", CLINIC_ID);

    const items = await catalogRepo.listMasterItems();
    const created = items.find((item) => item.name === "Gauze Swabs");
    expect(created).toBeDefined();

    const clinicInventory = await inventoryRepo.listClinicInventory(CLINIC_ID);
    const inventoryRow = clinicInventory.find(
      (item) => item.masterCatalogItemId === created?.id,
    );
    expect(inventoryRow).toBeDefined();
    expect(inventoryRow?.quantityOnHand).toBe(0);
    expect(inventoryRow?.reorderPoint).toBe(0);
  });

  it("never records an inventory adjustment or changes an existing item's quantity", async () => {
    const { importService, inventoryRepo } = buildService();
    const updateQuantitySpy = jest.spyOn(inventoryRepo, "updateQuantity");
    const recordAdjustmentSpy = jest.spyOn(inventoryRepo, "recordAdjustment");

    const csv =
      "display_name,category,status\n" +
      "Saliva Ejectors XL,Consumables,active\n" +
      "Face Shields,PPE,active\n";

    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", CLINIC_ID);

    expect(updateQuantitySpy).not.toHaveBeenCalled();
    expect(recordAdjustmentSpy).not.toHaveBeenCalled();

    const adjustments = await inventoryRepo.listAdjustments(CLINIC_ID);
    expect(adjustments).toHaveLength(0);
  });

  it("leaves an existing clinic's on-hand quantities untouched even when re-provisioning", async () => {
    const { importService, inventoryRepo, catalogRepo } = buildService();

    // Seeded item already has stock in Clinic A — verify the import never
    // adjusts it and does not duplicate it either.
    const seeded = (await catalogRepo.listMasterItems())[0];
    if (!seeded) throw new Error("expected seeded master items");

    const before = await inventoryRepo.listClinicInventory(CLINIC_ID);
    const beforeQty = before.find((i) => i.masterCatalogItemId === seeded.id)?.quantityOnHand;

    const csv = `display_name,category,status\n${seeded.name},${seeded.category},active\n`;
    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", CLINIC_ID);

    const after = await inventoryRepo.listClinicInventory(CLINIC_ID);
    const afterQty = after.find((i) => i.masterCatalogItemId === seeded.id)?.quantityOnHand;

    expect(afterQty).toBe(beforeQty);
  });
});

// ─── RLS tenant context (provisioning bug fix) ─────────────────────────────────
//
// clinic_inventory_items is RLS-protected: app_is_owner_admin() OR
// clinic_id = app_current_clinic_id(). Because /master-products/import is a
// global route (not nested under /clinics/:clinicId/*), rlsTenantContextMiddleware
// never runs for it — without provisionClinicInventory() explicitly establishing
// a context via runWithTenantContext(), Postgres would reject the INSERT with
// "new row violates row-level security policy for table clinic_inventory_items".
// These tests prove the correct context is established for both roles and that
// it is never widened beyond what assertClinicAccess() already authorised.
describe("MasterProductImportService — RLS tenant context", () => {
  it("establishes ownerAdmin=true context scoped to the target clinic for owner_admin", async () => {
    const { importService, inventoryRepo } = buildService();
    const original = inventoryRepo.createClinicInventoryItem.bind(inventoryRepo);
    let capturedCtx: ReturnType<typeof getCurrentTenantCtx> = null;
    jest
      .spyOn(inventoryRepo, "createClinicInventoryItem")
      .mockImplementation(async (item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">) => {
        capturedCtx = getCurrentTenantCtx();
        return original(item);
      });

    const csv = "display_name,category,status\nSuture Kit,Surgical,active\n";
    // owner_admin's home clinic is CLINIC_ID; provision a DIFFERENT clinic to
    // prove the context follows the target clinic, not the caller's home clinic.
    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", OTHER_CLINIC_ID);

    expect(capturedCtx).toEqual({ clinicId: OTHER_CLINIC_ID, ownerAdmin: true });
  });

  it("establishes ownerAdmin=false context scoped to the home clinic for group_practice_manager", async () => {
    const { importService, inventoryRepo } = buildService();
    const original = inventoryRepo.createClinicInventoryItem.bind(inventoryRepo);
    let capturedCtx: ReturnType<typeof getCurrentTenantCtx> = null;
    jest
      .spyOn(inventoryRepo, "createClinicInventoryItem")
      .mockImplementation(async (item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">) => {
        capturedCtx = getCurrentTenantCtx();
        return original(item);
      });

    const csv = "display_name,category,status\nSuture Kit,Surgical,active\n";
    await importService.importLibrary(MANAGER, Buffer.from(csv), "csv", CLINIC_ID);

    expect(capturedCtx).toEqual({ clinicId: CLINIC_ID, ownerAdmin: false });
  });

  it("does not establish or leak any tenant context outside the provisioning call", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nSuture Kit,Surgical,active\n";

    expect(getCurrentTenantCtx()).toBeNull();
    await importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", OTHER_CLINIC_ID);
    // The context is scoped to the runWithTenantContext() callback only — it
    // must not still be active once importLibrary() has returned.
    expect(getCurrentTenantCtx()).toBeNull();
  });

  it("does not call clinic inventory provisioning at all when a row is skipped as a duplicate", async () => {
    const { importService, inventoryRepo, catalogRepo } = buildService();
    const seeded = (await catalogRepo.listMasterItems())[0];
    if (!seeded) throw new Error("expected seeded master items");

    const createSpy = jest.spyOn(inventoryRepo, "createClinicInventoryItem");
    const csv = `display_name,category,status\n${seeded.name},${seeded.category},active\n`;

    const result = await importService.importLibrary(
      OWNER_ADMIN,
      Buffer.from(csv),
      "csv",
      CLINIC_ID,
    );

    expect(result.skippedDuplicates).toBe(1);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("surfaces a clear MASTER_PRODUCT_PROVISION_FAILED error instead of an unexpected error", async () => {
    const { importService, inventoryRepo } = buildService();
    jest
      .spyOn(inventoryRepo, "createClinicInventoryItem")
      .mockRejectedValue(
        new Error("new row violates row-level security policy for table clinic_inventory_items"),
      );

    const csv = "display_name,category,status\nSuture Kit,Surgical,active\n";

    await expect(
      importService.importLibrary(OWNER_ADMIN, Buffer.from(csv), "csv", CLINIC_ID),
    ).rejects.toMatchObject({
      code: "MASTER_PRODUCT_PROVISION_FAILED",
      statusCode: 500,
    });
  });
});

// ─── Clinic access control ──────────────────────────────────────────────────────

describe("MasterProductImportService — clinic access control", () => {
  it("allows a group_practice_manager to provision their own home clinic", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nMouth Mirrors,Instruments,active\n";

    const result = await importService.importLibrary(
      MANAGER,
      Buffer.from(csv),
      "csv",
      CLINIC_ID,
    );

    expect(result.imported).toBe(1);
  });

  it("denies a group_practice_manager provisioning a different clinic", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nMouth Mirrors,Instruments,active\n";

    await expect(
      importService.importLibrary(MANAGER, Buffer.from(csv), "csv", OTHER_CLINIC_ID),
    ).rejects.toMatchObject({ code: "MASTER_PRODUCT_IMPORT_FORBIDDEN" });
  });

  it("allows owner_admin to provision any clinic", async () => {
    const { importService } = buildService();
    const csv = "display_name,category,status\nMouth Mirrors,Instruments,active\n";

    const result = await importService.importLibrary(
      OWNER_ADMIN,
      Buffer.from(csv),
      "csv",
      OTHER_CLINIC_ID,
    );

    expect(result.imported).toBe(1);
  });
});
