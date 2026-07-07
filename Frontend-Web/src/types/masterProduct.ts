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
