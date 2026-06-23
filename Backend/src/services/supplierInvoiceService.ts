/**
 * Supplier Invoice Service — Sprint OCR-1.
 *
 * Orchestrates the complete AP invoice workflow:
 *   1. uploadAndExtract   — SHA256, OCR extraction, auto-match, duplicate checks
 *   2. getInvoice         — fetch header + lines
 *   3. listInvoices       — paginated list with filters
 *   4. updateInvoice      — edit header during pending_review
 *   5. updateLine         — edit a line item during pending_review
 *   6. confirmImport      — Amendment 3 validation + upsert pricing + history
 *   7. voidInvoice        — terminal state for pending_review invoices
 *
 * Amendments implemented:
 *   1B  — SHA256 duplicate-file detection (informational warning)
 *    2  — OCR confidence stored on invoice + lines
 *    3  — confirmImport() validates supplier_id, invoice_number, invoice_date
 *    4  — duplicate invoice-number warning (per clinic + supplier)
 */

import { createHash } from "node:crypto";
import type { AuditService } from "./auditService.js";
import type { OcrProvider } from "./ocr/OcrProvider.js";
import type { SupplierInvoiceRepository } from "../repositories/supplierInvoiceRepository.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type {
  ConfirmImportResult,
  ListSupplierInvoicesOptions,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  UpdateSupplierInvoiceInput,
  UpdateSupplierInvoiceLineInput,
  UploadAndExtractResult,
} from "../types/supplierInvoice.js";

