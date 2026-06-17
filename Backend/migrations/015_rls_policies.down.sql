-- =============================================================================
-- Rollback: 015_rls_policies  (Module 13 hardened)
-- Purpose:  Removes all RLS policies and disables row-level security.
--           Returns the database to application-layer-only tenant isolation.
--
-- WARNING: After executing this rollback, tenant isolation relies EXCLUSIVELY
--          on application-layer WHERE clauses.  Any bug in the application that
--          omits the clinic_id filter will expose cross-tenant data.
--          Only run this rollback in a controlled maintenance window.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop all RLS policies (reverse order of creation)
-- audit_events — operation-specific (hardened)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rls_audit_events_insert            ON audit_events;
DROP POLICY IF EXISTS rls_audit_events_select            ON audit_events;
DROP POLICY IF EXISTS rls_audit_events_tenant            ON audit_events;  -- legacy name

-- payment_records — operation-specific (hardened)
DROP POLICY IF EXISTS rls_payment_records_insert         ON payment_records;
DROP POLICY IF EXISTS rls_payment_records_select         ON payment_records;
DROP POLICY IF EXISTS rls_payment_records_tenant         ON payment_records;  -- legacy name
DROP POLICY IF EXISTS rls_invoice_line_items_tenant      ON invoice_line_items;
DROP POLICY IF EXISTS rls_invoice_number_sequences_tenant ON invoice_number_sequences;
DROP POLICY IF EXISTS rls_invoices_tenant                ON invoices;
DROP POLICY IF EXISTS rls_leave_requests_tenant          ON leave_requests;
DROP POLICY IF EXISTS rls_timesheet_entries_tenant       ON timesheet_entries;
-- roster_entry_audit — operation-specific (hardened)
DROP POLICY IF EXISTS rls_roster_entry_audit_insert      ON roster_entry_audit;
DROP POLICY IF EXISTS rls_roster_entry_audit_select      ON roster_entry_audit;
DROP POLICY IF EXISTS rls_roster_entry_audit_tenant      ON roster_entry_audit;  -- legacy name
DROP POLICY IF EXISTS rls_roster_entries_tenant          ON roster_entries;
DROP POLICY IF EXISTS rls_draft_po_lines_tenant          ON draft_po_lines;
DROP POLICY IF EXISTS rls_draft_purchase_orders_tenant   ON draft_purchase_orders;

-- inventory_adjustments — operation-specific (hardened)
DROP POLICY IF EXISTS rls_inventory_adjustments_insert   ON inventory_adjustments;
DROP POLICY IF EXISTS rls_inventory_adjustments_select   ON inventory_adjustments;
DROP POLICY IF EXISTS rls_inventory_adjustments_tenant   ON inventory_adjustments;  -- legacy name

DROP POLICY IF EXISTS rls_clinic_inventory_items_tenant  ON clinic_inventory_items;

DROP POLICY IF EXISTS rls_users_delete                   ON users;
DROP POLICY IF EXISTS rls_users_update                   ON users;
DROP POLICY IF EXISTS rls_users_insert                   ON users;
DROP POLICY IF EXISTS rls_users_select                   ON users;

-- ─────────────────────────────────────────────────────────────────────────────
-- Disable RLS on all tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_events               DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records            DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_number_sequences   DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests             DISABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries          DISABLE ROW LEVEL SECURITY;
ALTER TABLE roster_entry_audit         DISABLE ROW LEVEL SECURITY;
ALTER TABLE roster_entries             DISABLE ROW LEVEL SECURITY;
ALTER TABLE draft_po_lines             DISABLE ROW LEVEL SECURITY;
ALTER TABLE draft_purchase_orders      DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_inventory_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE users                      DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop helper functions
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS app_is_owner_admin();
DROP FUNCTION IF EXISTS app_current_clinic_id();
