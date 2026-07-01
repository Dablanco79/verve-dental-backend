-- Sprint C1.5: Inventory stock/receiving unit model.
-- Inventory quantities remain stored in stock units. Receiving-unit conversion
-- lives on the product for now and can be overridden by supplier pack sizes later.

ALTER TABLE master_catalog_items
  ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(32),
  ADD COLUMN IF NOT EXISTS receiving_unit VARCHAR(32),
  ADD COLUMN IF NOT EXISTS units_per_receiving_unit INTEGER;

UPDATE master_catalog_items
SET
  stock_unit = COALESCE(NULLIF(stock_unit, ''), unit_of_measure),
  receiving_unit = COALESCE(NULLIF(receiving_unit, ''), unit_of_measure),
  units_per_receiving_unit = COALESCE(units_per_receiving_unit, 1)
WHERE stock_unit IS NULL
   OR receiving_unit IS NULL
   OR units_per_receiving_unit IS NULL;

ALTER TABLE master_catalog_items
  ALTER COLUMN stock_unit SET NOT NULL,
  ALTER COLUMN receiving_unit SET NOT NULL,
  ALTER COLUMN units_per_receiving_unit SET NOT NULL,
  ADD CONSTRAINT master_catalog_items_units_per_receiving_unit_positive
    CHECK (units_per_receiving_unit > 0);

-- Keep the legacy unit_of_measure column aligned with the canonical stock unit
-- so older queries and reports continue to display inventory in stock units.
UPDATE master_catalog_items
SET unit_of_measure = stock_unit;
