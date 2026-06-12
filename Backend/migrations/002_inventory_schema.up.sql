-- Module 03 Session 1: Inventory & scanning schema (forward migration).
-- Tenant-owned tables use clinic_id + RLS (wired in Module 13).

CREATE TYPE barcode_format AS ENUM ('gs1', 'ean13', 'code128', 'qr', 'data_matrix');
CREATE TYPE inventory_adjustment_type AS ENUM (
  'scan_deduct',
  'manual_adjust',
  'receive',
  'transfer_in',
  'transfer_out'
);
CREATE TYPE draft_po_status AS ENUM ('draft', 'submitted');

-- Global master catalog (head office approved products).
CREATE TABLE master_catalog_items (
  id UUID PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(128) NOT NULL,
  unit_of_measure VARCHAR(32) NOT NULL,
  default_unit_cost_cents INTEGER NOT NULL CHECK (default_unit_cost_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE barcode_mappings (
  id UUID PRIMARY KEY,
  master_catalog_item_id UUID NOT NULL REFERENCES master_catalog_items (id),
  barcode_value VARCHAR(255) NOT NULL,
  barcode_format barcode_format NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (barcode_value)
);

CREATE INDEX idx_barcode_mappings_master_item
  ON barcode_mappings (master_catalog_item_id);

-- Per-clinic stock levels and overrides.
CREATE TABLE clinic_inventory_items (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  master_catalog_item_id UUID NOT NULL REFERENCES master_catalog_items (id),
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  unit_cost_override_cents INTEGER CHECK (unit_cost_override_cents >= 0),
  supplier_preference VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, master_catalog_item_id)
);

CREATE INDEX idx_clinic_inventory_clinic
  ON clinic_inventory_items (clinic_id);

-- Immutable inventory adjustment audit trail.
CREATE TABLE inventory_adjustments (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  clinic_inventory_item_id UUID NOT NULL REFERENCES clinic_inventory_items (id),
  master_catalog_item_id UUID NOT NULL REFERENCES master_catalog_items (id),
  adjustment_type inventory_adjustment_type NOT NULL,
  quantity_delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reason VARCHAR(255),
  performed_by_user_id UUID NOT NULL,
  performed_by_email VARCHAR(255) NOT NULL,
  reference_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_adjustments_clinic_created
  ON inventory_adjustments (clinic_id, created_at DESC);

-- Draft purchase orders (auto-populated when stock falls below reorder point).
CREATE TABLE draft_purchase_orders (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  status draft_po_status NOT NULL DEFAULT 'draft',
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_draft_po_clinic_status
  ON draft_purchase_orders (clinic_id, status);

CREATE TABLE draft_po_lines (
  id UUID PRIMARY KEY,
  draft_purchase_order_id UUID NOT NULL REFERENCES draft_purchase_orders (id) ON DELETE CASCADE,
  master_catalog_item_id UUID NOT NULL REFERENCES master_catalog_items (id),
  clinic_inventory_item_id UUID NOT NULL REFERENCES clinic_inventory_items (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_draft_po_lines_order
  ON draft_po_lines (draft_purchase_order_id);

-- RLS policies (enabled when clinics table exists in Module 13):
-- ALTER TABLE clinic_inventory_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE draft_purchase_orders ENABLE ROW LEVEL SECURITY;
