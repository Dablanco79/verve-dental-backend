ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_cancellation_metadata_complete,
  DROP CONSTRAINT IF EXISTS leave_requests_cancellation_reason_nonblank,
  DROP COLUMN IF EXISTS cancellation_reason,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_by_user_id;

-- PostgreSQL enum values cannot be safely removed in-place. The additive
-- 'cancelled' value intentionally remains during rollback.
