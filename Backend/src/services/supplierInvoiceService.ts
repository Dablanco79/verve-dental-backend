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
 *   7. cancelImport       — discard a review session without deleting catalogue data
 *   8. voidInvoice        — legacy terminal state for review invoices
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
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import type { SupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type { Supplier } from "../types/supplier.js";
import type {
  ConfirmImportResult,
  DetectedSupplierInfo,
  ListSupplierInvoicesOptions,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  SupplierMatchStatus,
  UpdateSupplierInvoiceInput,
  UpdateSupplierInvoiceLineInput,
  UploadAndExtractResult,
} from "../types/supplierInvoice.js";
import type { OcrInvoiceResult } from "../types/supplierInvoice.js";
import { normaliseImportRow } from "./catalogueImportNormalisation.js";

export function createSupplierInvoiceService(
  repo: SupplierInvoiceRepository,
  ocrProvider: OcrProvider,
  supplierCatalogueRepo: SupplierCatalogueRepository,
  auditService: AuditService,
  supplierRepo: SupplierRepository,
  supplierRelationshipRepo?: SupplierRelationshipRepository,
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
    if (invoice.status !== "ready_for_review" && invoice.status !== "pending_review") {
      throw new AppError(
        409,
        "SUPPLIER_INVOICE_INVALID_STATUS",
        `This action requires status 'ready_for_review'. Current status: ${invoice.status}`,
      );
    }
  }

  function assertCancellableImport(invoice: SupplierInvoice): void {
    switch (invoice.status) {
      case "cancelled":
      case "voided":
      case "uploaded":
      case "processing":
      case "ready_for_review":
      case "pending_review":
        return;
      case "imported":
      case "confirmed":
        throw new AppError(
          409,
          "IMPORT_ALREADY_IMPORTED",
          "Imported catalogue jobs cannot be cancelled.",
        );
      case "failed":
        throw new AppError(
          409,
          "IMPORT_ALREADY_FAILED",
          "Failed catalogue jobs cannot be cancelled after processing has completed.",
        );
    }
    throw new AppError(
      409,
      "IMPORT_CANNOT_CANCEL",
      "Catalogue import cannot be cancelled from the current status.",
    );
  }

  // ── Supplier matching ──────────────────────────────────────────────────────

  /**
   * Deterministic supplier matching — no fuzzy logic.
   * Priority: ABN match → exact name match.
   * Returns { detectedSupplier, matchedSupplier, supplierMatchStatus }.
   */
  async function matchSupplierFromOcr(ocrResult: OcrInvoiceResult): Promise<{
    detectedSupplier: DetectedSupplierInfo | null;
    matchedSupplier: Supplier | null;
    supplierMatchStatus: SupplierMatchStatus;
  }> {
    const rawName = ocrResult.supplierName?.trim() ?? null;

    if (!rawName) {
      return {
        detectedSupplier: null,
        matchedSupplier: null,
        supplierMatchStatus: "not_detected",
      };
    }

    const detectedSupplier: DetectedSupplierInfo = {
      supplierName: rawName,
      abn: ocrResult.supplierAbn ?? null,
      email: ocrResult.supplierEmail ?? null,
      phone: ocrResult.supplierPhone ?? null,
      address: ocrResult.supplierAddress ?? null,
      website: ocrResult.supplierWebsite ?? null,
    };

    // 1. Try ABN match first (most reliable).
    if (ocrResult.supplierAbn) {
      const byAbn = await supplierRepo.findSupplierByAbn(ocrResult.supplierAbn);
      if (byAbn) {
        return { detectedSupplier, matchedSupplier: byAbn, supplierMatchStatus: "matched" };
      }
    }

    // 2. Exact case-insensitive name match.
    const byName = await supplierRepo.findSupplierByName(rawName);
    if (byName) {
      return { detectedSupplier, matchedSupplier: byName, supplierMatchStatus: "matched" };
    }

    // 3. Name detected but no existing supplier found — needs user confirmation.
    return {
      detectedSupplier,
      matchedSupplier: null,
      supplierMatchStatus: "needs_confirmation",
    };
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

    // Smart Supplier Detection — match OCR supplier name/ABN to existing records.
    const { detectedSupplier, matchedSupplier, supplierMatchStatus } =
      await matchSupplierFromOcr(ocrResult);

    // Sprint 4D: Supplier Relationship awareness.
    // When a supplier is matched, check whether an active relationship exists
    // for this clinic.  We do NOT create a relationship automatically — the
    // frontend implements that workflow separately.
    const supplierExists = matchedSupplier !== null;
    let relationshipExists: boolean | null = null;
    if (matchedSupplier && supplierRelationshipRepo) {
      const rel = await supplierRelationshipRepo.findByClinicAndSupplier(
        clinicId,
        matchedSupplier.id,
      );
      relationshipExists = rel !== null && rel.relationshipStatus === "active";
    } else if (matchedSupplier) {
      // Relationship repo not available (in-memory / test mode without repo).
      relationshipExists = false;
    }

    // If a confident match was found, attach the invoice to that supplier.
    const resolvedSupplierId = matchedSupplier?.id ?? null;

    // Auto-match lines against supplier_catalogue by supplier_sku.
    // The first pass attempts exact SKU matching; unmatched lines remain unmatched.
    const matchedLines = await Promise.all(
      ocrResult.lines.map(async (ocrLine, idx) => {
        const normalizedLine = normaliseImportRow({
          productName: ocrLine.description,
          supplierSku: ocrLine.sku,
        });
        let masterCatalogItemId: string | null = null;
        let supplierCatalogueId: string | null = null;
        let isMatched = false;
        let matchMethod: "exact_sku" | "name_match" | "manual" | null = null;

        if (normalizedLine.supplierSku) {
          const sku = normalizedLine.supplierSku;
          const catalogueEntries = await supplierCatalogueRepo.listSupplierProducts({
            active: true,
          });
          const exactMatch = catalogueEntries.find(
            (e) =>
              e.supplierSku?.toLowerCase() === sku.toLowerCase(),
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
          normalizedDescription: normalizedLine.productName,
          normalizedSku: normalizedLine.supplierSku,
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
      supplierId: resolvedSupplierId,
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
          ocrDescription: m.normalizedDescription ?? "",
          ocrSku: m.normalizedSku,
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
          inv.status !== "cancelled" &&
          inv.id !== invoice.id,
      );
      if (dup) {
        duplicateInvoiceNumberWarning = {
          existingInvoiceId: dup.id,
          existingStatus: dup.status,
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
      detectedSupplier,
      matchedSupplier,
      supplierMatchStatus,
      supplierExists,
      relationshipExists,
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

    // These three fields were validated non-null above; capture as consts so TypeScript narrows.
    const confirmedSupplierId = invoice.supplierId;
    const confirmedInvoiceDate = invoice.invoiceDate;

    const lines = await repo.listLines(clinicId, invoiceId);
    const matchedLines = lines.filter(
      (l): l is SupplierInvoiceLine & { masterCatalogItemId: string } =>
        l.isMatched && l.masterCatalogItemId !== null,
    );

    // Upsert supplier_catalogue pricing for each matched line.
    const priceHistoryRecords = await Promise.all(
      matchedLines.map(async (line) => {
        const { catalogueId, oldUnitCostCents } =
          await repo.upsertSupplierCataloguePrice(
            confirmedSupplierId,
            line.masterCatalogItemId,
            line.unitPriceCents,
            line.ocrSku,
          );

        return repo.insertPriceHistory({
          supplierCatalogueId: catalogueId,
          supplierId: confirmedSupplierId,
          masterCatalogItemId: line.masterCatalogItemId,
          oldUnitCostCents,
          newUnitCostCents: line.unitPriceCents,
          source: "supplier_invoice_ocr",
          sourceReferenceId: invoiceId,
          changedByUserId: caller.id,
          changedByEmail: caller.email,
          effectiveDate: confirmedInvoiceDate,
        });
      }),
    );

    const now = new Date();
    const confirmed = await repo.setStatus(clinicId, invoiceId, "imported", {
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

  // ── 7. Cancel Import ──────────────────────────────────────────────────────

  async function cancelImport(
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

    assertCancellableImport(invoice);

    if (invoice.status === "cancelled" || invoice.status === "voided") {
      return invoice;
    }

    const cancelled = await repo.setStatus(clinicId, invoiceId, "cancelled", {
      voidedByUserId: caller.id,
      voidedAt: new Date(),
    });

    if (!cancelled) {
      throw new AppError(500, "INTERNAL_ERROR", "Failed to cancel catalogue import");
    }

    await repo.removeLinesForInvoice(clinicId, invoiceId);
    await repo.clearTemporaryExtractionData(clinicId, invoiceId);

    const cleaned = await repo.findById(clinicId, invoiceId);
    if (!cleaned) {
      throw new AppError(500, "INTERNAL_ERROR", "Failed to reload cancelled catalogue import");
    }

    auditService.logEvent("supplier_invoice.cancelled", {
      userId: caller.id,
      email: caller.email,
      clinicId,
      resourceId: invoiceId,
    });

    return cleaned;
  }

  // ── 8. Void ───────────────────────────────────────────────────────────────

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
    cancelImport,
    voidInvoice,
  };
}

export type SupplierInvoiceService = ReturnType<typeof createSupplierInvoiceService>;
