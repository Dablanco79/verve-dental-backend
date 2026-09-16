-- Rollback: 047_rls_own_roster_entries
-- Restore the original clinic-only roster_entries SELECT policy.

DROP FUNCTION IF EXISTS app_current_user_id();

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
