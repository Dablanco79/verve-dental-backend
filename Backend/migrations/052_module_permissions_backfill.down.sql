-- Reverse migration: remove all module:* grants added by migration 052.
-- This removes ALL module:* grants, not just those created by the backfill,
-- so it should only be run in development/test environments.
DELETE FROM user_permission_grants
  WHERE permission LIKE 'module:%';
