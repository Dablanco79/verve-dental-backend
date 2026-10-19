-- Reference rollback policy for migration 059_force_workflow_table_rls.
--
-- Reverting FORCE RLS would restore a confirmed table-owner tenant-isolation
-- bypass. This security migration is intentionally forward-only.

DO $$
BEGIN
  RAISE EXCEPTION
    'Migration 059 rollback refused: FORCE RLS is a required tenant-isolation control';
END
$$;
