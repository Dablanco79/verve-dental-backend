-- Migration 053 rollback: remove staff timesheet note columns.
ALTER TABLE timesheet_entries
  DROP COLUMN IF EXISTS clock_in_note,
  DROP COLUMN IF EXISTS clock_out_note;
