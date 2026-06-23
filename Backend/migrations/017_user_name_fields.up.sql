-- Sprint 1: User Identity
-- Adds nullable first_name, last_name, and display_name columns to the users
-- table.  All columns are nullable so that existing rows remain valid without a
-- backfill.  display_name defaults to "First Last" on creation via the
-- application layer; the DB does not enforce a default here.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name   text,
  ADD COLUMN IF NOT EXISTS last_name    text,
  ADD COLUMN IF NOT EXISTS display_name text;
