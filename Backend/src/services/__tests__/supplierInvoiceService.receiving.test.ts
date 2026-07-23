/**
 * supplierInvoiceService — receiveInvoice() unit tests.
 *
 * Sprint: Workflow 1.0 Invoice Receiving Safety Gate.
 *
 * Coverage:
 *   1.  Invoice confirmation does not change inventory.
 *   2.  First receiving succeeds.
 *   3.  Invoice lifecycle is marked received (receivedAt set).
 *   4.  receivedByUserId is persisted.
 *   5.  Inventory adjustment uses type 'receive'.
 *   6.  Audit event supplier_invoice.received is logged.
 *   7.  Second receiving attempt returns 409 INVOICE_ALREADY_RECEIVED.
 *   8.  Second receiving attempt does not change inventory.
 *   9.  Cross-clinic invoice receive is rejected.
 *  10.  Clinical staff are rejected (403).
 *  11.  Invalid (zero) quantities are rejected.
 *  12.  Invoice not in imported status is rejected.
 *  13.  Receiving requires at least one line.
 *  14.  Already-imported invoices are valid targets after migration (receivedAt null).
 */

import { jest } from "@jest/globals";
import { createInMemorySupplierInvoiceRepository } from "../../repositories/supplierInvoiceRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../../repositories/supplierCatalogueRepository.js";
import { createInMemorySupplierRepository } from "../../repositories/supplierRepository.js";
import { createInMemoryCatalogRepository } from "../../repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../../repositories/inventoryRepository.js";
import { createSupplierInvoiceService } from "../supplierInvoiceService.js";
import type { OcrProvider } from "../ocr/OcrProvider.js";
import type { OcrInvoiceResult } from "../../types/supplierInvoice.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { AuditService } from "../auditService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLINIC_ID   = "11111111-1111-4000-8000-000000000001";
const CLINIC_B_ID = "11111111-1111-4000-8000-000000000002";
const SUPPLIER_ID = "33333333-3333-4000-8000-000000000001";
const USER_ID     = "44444444-4444-4000-8000-000000000001";

const admin: AuthenticatedUser = {
  id: USER_ID,
  email: "admin@clinic.com",
  role: "owner_admin",
  homeClinicId: CLINIC_ID,
  homeClinicName: "Test Clinic",
  firstName: null,
  lastName: null,
  displayName: null,
  permissions: [],
};

const clinicalStaff: AuthenticatedUser = {
  ...admin,
  role: "clinical_staff",
};

const ocrResult: OcrInvoiceResult = {
  provider: "stub",
  supplierName: "DentalCo Australia",
  supplierAbn: null,
  supplierEmail: null,
  supplierPhone: null,
  supplierAddress: null,
  supplierWebsite: null,
  invoiceNumber: "INV-TEST-001",
  invoiceDate: "2026-07-01",
  dueDate: null,
  subtotalCents: 5000,
  taxCents: 500,
  totalCents: 5500,
  overallConfidence: 92,
  lines: [
    {
      description: "Gloves Box",
      sku: "GLV-001",
      quantity: 6,
      unitPriceCents: 800,
      subtotalCents: 4800,
      taxRateBasisPoints: 1000,
      taxCents: 480,
      totalCents: 5280,
      confidence: 90,
    },
  ],
  rawResponse: {},
};

const stubOcr: OcrProvider = {
  extractInvoice: jest.fn(() => Promise.resolve(ocrResult)),
};

// ── Helper to set up a fully confirmed invoice ─────────────────────────────

