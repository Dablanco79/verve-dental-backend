ALTER TABLE master_catalog_items
  DROP CONSTRAINT IF EXISTS master_catalog_items_units_per_receiving_unit_positive,
  DROP COLUMN IF EXISTS units_per_receiving_unit,
  DROP COLUMN IF EXISTS receiving_unit,
  DROP COLUMN IF EXISTS stock_unit;
