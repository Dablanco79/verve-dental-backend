-- Migration 044: Supplier invoice line financial truth fields
--
-- Adds three fields to supplier_invoice_lines to preserve the supplier
-- invoice as actually presented, resolving four confirmed data defects:
--
--   price_includes_tax    — whether the printed unit price already includes tax
--                           NULL = unknown (never silently assumes false)
--   discount_basis_points — supplier line discount in basis points (0 = none)
--   supplier_line_total_cents — the supplier-stated line total, preserved verbatim
--
-- These are additive columns. Existing rows receive safe defaults:
--   price_includes_tax    = NULL  (unknown — do not assume)
--   discount_basis_points = 0     (no discount — safe backward compat)
--   supplier_line_total_cents = NULL (not previously captured)
--
-- MIGRATION SAFETY: additive only. No existing data is modified.

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS price_includes_tax      BOOLEAN,
  ADD COLUMN IF NOT EXISTS discount_basis_points   INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sil_discount_bp_non_negative CHECK (discount_basis_points >= 0),
  ADD COLUMN IF NOT EXISTS supplier_line_total_cents BIGINT;

COMMENT ON COLUMN supplier_invoice_lines.price_includes_tax IS
  'Whether the printed supplier unit price includes tax. NULL = unknown; true = incl-GST; false = ex-GST.';

COMMENT ON COLUMN supplier_invoice_lines.discount_basis_points IS
  'Supplier line discount in basis points. 0 = no discount. 1000 = 10%.';

COMMENT ON COLUMN supplier_invoice_lines.supplier_line_total_cents IS
  'Supplier-stated line total exactly as extracted from the invoice (invoice financial truth). May be incl-GST or ex-GST depending on supplier presentation. NULL when not provided.';