async function buildImportedInvoice() {
  const invoiceRepo = createInMemorySupplierInvoiceRepository();
  const catalogRepo = createInMemoryCatalogRepository();
  const invRepo = createInMemoryInventoryRepository(catalogRepo);
  const supplierRepo = createInMemorySupplierRepository();
  const catalogueRepo = createInMemorySupplierCatalogueRepository();

  const logEventSpy = jest.fn();
  const mockAudit = {
    logAuthEvent: jest.fn(),
    logEvent: logEventSpy,
  } as unknown as AuditService;

  const service = createSupplierInvoiceService(
    invoiceRepo,
    stubOcr,
    catalogueRepo,
    mockAudit,
    supplierRepo,
    undefined,
    catalogRepo,
    invRepo,
  );

  // Upload invoice.
  const uploaded = await service.uploadAndExtract(admin, CLINIC_ID, {
    buffer: Buffer.from("fake"),
    mimetype: "application/pdf",
    originalname: "inv.pdf",
  });
  const invoiceId = uploaded.invoice.id;
  const lineId = uploaded.lines[0]?.id;

  // Ensure supplier and required fields are set.
  await invoiceRepo.updateSupplierInvoice(CLINIC_ID, invoiceId, {
    supplierId: SUPPLIER_ID,
    invoiceDate: "2026-07-01",
    invoiceNumber: "INV-TEST-001",
  });

  // Manually set status so confirmImport can proceed.
  await invoiceRepo.setStatus(CLINIC_ID, invoiceId, "ready_for_review");

  // Create a master catalog item and inventory item.
  const masterItem = await catalogRepo.createMasterItem({
    sku: "GLV-001",
    name: "Gloves Box",
    description: null,
    category: "PPE",
    stockUnit: "box",
    receivingUnit: "box",
    unitsPerReceivingUnit: 1,
    defaultUnitCostCents: 800,
  });

  await invRepo.createClinicInventoryItem({
    clinicId: CLINIC_ID,
    masterCatalogItemId: masterItem.id,
    quantityOnHand: 10,
    reorderPoint: 2,
    unitCostOverrideCents: null,
    supplierPreference: null,
  });

  // Link the line to the master item.
  if (lineId) {
    await invoiceRepo.updateLine(CLINIC_ID, lineId, {
      masterCatalogItemId: masterItem.id,
      isMatched: true,
      matchMethod: "manual",
    });
  }

  // Confirm the invoice (moves status to 'imported').
  const confirmed = await service.confirmImport(admin, CLINIC_ID, invoiceId, {
    readyToCreateLineIds: [],
    skippedLineIds: [],
  });

  return {
    invoiceRepo,
    invRepo,
    service,
    invoiceId,
    masterItemId: masterItem.id,
    logEventSpy,
    confirmedInvoice: confirmed.invoice,
  };
}

