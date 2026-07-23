export type Supplier = {
  // ── Core ───────────────────────────────────────────────────────────────────
  id: string;
  supplierName: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  abn: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // ── Enterprise metadata (Sprint 4C) ────────────────────────────────────────
  legalName: string | null;
  tradingName: string | null;
  countryCode: string;
  currencyCode: string;
  industryCategory: string | null;
  healthcareSubcategory: string | null;
  supplierCategory: string | null;
  verified: boolean;
  apiAvailable: boolean;
  catalogueAvailable: boolean;
  livePricing: boolean;
  onlineOrdering: boolean;
  preferredCommMethod: string | null;
  logoStorageKey: string | null;
  createdByClinicId: string | null;
  isPublic: boolean;
};

export type CreateSupplierRequest = {
  // ── Core ───────────────────────────────────────────────────────────────────
  supplierName: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  abn?: string | null;
  address?: string | null;
  notes?: string | null;
  // ── Enterprise metadata (Sprint 4C) ────────────────────────────────────────
  legalName?: string | null;
  tradingName?: string | null;
  countryCode?: string;
  currencyCode?: string;
  industryCategory?: string | null;
  healthcareSubcategory?: string | null;
  supplierCategory?: string | null;
  verified?: boolean;
  apiAvailable?: boolean;
  catalogueAvailable?: boolean;
  livePricing?: boolean;
  onlineOrdering?: boolean;
  preferredCommMethod?: string | null;
  logoStorageKey?: string | null;
  createdByClinicId?: string | null;
  isPublic?: boolean;
};

export type UpdateSupplierRequest = {
  // ── Core ───────────────────────────────────────────────────────────────────
  supplierName?: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  abn?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
  // ── Enterprise metadata (Sprint 4C) ────────────────────────────────────────
  legalName?: string | null;
  tradingName?: string | null;
  countryCode?: string;
  currencyCode?: string;
  industryCategory?: string | null;
  healthcareSubcategory?: string | null;
  supplierCategory?: string | null;
  verified?: boolean;
  apiAvailable?: boolean;
  catalogueAvailable?: boolean;
  livePricing?: boolean;
  onlineOrdering?: boolean;
  preferredCommMethod?: string | null;
  logoStorageKey?: string | null;
  isPublic?: boolean;
};

