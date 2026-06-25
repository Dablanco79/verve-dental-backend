/**
 * Supplier Contract Price frontend types — Sprint 4G.
 *
 * These types mirror the backend domain types and are used by the API client
 * and any future UI components.  No pages or navigation changes in this sprint.
 *
 * Prices are informational only — no purchasing behaviour changes.
 */

export type SupplierContractPriceType = "contract" | "promotional";

export type SupplierContractPrice = {
  id: string;
  supplierContractId: string;
  masterCatalogItemId: string;
  priceType: SupplierContractPriceType;
  unitPriceCents: number;
  /** ISO date-time string */
  effectiveFrom: string;
  /** ISO date-time string or null */
  effectiveTo: string | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  /** ISO 4217 currency code, e.g. "AUD" */
  currencyCode: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierContractPriceRequest = {
  masterCatalogItemId: string;
  priceType?: SupplierContractPriceType;
  unitPriceCents: number;
  /** ISO date string, e.g. "2026-01-01" */
  effectiveFrom: string;
  /** ISO date string or null */
  effectiveTo?: string | null;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  /** ISO 4217 currency code, defaults "AUD" */
  currencyCode?: string;
  notes?: string | null;
};

export type UpdateSupplierContractPriceRequest = {
  priceType?: SupplierContractPriceType;
  unitPriceCents?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  currencyCode?: string;
  notes?: string | null;
};
