-- Migration 044 rollback: remove supplier invoice line financial truth fields
ALTER TABLE supplier_invoice_lines
  DROP COLUMN IF EXISTS price_includes_tax,
  DROP COLUMN IF EXISTS discount_basis_points,
  DROP COLUMN IF EXISTS supplier_line_total_cents;
