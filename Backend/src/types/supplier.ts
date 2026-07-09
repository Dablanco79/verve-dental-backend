/**
 * Supplier domain types.
 *
 * Sprint O — Procurement Foundations: core CRUD (name, code, contact, ABN, …).
 * Sprint 4C — Supplier Master Foundation: enterprise metadata for global
 *   supplier directory, verification, API capability flags, and categorisation.
 *
 * Suppliers are global (system-wide, not clinic-scoped) — they mirror
 * master_catalog_items which are also global.  Supplier catalogue pricing
 * is also global: one price per (supplier, product) pair.
 */

// ─── Supplier ─────────────────────────────────────────────────────────────────

export type Supplier = {
  // ── Core (Sprint O) ────────────────────────────────────────────────────────
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
  createdAt: Date;
  updatedAt: Date;
  // ── Enterprise metadata (Sprint 4C) ────────────────────────────────────────
  /** Registered legal business name (may differ from trading name). */
  legalName: string | null;
  /** Public-facing trading name (if different from legalName). */
  tradingName: string | null;
  /** ISO 3166-1 alpha-2. Defaults to 'AU'. */
  countryCode: string;
  /** ISO 4217 currency code. Defaults to 'AUD'. */
  currencyCode: string;
  /** Broad industry (e.g. 'Healthcare', 'Dental Supplies'). */
  industryCategory: string | null;
  /** Healthcare sub-category (e.g. 'Dental', 'Surgical'). */
  healthcareSubcategory: string | null;
  /** Internal classification used for filtering/reporting. */
  supplierCategory: string | null;
  /** Whether this supplier has been verified by the platform team. */
  verified: boolean;
  /** Supplier offers a programmatic API for pricing/ordering. */
  apiAvailable: boolean;
  /** Supplier provides a digital product catalogue. */
  catalogueAvailable: boolean;
  /** Supplier supports live/real-time pricing queries. */
  livePricing: boolean;
  /** Supplier supports online ordering through the platform. */
  onlineOrdering: boolean;
  /** Preferred communication method (e.g. 'email', 'api', 'edi'). */
  preferredCommMethod: string | null;
  /** Storage key for supplier logo asset (e.g. S3 object key). */
  logoStorageKey: string | null;
  /** Clinic that originally created this supplier record (nullable). */
  createdByClinicId: string | null;
  /** When false, this supplier is private to the creating clinic. Defaults to true. */
  isPublic: boolean;
};

export type CreateSupplierInput = {
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
  /** ISO 3166-1 alpha-2. Defaults to 'AU' when omitted. */
  countryCode?: string;
  /** ISO 4217 currency code. Defaults to 'AUD' when omitted. */
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

export type UpdateSupplierInput = {
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

// ─── Supplier Product (catalogue pricing entry) ───────────────────────────────

export type SupplierProduct = {
  id: string;
  supplierId: string;
  /** References master_catalog_items.id */
  productId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  /** Unit cost stored as integer cents (e.g. 1250 = $12.50) */
  unitCostCents: number;
  unitOfMeasure: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSupplierProductInput = {
  supplierId: string;
  productId: string;
  supplierSku?: string | null;
  supplierDescription?: string | null;
  unitCostCents: number;
  unitOfMeasure?: string | null;
};

export type UpdateSupplierProductInput = {
  supplierSku?: string | null;
  supplierDescription?: string | null;
  unitCostCents?: number;
  unitOfMeasure?: string | null;
  active?: boolean;
};

// ─── Product matching ─────────────────────────────────────────────────────────

export const PRODUCT_MATCH_STATUSES = [
  "barcode",
  "sku",
  "name",
  "manual",
  "unmatched",
] as const;

export type ProductMatchStatus = (typeof PRODUCT_MATCH_STATUSES)[number];

export type ProductMatchResult = {
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  matchStatus: ProductMatchStatus;
};

/** Human-readable labels explaining why a suggestion was ranked at its confidence. */
export const PRODUCT_MATCH_REASONS = [
  "supplier_sku_mapping",
  "exact_name",
  "token_similarity",
  "category_boost",
  "brand_boost",
  "unit_boost",
] as const;

export type ProductMatchReason = (typeof PRODUCT_MATCH_REASONS)[number];

/**
 * A single ranked suggestion returned by the Product Matching Engine v1.
 * confidence is an integer 0–100.
 */
export type ProductMatchSuggestion = {
  masterProductId: string;
  displayName: string;
  sku: string;
  category: string;
  brand: string | null;
  stockUnit: string;
  /** Integer 0–100. */
  confidence: number;
  reasons: ProductMatchReason[];
};

export type SuggestMatchesInput = {
  supplierId: string;
  supplierSku?: string | null;
  supplierDescription?: string | null;
  category?: string | null;
  brand?: string | null;
  unit?: string | null;
  packSize?: string | null;
};

export type SuggestMatchesResult = {
  suggestions: ProductMatchSuggestion[];
};

export type ConfirmMatchInput = {
  supplierId: string;
  masterProductId: string;
  supplierSku?: string | null;
  supplierDescription?: string | null;
  /** Unit cost in cents; pass null/undefined to default to 0 */
  lastUnitCostCents?: number | null;
};

// ─── Catalogue import ─────────────────────────────────────────────────────────

export type ImportRow = {
  rowNumber: number;
  supplierSku: string | null;
  description: string | null;
  /** Raw string as it appeared in the file */
  rawUnitCost: string | null;
  /** Parsed and converted to cents; null if parsing failed */
  unitCostCents: number | null;
  unitOfMeasure: string | null;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchedProductSku: string | null;
  matchStatus: ProductMatchStatus;
  /** Populated only on rows that could not be imported */
  error: string | null;
};

export type ImportPreviewResult = {
  supplierId: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  errorRows: number;
  rows: ImportRow[];
};

export type ImportConfirmResult = {
  supplierId: string;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: ImportRow[];
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

export type ReviewedCatalogueImportResult = ImportConfirmResult & {
  createdProducts: number;
};

// ─── Purchase order cost estimation ──────────────────────────────────────────

export type SupplierPricingEntry = {
  supplierProductId: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  unitCostCents: number;
  supplierSku: string | null;
};
