-- Rollback for migration 043 (per-line received quantity).
--
-- Safe to reverse: received_quantity has no FK dependencies.
-- Any partial-receipt data in this column is discarded on rollback.

DROP INDEX IF EXISTS idx_draft_po_lines_received;

ALTER TABLE draft_po_lines
  DROP COLUMN IF EXISTS received_quantity;
