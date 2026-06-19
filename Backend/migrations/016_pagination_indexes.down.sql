-- =============================================================================
-- Migration: 016_pagination_indexes  (rollback)
-- Drops the pagination performance indexes added in the UP migration.
-- =============================================================================

DROP INDEX IF EXISTS idx_clinic_inventory_items_clinic_created;
DROP INDEX IF EXISTS idx_inventory_adjustments_clinic_created;
DROP INDEX IF EXISTS idx_roster_entries_clinic_start;
DROP INDEX IF EXISTS idx_timesheet_entries_clinic_date;
DROP INDEX IF EXISTS idx_timesheet_entries_clinic_submitted;
DROP INDEX IF EXISTS idx_leave_requests_clinic_start;
DROP INDEX IF EXISTS idx_leave_requests_clinic_pending;
DROP INDEX IF EXISTS idx_audit_events_clinic_created;
