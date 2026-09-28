-- Migration 052 — Backfill module permission grants for existing active users.
--
-- GPM users receive all 8 pilot module grants.
-- clinical_staff users receive the 3 default module grants.
-- owner_admin users receive no rows (inherent via ALL_PERMISSIONS in DEFAULT_PERMISSIONS).
-- Uses a DO block so it can be re-run safely (INSERT ... ON CONFLICT DO NOTHING).

DO $$
DECLARE
  admin_id uuid;
BEGIN
  -- Use the first active owner_admin as the granted_by actor.
  SELECT id INTO admin_id
    FROM users
    WHERE role = 'owner_admin' AND is_active = TRUE
    LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE NOTICE 'No active owner_admin found — skipping module permission backfill';
    RETURN;
  END IF;

  -- Grant all 8 modules to every active group_practice_manager.
  INSERT INTO user_permission_grants (clinic_id, user_id, permission, granted_by)
    SELECT u.home_clinic_id,
           u.id,
           perm.permission,
           admin_id
      FROM users u
      CROSS JOIN (VALUES
        ('module:timesheets'),
        ('module:roster'),
        ('module:leave'),
        ('module:inventory'),
        ('module:stocktakes'),
        ('module:procurement'),
        ('module:receiving'),
        ('module:reports')
      ) AS perm(permission)
      WHERE u.role = 'group_practice_manager'
        AND u.is_active = TRUE
    ON CONFLICT DO NOTHING;

  -- Grant 3 default modules to every active clinical_staff.
  INSERT INTO user_permission_grants (clinic_id, user_id, permission, granted_by)
    SELECT u.home_clinic_id,
           u.id,
           perm.permission,
           admin_id
      FROM users u
      CROSS JOIN (VALUES
        ('module:timesheets'),
        ('module:roster'),
        ('module:leave')
      ) AS perm(permission)
      WHERE u.role = 'clinical_staff'
        AND u.is_active = TRUE
    ON CONFLICT DO NOTHING;
END $$;
