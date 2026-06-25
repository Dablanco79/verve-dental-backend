/**
 * supplierInvoiceService — Smart Supplier Detection unit tests.
 *
 * Tests the matchSupplierFromOcr path inside uploadAndExtract().
 * All I/O is mocked — no real DB or OCR API is hit.
 *
 * Coverage:
 *   1.  ABN match resolves to "matched"
 *   2.  Name match resolves to "matched" when no ABN on OCR
 *   3.  ABN match takes priority — name lookup skipped
 *   4.  Name detected but no match → "needs_confirmation"
 *   5.  No supplier name in OCR → "not_detected"
 *   6.  Service never calls createSupplier (no silent creation)
 *   7.  Matched invoice: supplierId set on createSupplierInvoice
 *   8.  Unmatched invoice: supplierId null on createSupplierInvoice
 *   9.  not_detected: supplierId null on createSupplierInvoice
 *  10.  Cannot change supplier_id after invoice is confirmed (409)
 */

import { jest } from "@jest/globals";
import { createInMemorySupplierInvoiceRepository } from "../../repositories/supplierInvoiceRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../../repositories/supplierCatalogueRepository.js";
import { createInMemorySupplierRepository } from "../../repositories/supplierRepository.js";
import { createSupplierInvoiceService } from "../supplierInvoiceService.js";
import type { SupplierRepository } from "../../repositories/supplierRepository.js";
import type { OcrProvider } from "../ocr/OcrProvider.js";
import type { OcrInvoiceResult } from "../../types/supplierInvoice.js";
import type { Supplier } from "../../types/supplier.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { AuditService } from "../auditService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLINIC_ID = "11111111-1111-4000-8000-000000000001";
const SUPPLIER_ID = "33333333-3333-4000-8000-000000000001";
const USER_ID = "44444444-4444-4000-8000-000000000001";

const caller: AuthenticatedUser = {
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

const mockFile = {
  buffer: Buffer.from("fake"),
  mimetype: "application/pdf",
  originalname: "inv.pdf",
};

const fakeAudit = {
  logAuthEvent: jest.fn(),
  logEvent: jest.fn(),
  logError: jest.fn(),
} satisfies AuditService;

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    supplierName: "Henry Schein",
    supplierCode: null,
    contactName: null,
    email: null,
    phone: null,
    website: null,
    abn: "12 345 678 901",
    address: null,
    notes: null,
    active: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    // Sprint 4C metadata defaults
    legalName: null,
    tradingName: null,
    countryCode: "AU",
    currencyCode: "AUD",
    industryCategory: null,
    healthcareSubcategory: null,
    supplierCategory: null,
    verified: false,
    apiAvailable: false,
    catalogueAvailable: false,
    livePricing: false,
    onlineOrdering: false,
    preferredCommMethod: null,
    logoStorageKey: null,
    createdByClinicId: null,
    isPublic: true,
    ...overrides,
  };
}

function makeOcrResult(overrides: Partial<OcrInvoiceResult> = {}): OcrInvoiceResult {
  return {
    provider: "stub",
    supplierName: "Henry Schein",
    supplierAbn: "12 345 678 901",
    supplierEmail: null,
    supplierPhone: null,
    supplierAddress: null,
    supplierWebsite: null,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    dueDate: null,
    subtotalCents: 10_000,
    taxCents: 1_000,
    totalCents: 11_000,
    overallConfidence: 95,
    lines: [],
    rawResponse: {},
    ...overrides,
  };
}

function makeMockOcrProvider(result: OcrInvoiceResult): OcrProvider {
  return {
    extractInvoice: jest.fn<OcrProvider["extractInvoice"]>().mockResolvedValue(result),
  };
}

/**
 * Build a service with a real in-memory invoice repo but overridden supplier
 * lookup methods so tests can inject desired match results.
 * Mock function references are returned directly for assertion.
 */
