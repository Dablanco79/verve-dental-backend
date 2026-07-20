-- =============================================================================
-- Migration: 019_stocktake_schema  (Sprint 1 – Workflow 2.1)
-- Purpose:   Stocktake & Inventory Reconciliation schema.
--
-- Design decisions:
--   • stocktake_sessions holds session-level metadata (name, status, actor, dates).
--   • stocktake_lines snapshots expected_quantity at session-start time and
--     records counted_quantity as staff perform the count.
--   • Variance and variance_value_cents are derived columns (generated) so they
--     never drift out of sync with counted_quantity / unit_cost.
--   • Completion applies adjustments via the existing inventory_adjustments table
--     (adjustment_type = 'stocktake_adjustment') — no inventory logic is duplicated.
--   • All tables are tenant-scoped via clinic_id with RLS enabled.
-- =============================================================================

-- ── New adjustment type ───────────────────────────────────────────────────────
-- Extend the existing enum — ALTER TYPE ADD VALUE is non-transactional in PG
-- but safe inside a migration guard; IF NOT EXISTS prevents re-run errors.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'stocktake_adjustment'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'inventory_adjustment_type')
  ) THEN
    ALTER TYPE inventory_adjustment_type ADD VALUE 'stocktake_adjustment';
  END IF;
END;
$$;

-- ── stocktake_status enum ─────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'stocktake_status'
  ) THEN
    CREATE TYPE stocktake_status AS ENUM (
      'draft',
      'in_progress',
      'completed',
      'cancelled'
    );
  END IF;
END;
$$;

-- ── stocktake_sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL
                        REFERENCES clinics(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  status              stocktake_status NOT NULL DEFAULT 'draft',

  -- Actor who created the session (manager / admin only).
  created_by_user_id  UUID NOT NULL,
  created_by_email    VARCHAR(255) NOT NULL,

  -- Actor who started / completed / cancelled the session (may differ).
  started_by_user_id  UUID,
  started_by_email    VARCHAR(255),
  completed_by_user_id UUID,
  completed_by_email  VARCHAR(255),
  cancelled_by_user_id UUID,
  cancelled_by_email  VARCHAR(255),

  -- Lifecycle timestamps.
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;

-- ── stocktake_lines ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stocktake_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL
                             REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  clinic_id                UUID NOT NULL,
  clinic_inventory_item_id UUID NOT NULL
                             REFERENCES clinic_inventory_items(id) ON DELETE CASCADE,
  master_catalog_item_id   UUID NOT NULL
                             REFERENCES master_catalog_items(id) ON DELETE CASCADE,

  -- Snapshot of quantity on hand at the moment the session was started.
  -- Immutable after line creation.
  expected_quantity        INTEGER NOT NULL DEFAULT 0,

  -- Staff-entered count. NULL until the line is counted.
  counted_quantity         INTEGER,

  -- Variance = counted − expected. NULL when counted_quantity IS NULL.
  -- Stored as a generated column so it's always consistent.
  variance                 INTEGER GENERATED ALWAYS AS (
                             counted_quantity - expected_quantity
                           ) STORED,

  -- Unit cost snapshot at session-start (in cents) for variance value calculation.
  unit_cost_cents          INTEGER NOT NULL DEFAULT 0,

  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stocktake_lines ENABLE ROW LEVEL SECURITY;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_clinic_created
  ON stocktake_sessions (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_clinic_status
  ON stocktake_sessions (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_session
  ON stocktake_lines (session_id);

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_clinic_item
  ON stocktake_lines (clinic_id, clinic_inventory_item_id);

-- ── RLS Policies ──────────────────────────────────────────────────────────────
-- Pattern mirrors existing tables: FORCE RLS for all roles including table owner.
-- Tenant isolation is enforced via app.current_clinic_id session variable.

-- stocktake_sessions ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stocktake_sessions'
      AND policyname = 'tenant_isolation_stocktake_sessions'
  ) THEN
    CREATE POLICY tenant_isolation_stocktake_sessions
      ON stocktake_sessions
      USING (clinic_id = current_setting('app.current_clinic_id', TRUE)::UUID);
  END IF;
END;
$$;

-- stocktake_lines -------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stocktake_lines'
      AND policyname = 'tenant_isolation_stocktake_lines'
  ) THEN
    CREATE POLICY tenant_isolation_stocktake_lines
      ON stocktake_lines
      USING (clinic_id = current_setting('app.current_clinic_id', TRUE)::UUID);
  END IF;
END;
$$;
