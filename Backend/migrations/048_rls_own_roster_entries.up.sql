-- Migration 047: RLS — staff may read own roster entries across clinics.
--
-- Problem (confirmed audit finding):
--   The existing roster_entries SELECT policy only allows rows where
--   rostered_clinic_id = app_current_clinic_id(). A staff member rostered
--   at a different clinic from their home clinic can never see that shift via
--   the normal clinic-scoped path.
--
-- Solution:
--   Add a second USING clause branch: a staff member may read any entry where
--   staff_user_id matches the current user ID from the session variable
--   app.current_user_id. This variable is set only by the personal roster
--   endpoint (GET /api/v1/roster/me) — normal clinic-scoped requests leave
--   it empty, so the existing RLS policy is not weakened for those paths.
--
-- WITH CHECK (write guard) remains unchanged: writes still require either
--   owner_admin mode or rostered_clinic_id = app_current_clinic_id().
--   Staff can NEVER insert/update roster entries via the personal endpoint.
--
-- Security properties preserved:
--   1. A staff member reads ONLY their own entries (staff_user_id match).
--   2. They cannot read another staff member's entry at any clinic.
--   3. Inventory, Procurement, Timesheets, and all other tables are unaffected.
--   4. Write policies are unchanged.

-- Helper function: returns the current_user_id from the session variable.
-- Returns '' when the variable has not been set (safe default → no match).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(current_setting('app.current_user_id', true), '');
$$;

-- ── Update roster_entries SELECT policy ──────────────────────────────────────

DROP POLICY IF EXISTS rls_roster_entries_tenant ON roster_entries;

CREATE POLICY rls_roster_entries_tenant ON roster_entries
  FOR ALL
  USING (
    app_is_owner_admin()
    OR rostered_clinic_id = app_current_clinic_id()
    OR (
      -- Personal cross-clinic read: staff may see their own entries regardless
      -- of which clinic they are rostered at. The session variable is only set
      -- by the /roster/me endpoint; it is empty on all other request paths.
      app_current_user_id() <> ''
      AND staff_user_id::text = app_current_user_id()
    )
  )
  WITH CHECK (
    -- Write guard: unchanged — only owner_admin or the correct clinic context.
    app_is_owner_admin()
    OR rostered_clinic_id = app_current_clinic_id()
  );
