/**
 * Invoice Line Cost Helper — Financial Truth & Operational Cost Normalisation
 *
 * Two concerns are kept strictly separate:
 *
 * 1. INVOICE FINANCIAL TRUTH
 *    Verve-calculated line totals (subtotal_cents, tax_cents, total_cents)
 *    correctly derived from `price_includes_tax`, `discount_basis_points`,
 *    and `tax_rate_basis_points`.  These replace the old naive calculation
 *    that assumed every price was ex-GST and added tax unconditionally.
 *
 * 2. OPERATIONAL UNIT COST
 *    Net ex-tax cost per canonical stock unit after supplier discounts.
 *    Used for supplier catalogue pricing, price history, forecasting, and
 *    inventory valuation.
 *
 * Source-of-truth priority for operational cost:
 *   1. Supplier-stated line total (`supplier_line_total_cents`) + tax semantics
 *   2. Derived from printed unit price with explicit `price_includes_tax`,
 *      discount, and tax rate data
 *   3. Ambiguous → return null (do NOT silently persist a misleading cost)
 */

// ── Verve-calculated line totals ──────────────────────────────────────────────

export type LineTotals = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Calculate Verve-derived line totals correctly based on tax-inclusion semantics.
 *
 * GST-exclusive example (priceIncludesTax = false):
 *   unitPrice $100 ex-GST, qty 2, 10% discount, 10% GST:
 *   subtotal = round(200 × 0.90) = 180
 *   tax      = round(180 × 0.10) = 18
 *   total    = 198
 *
 * GST-inclusive example (priceIncludesTax = true):
 *   unitPrice $110 incl-GST, qty 2, 10% discount, 10% GST:
 *   gross incl-GST = 220
 *   total incl-GST = round(220 × 0.90) = 198
 *   tax (extracted) = round(198 × 1000 / 11000) = 18
 *   subtotal = 198 - 18 = 180
 *
 * GST-free example (taxRateBasisPoints = 0):
 *   subtotal = round(qty × price × (1 - discount))
 *   tax = 0, total = subtotal
 *
 * Unknown / null priceIncludesTax:
 *   Falls back to ex-GST assumption for backward compatibility.
 */
export function calcLineTotals(
  quantity: number,
  unitPriceCents: number,
  priceIncludesTax: boolean | null,
  discountBasisPoints: number,
  taxRateBasisPoints: number,
): LineTotals {
  if (priceIncludesTax === true) {
    // Price already includes tax — do NOT add tax again.
    const grossInclTax = Math.round(quantity * unitPriceCents);
    const totalCents = Math.round(grossInclTax * (10_000 - discountBasisPoints) / 10_000);
    const taxCents =
      taxRateBasisPoints > 0
        ? Math.round(totalCents * taxRateBasisPoints / (10_000 + taxRateBasisPoints))
        : 0;
    const subtotalCents = totalCents - taxCents;
    return { subtotalCents, taxCents, totalCents };
  }

  // Ex-tax (or unknown — backward-compat treat as ex-tax)
  const grossExTax = Math.round(quantity * unitPriceCents);
  const subtotalCents = Math.round(grossExTax * (10_000 - discountBasisPoints) / 10_000);
  const taxCents = Math.round(subtotalCents * taxRateBasisPoints / 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// ── Operational unit cost ─────────────────────────────────────────────────────

/**
 * Derive the net ex-tax line cost (entire line, not per unit) in cents.
 *
 * Source-of-truth priority:
 *   1. `supplierLineTotalCents` with explicit tax-basis semantics
 *   2. `unitPriceCents` with explicit `priceIncludesTax`, discount, and tax data
 *   3. Returns null when semantics are genuinely ambiguous
 *
 * The supplier line total is kept as invoice truth, but its tax basis must not
 * be guessed when deriving an operational ex-tax cost.
 */
export function deriveNetExTaxLineCost(params: {
  quantity: number;
  unitPriceCents: number;
  priceIncludesTax: boolean | null;
  discountBasisPoints: number;
  taxRateBasisPoints: number;
  supplierLineTotalCents: number | null;
}): number | null {
  const {
    quantity,
    unitPriceCents,
    priceIncludesTax,
    discountBasisPoints,
    taxRateBasisPoints,
    supplierLineTotalCents,
  } = params;

  // Priority 1: supplier-stated line total (invoice financial truth), using
  // the explicit printed-column tax basis shared by unit price and line total.
  if (supplierLineTotalCents !== null) {
    if (priceIncludesTax === true && taxRateBasisPoints > 0) {
      return Math.round(supplierLineTotalCents * 10_000 / (10_000 + taxRateBasisPoints));
    }
    if (priceIncludesTax !== null) return supplierLineTotalCents;
    return null;
  }

  // Priority 2: derive from printed unit price with explicit semantics.
  if (priceIncludesTax === true) {
    const grossInclTax = Math.round(quantity * unitPriceCents);
    const totalInclTax = Math.round(grossInclTax * (10_000 - discountBasisPoints) / 10_000);
    if (taxRateBasisPoints > 0) {
      return Math.round(totalInclTax * 10_000 / (10_000 + taxRateBasisPoints));
    }
    return totalInclTax;
  }

  if (priceIncludesTax === false) {
    const grossExTax = Math.round(quantity * unitPriceCents);
    return Math.round(grossExTax * (10_000 - discountBasisPoints) / 10_000);
  }

  // Priority 3: priceIncludesTax = null — genuinely ambiguous.
  return null;
}

/**
 * Derive the canonical operational unit cost: net ex-tax cost per stock unit
 * after supplier discounts and unit conversion.
 *
 * Operational unit cost = net ex-tax line cost / (quantity × unitsPerReceivingUnit)
 *
 * Example:
 *   2 Cartons × 10 Boxes/Carton, supplier net ex-GST line cost = $160
 *   Total stock units = 20 Boxes
 *   Operational unit cost = $160 / 20 = $8.00 per Box
 *
 * Returns null when:
 *   - Tax inclusion semantics are ambiguous and no supplier total is available
 *   - Total stock unit count is zero or negative
 */
export function deriveOperationalUnitCost(params: {
  quantity: number;
  unitPriceCents: number;
  priceIncludesTax: boolean | null;
  discountBasisPoints: number;
  taxRateBasisPoints: number;
  supplierLineTotalCents: number | null;
  unitsPerReceivingUnit?: number;
}): number | null {
  const unitsPerReceivingUnit = params.unitsPerReceivingUnit ?? 1;

  const netExTaxLineCost = deriveNetExTaxLineCost(params);
  if (netExTaxLineCost === null) return null;

  const totalStockUnits = params.quantity * unitsPerReceivingUnit;
  if (totalStockUnits <= 0) return null;

  return Math.round(netExTaxLineCost / totalStockUnits);
}
