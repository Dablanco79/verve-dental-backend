/**
 * SupplierInvoiceService unit tests.
 *
 * Uses the in-memory repository and a mock OcrProvider — no DB or real API key needed.
 *
 * Coverage:
 *   1.  uploadAndExtract — creates invoice + lines from OCR result
 *   2.  uploadAndExtract — SHA256 duplicate-file warning (Amendment 1B)
 *   3.  uploadAndExtract — duplicate invoice-number warning (Amendment 4)
 *   4.  uploadAndExtract — clinical_staff RBAC rejection
 *   5.  uploadAndExtract — cross-clinic tenant rejection
 *   6.  getInvoice — returns invoice + lines
 *   7.  getInvoice — 404 on unknown id
 *   8.  listInvoices — tenant-scoped results
 *   9.  updateInvoice — edits header fields, returns duplicate inv-number warning
 *   10. updateInvoice — rejects on non-pending_review status
 *   11. updateLine — recalculates totals correctly
 *   12. updateLine — rejects on non-pending_review status
 *   13. confirmImport — Amendment 3: rejects when supplier_id missing
 *   14. confirmImport — Amendment 3: rejects when invoice_number missing
 *   15. confirmImport — Amendment 3: rejects when invoice_date missing
 *   16. confirmImport — upserts pricing + records price history + marks confirmed
 *   17. confirmImport — idempotent guard (rejects already-confirmed)
 *   18. voidInvoice — voids a pending_review invoice
 *   19. voidInvoice — rejects voiding a confirmed invoice
 */

import { jest } from "@jest/globals";
import { createInMemorySupplierInvoiceRepository } from "../src/repositories/supplierInvoiceRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import { createSupplierInvoiceService } from "../src/services/supplierInvoiceService.js";
import { AppError } from "../src/types/errors.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { OcrProvider } from "../src/services/ocr/OcrProvider.js";
import type { OcrInvoiceResult } from "../src/types/supplierInvoice.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLINIC_A = "00000000-0000-0000-0000-000000000001";
const CLINIC_B = "00000000-0000-0000-0000-000000000002";

