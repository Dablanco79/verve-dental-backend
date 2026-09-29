-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053: Staff Timesheet Notes
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds two optional staff-authored note columns to timesheet_entries:
--
--   clock_in_note  text  — explanation provided by the staff member at clock-in.
--   clock_out_note text  — explanation provided by the staff member at clock-out.
--
-- BUSINESS RULES (enforced at service layer, NOT at DB level):
--   • Normal clock-in / clock-out: notes are optional (NULL when not provided).
--   • Geofence exception (outside radius / permission denied / unavailable):
--     the relevant note becomes REQUIRED before the backend will accept the event.
--   • Notes are staff-authored only.  They MUST remain completely separate from:
--       approval_notes  — manager-authored (approve/reject annotation)
--       commission_note — manager-authored (commission attendance note)
--   • A note never modifies distanceMetres, withinRange, locationState, clinic
--     assignments, or any payroll semantics.
--
-- ADDITIVE MIGRATION:
--   Both columns are nullable with no default — fully additive.
--   Existing rows remain NULL, which the application treats as "no note".
--   No backfill is required.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS clock_in_note  text,
  ADD COLUMN IF NOT EXISTS clock_out_note text;
