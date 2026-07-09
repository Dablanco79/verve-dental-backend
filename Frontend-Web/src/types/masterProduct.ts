// ── Master Product Management Foundation ──────────────────────────────────────
//
// Global (not clinic-scoped) catalogue products backed by master_catalog_items.
// These endpoints never touch stock quantities — see Backend/src/services/
// masterProductService.ts for the safety invariant.

export type MasterProductStatus = "active" | "archived";

export type MasterProduct = {
  id: string;
  displayName: string;
  sku: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  variantAttributes: string | null;
  stockUnit: string;
  receivingUnit: string;
  status: MasterProductStatus;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MasterProductStatusFilter = "active" | "archived" | "all";

export type ListMasterProductsParams = {
  search?: string;
  category?: string;
  status?: MasterProductStatusFilter;
  limit?: number;
  offset?: number;
};

export type MasterProductsPage = {
  items: MasterProduct[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateMasterProductRequest = {
  displayName: string;
  sku?: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  variantAttributes?: string | null;
  stockUnit?: string;
  receivingUnit?: string;
  status?: MasterProductStatus;
  notes?: string | null;
};

export type UpdateMasterProductRequest = Partial<CreateMasterProductRequest>;

// ─── Product Matching Engine v1 ───────────────────────────────────────────────

export type ProductMatchReason =
  | "supplier_sku_mapping"
  | "exact_name"
  | "token_similarity"
  | "category_boost"
  | "brand_boost"
  | "unit_boost";

/** A single ranked suggestion from the matching engine. confidence is 0–100. */
export type ProductMatchSuggestion = {
  masterProductId: string;
  displayName: string;
  sku: string;
  category: string;
  brand: string | null;
  stockUnit: string;
  confidence: number;
  reasons: ProductMatchReason[];
};

export type SuggestMatchesRequest = {
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

export type ConfirmMatchRequest = {
  supplierId: string;
  masterProductId: string;
  supplierSku?: string | null;
  supplierDescription?: string | null;
  lastUnitCostCents?: number | null;
};

export type ConfirmedSupplierProductMapping = {
  id: string;
  supplierId: string;
  masterProductId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  lastUnitCostCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Minimal accepted match info stored client-side when user accepts a suggestion. */
export type AcceptedMatchOverride = {
  masterProductId: string;
  displayName: string;
  sku: string;
};

