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

export const BOOTSTRAP_MIGRATIONS: BootstrapMigration[] = [
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
  {
    /**
     * Adds the two access-pattern indexes that were missing from 006.
     *
     * idx_roster_entries_active_staff_clinic — partial index covering only
     *   non-cancelled entries; used by hasActiveShiftAtClinic and the
     *   clinical_staff tenant-scoped listByClinic intercept.
     *
     * idx_roster_entries_staff_clinic_start — composite covering index for
     *   listByStaff / getMyShifts date-window queries scoped to a clinic.
     */
    id: "007_roster_performance_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_roster_entries_active_staff_clinic
        ON roster_entries (staff_user_id, rostered_clinic_id)
        WHERE status <> 'cancelled';

      CREATE INDEX IF NOT EXISTS idx_roster_entries_staff_clinic_start
        ON roster_entries (staff_user_id, rostered_clinic_id, shift_start_at);
    `,
  },
  {
    /**
     * Module 05 — Payroll, Timesheets, and Leave Management schema.
     *
     * HYBRID PAYROLL ARCHITECTURE
     * ───────────────────────────
     * Two staffing tracks share a single `timesheet_entries` table,
     * discriminated by the `payroll_type` column:
     *
     *   • hourly_auto / hourly_manual
     *       Clock-in/out records for support staff and hourly-rate dentists.
     *       Stores break duration and an accounting-agnostic breakdown of
     *       ordinary vs overtime hour bands so the adapter layer can target
     *       Xero, MYOB, KeyPay, or any generic CSV exporter without schema
     *       changes.
     *
     *   • commission_log
     *       Auto-generated provider attendance records for dentists/specialists
     *       paid by percentage-of-collections.  They do NOT clock in/out.
     *       The system creates a row when their roster shift reaches 'completed'.
     *
     * MATERIALS FORECASTING SAFEGUARD
     * ────────────────────────────────
     * commission_log entries are created with attendance_status =
     * 'pending_verification' — never defaulting to 'present'.  A manager MUST
     * explicitly mark 'present' before the forecasting engine counts that
     * provider's expected material usage.  Entries with 'absent' or 'sick'
     * status cause the forecasting engine to evaluate material usage as ZERO
     * for that shift, preventing phantom demand inflation in the inventory
     * replenishment model.
     *
     * The composite index idx_timesheet_attendance_forecast is the hot path
     * for all forecasting queries and should be used in preference to scanning
     * the full table.
     *
     * ACCOUNTING AGNOSTICISM
     * ──────────────────────
     * Hour breakdown columns (ordinary_hours, overtime_1_5x_hours, etc.) store
     * pre-calculated numeric values.  The adapter layer (Module 09) maps these
     * to the target payroll system's field names at export time — no schema
     * migration is needed when adding a new accounting software integration.
     */
    id: "008_payroll_and_leave_schema",
    sql: `
      -- ─────────────────────────────────────────────────────────────
      -- ENUMs
      -- ─────────────────────────────────────────────────────────────

      -- Payroll track discriminator.
      -- hourly_auto   → generated by the system from a completed roster shift.
      -- hourly_manual → entered manually by a manager (catch-up / correction).
      -- commission_log → provider attendance record; no clock-in/out.
      DO $$ BEGIN
        CREATE TYPE payroll_type AS ENUM (
          'hourly_auto', 'hourly_manual', 'commission_log'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Attendance status — governs the materials forecasting engine.
      -- ONLY 'present' entries contribute to forecast material usage.
      -- 'absent' and 'sick' force forecast usage to exactly ZERO.
      -- 'pending_verification' is the safe default for commission_log entries.
      DO $$ BEGIN
        CREATE TYPE attendance_status AS ENUM (
          'pending_verification', 'present', 'absent', 'sick', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Hourly timesheet submission + approval lifecycle.
      -- draft            → being entered; not yet submitted for review.
      -- submitted        → staff/system submitted; awaiting manager action.
      -- approved         → manager approved; ready for payroll export.
      -- rejected         → manager rejected; requires staff correction.
      -- requires_amendment → approved with edits requested before export.
      -- processed        → exported to payroll adapter; immutable.
      -- NULL             → commission_log entries (no submission workflow).
      DO $$ BEGIN
        CREATE TYPE timesheet_status AS ENUM (
          'draft', 'submitted', 'approved', 'rejected', 'requires_amendment', 'processed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Leave category (Australian Fair Work Act / National Employment Standards).
      -- 'compassionate' is a distinct NES entitlement (bereavement / family emergency).
      -- 'personal'      covers carer's leave and personal illness when not a separate sick type.
      -- 'other'         is a catch-all for enterprise-agreement-specific leave categories.
      DO $$ BEGIN
        CREATE TYPE leave_type AS ENUM (
          'annual', 'sick', 'personal', 'compassionate', 'unpaid', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Leave request lifecycle.
      DO $$ BEGIN
        CREATE TYPE leave_request_status AS ENUM (
          'pending', 'approved', 'rejected', 'withdrawn'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ─────────────────────────────────────────────────────────────
      -- timesheet_entries
      -- Unified table for both hourly clocking records and commission-
      -- track provider attendance logs.  Track-specific columns are
      -- NULL for the other track; application-layer validation enforces
      -- the per-track invariants.
      -- ─────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS timesheet_entries (

        id                       uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),

        -- ── Track discriminator ──────────────────────────────────
        payroll_type             payroll_type              NOT NULL,

        -- ── Staff identity (common to both tracks) ───────────────
        -- staff_email is denormalized for display, matching the
        -- performed_by_email pattern used in inventory_adjustments and
        -- roster_entry_audit — avoids joins for audit/reporting views.
        staff_user_id            uuid                      NOT NULL REFERENCES users (id),
        staff_email              varchar(255)              NOT NULL,

        -- ── Clinic context ───────────────────────────────────────
        -- clinic_id = home_clinic_id (users table) — used for payroll
        --   grouping and reporting.
        -- rostered_clinic_id = where the work physically occurred — may
        --   differ from home clinic for cross-location deployments.
        clinic_id                uuid                      NOT NULL,
        rostered_clinic_id       uuid                      NOT NULL,
        rostered_clinic_name     varchar(255)              NOT NULL,

        -- ── Roster link ──────────────────────────────────────────
        -- NULL for hourly_manual entries created without a corresponding
        -- roster shift (back-fills, corrections, etc.).
        roster_entry_id          uuid                      REFERENCES roster_entries (id),

        -- ── Shift window ─────────────────────────────────────────
        -- shift_date is denormalized from shift_start_at for efficient
        -- date-range index scans without timezone casting on every query.
        shift_date               date                      NOT NULL,
        shift_start_at           timestamptz               NOT NULL,
        shift_end_at             timestamptz               NOT NULL,

        -- ── Attendance status (FORECASTING SAFEGUARD) ────────────
        -- commission_log entries are created as 'pending_verification'.
        -- hourly_auto entries are set to 'present' when clock-out is
        --   recorded, or 'absent' if the shift window passes without
        --   a clock-in.
        attendance_status        attendance_status          NOT NULL DEFAULT 'pending_verification',

        -- ── Hourly clocking fields (NULL for commission_log) ─────
        clock_in_at              timestamptz,
        clock_out_at             timestamptz,
        break_duration_minutes   integer                   CHECK (break_duration_minutes >= 0),

        -- ── Accounting-agnostic hour breakdown (NULL for commission_log)
        -- Pre-calculated by the payroll engine; the adapter layer maps
        -- these generic numeric fields to Xero / MYOB / KeyPay / CSV
        -- column names at export time with zero schema changes.
        total_hours_worked       numeric(6,2)              CHECK (total_hours_worked >= 0),
        ordinary_hours           numeric(6,2)              CHECK (ordinary_hours >= 0),
        overtime_1_5x_hours      numeric(6,2)              CHECK (overtime_1_5x_hours >= 0),
        overtime_2x_hours        numeric(6,2)              CHECK (overtime_2x_hours >= 0),
        overtime_custom_hours    numeric(6,2)              CHECK (overtime_custom_hours >= 0),

        -- ── Timesheet submission/approval workflow (NULL for commission_log) ──
        -- commission_log entries have no submission workflow; they are verified
        -- via attendance_status instead.  Hourly entries start as 'draft'.
        timesheet_status         timesheet_status,
        approved_by_user_id      uuid                      REFERENCES users (id),
        approved_at              timestamptz,
        approval_notes           text,

        -- ── Commission track annotation ───────────────────────────
        -- Free-text note a manager records when verifying attendance
        -- (e.g. "Left early — half-day patient load", "No-show confirmed").
        commission_note          text,

        -- ── Generation metadata ───────────────────────────────────
        -- 'system_auto'    — created by the roster-completion trigger
        -- 'manager_manual' — created by a manager directly
        -- <email>          — created by a specific user (audit trail)
        generated_by             varchar(64)               NOT NULL DEFAULT 'system_auto',

        created_at               timestamptz               NOT NULL DEFAULT now(),
        updated_at               timestamptz               NOT NULL DEFAULT now(),

        CONSTRAINT timesheet_shift_order CHECK (shift_end_at > shift_start_at),

        -- Prevent duplicate system-generated entries for the same
        -- roster shift.  Manual entries (hourly_manual) have no roster
        -- link so the UNIQUE constraint only fires when both are set.
        CONSTRAINT timesheet_entries_roster_unique
          UNIQUE NULLS NOT DISTINCT (roster_entry_id, payroll_type)
      );

      -- Staff payroll view: all entries for a user ordered by shift date.
      CREATE INDEX IF NOT EXISTS idx_timesheet_entries_staff_date
        ON timesheet_entries (staff_user_id, shift_date DESC);

      -- Clinic payroll view: all entries for a clinic ordered by shift date.
      CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinic_date
        ON timesheet_entries (clinic_id, shift_date DESC);

      -- Manager approval queue: submitted hourly entries awaiting review.
      CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinic_approval
        ON timesheet_entries (clinic_id, timesheet_status, shift_date)
        WHERE payroll_type IN ('hourly_auto', 'hourly_manual');

      -- CRITICAL: Materials forecasting hot path.
      -- The forecasting engine queries (attendance_status, payroll_type, shift_date)
      -- to resolve which provider shifts contribute full vs zero material usage.
      CREATE INDEX IF NOT EXISTS idx_timesheet_attendance_forecast
        ON timesheet_entries (attendance_status, payroll_type, shift_date)
        WHERE payroll_type = 'commission_log';

      -- Roster back-link: look up the timesheet entry for a given roster shift.
      CREATE INDEX IF NOT EXISTS idx_timesheet_entries_roster_entry
        ON timesheet_entries (roster_entry_id)
        WHERE roster_entry_id IS NOT NULL;

      -- ─────────────────────────────────────────────────────────────
      -- leave_requests
      -- Tracks annual leave, sick leave, and other absence types for
      -- all staff.  Approved leave feeds into the payroll export adapter
      -- and blocks roster scheduling for the covered date range.
      -- ─────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS leave_requests (
        id                   uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),

        staff_user_id        uuid                 NOT NULL REFERENCES users (id),

        -- home_clinic_id for payroll grouping — matches users.home_clinic_id.
        clinic_id            uuid                 NOT NULL,

        leave_type           leave_type           NOT NULL,

        -- Inclusive date range (Australian conventions: both dates are worked-day
        -- boundaries, total_days accounts for part-days if required).
        start_date           date                 NOT NULL,
        end_date             date                 NOT NULL,

        -- Stored as a decimal to support half-day requests (0.5, 1.5, etc.).
        total_days           numeric(6,2)         NOT NULL CHECK (total_days > 0),

        reason               text,

        status               leave_request_status NOT NULL DEFAULT 'pending',

        -- NULL until a manager acts on the request.
        reviewed_by_user_id  uuid                 REFERENCES users (id),
        reviewed_at          timestamptz,
        review_notes         text,

        created_at           timestamptz          NOT NULL DEFAULT now(),
        updated_at           timestamptz          NOT NULL DEFAULT now(),

        CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date)
      );

      -- Staff leave history: all requests for a user ordered by start date.
      CREATE INDEX IF NOT EXISTS idx_leave_requests_staff_date
        ON leave_requests (staff_user_id, start_date DESC);

      -- Clinic manager queue: all leave requests for a clinic filtered by status.
      CREATE INDEX IF NOT EXISTS idx_leave_requests_clinic_status
        ON leave_requests (clinic_id, status, start_date);

      -- Date-range overlap check: find approved leave covering a specific date
      -- (used by the roster scheduler to block double-bookings).
      CREATE INDEX IF NOT EXISTS idx_leave_requests_clinic_date_range
        ON leave_requests (clinic_id, start_date, end_date)
        WHERE status = 'approved';
    `,
  },
  {
    /**
     * Adds payroll_track to the users table so the roster-completion hook can
     * determine whether to generate a commission attendance log or an hourly
     * draft timesheet without an additional application-level lookup table.
     *
     * Default is 'hourly' so all pre-existing rows remain valid after the
     * migration is applied on a live database.
     */
    id: "009_user_payroll_track",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS payroll_track text NOT NULL DEFAULT 'hourly'
          CONSTRAINT users_payroll_track_check
            CHECK (payroll_track IN ('hourly', 'commission'));
    `,
  },
  {
    /**
     * Adds the staff_email denormalization column to leave_requests.
     *
     * The original 008_payroll_and_leave_schema migration omitted staff_email
     * from leave_requests.  This fixup migration adds it so the TypeScript
     * LeaveRequest type is fully satisfied without a users JOIN on every
     * display query — matching the pattern already used on timesheet_entries
     * and roster_entries.
     *
     * DEFAULT '' is a safe fallback for any rows that pre-date this column
     * (there should be none in practice since the table was new in 008).
     */
    id: "010_leave_requests_staff_email",
    sql: `
      ALTER TABLE leave_requests
        ADD COLUMN IF NOT EXISTS staff_email varchar(255) NOT NULL DEFAULT '';
    `,
  },
  {
    /**
     * FIX MEDIUM — commission_log state structural safeguard.
     *
     * Adds a database-layer CHECK constraint that structurally prevents a
     * commission_log entry from ever holding a verified attendance status
     * (present / absent / sick) without an approver audit trail.
     *
     * Logic:
     *   The constraint is satisfied when ANY of these is true:
     *     a) The row is NOT a commission_log entry (hourly tracks are exempt).
     *     b) The attendance_status is an unverified safe state
     *        ('pending_verification' or 'cancelled').
     *     c) The row carries a complete manager approval audit trail
     *        (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL).
     *
     * This prevents any future code path — bypassing the service layer — from
     * inserting or updating a commission_log row into a forecast-eligible state
     * without first recording the approving manager.
     *
     * The constraint is added with NOT VALID so it does not retroactively
     * reject any existing rows, but all future writes are checked.
     * A subsequent VALIDATE CONSTRAINT can be run during a maintenance window
     * once all pre-existing data is confirmed clean.
     */
    id: "011_commission_log_state_check",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'timesheet_commission_log_state_check'
        ) THEN
          ALTER TABLE timesheet_entries
            ADD CONSTRAINT timesheet_commission_log_state_check
              CHECK (
                payroll_type <> 'commission_log'
                OR attendance_status IN ('pending_verification', 'cancelled')
                OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
              )
              NOT VALID;
        END IF;
      END
      $$;
    `,
  },
  {
    /**
     * Module 06 — Canonical clinics reference table.
     *
     * WHY THIS TABLE EXISTS
     * ─────────────────────
     * Prior to Module 06, clinic names were derived from users.home_clinic_name
     * using a workaround in userRepository.getClinicName() (deterministic ORDER
     * BY email LIMIT 1 query).  That approach meant clinic identity was a
     * property of the user roster rather than a first-class entity, which caused:
     *
     *   • No authoritative name — any manager could silently diverge
     *     homeClinicName across user rows.
     *   • No FK constraints — clinic_id columns on roster_entries,
     *     timesheet_entries, and leave_requests were bare UUIDs with no DB-level
     *     integrity check.
     *   • No clinic metadata — timezone, ABN, and address had nowhere to live.
     *
     * MULTI-TENANT NOTE
     * ─────────────────
     * The `id` column is the tenant discriminator used everywhere else in the
     * schema.  PostgreSQL RLS policies (Module 13) will reference this table
     * when enabling row-level security across all tenant-scoped tables.
     *
     * IDEMPOTENCY
     * ───────────
     * CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS ensure this
     * migration is safe to re-apply against a database that already has the
     * table (e.g. from a previous cold-start or a manual SQL run).
     */
    id: "012_clinics_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS clinics (
        id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        name              text         NOT NULL,

        -- Australian Business Number (9 digits, no spaces).
        -- Nullable until the practice owner fills in their details.
        abn               varchar(11),

        address_line1     text,
        suburb            text,

        -- Two or three-letter Australian state/territory code.
        state             varchar(3)
          CONSTRAINT clinics_state_check
            CHECK (state IS NULL OR state IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')),

        -- Four-digit Australian postcode.
        postcode          char(4),

        -- IANA timezone string.  Defaults to Eastern Standard / Daylight time.
        timezone          text         NOT NULL DEFAULT 'Australia/Sydney',

        subscription_tier varchar(20)  NOT NULL DEFAULT 'standard'
          CONSTRAINT clinics_subscription_tier_check
            CHECK (subscription_tier IN ('standard', 'premium', 'enterprise')),

        is_active         boolean      NOT NULL DEFAULT true,

        created_at        timestamptz  NOT NULL DEFAULT now(),
        updated_at        timestamptz  NOT NULL DEFAULT now()
      );

      -- Partial index — most queries filter by active clinics only.
      CREATE INDEX IF NOT EXISTS idx_clinics_is_active
        ON clinics (is_active)
        WHERE is_active = true;

      -- Name search / list ordering.
      CREATE INDEX IF NOT EXISTS idx_clinics_name
        ON clinics (name);
    `,
  },
  {
    /**
     * Module 07 — Core Billing, Invoicing, and Multi-Tenant Payment Integrations.
     *
     * DESIGN PRINCIPLES
     * ─────────────────
     * • All monetary values are stored as INTEGER CENTS (AUD) — no floats.
     * • GST is stored as basis points (1000 = 10%) snapshotted at invoice
     *   creation time, preventing retroactive recalculation on rate changes.
     * • `clinic_id` is present on EVERY table (invoices, line items, payments)
     *   as a non-nullable tenant discriminator.  This enables partial index
     *   scans that are strictly scoped to one clinic without a JOIN.
     * • Line items carry a redundant `clinic_id` (mirrors parent invoice) for
     *   defence-in-depth: a guessed `invoice_id` cannot retrieve a line item
     *   belonging to a different clinic without also matching `clinic_id`.
     * • Payment records are append-only.  Refunds are separate rows with a
     *   negative `amount_cents`; there are no DELETE or UPDATE on payments.
     * • `invoice_number` is NULL until the invoice is issued — draft invoices
     *   have no public identifier until the `issueInvoice()` service call.
     *
     * MULTI-TENANT NOTE
     * ─────────────────
     * All `clinic_id` columns reference `clinics.id` (introduced in 012).
     * The service layer's `assertTenantAccess()` function provides an explicit
     * token-level guard as defence-in-depth beyond `enforceTenantParam`.
     * PostgreSQL RLS policies (Module 13) will reference these columns.
     */
    id: "013_billing_schema",
    sql: `
      -- ─────────────────────────────────────────────────────────────────────
      -- ENUMs
      -- ─────────────────────────────────────────────────────────────────────

      -- Invoice lifecycle: draft → issued → (paid | partially_paid | overdue)
      -- void and cancelled are terminal states.
      DO $$ BEGIN
        CREATE TYPE invoice_status AS ENUM (
          'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Line item categories for rendering, reporting, and accounting adapter mapping.
      DO $$ BEGIN
        CREATE TYPE line_item_type AS ENUM (
          'consultation_fee', 'procedure_fee', 'material_fee',
          'catalogue_item', 'tax', 'adjustment', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Payment methods accepted at the clinic.
      -- insurance_claim covers Medicare, private health fund, and DVA bulk-bill claims.
      DO $$ BEGIN
        CREATE TYPE billing_payment_method AS ENUM (
          'cash', 'eftpos', 'credit_card', 'bank_transfer', 'insurance_claim', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- Payment record lifecycle.
      -- Only 'confirmed' records contribute to invoice.paid_cents total.
      DO $$ BEGIN
        CREATE TYPE billing_payment_status AS ENUM (
          'pending', 'confirmed', 'failed', 'refunded'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ─────────────────────────────────────────────────────────────────────
      -- invoices
      -- Header record per billing event.  Line items and payments are
      -- child tables that reference this row.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS invoices (
        id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Non-nullable tenant discriminator.
        clinic_id             uuid           NOT NULL REFERENCES clinics (id),

        -- Nullable until Module 08 introduces the canonical patients table.
        patient_id            uuid,
        patient_name          varchar(255)   NOT NULL,

        -- NULL until issueInvoice() is called.  draft invoices have no public number.
        -- Format: INV-{YYYY}-{NNNNNN} (e.g. INV-2026-000001), unique globally.
        invoice_number        varchar(32)    UNIQUE,

        status                invoice_status NOT NULL DEFAULT 'draft',
        issued_at             timestamptz,
        due_at                timestamptz,

        -- ── Monetary totals (integer cents, AUD) ─────────────────────────
        -- Maintained by refreshInvoiceTotals() / refreshInvoicePaymentTotals()
        -- after every line-item or payment mutation.
        subtotal_cents        integer        NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
        tax_cents             integer        NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
        discount_cents        integer        NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        total_cents           integer        NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        paid_cents            integer        NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
        -- May be negative when a credit balance exists (over-payment).
        outstanding_cents     integer        NOT NULL DEFAULT 0,

        -- ── Tax snapshot ─────────────────────────────────────────────────
        -- Australian GST rate in basis points at invoice creation time.
        -- Default 1000 = 10%.  Snapshot prevents retrospective recalculation.
        tax_rate_basis_points integer        NOT NULL DEFAULT 1000
          CHECK (tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),

        notes                 text,
        created_by_user_id    uuid           NOT NULL REFERENCES users (id),
        created_by_email      varchar(255)   NOT NULL,
        voided_by_user_id     uuid           REFERENCES users (id),
        voided_at             timestamptz,
        void_reason           text,

        created_at            timestamptz    NOT NULL DEFAULT now(),
        updated_at            timestamptz    NOT NULL DEFAULT now()
      );

      -- Clinic billing list: all invoices ordered by creation time.
      CREATE INDEX IF NOT EXISTS idx_invoices_clinic_created
        ON invoices (clinic_id, created_at DESC);

      -- Status-filtered queue (open invoices needing action).
      CREATE INDEX IF NOT EXISTS idx_invoices_clinic_status
        ON invoices (clinic_id, status, created_at DESC);

      -- Patient invoice lookup (ready for Module 08 patient FK).
      CREATE INDEX IF NOT EXISTS idx_invoices_clinic_patient
        ON invoices (clinic_id, patient_id)
        WHERE patient_id IS NOT NULL;

      -- ─────────────────────────────────────────────────────────────────────
      -- invoice_number_sequences
      -- Per-clinic atomic counter used by nextInvoiceNumber().
      -- UPDATE ... RETURNING ensures serialized increments under concurrent load.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS invoice_number_sequences (
        clinic_id  uuid    PRIMARY KEY REFERENCES clinics (id),
        last_seq   integer NOT NULL DEFAULT 0
      );

      -- ─────────────────────────────────────────────────────────────────────
      -- invoice_line_items
      -- Itemized fees attached to an invoice.
      -- Locked (no add/remove) once the parent invoice is issued.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Redundant clinic_id for defence-in-depth tenant isolation.
        -- A guessed invoice_id cannot read a line item from another clinic
        -- without also matching clinic_id.
        clinic_id             uuid           NOT NULL,

        invoice_id            uuid           NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
        line_item_type        line_item_type NOT NULL,
        description           varchar(512)   NOT NULL,

        -- Optional link to master_catalog_items (populated for catalogue_item type).
        catalogue_item_id     uuid,
        catalogue_sku         varchar(64),

        quantity              integer        NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_price_cents      integer        NOT NULL CHECK (unit_price_cents >= 0),
        -- quantity * unit_price_cents
        subtotal_cents        integer        NOT NULL CHECK (subtotal_cents >= 0),

        -- Snapshot of tax rate at line creation time (basis points).
        -- 0 for non-taxable lines (e.g. adjustment, insurance portion).
        tax_rate_basis_points integer        NOT NULL DEFAULT 0
          CHECK (tax_rate_basis_points >= 0),
        -- calculateTaxCents(subtotal_cents, tax_rate_basis_points)
        tax_cents             integer        NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
        -- subtotal_cents + tax_cents
        total_cents           integer        NOT NULL CHECK (total_cents >= 0),

        -- Display ordering within the invoice (ascending).
        sort_order            integer        NOT NULL DEFAULT 0,

        created_at            timestamptz    NOT NULL DEFAULT now(),
        updated_at            timestamptz    NOT NULL DEFAULT now()
      );

      -- All line items for an invoice ordered for display.
      CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
        ON invoice_line_items (invoice_id, sort_order);

      -- Defence-in-depth tenant-scoped scan without joining invoices.
      CREATE INDEX IF NOT EXISTS idx_invoice_line_items_clinic
        ON invoice_line_items (clinic_id, invoice_id);

      -- ─────────────────────────────────────────────────────────────────────
      -- payment_records
      -- Append-only ledger of all payment events against an invoice.
      -- amount_cents is positive for payments, negative for refunds.
      -- Only 'confirmed' rows contribute to invoice.paid_cents.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS payment_records (
        id                    uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Redundant clinic_id for defence-in-depth tenant isolation.
        clinic_id             uuid                   NOT NULL,

        invoice_id            uuid                   NOT NULL REFERENCES invoices (id),
        payment_method        billing_payment_method NOT NULL,
        status                billing_payment_status NOT NULL DEFAULT 'pending',

        -- Integer cents: positive = payment received, negative = refund issued.
        amount_cents          integer                NOT NULL,

        -- External transaction ID, receipt number, or health fund claim reference.
        reference_number      varchar(128),
        notes                 text,

        recorded_by_user_id   uuid                   NOT NULL REFERENCES users (id),
        recorded_by_email     varchar(255)           NOT NULL,

        -- When the payment actually occurred — may predate created_at for
        -- batch / reconciliation entries.
        transaction_at        timestamptz            NOT NULL,
        confirmed_at          timestamptz,
        failed_at             timestamptz,
        failure_reason        text,

        created_at            timestamptz            NOT NULL DEFAULT now(),
        updated_at            timestamptz            NOT NULL DEFAULT now()
      );

      -- Payment history for an invoice ordered by transaction time.
      CREATE INDEX IF NOT EXISTS idx_payment_records_invoice
        ON payment_records (invoice_id, transaction_at DESC);

      -- Clinic-level payment queue (pending confirmations, failed retries).
      CREATE INDEX IF NOT EXISTS idx_payment_records_clinic_status
        ON payment_records (clinic_id, status, transaction_at DESC);
    `,
  },
  {
    /**
     * Module 08 — Analytics, Reporting, and Audit Trails.
     *
     * audit_events is an append-only structured event log.  Every domain
     * operation (create invoice, approve roster, scan deduct, etc.) should
     * call analyticsRepository.recordEvent() so the trail is complete.
     *
     * Indexes cover:
     *   - Clinic-ordered time-range scan (primary audit query pattern).
     *   - Entity-scoped drill-down (all events for a specific invoice, user, etc.).
     *   - Actor-scoped drill-down (all events performed by a specific user).
     */
    id: "014_analytics_audit_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id    uuid         NOT NULL,
        entity_type  varchar(64)  NOT NULL,
        entity_id    uuid         NOT NULL,
        action       varchar(128) NOT NULL,
        actor_id     uuid         NOT NULL,
        actor_email  varchar(255) NOT NULL,
        metadata     jsonb        NOT NULL DEFAULT '{}',
        created_at   timestamptz  NOT NULL DEFAULT now()
      );

      -- Primary query path: clinic audit trail ordered newest-first.
      CREATE INDEX IF NOT EXISTS idx_audit_events_clinic_created
        ON audit_events (clinic_id, created_at DESC);

      -- Entity drill-down: all events for one invoice / roster entry / user etc.
      CREATE INDEX IF NOT EXISTS idx_audit_events_entity
        ON audit_events (clinic_id, entity_type, entity_id, created_at DESC);

      -- Actor drill-down: all actions performed by a specific staff member.
      CREATE INDEX IF NOT EXISTS idx_audit_events_actor
        ON audit_events (clinic_id, actor_id, created_at DESC);
    `,
  },
  {
    /**
     * Sprint 2B — adds the totp_secret column used by real TOTP verification.
     *
     * NULL until a user completes MFA enrollment (POST /auth/mfa/confirm,
     * shipped in Sprint 2C).  mfa_enabled stays false until enrollment is
     * confirmed, so existing rows with NULL totp_secret are never presented
     * with an MFA challenge.
     *
     * Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-apply.
     */
    id: "016_users_totp_secret",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS totp_secret text;
    `,
  },
  {
    /**
     * Module 13 — PostgreSQL Row-Level Security (RLS) across all tenant tables.
     * Hardened in Module 13 security pass.
     *
     * TWO HELPER FUNCTIONS
     * ────────────────────
     * app_current_clinic_id() — reads the 'app.current_clinic_id' session
     *   variable set by the application before tenant-scoped queries.
     *   Returns NULL when the variable is absent (empty string).
     *   SET search_path protects against search_path injection.
     *
     * app_is_owner_admin() — reads 'app.owner_admin_mode' session variable.
     *   Returns TRUE for owner_admin cross-clinic operations.
     *   NOTE: session variables are spoofable by direct DB connections;
     *   defence relies on DB credential security + network controls.
     *
     * TABLES PROTECTED
     * ────────────────
     * users, clinic_inventory_items, inventory_adjustments,
     * draft_purchase_orders, draft_po_lines, roster_entries,
     * roster_entry_audit, timesheet_entries, leave_requests,
     * invoices, invoice_number_sequences, invoice_line_items,
     * payment_records, audit_events  (14 tables total)
     *
     * TABLES EXCLUDED (global/shared — no per-clinic rows)
     * ─────────────────────────────────────────────────────
     * schema_migrations, master_catalog_items, barcode_mappings, clinics
     *
     * SECURITY NOTES
     * ──────────────
     * - NULL-context bypass REMOVED from users SELECT: any uncontextualised
     *   session is blocked. Auth lookups use owner_admin_mode via the app layer.
     * - inventory_adjustments and audit_events use operation-specific policies
     *   (SELECT + INSERT only) to enforce append-only at the DB layer.
     *
     * IDEMPOTENCY
     * ───────────
     * CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY,
     * ALTER TABLE ... ENABLE ROW LEVEL SECURITY (safe to re-run).
     * FORCE ROW LEVEL SECURITY ensures the table owner role is also subject
     * to policies (superuser still bypasses — required for migrations).
     */
    id: "015_rls_policies",
    sql: `
      -- ── Helper functions ────────────────────────────────────────────────────

      CREATE OR REPLACE FUNCTION app_current_clinic_id()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT NULLIF(current_setting('app.current_clinic_id', true), '')::uuid;
      $$;

      CREATE OR REPLACE FUNCTION app_is_owner_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT current_setting('app.owner_admin_mode', true) = 'true';
      $$;

      -- ── users ────────────────────────────────────────────────────────────────
      -- NULL-context bypass removed. Auth lookups (login/refresh/changePassword)
      -- use owner_admin_mode=true via withTenantContext() in the repository layer.
      -- This closes the exposure where any no-context DB session could read all
      -- user rows (including password hashes) without setting any variable.
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE users FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS rls_users_select ON users;
      CREATE POLICY rls_users_select ON users FOR SELECT USING (
        app_is_owner_admin()
        OR home_clinic_id = app_current_clinic_id()
      );

      DROP POLICY IF EXISTS rls_users_insert ON users;
      CREATE POLICY rls_users_insert ON users FOR INSERT WITH CHECK (
        app_is_owner_admin()
        OR home_clinic_id = app_current_clinic_id()
      );

      DROP POLICY IF EXISTS rls_users_update ON users;
      CREATE POLICY rls_users_update ON users FOR UPDATE
        USING (app_is_owner_admin() OR home_clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR home_clinic_id = app_current_clinic_id());

      DROP POLICY IF EXISTS rls_users_delete ON users;
      CREATE POLICY rls_users_delete ON users FOR DELETE USING (
        app_is_owner_admin()
        OR home_clinic_id = app_current_clinic_id()
      );

      -- ── clinic_inventory_items ───────────────────────────────────────────────
      ALTER TABLE clinic_inventory_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE clinic_inventory_items FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_clinic_inventory_items_tenant ON clinic_inventory_items;
      CREATE POLICY rls_clinic_inventory_items_tenant ON clinic_inventory_items FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── inventory_adjustments (append-only) ──────────────────────────────────
      -- SELECT + INSERT only; UPDATE and DELETE silently blocked by RLS.
      ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE inventory_adjustments FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_inventory_adjustments_tenant ON inventory_adjustments;
      DROP POLICY IF EXISTS rls_inventory_adjustments_select ON inventory_adjustments;
      DROP POLICY IF EXISTS rls_inventory_adjustments_insert ON inventory_adjustments;
      CREATE POLICY rls_inventory_adjustments_select ON inventory_adjustments
        FOR SELECT USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id());
      CREATE POLICY rls_inventory_adjustments_insert ON inventory_adjustments
        FOR INSERT WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── draft_purchase_orders ────────────────────────────────────────────────
      ALTER TABLE draft_purchase_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE draft_purchase_orders FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_draft_purchase_orders_tenant ON draft_purchase_orders;
      CREATE POLICY rls_draft_purchase_orders_tenant ON draft_purchase_orders FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── draft_po_lines (no direct clinic_id — subquery via parent) ────────────
      ALTER TABLE draft_po_lines ENABLE ROW LEVEL SECURITY;
      ALTER TABLE draft_po_lines FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_draft_po_lines_tenant ON draft_po_lines;
      CREATE POLICY rls_draft_po_lines_tenant ON draft_po_lines FOR ALL
        USING (
          app_is_owner_admin()
          OR EXISTS (
            SELECT 1 FROM draft_purchase_orders po
            WHERE po.id = draft_purchase_order_id
              AND po.clinic_id = app_current_clinic_id()
          )
        )
        WITH CHECK (
          app_is_owner_admin()
          OR EXISTS (
            SELECT 1 FROM draft_purchase_orders po
            WHERE po.id = draft_purchase_order_id
              AND po.clinic_id = app_current_clinic_id()
          )
        );

      -- ── roster_entries ───────────────────────────────────────────────────────
      ALTER TABLE roster_entries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE roster_entries FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_roster_entries_tenant ON roster_entries;
      CREATE POLICY rls_roster_entries_tenant ON roster_entries FOR ALL
        USING (app_is_owner_admin() OR rostered_clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR rostered_clinic_id = app_current_clinic_id());

      -- ── roster_entry_audit (append-only — subquery via parent roster_entry) ────
      -- SELECT + INSERT only; UPDATE and DELETE silently blocked by RLS.
      ALTER TABLE roster_entry_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE roster_entry_audit FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_roster_entry_audit_tenant ON roster_entry_audit;
      DROP POLICY IF EXISTS rls_roster_entry_audit_select ON roster_entry_audit;
      DROP POLICY IF EXISTS rls_roster_entry_audit_insert ON roster_entry_audit;
      CREATE POLICY rls_roster_entry_audit_select ON roster_entry_audit
        FOR SELECT USING (
          app_is_owner_admin()
          OR EXISTS (
            SELECT 1 FROM roster_entries re
            WHERE re.id = roster_entry_id
              AND re.rostered_clinic_id = app_current_clinic_id()
          )
        );
      CREATE POLICY rls_roster_entry_audit_insert ON roster_entry_audit
        FOR INSERT WITH CHECK (
          app_is_owner_admin()
          OR EXISTS (
            SELECT 1 FROM roster_entries re
            WHERE re.id = roster_entry_id
              AND re.rostered_clinic_id = app_current_clinic_id()
          )
        );

      -- ── timesheet_entries ────────────────────────────────────────────────────
      ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE timesheet_entries FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_timesheet_entries_tenant ON timesheet_entries;
      CREATE POLICY rls_timesheet_entries_tenant ON timesheet_entries FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── leave_requests ───────────────────────────────────────────────────────
      ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_leave_requests_tenant ON leave_requests;
      CREATE POLICY rls_leave_requests_tenant ON leave_requests FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── invoices ─────────────────────────────────────────────────────────────
      ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_invoices_tenant ON invoices;
      CREATE POLICY rls_invoices_tenant ON invoices FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── invoice_number_sequences ─────────────────────────────────────────────
      ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;
      ALTER TABLE invoice_number_sequences FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_invoice_number_sequences_tenant ON invoice_number_sequences;
      CREATE POLICY rls_invoice_number_sequences_tenant ON invoice_number_sequences FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── invoice_line_items ───────────────────────────────────────────────────
      ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_invoice_line_items_tenant ON invoice_line_items;
      CREATE POLICY rls_invoice_line_items_tenant ON invoice_line_items FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── payment_records (append-only) ────────────────────────────────────────
      -- SELECT + INSERT only; UPDATE and DELETE silently blocked by RLS.
      -- Refunds = new negative-amount_cents rows, never edits to existing rows.
      ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
      ALTER TABLE payment_records FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_payment_records_tenant ON payment_records;
      DROP POLICY IF EXISTS rls_payment_records_select ON payment_records;
      DROP POLICY IF EXISTS rls_payment_records_insert ON payment_records;
      CREATE POLICY rls_payment_records_select ON payment_records
        FOR SELECT USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id());
      CREATE POLICY rls_payment_records_insert ON payment_records
        FOR INSERT WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- ── audit_events (append-only) ───────────────────────────────────────────
      -- SELECT + INSERT only; UPDATE and DELETE silently blocked by RLS.
      -- Corrections must be new rows (action = 'corrected'), never edits.
      ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_audit_events_tenant ON audit_events;
      DROP POLICY IF EXISTS rls_audit_events_select ON audit_events;
      DROP POLICY IF EXISTS rls_audit_events_insert ON audit_events;
      CREATE POLICY rls_audit_events_select ON audit_events
        FOR SELECT USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id());
      CREATE POLICY rls_audit_events_insert ON audit_events
        FOR INSERT WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());
    `,
  },
  {
    /**
     * Sprint O — Procurement Foundations.
     *
     * Suppliers are global (system-wide, not clinic-scoped), mirroring the
     * master_catalog_items design.  A unique index on supplier_code prevents
     * duplicate codes while allowing NULL codes (multiple suppliers without codes).
     */
    id: "017_suppliers_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS suppliers (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_name text        NOT NULL,
        supplier_code text,
        contact_name  text,
        email         text,
        phone         text,
        website       text,
        notes         text,
        active        boolean     NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_suppliers_active
        ON suppliers (active);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_supplier_code
        ON suppliers (supplier_code)
        WHERE supplier_code IS NOT NULL;
    `,
  },
  {
    /**
     * Sprint O — Supplier catalogue pricing.
     *
     * Each row represents one supplier's price for one product (master catalog item).
     * The unique partial index on (supplier_id, master_catalog_item_id) WHERE active = true
     * prevents duplicate active pricing entries while allowing a supplier to have
     * historical inactive rows for the same product.
     *
     * unit_cost_cents: integer cents (e.g. 1250 = $12.50) — consistent with billing module.
     */
    id: "018_supplier_catalogue_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS supplier_catalogue (
        id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id            uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        master_catalog_item_id uuid        NOT NULL REFERENCES master_catalog_items(id),
        supplier_sku           text,
        supplier_description   text,
        unit_cost_cents        integer     NOT NULL CHECK (unit_cost_cents >= 0),
        unit_of_measure        text,
        active                 boolean     NOT NULL DEFAULT true,
        created_at             timestamptz NOT NULL DEFAULT now(),
        updated_at             timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_supplier_catalogue_supplier_id
        ON supplier_catalogue (supplier_id);

      CREATE INDEX IF NOT EXISTS idx_supplier_catalogue_item_id
        ON supplier_catalogue (master_catalog_item_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_catalogue_active_unique
        ON supplier_catalogue (supplier_id, master_catalog_item_id)
        WHERE active = true;
    `,
  },
  {
    /**
     * Sprint 1: User Identity — adds nullable first_name, last_name, and
     * display_name columns to the users table.  Nullable so existing rows
     * are not invalidated; the application layer derives display_name as
     * "First Last" on creation when not explicitly provided.
     */
    id: "019_user_name_fields",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS first_name   text,
        ADD COLUMN IF NOT EXISTS last_name    text,
        ADD COLUMN IF NOT EXISTS display_name text;
    `,
  },
  {
    /**
     * RBAC v2 foundation — explicit per-user permission grants.
     *
     * Stores additional or cross-role permissions layered on top of the
     * role-based defaults baked into DEFAULT_PERMISSIONS.  These rows are
     * loaded at JWT issuance time and embedded in the access token so
     * downstream requirePermission() checks need no extra DB round-trip.
     *
     * Soft-delete semantics: revoked_at IS NULL means the grant is active.
     * The partial unique index prevents duplicate active grants; after
     * revocation a new row may be inserted to re-grant.
     *
     * Foreign keys reference clinics and users but are not CASCADE-deleted —
     * historical grant records are preserved for the audit trail even after
     * a user or clinic is deactivated.
     */
    id: "020_user_permission_grants",
    sql: `
      CREATE TABLE IF NOT EXISTS user_permission_grants (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id   uuid        NOT NULL REFERENCES clinics(id),
        user_id     uuid        NOT NULL REFERENCES users(id),
        permission  text        NOT NULL,
        granted_by  uuid        NOT NULL REFERENCES users(id),
        granted_at  timestamptz NOT NULL DEFAULT now(),
        revoked_at  timestamptz
      );

      CREATE INDEX IF NOT EXISTS idx_upg_user_id
        ON user_permission_grants (user_id);

      CREATE INDEX IF NOT EXISTS idx_upg_clinic_user
        ON user_permission_grants (clinic_id, user_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_upg_active_unique
        ON user_permission_grants (clinic_id, user_id, permission)
        WHERE revoked_at IS NULL;
    `,
  },
  {
    /**
     * Sprint OCR-1 — Supplier Invoice OCR (Accounts Payable).
     *
     * OVERVIEW
     * ────────
     * These tables are entirely separate from the patient-facing billing tables
     * (invoices, invoice_line_items, payment_records).  They represent supplier
     * invoices received by the clinic (AP), not invoices issued to patients (AR).
     *
     * THREE NEW TABLES
     * ────────────────
     * supplier_invoices        — header record per uploaded supplier document.
     * supplier_invoice_lines   — OCR-extracted line items, editable pre-confirm.
     * supplier_price_history   — append-only audit trail of price changes.
     *
     * KEY DESIGN DECISIONS
     * ─────────────────────
     * • file_sha256 (Amendment 1B): SHA-256 hex of the raw upload buffer.
     *   Enables duplicate-file detection at upload time (informational warning,
     *   no hard block in MVP).  A future UNIQUE constraint can be added without
     *   a data migration once the warning UX is validated.
     *
     * • storage_key (Amendment 1): Nullable placeholder for a future S3/GCS
     *   object key.  Schema is future-proof; MVP stores NULL.
     *
     * • ocr_confidence NUMERIC(5,2) (Amendment 2): Per-invoice and per-line
     *   confidence scores (0–100) extracted from the Claude response.  The
     *   review UI uses these to highlight low-confidence extractions.
     *
     * • supplier_id / invoice_number / invoice_date are nullable until review
     *   (Amendment 3): confirmImport() enforces all three are non-null before
     *   transitioning to 'confirmed'.
     *
     * • invoice_number duplicate warning (Amendment 4): A non-unique index on
     *   (clinic_id, supplier_id, invoice_number) supports fast duplicate lookup;
     *   the service layer issues a warning — no hard block.
     *
     * • supplier_price_history is global (no clinic_id); access gated at service
     *   layer.  Mirrors the master_catalog_items / suppliers pattern.
     *
     * MONETARY CONVENTION
     * ────────────────────
     * All monetary values are integer CENTS (AUD), consistent with the billing
     * module.  GST is expressed in basis points (1000 = 10%).
     *
     * RLS
     * ───
     * supplier_invoices and supplier_invoice_lines are clinic-scoped (RLS).
     * supplier_price_history is global (no RLS — no clinic_id column).
     */
    id: "021_supplier_invoice_ocr",
    sql: `
      -- ── ENUM: supplier_invoice_status ──────────────────────────────────────
      DO $$ BEGIN
        CREATE TYPE supplier_invoice_status AS ENUM (
          'pending_review', 'confirmed', 'voided'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- ── supplier_invoices ───────────────────────────────────────────────────
      -- Header record per uploaded supplier document.
      -- status starts as 'pending_review'; transitions via review → confirmed.
      -- supplier_id, invoice_number, invoice_date are nullable until review;
      -- confirmImport() enforces all three are non-null (Amendment 3).
      -- file_sha256 enables duplicate-file detection (Amendment 1B).
      -- storage_key is a future S3/GCS placeholder — NULL in MVP (Amendment 1).
      -- ocr_confidence 0-100 for review UI highlighting (Amendment 2).
      CREATE TABLE IF NOT EXISTS supplier_invoices (
        id                      uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Tenant anchor — RLS is enforced on this column.
        clinic_id               uuid                    NOT NULL REFERENCES clinics (id),

        -- Set during review; required before confirmImport() (Amendment 3).
        supplier_id             uuid                    REFERENCES suppliers (id),
        supplier_name_raw       text,
        invoice_number          text,
        invoice_date            date,
        due_date                date,

        status                  supplier_invoice_status NOT NULL DEFAULT 'pending_review',

        -- Monetary totals (integer cents, AUD).  Recalculated from lines.
        subtotal_cents          integer,
        tax_cents               integer,
        total_cents             integer,
        currency                text                    NOT NULL DEFAULT 'AUD',

        -- OCR provenance
        ocr_provider            text                    NOT NULL,
        ocr_confidence          numeric(5,2),
        ocr_raw_response        jsonb                   NOT NULL DEFAULT '{}',

        -- Document identity and traceability (Amendments 1 + 1B)
        original_filename       text                    NOT NULL,
        file_mime_type          text                    NOT NULL,
        file_sha256             text,
        storage_key             text,

        -- Import actor
        imported_by_user_id     uuid                    NOT NULL REFERENCES users (id),
        imported_by_email       text                    NOT NULL,

        -- Confirmation (set by confirmImport)
        confirmed_by_user_id    uuid                    REFERENCES users (id),
        confirmed_at            timestamptz,

        -- Void (terminal state)
        voided_by_user_id       uuid                    REFERENCES users (id),
        voided_at               timestamptz,

        notes                   text,
        created_at              timestamptz             NOT NULL DEFAULT now(),
        updated_at              timestamptz             NOT NULL DEFAULT now()
      );

      -- Paginated list by clinic, with status filter.
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_clinic_status
        ON supplier_invoices (clinic_id, status, created_at DESC);

      -- Supplier-scoped lookup (filter invoices from a specific supplier).
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_clinic_supplier
        ON supplier_invoices (clinic_id, supplier_id)
        WHERE supplier_id IS NOT NULL;

      -- Duplicate-file detection (Amendment 1B).
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_sha256
        ON supplier_invoices (file_sha256)
        WHERE file_sha256 IS NOT NULL;

      -- Duplicate invoice-number detection (Amendment 4).
      -- Non-unique: the service issues a warning, not a hard block.
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_inv_number
        ON supplier_invoices (clinic_id, supplier_id, invoice_number)
        WHERE invoice_number IS NOT NULL AND supplier_id IS NOT NULL;

      -- ── supplier_invoice_lines ──────────────────────────────────────────────
      -- OCR-extracted line items.  Editable during 'pending_review'.
      -- clinic_id is redundant (mirrors parent) for defence-in-depth RLS.
      -- master_catalog_item_id and supplier_catalogue_id set during review.
      CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
        id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Redundant clinic_id — defence-in-depth tenant anchor (mirrors parent).
        clinic_id               uuid        NOT NULL REFERENCES clinics (id),

        supplier_invoice_id     uuid        NOT NULL REFERENCES supplier_invoices (id)
                                              ON DELETE CASCADE,

        -- Links set during the review step; NULL until matched.
        master_catalog_item_id  uuid        REFERENCES master_catalog_items (id),
        supplier_catalogue_id   uuid        REFERENCES supplier_catalogue (id),

        -- Raw OCR output (always preserved for audit)
        ocr_description         text        NOT NULL,
        ocr_sku                 text,
        ocr_confidence          numeric(5,2),

        -- Editable fields (may be corrected during review)
        quantity                numeric(12,4) NOT NULL,
        unit_price_cents        integer     NOT NULL,
        subtotal_cents          integer     NOT NULL,
        tax_rate_basis_points   integer     NOT NULL DEFAULT 1000,
        tax_cents               integer     NOT NULL,
        total_cents             integer     NOT NULL,

        sort_order              integer     NOT NULL DEFAULT 0,
        is_matched              boolean     NOT NULL DEFAULT false,
        match_method            text
          CONSTRAINT supplier_invoice_lines_match_method_check
            CHECK (match_method IS NULL OR match_method IN ('exact_sku', 'name_match', 'manual')),

        created_at              timestamptz NOT NULL DEFAULT now(),
        updated_at              timestamptz NOT NULL DEFAULT now()
      );

      -- All lines for a supplier invoice ordered for display.
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice
        ON supplier_invoice_lines (supplier_invoice_id, sort_order);

      -- Defence-in-depth: tenant-scoped line lookup without joining header.
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_clinic
        ON supplier_invoice_lines (clinic_id, supplier_invoice_id);

      -- Lookup by catalog item (for "all invoices that mentioned this product").
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_catalog_item
        ON supplier_invoice_lines (master_catalog_item_id)
        WHERE master_catalog_item_id IS NOT NULL;

      -- ── supplier_price_history ──────────────────────────────────────────────
      -- Append-only audit trail of every supplier price change.
      -- No clinic_id — global, like suppliers and master_catalog_items.
      -- source = 'supplier_invoice_ocr' when written by confirmImport().
      CREATE TABLE IF NOT EXISTS supplier_price_history (
        id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

        supplier_catalogue_id   uuid        NOT NULL REFERENCES supplier_catalogue (id),
        supplier_id             uuid        NOT NULL REFERENCES suppliers (id),
        master_catalog_item_id  uuid        NOT NULL REFERENCES master_catalog_items (id),

        old_unit_cost_cents     integer,
        new_unit_cost_cents     integer     NOT NULL,

        source                  text        NOT NULL
          CONSTRAINT supplier_price_history_source_check
            CHECK (source IN ('supplier_invoice_ocr', 'manual', 'catalogue_import')),

        -- References the supplier_invoice_id that triggered the change.
        source_reference_id     uuid,

        changed_by_user_id      uuid        NOT NULL REFERENCES users (id),
        changed_by_email        text        NOT NULL,
        effective_date          date        NOT NULL,

        created_at              timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_supplier_price_history_catalogue
        ON supplier_price_history (supplier_catalogue_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_supplier_price_history_item
        ON supplier_price_history (master_catalog_item_id, created_at DESC);

      -- ── RLS policies ───────────────────────────────────────────────────────
      -- supplier_invoices: full CRUD scoped to clinic (FORCE RLS on owner too).
      ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_supplier_invoices_tenant ON supplier_invoices;
      CREATE POLICY rls_supplier_invoices_tenant ON supplier_invoices FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- supplier_invoice_lines: same pattern as invoice_line_items.
      ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
      ALTER TABLE supplier_invoice_lines FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_supplier_invoice_lines_tenant ON supplier_invoice_lines;
      CREATE POLICY rls_supplier_invoice_lines_tenant ON supplier_invoice_lines FOR ALL
        USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
        WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

      -- supplier_price_history: no RLS (global table, no clinic_id).
      -- Access gated at service layer, matching master_catalog_items pattern.
    `,
  },
  {
    id: "022_supplier_abn_address",
    sql: `
      -- Add ABN and address fields to suppliers for Smart Supplier Detection.
      -- Both columns are optional (text, nullable) so existing rows are unaffected.
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS abn     text;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address text;
    `,
  },
];

/**
 * Advisory lock key — unique to this application so it never collides with
 * other Postgres-backed services sharing the same cluster.
 * Value is arbitrary but must be a stable bigint.
 */
const MIGRATION_ADVISORY_LOCK_KEY = 5_432_001n;

export type MigrationRunOptions = {
  /**
   * Current NODE_ENV.  Staging and production trigger the migration gate.
   * Defaults to "development" (auto-apply, no gate).
   */
  nodeEnv?: string;
  /**
   * When true, pending migrations are applied even in staging/production.
   * Set via MIGRATE_ON_STARTUP=true or by running `npm run migrate`.
   * Ignored in development/test (migrations always apply there).
   */
  migrateOnStartup?: boolean;
};

export async function runBootstrapMigrations(
  pool: DatabasePool,
  logger: Logger,
  options: MigrationRunOptions = {},
): Promise<void> {
  const { nodeEnv = "development", migrateOnStartup = false } = options;
  const isRestrictedEnv = nodeEnv === "staging" || nodeEnv === "production";

  // Check-out a dedicated connection so the transaction and the advisory lock
  // are both scoped to the same physical session.  pg_advisory_xact_lock is
  // automatically released when the transaction commits or rolls back, so two
  // app instances scaling up concurrently on Render will serialize here without
  // executing migrations twice or corrupting schema_migrations.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Acquire transaction-level advisory lock — blocks until the lock is free.
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Fetch all already-applied migration IDs in a single round-trip.
    const { rows: appliedRows } = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations",
    );
    const applied = new Set(appliedRows.map((r) => r.id));
    const pending = BOOTSTRAP_MIGRATIONS.filter((m) => !applied.has(m.id));

    // ── Migration gate ────────────────────────────────────────────────────────
    // In staging and production, block startup when pending migrations exist
    // unless the operator has explicitly opted in via MIGRATE_ON_STARTUP=true
    // or by running `npm run migrate`.  This prevents unreviewed DDL from
    // being silently applied during a normal deployment.
    if (pending.length > 0 && isRestrictedEnv && !migrateOnStartup) {
      const pendingIds = pending.map((m) => m.id).join(", ");
      throw new Error(
        `[Migration Gate] ${String(pending.length)} pending migration(s) detected in ${nodeEnv}. ` +
          `Startup blocked to prevent unreviewed DDL changes. ` +
          `Pending: ${pendingIds}. ` +
          `Run 'npm run migrate' to apply intentionally, or set MIGRATE_ON_STARTUP=true.`,
      );
    }

    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
        migration.id,
      ]);
      logger.info({ migrationId: migration.id }, "Bootstrap migration applied");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
