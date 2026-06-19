-- =============================================================================
-- Migration: 016_pagination_indexes  (Sprint L — Pagination & Performance)
-- Purpose:   Composite indexes to support tenant-scoped LIMIT/OFFSET pagination
--            on the six high-volume list endpoints added in Sprint L.
--
-- All indexes are:
--   • CREATE INDEX IF NOT EXISTS — fully idempotent, safe to re-run.
--   • Named with a consistent prefix:  idx_<table>_<purpose>
--   • Scoped to include the tenant column (clinic_id or rostered_clinic_id)
--     as the leading key so the index satisfies both the WHERE clause filter
--     and the ORDER BY used by the paginated query in a single index scan.
--
-- No RLS policies are modified.  These indexes are purely additive.
-- =============================================================================

-- ── clinic_inventory_items ────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/inventory  (listClinicInventoryPage)
-- Query:    WHERE clinic_id = $1 ORDER BY name LIMIT/OFFSET
-- The JOIN to master_catalog_items uses the existing PK; the index here
-- narrows the outer scan to one tenant before the sort/join.
CREATE INDEX IF NOT EXISTS idx_clinic_inventory_items_clinic_created
  ON clinic_inventory_items (clinic_id, created_at DESC);

-- ── inventory_adjustments ─────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/inventory/adjustments  (listAdjustmentsPage)
-- Query:    WHERE clinic_id = $1 ORDER BY created_at DESC LIMIT/OFFSET
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_clinic_created
  ON inventory_adjustments (clinic_id, created_at DESC);

-- ── roster_entries ────────────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/roster  (listByClinicPaginated)
-- Query:    WHERE rostered_clinic_id = $1 [AND status/date filters]
--           ORDER BY shift_start_at ASC LIMIT/OFFSET
-- The existing idx_roster_entries_rostered_clinic_id covers the WHERE clause
-- but cannot satisfy the ORDER BY without a filesort.  This composite index
-- eliminates the sort for the common case (no status or date filter).
CREATE INDEX IF NOT EXISTS idx_roster_entries_clinic_start
  ON roster_entries (rostered_clinic_id, shift_start_at ASC);

-- ── timesheet_entries ─────────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/timesheets  (listByClinicPaginated)
-- Query:    WHERE clinic_id = $1 [AND filters] ORDER BY shift_date DESC LIMIT/OFFSET
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinic_date
  ON timesheet_entries (clinic_id, shift_date DESC);

-- Partial index for the pendingApprovalOnly fast path (approval queue).
-- Avoids a full table scan when managers poll for submitted timesheets.
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinic_submitted
  ON timesheet_entries (clinic_id, shift_date DESC)
  WHERE timesheet_status = 'submitted';

-- ── leave_requests ────────────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/leave  (listByClinicPaginated)
-- Query:    WHERE clinic_id = $1 [AND status/type/date filters]
--           ORDER BY start_date DESC LIMIT/OFFSET
CREATE INDEX IF NOT EXISTS idx_leave_requests_clinic_start
  ON leave_requests (clinic_id, start_date DESC);

-- Partial index for pending leave — used heavily by the manager approval flow.
CREATE INDEX IF NOT EXISTS idx_leave_requests_clinic_pending
  ON leave_requests (clinic_id, start_date DESC)
  WHERE status = 'pending';

-- ── audit_events ──────────────────────────────────────────────────────────────
-- Supports: GET /clinics/:clinicId/analytics/audit-events  (listEvents)
-- The repository already uses LIMIT/OFFSET; this index supports the
-- COUNT(*) + ORDER BY created_at DESC pattern.
CREATE INDEX IF NOT EXISTS idx_audit_events_clinic_created
  ON audit_events (clinic_id, created_at DESC);
