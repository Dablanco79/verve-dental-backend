/**
 * Lightweight bootstrap migration runner.
 *
 * Applies the tables required for the app to start (auth/users + inventory).
 * Full RLS policies are managed via migrations/ SQL files and will be wired
 * into a proper CLI runner in Module 13.
 *
 * Each entry is idempotent — safe to run on every cold start.
 */

import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "./pool.js";

type BootstrapMigration = {
  id: string;
  sql: string;
};

const BOOTSTRAP_MIGRATIONS: BootstrapMigration[] = [
  {
    /**
     * Creates the users table with home_clinic_id / home_clinic_name columns.
     * "home clinic" is the user's payroll/contract location.
     * It is distinct from the rostered_clinic_id that Roster/Timesheet records
     * will carry when a staff member works at a different location on a given day.
     */
    id: "003_users_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        email            text        NOT NULL UNIQUE,
        password_hash    text        NOT NULL,
        role             text        NOT NULL
          CONSTRAINT users_role_check
            CHECK (role IN ('owner_admin', 'group_practice_manager', 'clinical_staff')),
        home_clinic_id   uuid        NOT NULL,
        home_clinic_name text        NOT NULL,
        mfa_enabled      boolean     NOT NULL DEFAULT false,
        is_active        boolean     NOT NULL DEFAULT true,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email          ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_home_clinic_id ON users (home_clinic_id);
    `,
  },
  {
    /**
     * Renames clinic_id → home_clinic_id and clinic_name → home_clinic_name on
     * existing databases that ran the original 003_users_schema migration.
     * Idempotent: column_name check guards against re-running.
     */
    id: "004_rename_clinic_to_home_clinic",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'clinic_id'
        ) THEN
          ALTER TABLE users RENAME COLUMN clinic_id   TO home_clinic_id;
          ALTER TABLE users RENAME COLUMN clinic_name TO home_clinic_name;

          -- Re-create the index under the new column name.
          DROP INDEX IF EXISTS idx_users_clinic_id;
          CREATE INDEX IF NOT EXISTS idx_users_home_clinic_id ON users (home_clinic_id);
        END IF;
      END
      $$;
    `,
  },
  {
    /**
     * Inventory schema — master catalog, clinic stock, adjustment audit trail,
     * and draft purchase orders.
     *
     * ENUM types use the DO $$ EXCEPTION pattern so the migration is safe to
     * apply against a database that already has the types (e.g. from a manual
     * SQL run), while still recording in schema_migrations for idempotency.
     */
    id: "005_inventory_schema",
    sql: `
      -- ENUM: barcode_format
      DO $$ BEGIN
        CREATE TYPE barcode_format AS ENUM ('gs1', 'ean13', 'code128', 'qr', 'data_matrix');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ENUM: inventory_adjustment_type
      DO $$ BEGIN
        CREATE TYPE inventory_adjustment_type AS ENUM (
          'scan_deduct', 'manual_adjust', 'receive', 'transfer_in', 'transfer_out'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ENUM: draft_po_status
      DO $$ BEGIN
        CREATE TYPE draft_po_status AS ENUM ('draft', 'submitted');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Global master catalog (head-office-approved products).
      CREATE TABLE IF NOT EXISTS master_catalog_items (
        id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        sku                     varchar(64)  NOT NULL UNIQUE,
        name                    varchar(255) NOT NULL,
        description             text,
        category                varchar(128) NOT NULL,
        unit_of_measure         varchar(32)  NOT NULL,
        default_unit_cost_cents integer      NOT NULL CHECK (default_unit_cost_cents >= 0),
        is_active               boolean      NOT NULL DEFAULT true,
        created_at              timestamptz  NOT NULL DEFAULT now(),
        updated_at              timestamptz  NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS barcode_mappings (
        id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        master_catalog_item_id uuid          NOT NULL REFERENCES master_catalog_items (id),
        barcode_value         varchar(255)   NOT NULL UNIQUE,
        barcode_format        barcode_format NOT NULL,
        is_primary            boolean        NOT NULL DEFAULT false,
        created_at            timestamptz    NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_barcode_mappings_master_item
        ON barcode_mappings (master_catalog_item_id);

      -- Per-clinic stock levels and overrides.
      CREATE TABLE IF NOT EXISTS clinic_inventory_items (
        id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id                uuid        NOT NULL,
        master_catalog_item_id   uuid        NOT NULL REFERENCES master_catalog_items (id),
        quantity_on_hand         integer     NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
        reorder_point            integer     NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
        unit_cost_override_cents integer     CHECK (unit_cost_override_cents >= 0),
        supplier_preference      varchar(128),
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now(),
        UNIQUE (clinic_id, master_catalog_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_clinic_inventory_clinic
        ON clinic_inventory_items (clinic_id);

      -- Immutable inventory adjustment audit trail.
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id                       uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id                uuid                        NOT NULL,
        clinic_inventory_item_id uuid                        NOT NULL REFERENCES clinic_inventory_items (id),
        master_catalog_item_id   uuid                        NOT NULL REFERENCES master_catalog_items (id),
        adjustment_type          inventory_adjustment_type   NOT NULL,
        quantity_delta           integer                     NOT NULL,
        quantity_before          integer                     NOT NULL CHECK (quantity_before >= 0),
        quantity_after           integer                     NOT NULL CHECK (quantity_after >= 0),
        reason                   varchar(255),
        performed_by_user_id     uuid                        NOT NULL,
        performed_by_email       varchar(255)                NOT NULL,
        reference_id             varchar(128),
        created_at               timestamptz                 NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_clinic_created
        ON inventory_adjustments (clinic_id, created_at DESC);

      -- Draft purchase orders (auto-populated when stock falls below reorder point).
      CREATE TABLE IF NOT EXISTS draft_purchase_orders (
        id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id          uuid           NOT NULL,
        status             draft_po_status NOT NULL DEFAULT 'draft',
        created_by_user_id uuid           NOT NULL,
        created_at         timestamptz    NOT NULL DEFAULT now(),
        updated_at         timestamptz    NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_draft_po_clinic_status
        ON draft_purchase_orders (clinic_id, status);

      CREATE TABLE IF NOT EXISTS draft_po_lines (
        id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        draft_purchase_order_id  uuid        NOT NULL REFERENCES draft_purchase_orders (id) ON DELETE CASCADE,
        master_catalog_item_id   uuid        NOT NULL REFERENCES master_catalog_items (id),
        clinic_inventory_item_id uuid        NOT NULL REFERENCES clinic_inventory_items (id),
        quantity                 integer     NOT NULL CHECK (quantity > 0),
        reason                   varchar(255) NOT NULL,
        created_at               timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_draft_po_lines_order
        ON draft_po_lines (draft_purchase_order_id);
    `,
  },
  {
    /**
     * Roster schema — shift entries with full TIMESTAMPTZ start/end for overnight
     * shift support, an immutable audit trail, and a JSONB snapshot per change.
     *
     * rostered_clinic_id is a UUID but NOT a hard FK — there is no clinics table
     * (multi-tenancy is by convention, matching users.home_clinic_id).
     *
     * staff_email is denormalized for display purposes, matching the
     * performed_by_email pattern used in inventory_adjustments.
     */
    id: "006_roster_schema",
    sql: `
      -- ENUM: shift_type
      DO $$ BEGIN
        CREATE TYPE shift_type AS ENUM ('standard', 'overtime', 'on_call', 'training');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ENUM: roster_status  (scheduled → confirmed → completed | cancelled)
      DO $$ BEGIN
        CREATE TYPE roster_status AS ENUM ('scheduled', 'confirmed', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ENUM: roster_audit_action
      DO $$ BEGIN
        CREATE TYPE roster_audit_action AS ENUM ('created', 'updated', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS roster_entries (
        id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_user_id        uuid          NOT NULL REFERENCES users (id),
        staff_email          varchar(255)  NOT NULL,
        rostered_clinic_id   uuid          NOT NULL,
        rostered_clinic_name varchar(255)  NOT NULL,
        shift_start_at       timestamptz   NOT NULL,
        shift_end_at         timestamptz   NOT NULL,
        shift_type           shift_type    NOT NULL DEFAULT 'standard',
        status               roster_status NOT NULL DEFAULT 'scheduled',
        notes                text,
        created_by_user_id   uuid          NOT NULL REFERENCES users (id),
        created_at           timestamptz   NOT NULL DEFAULT now(),
        updated_at           timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT roster_entries_shift_order CHECK (shift_end_at > shift_start_at)
      );

      -- Primary scheduling view: all shifts at a clinic ordered by start time.
      CREATE INDEX IF NOT EXISTS idx_roster_entries_clinic_start
        ON roster_entries (rostered_clinic_id, shift_start_at);

      -- Staff member view: all shifts for a given user.
      CREATE INDEX IF NOT EXISTS idx_roster_entries_staff_start
        ON roster_entries (staff_user_id, shift_start_at);

      -- Filtered scheduling view: active/scheduled shifts only.
      CREATE INDEX IF NOT EXISTS idx_roster_entries_clinic_status_start
        ON roster_entries (rostered_clinic_id, status, shift_start_at);

      -- Immutable audit trail with JSONB snapshot of each change.
      CREATE TABLE IF NOT EXISTS roster_entry_audit (
        id                   uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
        roster_entry_id      uuid                NOT NULL REFERENCES roster_entries (id) ON DELETE CASCADE,
        changed_by_user_id   uuid                NOT NULL,
        changed_by_email     varchar(255)        NOT NULL,
        action               roster_audit_action NOT NULL,
        snapshot             jsonb               NOT NULL,
        created_at           timestamptz         NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_roster_audit_entry_created
        ON roster_entry_audit (roster_entry_id, created_at DESC);
    `,
  },
];

export async function runBootstrapMigrations(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of BOOTSTRAP_MIGRATIONS) {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id],
    );

    if (rows.length > 0) {
      continue;
    }

    await pool.query(migration.sql);
    await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    logger.info({ migrationId: migration.id }, "Bootstrap migration applied");
  }
}
