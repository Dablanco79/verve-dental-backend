-- Migration 046: user_clinic_assignments
-- Establishes the many-to-many relationship between users and clinics that
-- separates three previously conflated concepts:
--
--   A. Home clinic   → still represented by users.clinic_id (unchanged)
--   B. Roster eligibility → can_roster = true rows in this table
--   C. Operational access → can_operate = true rows in this table
--
-- Backfill: every existing user receives one row for their home clinic with
--   can_roster=true, can_operate=true  (no change in current behaviour).
--
-- Users.clinic_id is deliberately NOT removed. It remains the canonical
-- payroll/home clinic reference for Timesheets, JWT context, and existing
-- single-clinic RBAC. This table ADDS multi-clinic assignment on top of it.

CREATE TABLE IF NOT EXISTS user_clinic_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id           uuid        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- can_roster: the user may be scheduled to work at this clinic.
  -- Does NOT grant operational module access (Inventory, Procurement, etc.).
  can_roster          boolean     NOT NULL DEFAULT true,
  -- can_operate: the user may access clinic-scoped operational modules at
  -- this clinic (Inventory, Purchasing, Timesheets, etc.).
  -- For owner_admin this is derived from role, not rows in this table.
  can_operate         boolean     NOT NULL DEFAULT false,
  assigned_by_user_id uuid        REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_clinic_assignments_unique UNIQUE (user_id, clinic_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary lookup: all assignments for a user.
CREATE INDEX IF NOT EXISTS idx_uca_user_id
  ON user_clinic_assignments (user_id);

-- Reverse lookup: all users assigned to a clinic.
CREATE INDEX IF NOT EXISTS idx_uca_clinic_id
  ON user_clinic_assignments (clinic_id);

-- Filtered: roster-eligible users for a clinic (Add Shift staff picker).
CREATE INDEX IF NOT EXISTS idx_uca_clinic_roster
  ON user_clinic_assignments (clinic_id, can_roster)
  WHERE can_roster = true;

-- Filtered: operationally-permitted clinics for a user (GPM clinic selector).
CREATE INDEX IF NOT EXISTS idx_uca_user_operate
  ON user_clinic_assignments (user_id, can_operate)
  WHERE can_operate = true;

-- Filtered: roster-eligible clinics for a user (My Roster cross-clinic).
CREATE INDEX IF NOT EXISTS idx_uca_user_roster
  ON user_clinic_assignments (user_id, can_roster)
  WHERE can_roster = true;

-- Filtered: operationally-permitted users at a clinic.
CREATE INDEX IF NOT EXISTS idx_uca_clinic_operate
  ON user_clinic_assignments (clinic_id, can_operate)
  WHERE can_operate = true;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every existing user's home clinic becomes their first roster-eligible AND
-- operational clinic. This preserves all existing behaviour unchanged.
-- ON CONFLICT DO NOTHING ensures the migration is safe to re-run (idempotent).
--
-- SET LOCAL enables owner_admin RLS bypass so the SELECT can read all users rows.
-- This is transaction-local: automatically reverted on COMMIT.
-- The migration runner wraps each migration in BEGIN/COMMIT.

SET LOCAL app.owner_admin_mode = 'true';
SET LOCAL app.current_clinic_id = '00000000-0000-0000-0000-000000000000';

INSERT INTO user_clinic_assignments (user_id, clinic_id, can_roster, can_operate, assigned_at)
SELECT id, home_clinic_id, true, true, now()
FROM users
ON CONFLICT (user_id, clinic_id) DO NOTHING;

SET LOCAL app.owner_admin_mode = 'false';
