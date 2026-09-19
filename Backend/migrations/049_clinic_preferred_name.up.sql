-- Migration 049: Add preferred_name to clinics
-- Optional short display name for compact operational UI (My Shifts, roster calendars).
-- Falls back to the canonical `name` when NULL.
-- Must not replace or mutate the official clinic name.
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS preferred_name text;
