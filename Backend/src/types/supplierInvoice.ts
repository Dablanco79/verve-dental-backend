/**
 * Supplier Invoice OCR — Domain Types (Sprint OCR-1)
 *
 * These types cover the AP (Accounts Payable) supplier invoice workflow:
 *   upload → OCR extraction → review/edit → confirm import → price history
 *
 * Distinct from the AR (Accounts Receivable) billing module which covers
 * patient-facing invoices in types/billing.ts.
 *
 * All monetary values are integer CENTS (AUD).
 * OCR confidence is a numeric 0–100 score.
 */

// ── Status ENUM ──────────────────────────────────────────────────────────────

export const SUPPLIER_INVOICE_STATUSES = [
  "pending_review",
  "confirmed",
  "voided",
] as const;

export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Supplier invoice header record.
 *
 * supplier_id, invoice_number, and invoice_date are nullable until the
 * review step.  confirmImport() enforces all three are present (Amendment 3).
 *
 * file_sha256 is the hex SHA-256 of the raw upload buffer.  Used for
 * duplicate-file detection (informational warning only in MVP) (Amendment 1B).
 *
 * storage_key is a nullable placeholder for a future S3/GCS object key.
 * NULL in MVP (Amendment 1).
 *
 * ocr_confidence is the Claude-reported overall extraction confidence (0–100).
 */
export type SupplierInvoice = {
  id: string;
  clinicId: string;
  supplierId: string | null;
  supplierNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  status: SupplierInvoiceStatus;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  currency: string;
  ocrProvider: string;
  ocrConfidence: number | null;
  ocrRawResponse: unknown;
  originalFilename: string;
  fileMimeType: string;
  fileSha256: string | null;
  storageKey: string | null;
  importedByUserId: string;
  importedByEmail: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  voidedByUserId: string | null;
  voidedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Supplier invoice line item.
 *
 * ocr_description and ocr_sku are preserved verbatim from the OCR extraction
 * for audit purposes.  The editable quantity/price fields may be corrected
 * during review.
 *
 * master_catalog_item_id and supplier_catalogue_id are set during the review
 * step when the user matches the line to a known catalog item.
 */
export type SupplierInvoiceLine = {
  id: string;
  clinicId: string;
  supplierInvoiceId: string;
  masterCatalogItemId: string | null;
  supplierCatalogueId: string | null;
  ocrDescription: string;
  ocrSku: string | null;
  ocrConfidence: number | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  sortOrder: number;
  isMatched: boolean;
  matchMethod: "exact_sku" | "name_match" | "manual" | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Append-only record of every supplier price change.
 * Written by confirmImport() when it upserts supplier_catalogue pricing.
 */
export type SupplierPriceHistory = {
  id: string;
  supplierCatalogueId: string;
  supplierId: string;
  masterCatalogItemId: string;
  oldUnitCostCents: number | null;
  newUnitCostCents: number;
  source: "supplier_invoice_ocr" | "manual" | "catalogue_import";
  sourceReferenceId: string | null;
  changedByUserId: string;
  changedByEmail: string;
  effectiveDate: string;
  createdAt: Date;
};

// ── OCR provider result types ─────────────────────────────────────────────────

/**
 * Structured result returned by any OcrProvider implementation.
 * All monetary values in integer CENTS (AUD).
 * Supplier header fields (abn, supplierEmail, etc.) are extracted for Smart
 * Supplier Detection and used only in matching — they are never persisted
 * directly; the matched/created Supplier record is the source of truth.
 */
export type OcrInvoiceResult = {
  provider: string;
  supplierName: string | null;
  supplierAbn: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  supplierWebsite: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  overallConfidence: number | null;
  lines: OcrInvoiceLine[];
  rawResponse: unknown;
};

export type OcrInvoiceLine = {
  description: string;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  confidence: number | null;
};

// ── Input / filter types ──────────────────────────────────────────────────────

export type CreateSupplierInvoiceInput = {
  clinicId: string;
  supplierId: string | null;
  supplierNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  ocrProvider: string;
  ocrConfidence: number | null;
  ocrRawResponse: unknown;
  originalFilename: string;
  fileMimeType: string;
  fileSha256: string | null;
  importedByUserId: string;
  importedByEmail: string;
};

export type UpdateSupplierInvoiceInput = Partial<{
  supplierId: string | null;
  supplierNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
}>;

export type UpdateSupplierInvoiceLineInput = Partial<{
  ocrDescription: string;
  ocrSku: string | null;
  quantity: number;
  unitPriceCents: number;
  taxRateBasisPoints: number;
  masterCatalogItemId: string | null;
  supplierCatalogueId: string | null;
  isMatched: boolean;
  matchMethod: "exact_sku" | "name_match" | "manual" | null;
}>;

export type ListSupplierInvoicesOptions = {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type AddSupplierInvoiceLineInput = {
  clinicId: string;
  supplierInvoiceId: string;
  masterCatalogItemId: string | null;
  supplierCatalogueId: string | null;
  ocrDescription: string;
  ocrSku: string | null;
  ocrConfidence: number | null;
  quantity: number;
  unitPriceCents: number;
  taxRateBasisPoints: number;
  sortOrder: number;
  isMatched: boolean;
  matchMethod: "exact_sku" | "name_match" | "manual" | null;
};

// ── Upload result (service layer response) ────────────────────────────────────

export type DuplicateFileWarning = {
  existingInvoiceId: string;
  importedAt: Date;
};

export type DuplicateInvoiceNumberWarning = {
  existingInvoiceId: string;
  existingStatus: SupplierInvoiceStatus;
};

/**
 * Supplier header fields detected by OCR but not yet matched/confirmed.
 * Passed to the frontend so the user can review before a supplier is created.
 */
export type DetectedSupplierInfo = {
  supplierName: string;
  abn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
};

/**
 * Result of deterministic supplier matching after OCR extraction.
 *
 * "matched"           — OCR name/ABN matched an existing supplier; invoice
 *                       supplierId has been set automatically.
 * "needs_confirmation" — OCR detected a supplier name but no match found;
 *                        user must confirm before a supplier is created.
 * "not_detected"      — OCR could not extract any supplier name.
 */
export type SupplierMatchStatus =
  | "matched"
  | "needs_confirmation"
  | "not_detected";

export type UploadAndExtractResult = {
  invoice: SupplierInvoice;
  lines: SupplierInvoiceLine[];
  duplicateFileWarning: DuplicateFileWarning | null;
  duplicateInvoiceNumberWarning: DuplicateInvoiceNumberWarning | null;
  /** Fields extracted from the invoice header by OCR (null when not detected). */
  detectedSupplier: DetectedSupplierInfo | null;
  /** Existing supplier record that was matched (null when status is not "matched"). */
  matchedSupplier: import("./supplier.js").Supplier | null;
  supplierMatchStatus: SupplierMatchStatus;
};

// ── Confirm result ────────────────────────────────────────────────────────────

export type ConfirmImportResult = {
  invoice: SupplierInvoice;
  priceUpdates: number;
  priceHistory: SupplierPriceHistory[];
};