export type SupplierProduct = {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  unitCostCents: number;
  unitOfMeasure: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CatalogueImportMatchStatus = "barcode" | "sku" | "name" | "manual" | "unmatched";

export type CatalogueImportRow = {
  rowNumber: number;
  supplierSku: string | null;
  description: string | null;
  rawUnitCost: string | null;
  unitCostCents: number | null;
  unitOfMeasure: string | null;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchedProductSku: string | null;
  matchStatus: CatalogueImportMatchStatus;
  error: string | null;
};

export type CatalogueImportPreviewResult = {
  supplierId: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  errorRows: number;
  rows: CatalogueImportRow[];
};

export type CatalogueImportConfirmResult = {
  supplierId: string;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: CatalogueImportRow[];
};

export type ReviewedCatalogueRowState =
  | "Approved"
  | "Skipped"
  | "Ready to Create"
  | "Matched Existing Product";

export type ReviewedCatalogueImportRow = {
  rowNumber: number;
  state: ReviewedCatalogueRowState;
  supplierSku: string | null;
  description: string | null;
  unitCostCents: number | null;
  unitOfMeasure: string | null;
  matchedProductId: string | null;
};

export type ReviewedCatalogueImportRequest = {
  clinicId: string;
  rows: ReviewedCatalogueImportRow[];
};

export type ReviewedCatalogueImportResult = CatalogueImportConfirmResult & {
  createdProducts: number;
};

export type SupplierInvoiceStatus =
  | "uploaded"
  | "processing"
  | "ready_for_review"
  | "imported"
  | "cancelled"
  | "failed"
  | "pending_review"
  | "confirmed"
  | "voided";

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
  originalFilename: string;
  fileMimeType: string;
  importedByUserId: string;
  importedByEmail: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  voidedByUserId: string | null;
  voidedAt: string | null;
  /** Set once physical receiving is completed for this invoice. */
  receivedAt: string | null;
  /** ID of the user who confirmed receiving. */
  receivedByUserId: string | null;
  /** Invoice/delivery reference recorded at receiving time. */
  receivedReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListSuppliersParams = {
  active?: boolean;
};

export type ListSupplierInvoicesParams = {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type SupplierInvoiceLine = {
  id: string;
  invoiceId: string;
  lineNumber: number;
  ocrDescription: string | null;
  ocrSku: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  masterCatalogItemId: string | null;
  /** Display name of the linked Master Product — null when not yet matched. */
  masterProductName: string | null;
  supplierCatalogueId: string | null;
  isMatched: boolean;
  matchMethod: "exact_sku" | "name_match" | "manual" | null;
  /**
   * Persisted review decision returned by the backend.
   * null = no decision yet (unresolved).
   */
  reviewDecision: "create_product" | "skip" | null;
  createdAt: string;
  updatedAt: string;
};

export type DetectedSupplierInfo = {
  supplierName: string;
  abn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
};

export type SupplierMatchStatus =
  | "matched"
  | "needs_confirmation"
  | "not_detected";

export type UploadAndExtractResult = {
  invoice: SupplierInvoice;
  lines: SupplierInvoiceLine[];
  duplicateFileWarning: {
    existingInvoiceId: string;
    importedAt: string;
  } | null;
  duplicateInvoiceNumberWarning: {
    existingInvoiceId: string;
    existingStatus: SupplierInvoiceStatus;
  } | null;
  detectedSupplier: DetectedSupplierInfo | null;
  matchedSupplier: Supplier | null;
  supplierMatchStatus: SupplierMatchStatus;
  /** Sprint 4D: true when OCR matched a supplier in the global Supplier Master. */
  supplierExists: boolean;
  /**
   * Sprint 4D: Whether an active clinic-supplier relationship exists.
   * null when supplier was not matched (supplierExists = false).
   */
  relationshipExists: boolean | null;
};

export type ConfirmImportResult = {
  invoice: SupplierInvoice;
  priceUpdates: number;
  createdProducts: number;
};

export type ConfirmImportRequest = {
  readyToCreateLineIds?: string[];
  skippedLineIds?: string[];
};

// ── Supplier Intelligence (Sprint 3) ─────────────────────────────────────────

export type IntelligenceConfidence =
  | "high"
  | "medium"
  | "catalogue_only"
  | "insufficient_data";

export type SupplierIntelligenceRow = {
  productId: string;
  productName: string;
  productSku: string;
  currentSupplierId: string | null;
  currentSupplierName: string | null;
  currentUnitPriceCents: number | null;
  bestSupplierId: string | null;
  bestSupplierName: string | null;
  bestUnitPriceCents: number | null;
  savingPerUnit: number | null;
  estimatedAnnualUsage: number | null;
  estimatedAnnualSaving: number | null;
  confidence: IntelligenceConfidence;
  reason: string;
  supplierCatalogueCount: number;
};

export type SupplierIntelligenceSummary = {
  totalPotentialAnnualSavingCents: number;
  productsWithSaving: number;
  averagePriceVariancePct: number | null;
  productsNeedingAttention: number;
};

export type SupplierIntelligenceResult = {
  clinicId: string;
  generatedAt: string;
  summary: SupplierIntelligenceSummary;
  opportunities: SupplierIntelligenceRow[];
  needsAttention: SupplierIntelligenceRow[];
};

export type UpdateSupplierInvoiceRequest = {
  supplierId?: string | null;
  supplierNameRaw?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export type UpdateSupplierInvoiceLineRequest = {
  ocrDescription?: string;
  ocrSku?: string | null;
  quantity?: number;
  unitPriceCents?: number;
  taxRateBasisPoints?: number;
  masterCatalogItemId?: string | null;
  supplierCatalogueId?: string | null;
  isMatched?: boolean;
  matchMethod?: "exact_sku" | "name_match" | "manual" | null;
  /** Persist a review decision to the database. null clears the current decision. */
  reviewDecision?: "create_product" | "skip" | null;
};

// ── Invoice receiving request / result ────────────────────────────────────────

export type ReceiveInvoiceLineRequest = {
  itemId: string;
  quantityDelta: number;
};

export type ReceiveInvoiceRequest = {
  lines: ReceiveInvoiceLineRequest[];
  receivedReference?: string | null;
};

export type ReceiveInvoiceResult = {
  invoice: SupplierInvoice;
  adjustments: import("./inventory.js").InventoryAdjustment[];
  receivedAt: string;
  receivedBy: string;
};
