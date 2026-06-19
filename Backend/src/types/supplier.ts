/**
 * Supplier domain types for Sprint O — Procurement Foundations.
 *
 * Suppliers are global (system-wide, not clinic-scoped) — they mirror
 * master_catalog_items which are also global.  Supplier catalogue pricing
 * is also global: one price per (supplier, product) pair.
 */

// ─── Supplier ─────────────────────────────────────────────────────────────────

export type Supplier = {
  id: string;
  supplierName: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSupplierInput = {
  supplierName: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
};

export type UpdateSupplierInput = {
  supplierName?: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  active?: boolean;
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

// ─── Purchase order cost estimation ──────────────────────────────────────────

export type SupplierPricingEntry = {
  supplierProductId: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  unitCostCents: number;
  supplierSku: string | null;
};
