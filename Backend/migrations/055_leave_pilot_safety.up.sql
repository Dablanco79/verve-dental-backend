-- Migration 055: Workforce pilot leave safety.
--
-- start_date and end_date are authoritative for whole-day leave. Existing
-- inconsistent rows are never rewritten: the migration fails before adding
-- the constraint so an operator can review them explicitly.

DO $$
DECLARE
  invalid_count integer;
  sample_ids text;
BEGIN
  SELECT COUNT(*)
    INTO invalid_count
    FROM leave_requests
   WHERE total_days <> (end_date - start_date + 1)::numeric
      OR total_days <> trunc(total_days);

  SELECT string_agg(id::text, ', ' ORDER BY id::text)
    INTO sample_ids
    FROM (
      SELECT id
        FROM leave_requests
       WHERE total_days <> (end_date - start_date + 1)::numeric
          OR total_days <> trunc(total_days)
       ORDER BY id
       LIMIT 10
    ) invalid;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Migration 055 blocked: % fractional/inconsistent leave_requests rows exist (sample IDs: %). No rows were modified.',
      invalid_count,
      sample_ids;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'leave_requests_whole_day_count'
       AND conrelid = 'leave_requests'::regclass
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_whole_day_count
      CHECK (
        total_days = trunc(total_days)
        AND total_days = (end_date - start_date + 1)::numeric
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leave_requests_staff_approved_range
  ON leave_requests (staff_user_id, start_date, end_date)
  WHERE status = 'approved';
