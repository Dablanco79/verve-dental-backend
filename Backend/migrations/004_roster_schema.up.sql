-- Module 04: Roster entries schema.
-- Creates the roster_entries and roster_entry_audit tables and the
-- performance indexes required for the access patterns used in Module 04.

CREATE TABLE IF NOT EXISTS roster_entries (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id        uuid        NOT NULL,
  staff_email          text        NOT NULL,
  rostered_clinic_id   uuid        NOT NULL,
  rostered_clinic_name text        NOT NULL,
  shift_start_at       timestamptz NOT NULL,
  shift_end_at         timestamptz NOT NULL,
  shift_type           text        NOT NULL DEFAULT 'standard'
    CONSTRAINT roster_entries_shift_type_check
      CHECK (shift_type IN ('standard', 'overtime', 'on_call', 'training')),
  status               text        NOT NULL DEFAULT 'scheduled'
    CONSTRAINT roster_entries_status_check
      CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled')),
  notes                text,
  created_by_user_id   uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_entries_shift_order_check
    CHECK (shift_end_at > shift_start_at)
);

CREATE TABLE IF NOT EXISTS roster_entry_audit (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_entry_id     uuid        NOT NULL REFERENCES roster_entries (id),
  changed_by_user_id  uuid        NOT NULL,
  changed_by_email    text        NOT NULL,
  action              text        NOT NULL
    CONSTRAINT roster_entry_audit_action_check
      CHECK (action IN ('created', 'updated', 'cancelled')),
  snapshot            jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Core lookup indexes ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_roster_entries_rostered_clinic_id
  ON roster_entries (rostered_clinic_id);

CREATE INDEX IF NOT EXISTS idx_roster_entries_staff_user_id
  ON roster_entries (staff_user_id);

CREATE INDEX IF NOT EXISTS idx_roster_entry_audit_roster_entry_id
  ON roster_entry_audit (roster_entry_id);

-- ── Performance indexes for Module 04 access patterns ──────────────────────

-- Partial index: active shifts per staff member at a clinic.
-- Used by hasActiveShiftAtClinic and the tenant-scoped listByClinic path.
CREATE INDEX IF NOT EXISTS idx_roster_entries_active_staff_clinic
  ON roster_entries (staff_user_id, rostered_clinic_id)
  WHERE status <> 'cancelled';

-- Covering index: staff + clinic + shift start for date-window queries.
-- Supports getMyShifts / listByStaff with date filters.
CREATE INDEX IF NOT EXISTS idx_roster_entries_staff_clinic_start
  ON roster_entries (staff_user_id, rostered_clinic_id, shift_start_at);
