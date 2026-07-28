/**
 * supplierCompatibility.service.test.ts
 *
 * BLOCKER 1 resolution — tests for the full supplier compatibility hierarchy
 * used when adding a product line to a purchase order.
 *
 * Decision layers (in priority order):
 *
 *   LAYER 1 — product_suppliers (clinic-level explicit relationship)
 *     A. Explicit compatible product-supplier relationship → ALLOW
 *     B. Known incompatible supplier (product has records for different supplier) → REJECT
 *
 *   LAYER 2 — supplier catalogue (cross-clinic SupplierProduct relationship)
 *     C. Supplier catalogue relationship → ALLOW  (regardless of pricing presence)
 *     D. Catalogue confirms different supplier → REJECT
 *     E. Catalogue relationship exists with null pricing → ALLOW (not pricing-gated)
 *
 *   LAYER 3 — no relationship data available
 *     F. Genuinely unresolved compatibility → soft pass (allow, unverified)
 */

import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import { createPurchaseOrderService } from "../src/services/purchaseOrderService.js";
import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import {
  SEED_CLINIC_INVENTORY_IDS,
  SEED_MASTER_CATALOG_IDS,
} from "../src/repositories/seed/inventorySeed.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000099";
const ACTOR_EMAIL = "compat.test@clinic.test";

const BURS_CATALOG_ID = SEED_MASTER_CATALOG_IDS.diamondBurs;
const BURS_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicABurs;
const GLOVES_CATALOG_ID = SEED_MASTER_CATALOG_IDS.nitrileGloves;
const GLOVES_INV_ID = SEED_CLINIC_INVENTORY_IDS.clinicAGloves;

const SUPPLIER_A = "supplier-aaaaaaaa-0000-4000-8000-000000000001";
const SUPPLIER_B = "supplier-bbbbbbbb-0000-4000-8000-000000000002";

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeAudit() {
  return {
    logEvent: () => undefined,
    recordEvent: (): Promise<void> => Promise.resolve(),
  };
}

/** Service with only the in-memory inventory / catalogue repos (no supplier catalogue). */
function makeServiceNoSuppCatalogue() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const audit = makeAudit();
  const service = createPurchaseOrderService(
    inventoryRepo,
    catalogRepo,
    audit as unknown as Parameters<typeof createPurchaseOrderService>[2],
    audit,
    // supplierCatalogueRepository intentionally omitted
  );
  return { service, inventoryRepo };
}

/** Service with both inventory repo and supplier catalogue repo. */
function makeServiceWithSuppCatalogue() {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const suppCatalogueRepo = createInMemorySupplierCatalogueRepository();
  const audit = makeAudit();
  const service = createPurchaseOrderService(
    inventoryRepo,
    catalogRepo,
    audit as unknown as Parameters<typeof createPurchaseOrderService>[2],
    audit,
    suppCatalogueRepo,
  );
  return { service, inventoryRepo, suppCatalogueRepo };
}

// ─── LAYER 1 — product_suppliers (clinic-level explicit relationship) ─────────

describe("checkSupplierCompatibility — Layer 1: product_suppliers", () => {
  it("A. allows adding a product when an explicit product_suppliers record exists for the PO supplier", async () => {
    const { service, inventoryRepo } = makeServiceNoSuppCatalogue();

    // Register an explicit product-supplier relationship
    await inventoryRepo.createProductSupplier({
      clinicId: CLINIC_A,
      productId: BURS_CATALOG_ID,
      supplierId: SUPPLIER_A,
      supplierName: "Supplier A",
      supplierSku: null,
      supplierBarcode: null,
      unitCostCents: null,
      packSize: null,
      isPreferred: true,
      active: true,
    });

    // Create a PO for Supplier A
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // Adding a burs line to Supplier A's PO must succeed
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });

  it("B. rejects adding a product when an explicit product_suppliers record exists ONLY for a different supplier", async () => {
    const { service, inventoryRepo } = makeServiceNoSuppCatalogue();

    // Register an explicit product-supplier relationship for Supplier B only
    await inventoryRepo.createProductSupplier({
      clinicId: CLINIC_A,
      productId: BURS_CATALOG_ID,
      supplierId: SUPPLIER_B,
      supplierName: "Supplier B",
      supplierSku: null,
      supplierBarcode: null,
      unitCostCents: null,
      packSize: null,
      isPreferred: true,
      active: true,
    });

    // Create a PO for Supplier A
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // Adding a burs line (which belongs to Supplier B) to Supplier A's PO must be rejected
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "PO_SUPPLIER_MISMATCH" });
  });

  it("preferred supplier compatibility — product with preferred supplier A allowed on Supplier A PO", async () => {
    const { service, inventoryRepo } = makeServiceNoSuppCatalogue();

    // Register isPreferred = true for Supplier A
    await inventoryRepo.createProductSupplier({
      clinicId: CLINIC_A,
      productId: GLOVES_CATALOG_ID,
      supplierId: SUPPLIER_A,
      supplierName: "Supplier A",
      supplierSku: null,
      supplierBarcode: null,
      unitCostCents: null,
      packSize: null,
      isPreferred: true,
      active: true,
    });

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: GLOVES_CATALOG_ID,
        clinicInventoryItemId: GLOVES_INV_ID,
        quantity: 3,
      }),
    ).resolves.toBeDefined();
  });

  it("inactive product_suppliers records are ignored (not used as evidence)", async () => {
    const { service, inventoryRepo } = makeServiceNoSuppCatalogue();

    // Register an explicit product-supplier relationship for Supplier B — but inactive
    await inventoryRepo.createProductSupplier({
      clinicId: CLINIC_A,
      productId: BURS_CATALOG_ID,
      supplierId: SUPPLIER_B,
      supplierName: "Supplier B",
      supplierSku: null,
      supplierBarcode: null,
      unitCostCents: null,
      packSize: null,
      isPreferred: false,
      active: false,
    });

    // No active records → Layer 3 soft pass
    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // Should soft-pass since the only record is inactive
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });
});

