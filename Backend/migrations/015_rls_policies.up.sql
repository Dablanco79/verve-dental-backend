-- =============================================================================
-- Migration: 015_rls_policies  (Module 13 hardened)
-- Purpose:   PostgreSQL Row-Level Security across all tenant-owned tables.
--
-- Architecture
-- ─────────────────────────────────────────────────────────────────────────────
-- Two PostgreSQL session variables govern access:
--
--   app.current_clinic_id  — UUID of the clinic whose data the current
--                            application session may access.  Set before any
--                            tenant-scoped query via set_config() or SET LOCAL
--                            inside a transaction.
--
--   app.owner_admin_mode   — 'true' when the authenticated user is an
--                            owner_admin who requires cross-clinic read access.
--                            When set, ALL clinic rows are visible (matching
--                            the application-layer behaviour for owner_admin).
--
-- Helper functions
-- ─────────────────────────────────────────────────────────────────────────────
-- app_current_clinic_id()   → uuid | NULL
-- app_is_owner_admin()      → boolean
--
-- These are STABLE (no side effects, safe to cache per statement) and
-- SECURITY DEFINER so they can be called from within RLS policies without
-- requiring the calling role to have direct access to pg_settings.
-- SET search_path ensures they cannot be hijacked via search_path manipulation.
--
-- Policy naming convention
-- ─────────────────────────────────────────────────────────────────────────────
-- rls_<table>_tenant    — generic tenant-scoped policy (SELECT+INSERT+UPDATE+DELETE)
-- rls_<table>_select    — read-only policy for append-only audit tables
-- rls_<table>_insert    — write-only policy for append-only audit tables
--
-- FORCE ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- Added on every table so that table owners (and superusers connecting as the
-- app role) are also subject to RLS policies.  The PostgreSQL superuser role
-- itself always bypasses RLS regardless of FORCE — this is intentional so
-- migrations and manual DBA operations are not blocked.
--
-- THREAT MODEL & REMAINING ASSUMPTIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. app.owner_admin_mode is a session variable settable by any actor with
--    the application database credentials.  The defense against spoofing is:
--      a. Application DB credentials are secret and access-controlled.
--      b. DB connections are restricted by pg_hba.conf / network firewall.
--      c. The pool hook resets both variables on connection release.
--      d. withTenantContext() always sets both variables atomically.
--    A fully privilege-separated implementation would use separate PostgreSQL
--    roles (one per privilege level) rather than session variables.  This is
--    a known remaining limitation; the current architecture provides
--    defence-in-depth through application-layer RBAC + JWT validation.
--
-- 2. Auth-related user lookups (login, refresh, MFA verify, changePassword)
--    use owner_admin_mode = 'true' context set by the application layer.
--    These are trusted code paths guarded by bcrypt and JWT verification.
--    The application NEVER exposes password_hash over the REST API.
--
-- 3. The migration/seed role must have sufficient privilege to apply
--    FORCE ROW LEVEL SECURITY and create SECURITY DEFINER functions.
--    In production (Render), the initial database owner satisfies this.
--    Seed functions use owner_admin_mode to bypass RLS; this is safe because
--    seed runs only on a fresh, empty database with no tenant data to protect.
--
-- Idempotency
-- ─────────────────────────────────────────────────────────────────────────────
-- All statements use CREATE OR REPLACE / IF NOT EXISTS / ALTER TABLE ...
-- ENABLE ROW LEVEL SECURITY (idempotent).  Safe to re-run against a database
-- that already has some or all of these objects.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns the clinic UUID from the current session variable, or NULL if the
-- variable has not been set (e.g., during auth operations that precede login).
CREATE OR REPLACE FUNCTION app_current_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.current_clinic_id', true), '')::uuid;
$$;

