-- =============================================================================
-- Migration: 019_stocktake_schema DOWN
-- Drops all objects added in the UP migration.
-- =============================================================================

DROP TABLE IF EXISTS stocktake_lines CASCADE;
DROP TABLE IF EXISTS stocktake_sessions CASCADE;
DROP TYPE IF EXISTS stocktake_status CASCADE;

-- NOTE: inventory_adjustment_type enum values cannot be removed in PostgreSQL
-- without recreating the type. The 'stocktake_adjustment' value is left in
-- place as it causes no harm and avoids a complex type-rebuild.
