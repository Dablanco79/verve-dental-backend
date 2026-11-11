-- Additive first-login credential state.
--
-- Existing users deliberately remain unaffected. Only accounts created or
-- reset through the updated application are marked as requiring a password
-- change. Any one-time Production backfill must be separately reviewed.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