-- Returns TRUE when the current session is running in owner_admin mode,
-- meaning cross-clinic access is permitted.
-- NOTE: This relies on a session variable that is spoofable by any actor
-- with direct DB access.  See THREAT MODEL notes in the file header.
CREATE OR REPLACE FUNCTION app_is_owner_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_setting('app.owner_admin_mode', true) = 'true';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: users
-- Tenant column: home_clinic_id
--
-- Auth operations (login, MFA verify, token refresh, changePassword) look up
-- users by email or ID without a per-clinic context.  These are handled at the
-- application layer: the PostgreSQL user repository wraps auth queries in a
-- withTenantContext(ownerAdmin=true) call so app_is_owner_admin() evaluates to
-- TRUE.  This is narrower than the previous IS NULL bypass because it requires
-- the application to explicitly opt in, and it can be observed in DB audit logs.
--
-- The NULL-context bypass was removed because it allowed ANY actor with DB
-- credentials to read all user rows (including password_hash) simply by
-- connecting without setting app.current_clinic_id.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_users_select ON users;
CREATE POLICY rls_users_select ON users
  FOR SELECT
  USING (
    app_is_owner_admin()
    OR home_clinic_id = app_current_clinic_id()
  );

DROP POLICY IF EXISTS rls_users_insert ON users;
CREATE POLICY rls_users_insert ON users
  FOR INSERT
  WITH CHECK (
    app_is_owner_admin()
    OR home_clinic_id = app_current_clinic_id()
  );

DROP POLICY IF EXISTS rls_users_update ON users;
CREATE POLICY rls_users_update ON users
  FOR UPDATE
  USING (
    app_is_owner_admin()
    OR home_clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR home_clinic_id = app_current_clinic_id()
  );

