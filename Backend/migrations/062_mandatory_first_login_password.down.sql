-- Application rollback does not require removing this additive column.
-- Run only after confirming no deployed code depends on first-login state.
ALTER TABLE users
  DROP COLUMN IF EXISTS must_change_password;
