-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 — Commission log verification-gate CHECK constraint
--
-- Adds a structural backstop that prevents any code path (current or future)
-- from inserting or updating a commission_log row into a verified attendance
-- status (present / absent / sick) without a manager approval audit trail.
--
-- IDEMPOTENCY: Uses a DO block with a pg_constraint existence check instead
-- of the non-standard `ADD CONSTRAINT IF NOT EXISTS` syntax, which is not
-- valid in PostgreSQL.  Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_log_verification_gate'
  ) THEN
    ALTER TABLE timesheet_entries
    ADD CONSTRAINT commission_log_verification_gate
    CHECK (
      payroll_type <> 'commission_log'
      OR attendance_status IN ('pending_verification', 'cancelled')
      OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    );
  END IF;
END $$;