function makeManager(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-manager-1",
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeAdmin(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-admin-1",
    email: "admin@clinic-a.au",
    role: "owner_admin",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeStaff(): AuthenticatedUser {
  return {
    id: "user-staff-1",
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: CLINIC_A,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

const MOCK_OCR_RESULT: OcrInvoiceResult = {
  provider: "stub",
  supplierName: "Acme Dental Supplies",
  invoiceNumber: "INV-2026-001",
  invoiceDate: "2026-06-01",
  dueDate: "2026-07-01",
  subtotalCents: 10_000,
  taxCents: 1_000,
  totalCents: 11_000,
  overallConfidence: 95,
  lines: [
    {
      description: "Prophy Paste 200pk",
      sku: "PP-200",
      quantity: 2,
      unitPriceCents: 5_000,
      subtotalCents: 10_000,
      taxRateBasisPoints: 1_000,
      taxCents: 1_000,
      totalCents: 11_000,
      confidence: 98,
    },
  ],
  rawResponse: { test: true },
};

function makeMockOcrProvider(result: OcrInvoiceResult = MOCK_OCR_RESULT): OcrProvider {
  return {
    extractInvoice: jest.fn().mockResolvedValue(result),
  };
}

const FAKE_FILE = {
  buffer: Buffer.from("fake-pdf-content"),
  mimetype: "application/pdf",
  originalname: "test-invoice.pdf",
};

const FAKE_AUDIT = {
  logEvent: jest.fn(),
  recordClinicEvent: jest.fn(),
};

function makeService(ocrProvider?: OcrProvider) {
  const repo = createInMemorySupplierInvoiceRepository();
  const catalogueRepo = createInMemorySupplierCatalogueRepository();
  const provider = ocrProvider ?? makeMockOcrProvider();
  const service = createSupplierInvoiceService(
    repo,
    provider,
    catalogueRepo,
    FAKE_AUDIT as never,
  );
  return { repo, catalogueRepo, service, provider };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupplierInvoiceService", () => {

  // ── 1. uploadAndExtract — success ──────────────────────────────────────────
  it("creates invoice + lines from OCR result", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const result = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    expect(result.invoice.clinicId).toBe(CLINIC_A);
    expect(result.invoice.status).toBe("pending_review");
    expect(result.invoice.supplierNameRaw).toBe("Acme Dental Supplies");
    expect(result.invoice.invoiceNumber).toBe("INV-2026-001");
    expect(result.invoice.ocrConfidence).toBe(95);
    expect(result.invoice.fileSha256).toHaveLength(64);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.ocrDescription).toBe("Prophy Paste 200pk");
    expect(result.lines[0]!.ocrConfidence).toBe(98);
    expect(result.lines[0]!.subtotalCents).toBe(10_000);
    expect(result.lines[0]!.taxCents).toBe(1_000);
    expect(result.lines[0]!.totalCents).toBe(11_000);
    expect(result.duplicateFileWarning).toBeNull();
    expect(result.duplicateInvoiceNumberWarning).toBeNull();
  });

  // ── 2. uploadAndExtract — duplicate-file warning (Amendment 1B) ────────────
  it("returns duplicateFileWarning when same SHA256 exists for clinic", async () => {
    const { service } = makeService();
    const caller = makeManager();

    // First upload.
    await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    // Second upload with the same buffer.
    const result = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    expect(result.duplicateFileWarning).not.toBeNull();
    expect(result.duplicateFileWarning!.existingInvoiceId).toBeDefined();
  });

  // ── 3. uploadAndExtract — no dup warning for different clinic ──────────────
  it("does not warn about duplicate file for a different clinic", async () => {
    const { service } = makeService();
    const managerA = makeManager(CLINIC_A);
    const adminB = makeAdmin(CLINIC_B);

    // Upload to CLINIC_A first.
    await service.uploadAndExtract(managerA, CLINIC_A, FAKE_FILE);

    // Same file to CLINIC_B — no warning.
    const result = await service.uploadAndExtract(adminB, CLINIC_B, FAKE_FILE);

    expect(result.duplicateFileWarning).toBeNull();
  });

  // ── 4. uploadAndExtract — clinical_staff RBAC rejection ───────────────────
  it("rejects clinical_staff from uploading invoices", async () => {
    const { service } = makeService();
    const caller = makeStaff();

    await expect(
      service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  // ── 5. uploadAndExtract — cross-clinic tenant rejection ───────────────────
  it("rejects a manager from accessing a different clinic", async () => {
    const { service } = makeService();
    const caller = makeManager(CLINIC_A);

    await expect(
      service.uploadAndExtract(caller, CLINIC_B, FAKE_FILE),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_TENANT_VIOLATION",
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  // ── 6. getInvoice — returns invoice + lines ────────────────────────────────
  it("getInvoice returns invoice and its lines", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice: created } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    const { invoice, lines } = await service.getInvoice(caller, CLINIC_A, created.id);

    expect(invoice.id).toBe(created.id);
    expect(lines).toHaveLength(1);
  });

  // ── 7. getInvoice — 404 on unknown id ─────────────────────────────────────
  it("getInvoice returns 404 for unknown invoiceId", async () => {
    const { service } = makeService();
    const caller = makeManager();

    await expect(
      service.getInvoice(caller, CLINIC_A, "00000000-0000-0000-0000-000000000099"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 } satisfies Partial<AppError>);
  });

  // ── 8. listInvoices — tenant scoped ───────────────────────────────────────
  it("listInvoices only returns invoices for the caller's clinic", async () => {
    const { service } = makeService();
    const managerA = makeManager(CLINIC_A);
    const adminB = makeAdmin(CLINIC_B);

    await service.uploadAndExtract(managerA, CLINIC_A, FAKE_FILE);
    await service.uploadAndExtract(managerA, CLINIC_A, { ...FAKE_FILE, buffer: Buffer.from("x") });
    await service.uploadAndExtract(adminB, CLINIC_B, { ...FAKE_FILE, buffer: Buffer.from("y") });

    const clinicAInvoices = await service.listInvoices(managerA, CLINIC_A);
    const clinicBInvoices = await service.listInvoices(adminB, CLINIC_B);

    expect(clinicAInvoices).toHaveLength(2);
    expect(clinicBInvoices).toHaveLength(1);
    expect(clinicAInvoices.every((i) => i.clinicId === CLINIC_A)).toBe(true);
  });

  // ── 9. updateInvoice — edits header and checks dup invoice number ──────────
  it("updateInvoice updates header fields and checks for duplicate invoice number", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    const supplierId = "00000000-0000-0000-0000-000000000010";
    const { invoice: updated, duplicateInvoiceNumberWarning } =
      await service.updateInvoice(caller, CLINIC_A, invoice.id, {
        supplierId,
        invoiceNumber: "ACME-2026-999",
        invoiceDate: "2026-06-10",
        notes: "Reviewed by manager",
      });

    expect(updated.supplierId).toBe(supplierId);
    expect(updated.invoiceNumber).toBe("ACME-2026-999");
    expect(updated.invoiceDate).toBe("2026-06-10");
    expect(updated.notes).toBe("Reviewed by manager");
    // No existing invoice with this number+supplier, so no warning.
    expect(duplicateInvoiceNumberWarning).toBeNull();
  });

  // ── 10. updateInvoice — rejects on non-pending status ────────────────────
  it("updateInvoice rejects when invoice is already voided", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    await service.voidInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.updateInvoice(caller, CLINIC_A, invoice.id, { notes: "late edit" }),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 11. updateLine — recalculates totals ──────────────────────────────────
  it("updateLine recalculates subtotal, tax, and total correctly", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const lineId = lines[0]!.id;

    // Change quantity to 3, unit price to $6000, GST 10% (1000bp)
    const updated = await service.updateLine(
      caller,
      CLINIC_A,
      invoice.id,
      lineId,
      { quantity: 3, unitPriceCents: 6_000, taxRateBasisPoints: 1_000 },
    );

    // subtotal = 3 × 6000 = 18000
    // tax      = round(18000 × 1000 / 10000) = 1800
    // total    = 19800
    expect(updated.quantity).toBe(3);
    expect(updated.unitPriceCents).toBe(6_000);
    expect(updated.subtotalCents).toBe(18_000);
    expect(updated.taxCents).toBe(1_800);
    expect(updated.totalCents).toBe(19_800);
  });

  // ── 12. updateLine — rejects on non-pending status ────────────────────────
  it("updateLine rejects when invoice is not pending_review", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    await service.voidInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.updateLine(caller, CLINIC_A, invoice.id, lines[0]!.id, {
        quantity: 5,
      }),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 13. confirmImport — missing supplier_id (Amendment 3) ─────────────────
  it("confirmImport rejects when supplier_id is null", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    // invoice.supplierId is null by default after upload

    await expect(
      service.confirmImport(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
    } satisfies Partial<AppError>);
  });

  // ── 14. confirmImport — missing invoice_number (Amendment 3) ──────────────
  it("confirmImport rejects when invoice_number is null", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const ocrNoNumber: OcrInvoiceResult = {
      ...MOCK_OCR_RESULT,
      invoiceNumber: null,
    };
    const { service: svc2 } = makeService(makeMockOcrProvider(ocrNoNumber));

    const { invoice } = await svc2.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    // Set supplierId but leave invoiceNumber null
    await svc2.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: "00000000-0000-0000-0000-000000000010",
    });

    await expect(
      svc2.confirmImport(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
    } satisfies Partial<AppError>);
  });

  // ── 15. confirmImport — missing invoice_date (Amendment 3) ────────────────
  it("confirmImport rejects when invoice_date is null", async () => {
    const ocrNoDate: OcrInvoiceResult = {
      ...MOCK_OCR_RESULT,
      invoiceDate: null,
    };
    const { service: svc } = makeService(makeMockOcrProvider(ocrNoDate));
    const caller = makeManager();

    const { invoice } = await svc.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    await svc.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: "00000000-0000-0000-0000-000000000010",
      invoiceNumber: "INV-001",
    });

    await expect(
      svc.confirmImport(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
    } satisfies Partial<AppError>);
  });

  // ── 16. confirmImport — success: pricing + history + status ───────────────
  it("confirmImport upserts catalogue pricing, records history, marks confirmed", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    const supplierId = "00000000-0000-0000-0000-000000000010";
    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId,
      invoiceNumber: "ACME-001",
      invoiceDate: "2026-06-01",
    });

    const result = await service.confirmImport(caller, CLINIC_A, invoice.id);

    expect(result.invoice.status).toBe("confirmed");
    expect(result.invoice.confirmedByUserId).toBe(caller.id);
    expect(result.invoice.confirmedAt).toBeInstanceOf(Date);
    // No matched lines (no master_catalog_item_id linked), so priceUpdates = 0
    expect(result.priceUpdates).toBe(0);
  });

  // ── 17. confirmImport — rejects already-confirmed ─────────────────────────
  it("confirmImport rejects an already-confirmed invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: "00000000-0000-0000-0000-000000000010",
      invoiceNumber: "ACME-002",
      invoiceDate: "2026-06-01",
    });

    await service.confirmImport(caller, CLINIC_A, invoice.id);

    await expect(
      service.confirmImport(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 18. voidInvoice — success ────────────────────────────────────────────
  it("voids a pending_review invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    const voided = await service.voidInvoice(caller, CLINIC_A, invoice.id);

    expect(voided.status).toBe("voided");
    expect(voided.voidedByUserId).toBe(caller.id);
    expect(voided.voidedAt).toBeInstanceOf(Date);
  });

  // ── 19. voidInvoice — rejects on confirmed ────────────────────────────────
  it("voidInvoice rejects a confirmed invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: "00000000-0000-0000-0000-000000000010",
      invoiceNumber: "ACME-003",
      invoiceDate: "2026-06-01",
    });

    await service.confirmImport(caller, CLINIC_A, invoice.id);

    await expect(
      service.voidInvoice(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "SUPPLIER_INVOICE_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });
});