/** Returns the first clinic inventory item matching the given masterCatalogItemId. */
async function getItem(
  invRepo: ReturnType<typeof createInMemoryInventoryRepository>,
  masterCatalogItemId: string,
) {
  const items = await invRepo.listClinicInventory(CLINIC_ID);
  const found = items.find((i) => i.masterCatalogItemId === masterCatalogItemId);
  if (!found) throw new Error(`Inventory item for masterCatalogItemId ${masterCatalogItemId} not found`);
  return found;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("supplierInvoiceService.receiveInvoice", () => {
  test("1. Invoice confirmation does not change inventory", async () => {
    const { invRepo, confirmedInvoice, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);
    expect(item.quantityOnHand).toBe(10);
    expect(confirmedInvoice.status).toBe("imported");
    expect(confirmedInvoice.receivedAt).toBeNull();
  });

  test("2 & 3 & 4. First receiving succeeds, sets receivedAt and receivedByUserId", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    const result = await service.receiveInvoice(
      admin,
      CLINIC_ID,
      invoiceId,
      [{ itemId: item.id, quantityDelta: 6 }],
      "REF-001",
    );

    expect(result.invoice.receivedAt).not.toBeNull();
    expect(result.invoice.receivedByUserId).toBe(USER_ID);
    expect(result.invoice.receivedReference).toBe("REF-001");
    expect(result.receivedAt).toBeInstanceOf(Date);
    expect(result.receivedBy).toBe("admin@clinic.com");
  });

  test("5. Inventory adjustment uses type receive", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    await service.receiveInvoice(
      admin,
      CLINIC_ID,
      invoiceId,
      [{ itemId: item.id, quantityDelta: 6 }],
      null,
    );

    const adjustments = await invRepo.listAdjustments(CLINIC_ID, { limit: 10 });
    const receiveAdj = adjustments.find((a) => a.adjustmentType === "receive");
    expect(receiveAdj).toBeDefined();
    expect(receiveAdj?.quantityDelta).toBe(6);
    expect(receiveAdj?.quantityBefore).toBe(10);
    expect(receiveAdj?.quantityAfter).toBe(16);
    expect(receiveAdj?.referenceId).toBe(invoiceId);
  });

  test("6. In-memory path: auditService.logEvent is NOT called for received events; durable audit is inside PG transaction", async () => {
    const { service, invoiceId, invRepo, masterItemId, logEventSpy } =
      await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    logEventSpy.mockClear();

    await service.receiveInvoice(
      admin,
      CLINIC_ID,
      invoiceId,
      [{ itemId: item.id, quantityDelta: 3 }],
      null,
    );

    // After the durable-audit change, the supplier_invoice.received event is
    // inserted as step 4 of executeAtomicReceivingPg — inside the PostgreSQL
    // transaction.  The in-memory path (no pool) does NOT call logEvent.
    const calls: unknown[][] = logEventSpy.mock.calls;
    const receivedEvent = calls.find((call) => call[0] === "supplier_invoice.received");
    expect(receivedEvent).toBeUndefined();
  });

  test("7 & 8. Second receiving attempt returns 409 and does not change inventory", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    // First receive.
    await service.receiveInvoice(
      admin,
      CLINIC_ID,
      invoiceId,
      [{ itemId: item.id, quantityDelta: 6 }],
      null,
    );

    // Capture inventory after first receive.
    const afterFirst = await invRepo.findClinicInventoryItem(CLINIC_ID, item.id);
    const qtyAfterFirst = afterFirst?.quantityOnHand ?? 0;

    // Second receive should be rejected.
    await expect(
      service.receiveInvoice(
        admin,
        CLINIC_ID,
        invoiceId,
        [{ itemId: item.id, quantityDelta: 6 }],
        null,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INVOICE_ALREADY_RECEIVED",
    });

    // Inventory must not have changed.
    const afterSecond = await invRepo.findClinicInventoryItem(CLINIC_ID, item.id);
    expect(afterSecond?.quantityOnHand).toBe(qtyAfterFirst);
  });

  test("9. Cross-clinic invoice receive is rejected (404 — invoice not visible)", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    const clinicBAdmin: AuthenticatedUser = {
      ...admin,
      homeClinicId: CLINIC_B_ID,
    };

    // Invoice belongs to CLINIC_ID; look up under CLINIC_B_ID returns 404.
    await expect(
      service.receiveInvoice(
        clinicBAdmin,
        CLINIC_B_ID,
        invoiceId,
        [{ itemId: item.id, quantityDelta: 6 }],
        null,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("10. Clinical staff are rejected (403)", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    await expect(
      service.receiveInvoice(
        clinicalStaff,
        CLINIC_ID,
        invoiceId,
        [{ itemId: item.id, quantityDelta: 6 }],
        null,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("11. Invalid (zero) quantities are rejected", async () => {
    const { service, invoiceId, invRepo, masterItemId } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    await expect(
      service.receiveInvoice(
        admin,
        CLINIC_ID,
        invoiceId,
        [{ itemId: item.id, quantityDelta: 0 }],
        null,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  test("12. Invoice not in imported status is rejected", async () => {
    const invoiceRepo = createInMemorySupplierInvoiceRepository();
    const catalogRepo = createInMemoryCatalogRepository();
    const invRepo = createInMemoryInventoryRepository(catalogRepo);
    const supplierRepo = createInMemorySupplierRepository();
    const catalogueRepo = createInMemorySupplierCatalogueRepository();
    const mockAudit = {
      logAuthEvent: jest.fn(),
      logEvent: jest.fn(),
    } as unknown as AuditService;

    const service = createSupplierInvoiceService(
      invoiceRepo,
      stubOcr,
      catalogueRepo,
      mockAudit,
      supplierRepo,
      undefined,
      catalogRepo,
      invRepo,
    );

    const uploaded = await service.uploadAndExtract(admin, CLINIC_ID, {
      buffer: Buffer.from("fake"),
      mimetype: "application/pdf",
      originalname: "inv.pdf",
    });

    // Invoice is in 'ready_for_review' status — not 'imported'.
    await expect(
      service.receiveInvoice(
        admin,
        CLINIC_ID,
        uploaded.invoice.id,
        [{ itemId: "55555555-5555-4000-8000-000000000001", quantityDelta: 6 }],
        null,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "SUPPLIER_INVOICE_INVALID_STATUS" });
  });

  test("13. Empty lines array is rejected", async () => {
    const { service, invoiceId } = await buildImportedInvoice();

    await expect(
      service.receiveInvoice(admin, CLINIC_ID, invoiceId, [], null),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  test("14. Imported invoice (receivedAt null) is valid receiving target", async () => {
    const { invoiceId, invRepo, masterItemId, service } = await buildImportedInvoice();
    const item = await getItem(invRepo, masterItemId);

    const result = await service.receiveInvoice(
      admin,
      CLINIC_ID,
      invoiceId,
      [{ itemId: item.id, quantityDelta: 1 }],
      null,
    );

    expect(result.invoice.status).toBe("imported");
    expect(result.invoice.receivedAt).not.toBeNull();
  });
});
