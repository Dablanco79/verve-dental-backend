/**
 * Supplier Contract Price domain types — Sprint 4G.
 *
 * A SupplierContractPrice is a negotiated line-item price for a specific product
 * under a Supplier Contract.  Pricing is informational only in this sprint —
 * no purchasing behaviour changes.
 *
 * Commercial intelligence model (future):
 *   This schema is designed to become Verve's commercial pricing engine.
 *   The combination of:
 *     Supplier Catalogue Price  (supplier_catalogue_items.unit_cost_cents)
 *     Negotiated Contract Price (supplier_contract_prices.unit_price_cents)
 *     Actual Invoice Price      (supplier_invoice_lines.unit_cost_cents)
 *     Live Supplier API Price   (future supplier API integration)
 *   will support price variance detection, AI purchasing recommendations,
 *   contract compliance checking, and savings reporting without redesigning
 *   this table.
 *
 * Business rules:
 *   • unit_price_cents must be > 0.
 *   • effective_to must be after effective_from when provided.
 *   • minimum_quantity >= 1 when provided.
 *   • maximum_quantity >= minimum_quantity when both are provided.
 *   • Only one active price per (contract, product, priceType, qty-tier) at
 *     any point in time (enforced by the service layer).
 *   • No hard deletes — expire (set effective_to) only.
 */

// ─── Price type ───────────────────────────────────────────────────────────────

export const SUPPLIER_CONTRACT_PRICE_TYPES = [
  "contract",
  "promotional",
] as const;

export type SupplierContractPriceType =
  (typeof SUPPLIER_CONTRACT_PRICE_TYPES)[number];

// ─── Domain type ──────────────────────────────────────────────────────────────

export type SupplierContractPrice = {
  id: string;
  /** References supplier_contracts.id */
  supplierContractId: string;
  /** References master_catalog_items.id */
  masterCatalogItemId: string;
  /**
   * 'contract'    = standing negotiated price for the contract term.
   * 'promotional' = time-limited promotional price (e.g. end-of-quarter).
   */
  priceType: SupplierContractPriceType;
  /** Negotiated unit price in integer cents. Must be > 0. */
  unitPriceCents: number;
  /** Date from which this price is effective. */
  effectiveFrom: Date;
  /** Date after which this price is no longer effective. null = open-ended. */
  effectiveTo: Date | null;
  /** Minimum order quantity for this price tier. null = no minimum. */
  minimumQuantity: number | null;
  /** Maximum order quantity for this price tier. null = no maximum. */
  maximumQuantity: number | null;
  /** ISO 4217 currency code. Defaults 'AUD'. */
  currencyCode: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateSupplierContractPriceInput = {
  masterCatalogItemId: string;
  priceType?: SupplierContractPriceType;
  unitPriceCents: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  currencyCode?: string;
  notes?: string | null;
};

export type UpdateSupplierContractPriceInput = {
  priceType?: SupplierContractPriceType;
  unitPriceCents?: number;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  currencyCode?: string;
  notes?: string | null;
};