function makeService(opts: {
  ocrResult?: Partial<OcrInvoiceResult>;
  existingSupplierByAbn?: Supplier | null;
  existingSupplierByName?: Supplier | null;
}) {
  const ocrResult = makeOcrResult(opts.ocrResult);
  const invoiceRepo = createInMemorySupplierInvoiceRepository();
  const catalogueRepo = createInMemorySupplierCatalogueRepository();

  const findSupplierByAbn = jest.fn<SupplierRepository["findSupplierByAbn"]>()
    .mockResolvedValue(opts.existingSupplierByAbn ?? null);
  const findSupplierByName = jest.fn<SupplierRepository["findSupplierByName"]>()
    .mockResolvedValue(opts.existingSupplierByName ?? null);
  const createSupplier = jest.fn<SupplierRepository["createSupplier"]>();

  const baseSupplierRepo = createInMemorySupplierRepository();
  const supplierRepo: SupplierRepository = {
    ...baseSupplierRepo,
    findSupplierByAbn,
    findSupplierByName,
    createSupplier,
  };

  const ocrProvider = makeMockOcrProvider(ocrResult);
  const service = createSupplierInvoiceService(
    invoiceRepo,
    ocrProvider,
    catalogueRepo,
    fakeAudit,
    supplierRepo,
  );

  return { service, invoiceRepo, supplierRepo, findSupplierByAbn, findSupplierByName, createSupplier };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Smart Supplier Detection — uploadAndExtract", () => {
  it("1. returns supplierMatchStatus=matched when ABN matches an existing supplier", async () => {
    const existing = makeSupplier();
    const { service } = makeService({ existingSupplierByAbn: existing });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.supplierMatchStatus).toBe("matched");
    expect(result.matchedSupplier).not.toBeNull();
    expect(result.matchedSupplier?.id).toBe(SUPPLIER_ID);
    expect(result.detectedSupplier?.supplierName).toBe("Henry Schein");
    expect(result.detectedSupplier?.abn).toBe("12 345 678 901");
  });

  it("2. returns supplierMatchStatus=matched when name matches (no ABN on OCR)", async () => {
    const existing = makeSupplier({ abn: null });
    const { service } = makeService({
      ocrResult: { supplierAbn: null },
      existingSupplierByAbn: null,
      existingSupplierByName: existing,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.supplierMatchStatus).toBe("matched");
    expect(result.matchedSupplier?.id).toBe(SUPPLIER_ID);
  });

  it("3. ABN match takes priority — findSupplierByName is not called when ABN resolves", async () => {
    const existing = makeSupplier();
    const differentSupplier = makeSupplier({ id: "different-supplier-id" });
    const { service, findSupplierByName } = makeService({
      existingSupplierByAbn: existing,
      existingSupplierByName: differentSupplier,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.supplierMatchStatus).toBe("matched");
    expect(result.matchedSupplier?.id).toBe(SUPPLIER_ID);
    expect(findSupplierByName).not.toHaveBeenCalled();
  });

  it("4. returns needs_confirmation when name detected but no match found", async () => {
    const { service } = makeService({
      existingSupplierByAbn: null,
      existingSupplierByName: null,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.supplierMatchStatus).toBe("needs_confirmation");
    expect(result.matchedSupplier).toBeNull();
    expect(result.detectedSupplier?.supplierName).toBe("Henry Schein");
  });

  it("5. returns not_detected when OCR has no supplier name", async () => {
    const { service } = makeService({
      ocrResult: { supplierName: null, supplierAbn: null },
      existingSupplierByAbn: null,
      existingSupplierByName: null,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.supplierMatchStatus).toBe("not_detected");
    expect(result.detectedSupplier).toBeNull();
    expect(result.matchedSupplier).toBeNull();
  });

  it("6. service never calls createSupplier (no silent supplier creation)", async () => {
    const { service, createSupplier } = makeService({
      existingSupplierByAbn: null,
      existingSupplierByName: null,
    });

    await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(createSupplier).not.toHaveBeenCalled();
  });

  it("7. matched invoice: supplierId set on persisted invoice", async () => {
    const existing = makeSupplier();
    const { service, invoiceRepo } = makeService({ existingSupplierByAbn: existing });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.invoice.supplierId).toBe(SUPPLIER_ID);
    // Confirm it was actually stored.
    const stored = await invoiceRepo.findById(CLINIC_ID, result.invoice.id);
    expect(stored?.supplierId).toBe(SUPPLIER_ID);
  });

  it("8. unmatched invoice: supplierId is null on persisted invoice", async () => {
    const { service, invoiceRepo } = makeService({
      existingSupplierByAbn: null,
      existingSupplierByName: null,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.invoice.supplierId).toBeNull();
    const stored = await invoiceRepo.findById(CLINIC_ID, result.invoice.id);
    expect(stored?.supplierId).toBeNull();
  });

  it("9. not_detected invoice: supplierId is null on persisted invoice", async () => {
    const { service, invoiceRepo } = makeService({
      ocrResult: { supplierName: null, supplierAbn: null },
      existingSupplierByAbn: null,
      existingSupplierByName: null,
    });

    const result = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);

    expect(result.invoice.supplierId).toBeNull();
    const stored = await invoiceRepo.findById(CLINIC_ID, result.invoice.id);
    expect(stored?.supplierId).toBeNull();
  });

  it("10. cannot change supplier_id after invoice is confirmed (409)", async () => {
    const existing = makeSupplier();
    const { service, invoiceRepo } = makeService({ existingSupplierByAbn: existing });

    // Upload + confirm.
    const uploaded = await service.uploadAndExtract(caller, CLINIC_ID, mockFile);
    const invoiceId = uploaded.invoice.id;

    // Manually patch the invoice to have invoiceNumber + invoiceDate (required for confirm).
    await invoiceRepo.updateSupplierInvoice(CLINIC_ID, invoiceId, {
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
    });
    await service.confirmImport(caller, CLINIC_ID, invoiceId);

    // Now attempt to change the supplier.
    await expect(
      service.updateInvoice(caller, CLINIC_ID, invoiceId, { supplierId: "new-supplier-id" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
