-- Migration 043: Durable per-line received quantity tracking
--
-- Adds a cumulative received_quantity column to draft_po_lines so that
-- partial receipts survive page reloads and multiple sessions aggregate
-- correctly without relying on in-memory state.
--
-- outstanding_quantity is derived as (quantity - received_quantity).
-- PO status transitions are determined from durable line data, not counts.
--
-- Non-destructive: existing rows get received_quantity = 0 (default).

ALTER TABLE draft_po_lines
  ADD COLUMN IF NOT EXISTS received_quantity INTEGER NOT NULL DEFAULT 0
    CONSTRAINT draft_po_lines_received_qty_check
    CHECK (received_quantity >= 0);

CREATE INDEX IF NOT EXISTS idx_draft_po_lines_received
  ON draft_po_lines (draft_purchase_order_id)
  WHERE received_quantity > 0;
