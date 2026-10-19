-- Reference copy of bootstrap migration 059_force_workflow_table_rls.
-- The executable source of truth is Backend/src/db/migrate.ts.
--
-- Migration 058 belongs to the separate Workforce workstream. This hardening
-- intentionally uses 059 so the two branches do not reuse an ID.

ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_stocktake_sessions ON stocktake_sessions;
CREATE POLICY tenant_isolation_stocktake_sessions ON stocktake_sessions
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

ALTER TABLE stocktake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_stocktake_lines ON stocktake_lines;
CREATE POLICY tenant_isolation_stocktake_lines ON stocktake_lines
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );

ALTER TABLE purchasing_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchasing_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchasing_drafts_clinic_isolation ON purchasing_drafts;
CREATE POLICY purchasing_drafts_clinic_isolation ON purchasing_drafts
  FOR ALL
  USING (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  )
  WITH CHECK (
    app_is_owner_admin()
    OR clinic_id = app_current_clinic_id()
  );