export function createSupplierInvoiceService(
  repo: SupplierInvoiceRepository,
  ocrProvider: OcrProvider,
  supplierCatalogueRepo: SupplierCatalogueRepository,
  auditService: AuditService,
) {
  // ── Tenant + role guards ─────────────────────────────────────────────────

  function assertTenantAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (
      caller.role !== "owner_admin" &&
      caller.homeClinicId !== clinicId
    ) {
      throw new AppError(
        403,
        "SUPPLIER_INVOICE_TENANT_VIOLATION",
        "Access denied: you do not belong to this clinic",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "SUPPLIER_INVOICE_FORBIDDEN",
        "Clinical staff cannot manage supplier invoices",
      );
    }
  }

  function assertPendingReview(invoice: SupplierInvoice): void {
    if (invoice.status !== "pending_review") {
      throw new AppError(
        409,
        "SUPPLIER_INVOICE_INVALID_STATUS",
        `This action requires status 'pending_review'. Current status: ${invoice.status}`,
      );
    }
  }

  // ── 1. Upload & Extract ───────────────────────────────────────────────────

  async function uploadAndExtract(
    caller: AuthenticatedUser,
    clinicId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
    },
  ): Promise<UploadAndExtractResult> {
    assertTenantAccess(caller, clinicId);
    assertWriteAccess(caller);

    // SHA-256 hash for duplicate-file detection (Amendment 1B).
    const fileSha256 = createHash("sha256").update(file.buffer).digest("hex");

    // Check for duplicate file upload (informational warning only).
    const duplicateFileWarning = await repo.findDuplicateFile(
      clinicId,
      fileSha256,
    );

    // Call the OCR provider.
    const ocrResult = await ocrProvider.extractInvoice(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    // Auto-match lines against supplier_catalogue by supplier_sku.
    // The first pass attempts exact SKU matching; unmatched lines remain unmatched.
    const matchedLines = await Promise.all(
      ocrResult.lines.map(async (ocrLine, idx) => {
        let masterCatalogItemId: string | null = null;
        let supplierCatalogueId: string | null = null;
        let isMatched = false;
        let matchMethod: "exact_sku" | "name_match" | "manual" | null = null;

        if (ocrLine.sku) {
          const catalogueEntries = await supplierCatalogueRepo.listSupplierProducts({
            active: true,
          });
          const exactMatch = catalogueEntries.find(
            (e) =>
              e.supplierSku?.toLowerCase() === ocrLine.sku!.toLowerCase(),
          );
          if (exactMatch) {
            masterCatalogItemId = exactMatch.productId;
            supplierCatalogueId = exactMatch.id;
            isMatched = true;
            matchMethod = "exact_sku";
          }
        }

        return {
          ocrLine,
          masterCatalogItemId,
          supplierCatalogueId,
          isMatched,
          matchMethod,
          sortOrder: idx,
        };
      }),
    );

    // Persist the invoice header.
    const invoice = await repo.createSupplierInvoice({
      clinicId,
      supplierId: null,
      supplierNameRaw: ocrResult.supplierName,
      invoiceNumber: ocrResult.invoiceNumber,
      invoiceDate: ocrResult.invoiceDate,
      dueDate: ocrResult.dueDate,
      subtotalCents: ocrResult.subtotalCents,
      taxCents: ocrResult.taxCents,
      totalCents: ocrResult.totalCents,
      ocrProvider: ocrResult.provider,
      ocrConfidence: ocrResult.overallConfidence,
      ocrRawResponse: ocrResult.rawResponse,
      originalFilename: file.originalname,
      fileMimeType: file.mimetype,
      fileSha256,
      importedByUserId: caller.id,
      importedByEmail: caller.email,
    });

    // Persist the extracted lines.
    const lines = await Promise.all(
      matchedLines.map((m) =>
        repo.addLine({
          clinicId,
          supplierInvoiceId: invoice.id,
          masterCatalogItemId: m.masterCatalogItemId,
          supplierCatalogueId: m.supplierCatalogueId,
          ocrDescription: m.ocrLine.description,
          ocrSku: m.ocrLine.sku,
          ocrConfidence: m.ocrLine.confidence,
          quantity: m.ocrLine.quantity,
          unitPriceCents: m.ocrLine.unitPriceCents,
          taxRateBasisPoints: m.ocrLine.taxRateBasisPoints,
          sortOrder: m.sortOrder,
          isMatched: m.isMatched,
          matchMethod: m.matchMethod,
        }),
      ),
    );

    // Duplicate invoice-number warning (Amendment 4).
    // Only checked when OCR extracted an invoice_number.
    // Cannot check supplier-scoped duplicate without a supplierId yet,
    // so we do a clinic-wide check on invoice_number alone using a
    // relaxed approach: check after the invoice is persisted (exclude self).
    let duplicateInvoiceNumberWarning = null;
    if (ocrResult.invoiceNumber) {
      // We search across all suppliers for this clinic+invoiceNumber
      // (partial check — full supplier-scoped check happens at PATCH/confirm).
      const existingInvoices = await repo.listSupplierInvoices(clinicId, {
        limit: 1,
      });
      const dup = existingInvoices.find(
        (inv) =>
          inv.invoiceNumber === ocrResult.invoiceNumber &&
          inv.status !== "voided" &&
          inv.id !== invoice.id,
      );
      if (dup) {
        duplicateInvoiceNumberWarning = {
          existingInvoiceId: dup.id,
          existingStatus: dup.status as SupplierInvoiceStatus,
        };
      }
    }

    auditService.logEvent("supplier_invoice.uploaded", {
      userId: caller.id,
      resourceId: invoice.id,
    });

    return {
      invoice,
      lines,
      duplicateFileWarning,
      duplicateInvoiceNumberWarning,
    };
  }

  // ── 2. Get ────────────────────────────────────────────────────────────────

  async function getInvoice(
    caller: AuthenticatedUser,
    clinicId: string,
    invoiceId: string,
  ): Promise<{ invoice: SupplierInvoice; lines: SupplierInvoiceLine[] }> {
    assertTenantAccess(caller, clinicId);

    const invoice = await repo.findById(clinicId, invoiceId);
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }

    const lines = await repo.listLines(clinicId, invoiceId);
    return { invoice, lines };
  }

  // ── 3. List ───────────────────────────────────────────────────────────────

  async function listInvoices(
    caller: AuthenticatedUser,
    clinicId: string,
    options?: ListSupplierInvoicesOptions,
  ): Promise<SupplierInvoice[]> {
    assertTenantAccess(caller, clinicId);
    return repo.listSupplierInvoices(clinicId, options);
  }

  // ── 4. Update header ──────────────────────────────────────────────────────

  async function updateInvoice(
    caller: AuthenticatedUser,
    clinicId: string,
    invoiceId: string,
    patch: UpdateSupplierInvoiceInput,
  ): Promise<{
    invoice: SupplierInvoice;
    duplicateInvoiceNumberWarning: {
      existingInvoiceId: string;
      existingStatus: SupplierInvoiceStatus;
    } | null;
  }> {
    assertTenantAccess(caller, clinicId);
    assertWriteAccess(caller);

    const existing = await repo.findById(clinicId, invoiceId);
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }
    assertPendingReview(existing);

    const updated = await repo.updateSupplierInvoice(clinicId, invoiceId, patch);
    if (!updated) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }

    // Amendment 4 — duplicate invoice-number check on PATCH.
    let duplicateInvoiceNumberWarning = null;
    const effectiveSupplierId = patch.supplierId ?? updated.supplierId;
    const effectiveInvoiceNumber = patch.invoiceNumber ?? updated.invoiceNumber;

    if (effectiveSupplierId && effectiveInvoiceNumber) {
      duplicateInvoiceNumberWarning = await repo.findDuplicateInvoiceNumber(
        clinicId,
        effectiveSupplierId,
        effectiveInvoiceNumber,
        invoiceId,
      );
    }

    return { invoice: updated, duplicateInvoiceNumberWarning };
  }

  // ── 5. Update line ────────────────────────────────────────────────────────

  async function updateLine(
    caller: AuthenticatedUser,
    clinicId: string,
    invoiceId: string,
    lineId: string,
    patch: UpdateSupplierInvoiceLineInput,
  ): Promise<SupplierInvoiceLine> {
    assertTenantAccess(caller, clinicId);
    assertWriteAccess(caller);

    const invoice = await repo.findById(clinicId, invoiceId);
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }
    assertPendingReview(invoice);

    const line = await repo.findLineById(clinicId, lineId);
    if (!line || line.supplierInvoiceId !== invoiceId) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice line not found");
    }

    const updated = await repo.updateLine(clinicId, lineId, patch);
    if (!updated) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice line not found");
    }
    return updated;
  }

  // ── 6. Confirm Import ──────────────────────────────────────────────────────

  async function confirmImport(
    caller: AuthenticatedUser,
    clinicId: string,
    invoiceId: string,
  ): Promise<ConfirmImportResult> {
    assertTenantAccess(caller, clinicId);
    assertWriteAccess(caller);

    const invoice = await repo.findById(clinicId, invoiceId);
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }
    assertPendingReview(invoice);

    // Amendment 3 — mandatory field validation before confirming.
    if (!invoice.supplierId) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "supplier_id is required before confirming the import. Set it via PATCH first.",
      );
    }
    if (!invoice.invoiceNumber) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "invoice_number is required before confirming the import. Set it via PATCH first.",
      );
    }
    if (!invoice.invoiceDate) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "invoice_date is required before confirming the import. Set it via PATCH first.",
      );
    }

    const lines = await repo.listLines(clinicId, invoiceId);
    const matchedLines = lines.filter((l) => l.isMatched && l.masterCatalogItemId);

    // Upsert supplier_catalogue pricing for each matched line.
    const priceHistoryRecords = await Promise.all(
      matchedLines.map(async (line) => {
        const { catalogueId, oldUnitCostCents } =
          await repo.upsertSupplierCataloguePrice(
            invoice.supplierId!,
            line.masterCatalogItemId!,
            line.unitPriceCents,
            line.ocrSku,
          );

        return repo.insertPriceHistory({
          supplierCatalogueId: catalogueId,
          supplierId: invoice.supplierId!,
          masterCatalogItemId: line.masterCatalogItemId!,
          oldUnitCostCents,
          newUnitCostCents: line.unitPriceCents,
          source: "supplier_invoice_ocr",
          sourceReferenceId: invoiceId,
          changedByUserId: caller.id,
          changedByEmail: caller.email,
          effectiveDate: invoice.invoiceDate!,
        });
      }),
    );

    const now = new Date();
    const confirmed = await repo.setStatus(clinicId, invoiceId, "confirmed", {
      confirmedByUserId: caller.id,
      confirmedAt: now,
    });

    if (!confirmed) {
      throw new AppError(500, "INTERNAL_ERROR", "Failed to confirm supplier invoice");
    }

    auditService.logEvent("supplier_invoice.confirmed", {
      userId: caller.id,
      resourceId: invoiceId,
    });

    return {
      invoice: confirmed,
      priceUpdates: priceHistoryRecords.length,
      priceHistory: priceHistoryRecords,
    };
  }

  // ── 7. Void ───────────────────────────────────────────────────────────────

  async function voidInvoice(
    caller: AuthenticatedUser,
    clinicId: string,
    invoiceId: string,
  ): Promise<SupplierInvoice> {
    assertTenantAccess(caller, clinicId);
    assertWriteAccess(caller);

    const invoice = await repo.findById(clinicId, invoiceId);
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Supplier invoice not found");
    }
    assertPendingReview(invoice);

    const voided = await repo.setStatus(clinicId, invoiceId, "voided", {
      voidedByUserId: caller.id,
      voidedAt: new Date(),
    });

    if (!voided) {
      throw new AppError(500, "INTERNAL_ERROR", "Failed to void supplier invoice");
    }

    auditService.logEvent("supplier_invoice.voided", {
      userId: caller.id,
      resourceId: invoiceId,
    });

    return voided;
  }

  return {
    uploadAndExtract,
    getInvoice,
    listInvoices,
    updateInvoice,
    updateLine,
    confirmImport,
    voidInvoice,
  };
}

export type SupplierInvoiceService = ReturnType<typeof createSupplierInvoiceService>;
