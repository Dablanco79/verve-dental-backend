-- Migration 021: Purchase Order lifecycle expansion (Workflow 1.1 gaps)
--
-- 1. Extends draft_po_status ENUM with partially_received, received, cancelled.
-- 2. Adds supplier_id, notes, po_reference to draft_purchase_orders.
-- 3. Adds unit_cost_cents, receiving_unit to draft_po_lines.
--
-- Non-destructive: all new columns are nullable.  Existing rows are preserved.

-- ENUM values must be added individually before the table is altered.
ALTER TYPE draft_po_status ADD VALUE IF NOT EXISTS 'partially_received';
ALTER TYPE draft_po_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE draft_po_status ADD VALUE IF NOT EXISTS 'cancelled';

-- PO header additions
ALTER TABLE draft_purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS po_reference VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_draft_po_clinic_reference
  ON draft_purchase_orders (clinic_id, po_reference)
  WHERE po_reference IS NOT NULL;

-- PO line additions (unit cost and receiving unit for ordered lines)
ALTER TABLE draft_po_lines
  ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS receiving_unit VARCHAR(32);