// ─── LAYER 2 — supplier catalogue ────────────────────────────────────────────

describe("checkSupplierCompatibility — Layer 2: supplier catalogue", () => {
  it("C. allows adding a product when the supplier catalogue has a relationship for the PO supplier", async () => {
    const { service, suppCatalogueRepo } = makeServiceWithSuppCatalogue();

    // Supplier catalogue entry for Supplier A (no pricing needed)
    await suppCatalogueRepo.createSupplierProduct({
      supplierId: SUPPLIER_A,
      productId: BURS_CATALOG_ID,
      supplierSku: "BUR-001",
      supplierDescription: null,
      unitCostCents: 4599,
      unitOfMeasure: null,
    });

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });

  it("D. rejects adding a product when the supplier catalogue has entries for ONLY a different supplier", async () => {
    const { service, suppCatalogueRepo } = makeServiceWithSuppCatalogue();

    // Supplier catalogue entry for Supplier B only
    await suppCatalogueRepo.createSupplierProduct({
      supplierId: SUPPLIER_B,
      productId: BURS_CATALOG_ID,
      supplierSku: "BUR-B-001",
      supplierDescription: null,
      unitCostCents: 4200,
      unitOfMeasure: null,
    });

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "PO_SUPPLIER_MISMATCH" });
  });

  it("E. null/missing pricing does not block compatibility — catalogue entry without pricing still allows the addition", async () => {
    const { service, suppCatalogueRepo } = makeServiceWithSuppCatalogue();

    // Supplier catalogue entry for Supplier A — relationship established but pricing not yet set.
    // unitCostCents = 0 is used as a placeholder because the type requires a number; the test
    // verifies that the existence of the catalogue relationship (not its price value) drives compatibility.
    await suppCatalogueRepo.createSupplierProduct({
      supplierId: SUPPLIER_A,
      productId: BURS_CATALOG_ID,
      supplierSku: null,
      supplierDescription: null,
      unitCostCents: 0,
      unitOfMeasure: null,
    });

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // Must succeed: catalogue relationship exists, absence of pricing is irrelevant
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });
});

// ─── LAYER 3 — no relationship data ──────────────────────────────────────────

describe("checkSupplierCompatibility — Layer 3: no relationship data (soft pass)", () => {
  it("F. allows adding a product when no product_suppliers or supplier catalogue entries exist for the product", async () => {
    // No product_suppliers records, no supplier catalogue → Layer 3 soft pass
    const { service } = makeServiceWithSuppCatalogue(); // catalogue wired but empty

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // No relationship data → soft pass (compatibility unverified but not blocked)
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });

  it("F2. soft pass applies equally when the supplier catalogue repository is not wired at all", async () => {
    const { service } = makeServiceNoSuppCatalogue(); // no catalogue at all

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).resolves.toBeDefined();
  });
});

// ─── Layer 1 takes priority over Layer 2 ─────────────────────────────────────

describe("checkSupplierCompatibility — Layer 1 wins over Layer 2", () => {
  it("rejects when product_suppliers says Supplier B but supplier catalogue also has Supplier A", async () => {
    const { service, inventoryRepo, suppCatalogueRepo } = makeServiceWithSuppCatalogue();

    // product_suppliers: only Supplier B (Layer 1 — takes priority)
    await inventoryRepo.createProductSupplier({
      clinicId: CLINIC_A,
      productId: BURS_CATALOG_ID,
      supplierId: SUPPLIER_B,
      supplierName: "Supplier B",
      supplierSku: null,
      supplierBarcode: null,
      unitCostCents: null,
      packSize: null,
      isPreferred: true,
      active: true,
    });

    // supplier catalogue: has Supplier A (Layer 2 — should NOT override Layer 1)
    await suppCatalogueRepo.createSupplierProduct({
      supplierId: SUPPLIER_A,
      productId: BURS_CATALOG_ID,
      supplierSku: null,
      supplierDescription: null,
      unitCostCents: 4599,
      unitOfMeasure: null,
    });

    const po = await service.createManualPurchaseOrder(CLINIC_A, ACTOR_ID, ACTOR_EMAIL, {
      supplierId: SUPPLIER_A,
    });

    // Layer 1 (product_suppliers) says Supplier B only → reject, even though Layer 2 would allow
    await expect(
      service.addPoLine(CLINIC_A, po.id, ACTOR_ID, ACTOR_EMAIL, {
        masterCatalogItemId: BURS_CATALOG_ID,
        clinicInventoryItemId: BURS_INV_ID,
        quantity: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "PO_SUPPLIER_MISMATCH" });
  });
});
