DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM leave_cancellation_requests LIMIT 1) THEN
    RAISE EXCEPTION 'Migration 057 rollback refused: leave_cancellation_requests contains rows';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM leave_requests
     WHERE cancellation_self_review_exception_used = true
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Migration 057 rollback refused: leave_requests contains sole-review exception history';
  END IF;
END
$$;

DROP TABLE IF EXISTS leave_cancellation_requests;
DROP TYPE IF EXISTS leave_cancellation_request_status;
ALTER TABLE leave_requests
  DROP COLUMN IF EXISTS cancellation_self_review_exception_used;
