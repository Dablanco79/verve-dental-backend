-- =============================================================================
-- Migration: 020_stocktake_line_snapshot  (Sprint 1.1 – Pilot Readiness)
-- Purpose:   Add product snapshot columns to stocktake_lines so that
--            Product Name, Category, Stock Unit and Primary Barcode are
--            permanently frozen at session-start time.
--
-- These columns replace the dynamic JOIN to master_catalog_items used in
-- the original LINE_VIEW_SELECT query. Historical sessions must remain
-- immutable: renaming a product, changing its category or updating its
-- primary barcode must never alter a completed or in-progress stocktake.
--
-- Backfill strategy:
--   • ADD COLUMN with a temporary DEFAULT so the ALTER succeeds on existing
--     rows without violating the NOT NULL constraint.
--   • UPDATE to populate stored values from master_catalog_items and
--     barcode_mappings.
--   • DROP DEFAULT so future rows must supply real values from the
--     application (enforced by the service layer).
-- =============================================================================

ALTER TABLE stocktake_lines
  ADD COLUMN IF NOT EXISTS product_name    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stock_unit      TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS primary_barcode TEXT;

-- Backfill existing rows from live catalogue and barcode data.
-- Safe to run multiple times (idempotent UPDATE, no side-effects on new rows).
UPDATE stocktake_lines sl
SET
  product_name    = COALESCE(mci.name, ''),
  category        = COALESCE(mci.category, ''),
  stock_unit      = COALESCE(mci.stock_unit, mci.unit_of_measure, 'unit'),
  primary_barcode = (
    SELECT bm.barcode_value
    FROM   barcode_mappings bm
    WHERE  bm.master_catalog_item_id = sl.master_catalog_item_id
      AND  bm.is_primary = TRUE
    LIMIT  1
  )
FROM master_catalog_items mci
WHERE mci.id = sl.master_catalog_item_id;

-- Remove the temporary DEFAULTs — new rows must always supply real values.
ALTER TABLE stocktake_lines
  ALTER COLUMN product_name DROP DEFAULT,
  ALTER COLUMN category     DROP DEFAULT,
  ALTER COLUMN stock_unit   DROP DEFAULT;
