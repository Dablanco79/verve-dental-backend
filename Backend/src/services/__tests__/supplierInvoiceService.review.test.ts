/**
 * supplierInvoiceService — Invoice Review workflow unit tests.
 *
 * Sprint: Workflow 1.0 Complete Invoice Review Remediation.
 *
 * Coverage:
 *   1.  ready_for_review invoice allows header editing (assertPendingReview passes).
 *   2.  ready_for_review invoice allows line editing.
 *   3.  pending_review invoice allows line editing (legacy compat).
 *   4.  updateLine persists reviewDecision = 'skip'.
 *   5.  updateLine persists reviewDecision = 'create_product'.
 *   6.  updateLine clears reviewDecision with null.
 *   7.  confirmImport reads reviewDecision='skip' from DB (no request body needed).
 *   8.  confirmImport reads reviewDecision='create_product' from DB.
 *   9.  confirmImport request-body skippedLineIds include DB reviewDecision lines.
 *  10.  confirmImport succeeds for ready_for_review invoice.
 *  11.  confirmImport requires supplierId (Amendment 3 validation).
 *  12.  clinical_staff cannot updateLine.
 *  13.  cross-clinic line update is rejected.
 *  14.  Void allowed for ready_for_review invoices.
 *  15.  Editing blocked for 'imported' status invoice.
 *  16.  Newly uploaded invoice has reviewDecision = null on each line.
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

const CLINIC_ID   = "11111111-1111-4000-8000-000000001001";
const CLINIC_B_ID = "11111111-1111-4000-8000-000000001002";
const SUPPLIER_ID = "33333333-3333-4000-8000-000000001001";
const USER_ID     = "44444444-4444-4000-8000-000000001001";

const admin: AuthenticatedUser = {
  id: USER_ID,
  email: "admin@review-test.com",
  role: "owner_admin",
  homeClinicId: CLINIC_ID,
  homeClinicName: "Review Test Clinic",
  firstName: null,
  lastName: null,
  displayName: null,
  permissions: [],
};

const clinicalStaff: AuthenticatedUser = {
  ...admin,
  role: "clinical_staff",
};

// Group practice manager with home clinic = CLINIC_ID — cannot access CLINIC_B_ID
const manager: AuthenticatedUser = {
  ...admin,
  id: "44444444-4444-4000-8000-000000001002",
  email: "manager@review-test.com",
  role: "group_practice_manager",
};

const ocrResult: OcrInvoiceResult = {
  provider: "stub",
  supplierName: "DentalCo Australia",
  supplierAbn: null,
  supplierEmail: null,
  supplierPhone: null,
  supplierAddress: null,
  supplierWebsite: null,
  invoiceNumber: "INV-REVIEW-001",
  invoiceDate: "2026-07-01",
  dueDate: null,
  subtotalCents: 5000,
  taxCents: 500,
  totalCents: 5500,
  overallConfidence: 90,
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
      confidence: 95,
    },
    {
      description: "Free Sample Kit",
      sku: null,
      quantity: 1,
      unitPriceCents: 0,
      subtotalCents: 0,
      taxRateBasisPoints: 0,
      taxCents: 0,
      totalCents: 0,
      confidence: 80,
    },
  ],
  rawResponse: {},
};

const stubOcr: OcrProvider = {
  extractInvoice: jest.fn(() => Promise.resolve(ocrResult)),
};

// ── Helper: build a fresh service + upload an invoice ─────────────────────────

async function buildServiceAndUpload() {
  const repo = createInMemorySupplierInvoiceRepository();
  const supplierCatalogueRepo = createInMemorySupplierCatalogueRepository();
  const supplierRepo = createInMemorySupplierRepository();
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);

  const mockAudit = {
    logAuthEvent: jest.fn(),
    logEvent: jest.fn(),
    logError: jest.fn(),
  } as unknown as AuditService;

  const service = createSupplierInvoiceService(
    repo,
    stubOcr,
    supplierCatalogueRepo,
    mockAudit,
    supplierRepo,
    undefined,
    catalogRepo,
    inventoryRepo,
    null,
  );

  const uploadResult = await service.uploadAndExtract(admin, CLINIC_ID, {
    buffer: Buffer.from("fake-pdf"),
    mimetype: "application/pdf",
    originalname: "test-invoice.pdf",
  });

  // Attach supplier so confirmImport passes Amendment 3 validation.
  await service.updateInvoice(admin, CLINIC_ID, uploadResult.invoice.id, {
    supplierId: SUPPLIER_ID,
    invoiceNumber: "INV-REVIEW-001",
    invoiceDate: "2026-07-01",
  });

  return { service, uploadResult, repo };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("supplierInvoiceService — Invoice Review workflow", () => {
  // 1 — ready_for_review allows header editing
  it("allows header editing on a ready_for_review invoice", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();

    await expect(
      service.updateInvoice(admin, CLINIC_ID, uploadResult.invoice.id, {
        notes: "Checked by reception",
      }),
    ).resolves.toBeDefined();
  });

  // 2 — ready_for_review allows line editing
  it("allows line editing on a ready_for_review invoice", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    await expect(
      service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
        ocrDescription: "Corrected description",
      }),
    ).resolves.toBeDefined();
  });

  // 3 — legacy pending_review allows line editing
  it("allows line editing on a legacy pending_review invoice", async () => {
    const repo = createInMemorySupplierInvoiceRepository();
    const mockAudit = {
      logAuthEvent: jest.fn(),
      logEvent: jest.fn(),
      logError: jest.fn(),
    } as unknown as AuditService;

    const service = createSupplierInvoiceService(
      repo,
      stubOcr,
      createInMemorySupplierCatalogueRepository(),
      mockAudit,
      createInMemorySupplierRepository(),
      undefined,
      undefined,
      undefined,
      null,
    );

    const uploadResult = await service.uploadAndExtract(admin, CLINIC_ID, {
      buffer: Buffer.from("legacy"),
      mimetype: "application/pdf",
      originalname: "legacy.pdf",
    });

    // Force the invoice to legacy pending_review status via repo directly.
    const legacyInvoice = await repo.setStatus(CLINIC_ID, uploadResult.invoice.id, "pending_review");
    expect(legacyInvoice?.status).toBe("pending_review");

    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");
    await expect(
      service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
        quantity: 10,
      }),
    ).resolves.toBeDefined();
  });

  // 4 — updateLine persists reviewDecision = 'skip'
  it("persists reviewDecision=skip to a line", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    const updated = await service.updateLine(
      admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id,
      { reviewDecision: "skip" },
    );

    expect(updated.reviewDecision).toBe("skip");
  });

  // 5 — updateLine persists reviewDecision = 'create_product'
  it("persists reviewDecision=create_product to a line", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const secondLine = uploadResult.lines.at(1);
    if (!secondLine) throw new Error("not enough lines");

    const updated = await service.updateLine(
      admin, CLINIC_ID, uploadResult.invoice.id, secondLine.id,
      { reviewDecision: "create_product" },
    );

    expect(updated.reviewDecision).toBe("create_product");
  });

  // 6 — updateLine clears reviewDecision with null
  it("clears reviewDecision when set to null", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    await service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
      reviewDecision: "skip",
    });

    const cleared = await service.updateLine(
      admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id,
      { reviewDecision: null },
    );

    expect(cleared.reviewDecision).toBeNull();
  });

  // 7 — confirmImport reads reviewDecision='skip' from DB without request body
  it("confirmImport uses DB reviewDecision=skip without needing request body", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();

    const secondLine = uploadResult.lines.at(1);
    if (!secondLine) throw new Error("not enough lines");

    await service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, secondLine.id, {
      reviewDecision: "skip",
    });

    const result = await service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {});
    expect(result.invoice.status).toBe("imported");
    expect(result.priceUpdates).toBe(0);
  });

  // 8 — confirmImport reads reviewDecision='create_product' from DB
  it("confirmImport uses DB reviewDecision=create_product to create product", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();

    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    await service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
      reviewDecision: "create_product",
    });

    const result = await service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {});
    expect(result.createdProducts).toBe(1);
    expect(result.invoice.status).toBe("imported");
  });

  // 9 — request-body skippedLineIds union with DB decisions
  it("request-body skippedLineIds are combined with DB reviewDecision", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();

    // Both lines should be effectively skipped:
    // line[0] via request body, line[1] via DB reviewDecision
    const line0 = uploadResult.lines.at(0);
    const line1 = uploadResult.lines.at(1);
    if (!line0 || !line1) throw new Error("not enough lines");

    await service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, line1.id, {
      reviewDecision: "skip",
    });

    const result = await service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {
      skippedLineIds: [line0.id],
    });

    expect(result.invoice.status).toBe("imported");
    expect(result.priceUpdates).toBe(0);
  });

  // 10 — confirmImport succeeds for ready_for_review invoice
  it("confirmImport transitions ready_for_review to imported", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const result = await service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {
      skippedLineIds: uploadResult.lines.map((l) => l.id),
    });
    expect(result.invoice.status).toBe("imported");
  });

  // 11 — confirmImport requires supplierId
  it("confirmImport rejects invoice without supplierId", async () => {
    const repo = createInMemorySupplierInvoiceRepository();
    const mockAudit = {
      logAuthEvent: jest.fn(),
      logEvent: jest.fn(),
      logError: jest.fn(),
    } as unknown as AuditService;

    const service = createSupplierInvoiceService(
      repo,
      stubOcr,
      createInMemorySupplierCatalogueRepository(),
      mockAudit,
      createInMemorySupplierRepository(),
      undefined, undefined, undefined, null,
    );

    const uploadResult = await service.uploadAndExtract(admin, CLINIC_ID, {
      buffer: Buffer.from("no-supplier"),
      mimetype: "application/pdf",
      originalname: "no-supplier.pdf",
    });

    // Set invoice_number and invoice_date but NOT supplierId
    await service.updateInvoice(admin, CLINIC_ID, uploadResult.invoice.id, {
      invoiceNumber: "INV-NO-SUPPLIER",
      invoiceDate: "2026-07-01",
    });

    await expect(
      service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {}),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // 12 — clinical_staff cannot updateLine
  it("clinical_staff are rejected for line editing", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    await expect(
      service.updateLine(clinicalStaff, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
        reviewDecision: "skip",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // 13 — cross-clinic line update is rejected
  it("rejects line update for wrong clinic (non-owner_admin)", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");

    // manager belongs to CLINIC_ID but tries to operate on CLINIC_B_ID
    await expect(
      service.updateLine(manager, CLINIC_B_ID, uploadResult.invoice.id, firstLine.id, {
        reviewDecision: "skip",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // 14 — void allowed for ready_for_review invoices
  it("allows voiding a ready_for_review invoice", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();
    const voided = await service.voidInvoice(admin, CLINIC_ID, uploadResult.invoice.id);
    expect(voided.status).toBe("voided");
  });

  // 15 — editing blocked for imported status
  it("blocks line editing on an imported invoice", async () => {
    const { service, uploadResult } = await buildServiceAndUpload();

    await service.confirmImport(admin, CLINIC_ID, uploadResult.invoice.id, {
      skippedLineIds: uploadResult.lines.map((l) => l.id),
    });

    const firstLine = uploadResult.lines.at(0);
    if (!firstLine) throw new Error("no lines");
    await expect(
      service.updateLine(admin, CLINIC_ID, uploadResult.invoice.id, firstLine.id, {
        quantity: 99,
      }),
    ).rejects.toMatchObject({ code: "SUPPLIER_INVOICE_INVALID_STATUS" });
  });

  // 16 — newly uploaded invoice has reviewDecision = null on each line
  it("newly uploaded invoice lines have reviewDecision = null", async () => {
    const { uploadResult } = await buildServiceAndUpload();
    for (const line of uploadResult.lines) {
      expect(line.reviewDecision).toBeNull();
    }
  });
});
