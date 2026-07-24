-- Rollback for migration 021 (purchase order lifecycle expansion).
--
-- Cannot un-add ENUM values in PostgreSQL without recreating the type.
-- Instead we document that rollback of the ENUM requires a full type recreation
-- and data migration.  The column additions ARE reversible.

ALTER TABLE draft_po_lines
  DROP COLUMN IF EXISTS receiving_unit,
  DROP COLUMN IF EXISTS unit_cost_cents;

ALTER TABLE draft_purchase_orders
  DROP COLUMN IF EXISTS po_reference,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS supplier_id;

-- NOTE: The ENUM values (partially_received, received, cancelled) cannot be
-- dropped in-place.  Any rows using them must be migrated before the ENUM
-- can be recreated without those values.  Full ENUM rollback is manual:
--
--   UPDATE draft_purchase_orders SET status = 'cancelled' WHERE status IN (...);
--   ALTER TYPE draft_po_status RENAME TO draft_po_status_old;
--   CREATE TYPE draft_po_status AS ENUM ('draft', 'submitted');
--   ALTER TABLE draft_purchase_orders ALTER COLUMN status TYPE draft_po_status
--     USING status::text::draft_po_status;
--   DROP TYPE draft_po_status_old;