DROP POLICY IF EXISTS rls_users_delete ON users;
CREATE POLICY rls_users_delete ON users
  FOR DELETE
  USING (
    app_is_owner_admin()
    OR home_clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: clinic_inventory_items
-- Tenant column: clinic_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clinic_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_inventory_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_clinic_inventory_items_tenant ON clinic_inventory_items;
CREATE POLICY rls_clinic_inventory_items_tenant ON clinic_inventory_items
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: inventory_adjustments
-- Tenant column: clinic_id
-- Append-only audit log: SELECT and INSERT are permitted; UPDATE and DELETE
-- are intentionally denied at the policy level.  A separate negative line
-- must be written to undo an adjustment — never a mutation of an existing row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments FORCE ROW LEVEL SECURITY;

-- Remove old combined policy; keep old name as drop-target for idempotency.
DROP POLICY IF EXISTS rls_inventory_adjustments_tenant ON inventory_adjustments;
DROP POLICY IF EXISTS rls_inventory_adjustments_select ON inventory_adjustments;
DROP POLICY IF EXISTS rls_inventory_adjustments_insert ON inventory_adjustments;

CREATE POLICY rls_inventory_adjustments_select ON inventory_adjustments
  FOR SELECT
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

CREATE POLICY rls_inventory_adjustments_insert ON inventory_adjustments
  FOR INSERT
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );
-- No UPDATE or DELETE policy → those operations are silently blocked by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: draft_purchase_orders
-- Tenant column: clinic_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE draft_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_purchase_orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_draft_purchase_orders_tenant ON draft_purchase_orders;
CREATE POLICY rls_draft_purchase_orders_tenant ON draft_purchase_orders
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: draft_po_lines
-- No direct clinic_id — tenant scope inherited via parent draft_purchase_order.
-- Uses EXISTS subquery to enforce isolation without adding a redundant column.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE draft_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_po_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_draft_po_lines_tenant ON draft_po_lines;
CREATE POLICY rls_draft_po_lines_tenant ON draft_po_lines
  FOR ALL
  USING (
    app_is_owner_admin()
    OR EXISTS (
      SELECT 1
      FROM draft_purchase_orders po
      WHERE po.id = draft_purchase_order_id
        AND po.clinic_id = app_current_clinic_id()
    )
  )
  WITH CHECK (
    app_is_owner_admin()
    OR EXISTS (
      SELECT 1
      FROM draft_purchase_orders po
      WHERE po.id = draft_purchase_order_id
        AND po.clinic_id = app_current_clinic_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: roster_entries
-- Tenant column: rostered_clinic_id
-- NOTE: roster_entries uses rostered_clinic_id (physical work location) as the
-- tenant discriminator, not a home_clinic_id.  This matches the application's
-- scheduling view which groups shifts by work location.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE roster_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_roster_entries_tenant ON roster_entries;
CREATE POLICY rls_roster_entries_tenant ON roster_entries
  FOR ALL
  USING (
    app_is_owner_admin()
    OR rostered_clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR rostered_clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: roster_entry_audit
-- No direct clinic_id — tenant scope inherited via parent roster_entry.
-- Append-only: SELECT and INSERT permitted; UPDATE and DELETE denied at the
-- policy level.  Each schedule change produces a new immutable audit row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE roster_entry_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_entry_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_roster_entry_audit_tenant ON roster_entry_audit;
DROP POLICY IF EXISTS rls_roster_entry_audit_select ON roster_entry_audit;
DROP POLICY IF EXISTS rls_roster_entry_audit_insert ON roster_entry_audit;

CREATE POLICY rls_roster_entry_audit_select ON roster_entry_audit
  FOR SELECT
  USING (
    app_is_owner_admin()
    OR EXISTS (
      SELECT 1
      FROM roster_entries re
      WHERE re.id = roster_entry_id
        AND re.rostered_clinic_id = app_current_clinic_id()
    )
  );

CREATE POLICY rls_roster_entry_audit_insert ON roster_entry_audit
  FOR INSERT
  WITH CHECK (
    app_is_owner_admin()
    OR EXISTS (
      SELECT 1
      FROM roster_entries re
      WHERE re.id = roster_entry_id
        AND re.rostered_clinic_id = app_current_clinic_id()
    )
  );
-- No UPDATE or DELETE policy → those operations are silently blocked by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: timesheet_entries
-- Tenant column: clinic_id (home/payroll location)
-- NOTE: clinic_id = users.home_clinic_id (payroll grouping).
-- rostered_clinic_id is a secondary field for physical location; it is NOT
-- used as the RLS discriminator — payroll records belong to the home clinic.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_timesheet_entries_tenant ON timesheet_entries;
CREATE POLICY rls_timesheet_entries_tenant ON timesheet_entries
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: leave_requests
-- Tenant column: clinic_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_leave_requests_tenant ON leave_requests;
CREATE POLICY rls_leave_requests_tenant ON leave_requests
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: invoices
-- Tenant column: clinic_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_invoices_tenant ON invoices;
CREATE POLICY rls_invoices_tenant ON invoices
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: invoice_number_sequences
-- Tenant column: clinic_id (also the primary key)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_number_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_invoice_number_sequences_tenant ON invoice_number_sequences;
CREATE POLICY rls_invoice_number_sequences_tenant ON invoice_number_sequences
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: invoice_line_items
-- Tenant column: clinic_id (redundant — also accessible via invoice_id FK)
-- Using the redundant column avoids a JOIN in the policy evaluation.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_invoice_line_items_tenant ON invoice_line_items;
CREATE POLICY rls_invoice_line_items_tenant ON invoice_line_items
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: payment_records
-- Tenant column: clinic_id (redundant — also accessible via invoice_id FK)
-- Append-only ledger: SELECT and INSERT permitted; UPDATE and DELETE denied.
-- Refunds are recorded as new negative-amount_cents rows, never as edits.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_payment_records_tenant ON payment_records;
DROP POLICY IF EXISTS rls_payment_records_select ON payment_records;
DROP POLICY IF EXISTS rls_payment_records_insert ON payment_records;

CREATE POLICY rls_payment_records_select ON payment_records
  FOR SELECT
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

CREATE POLICY rls_payment_records_insert ON payment_records
  FOR INSERT
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );
-- No UPDATE or DELETE policy → those operations are silently blocked by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: audit_events
-- Tenant column: clinic_id
-- Append-only: SELECT and INSERT permitted; UPDATE and DELETE denied at the
-- policy level.  Audit integrity requires that events are immutable once
-- written — a correction is a new event (action = 'corrected'), never an edit.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_audit_events_tenant ON audit_events;
DROP POLICY IF EXISTS rls_audit_events_select ON audit_events;
DROP POLICY IF EXISTS rls_audit_events_insert ON audit_events;

CREATE POLICY rls_audit_events_select ON audit_events
  FOR SELECT
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

CREATE POLICY rls_audit_events_insert ON audit_events
  FOR INSERT
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );
-- No UPDATE or DELETE policy → those operations are silently blocked by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMENT: Tables NOT protected by RLS (by design)
-- ─────────────────────────────────────────────────────────────────────────────
-- • schema_migrations      — internal, no tenant data, never queried by app
-- • master_catalog_items   — global product catalog, read by all clinics
-- • barcode_mappings       — global barcode → SKU map, read by all clinics
-- • clinics                — the tenant registry; queried by ClinicService
--                            which has its own RBAC guards
-- ─────────────────────────────────────────────────────────────────────────────
