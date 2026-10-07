DROP INDEX IF EXISTS idx_leave_requests_staff_approved_range;

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_whole_day_count;
