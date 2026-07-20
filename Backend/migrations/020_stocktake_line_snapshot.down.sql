-- Reverse migration 020: remove product snapshot columns from stocktake_lines.
ALTER TABLE stocktake_lines
  DROP COLUMN IF EXISTS product_name,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS stock_unit,
  DROP COLUMN IF EXISTS primary_barcode;
