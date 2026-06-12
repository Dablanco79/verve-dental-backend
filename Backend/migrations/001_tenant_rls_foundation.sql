-- Module 02 foundation: PostgreSQL RLS session variable + policy template.
-- Applied in Module 13 when the database schema is created.

-- Session variable set by the application before tenant-scoped queries:
--   SET app.current_clinic_id = '<clinic-uuid>';

CREATE OR REPLACE FUNCTION app_current_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_clinic_id', true), '')::uuid;
$$;

-- Example RLS policy pattern for tenant-owned tables (repeat per table in Module 13):
--
-- ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
--
-- CREATE POLICY tenant_isolation_select ON inventory_items
--   FOR SELECT
--   USING (clinic_id = app_current_clinic_id());
--
-- CREATE POLICY tenant_isolation_write ON inventory_items
--   FOR ALL
--   USING (clinic_id = app_current_clinic_id())
--   WITH CHECK (clinic_id = app_current_clinic_id());
