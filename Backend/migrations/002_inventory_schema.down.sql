-- Module 03 Session 1: Inventory schema rollback.

DROP TABLE IF EXISTS draft_po_lines;
DROP TABLE IF EXISTS draft_purchase_orders;
DROP TABLE IF EXISTS inventory_adjustments;
DROP TABLE IF EXISTS clinic_inventory_items;
DROP TABLE IF EXISTS barcode_mappings;
DROP TABLE IF EXISTS master_catalog_items;

DROP TYPE IF EXISTS draft_po_status;
DROP TYPE IF EXISTS inventory_adjustment_type;
DROP TYPE IF EXISTS barcode_format;
