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

// ── Inline product-creation data ─────────────────────────────────────────────

/**
 * Operator-reviewed product details saved when the user completes the
 * product-creation modal during invoice line review.
 *
 * Stored as JSONB in supplier_invoice_lines.product_creation_data.
 * Used by confirmImport() in preference to raw OCR text.
 */
export type ProductCreationData = {
  productName: string;
  category: string;
  supplierSku: string | null;
  stockUnit: string;
  receivingUnit: string;
  unitsPerReceivingUnit: number;
  unitCostCents: number;
};

// ── Status ENUM ──────────────────────────────────────────────────────────────

export const SUPPLIER_INVOICE_STATUSES = [
  "uploaded",
  "processing",
  "ready_for_review",
  "imported",
  "cancelled",
  "failed",
  // Legacy statuses retained for existing rows/API compatibility.
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
  /** Timestamp set when physical receiving is completed for this invoice. */
  receivedAt: Date | null;
  /** ID of the user who completed receiving. */
  receivedByUserId: string | null;
  /** Invoice/delivery reference recorded at receiving time (free-text). */
  receivedReference: string | null;
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
  /** Display name of the linked Master Product — populated via JOIN at read time. */
  masterProductName: string | null;
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
  /**
   * Persisted line review decision.
   *
   * null           — no decision yet (unresolved)
   * 'create_product' — user marked this line to have a new product created at confirm time
   * 'skip'           — user explicitly excluded this line from the import
   */
  reviewDecision: "create_product" | "skip" | null;
  /**
   * Operator-reviewed product creation details, populated when the user
   * completes the product-creation modal during invoice review.
   * confirmImport() uses these values in preference to raw OCR text.
   */
  productCreationData: ProductCreationData | null;
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
  /** Persisted review decision. null clears the current decision. */
  reviewDecision: "create_product" | "skip" | null;
  /** Operator-reviewed product details for the create_product flow. null clears. */
  productCreationData: ProductCreationData | null;
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
  reviewDecision?: "create_product" | "skip" | null;
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
  /**
   * Sprint 4D — Supplier Relationship awareness.
   *
   * true  — OCR matched a supplier in the global Supplier Master.
   * false — No supplier was matched (supplierMatchStatus is not "matched").
   */
  supplierExists: boolean;
  /**
   * Sprint 4D — Whether an active clinic-supplier relationship exists.
   *
   * true  — An active SupplierRelationship exists for this clinic + supplier.
   * false — Supplier matched but no relationship exists; the frontend should
   *         prompt the user to create one.
   * null  — Supplier was not matched (supplierExists = false); not applicable.
   */
  relationshipExists: boolean | null;
};

// ── Confirm result ────────────────────────────────────────────────────────────

export type ConfirmImportResult = {
  invoice: SupplierInvoice;
  priceUpdates: number;
  priceHistory: SupplierPriceHistory[];
  createdProducts: number;
};

export type ConfirmImportOptions = {
  readyToCreateLineIds?: string[];
  skippedLineIds?: string[];
};

// ── Receiving request / result types ──────────────────────────────────────────

/**
 * One line of a receiving action — links a clinic inventory item to the
 * quantity being physically received.
 */
export type ReceiveInvoiceLineInput = {
  itemId: string;
  quantityDelta: number;
};

/**
 * Result returned by receiveInvoice().
 * Contains the updated invoice (with receivedAt set), one adjustment
 * record per received line, and the actor who completed receiving.
 */
export type ReceiveInvoiceResult = {
  invoice: SupplierInvoice;
  adjustments: import("./inventory.js").InventoryAdjustment[];
  receivedAt: Date;
  receivedBy: string;
};
