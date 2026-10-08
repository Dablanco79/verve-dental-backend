ALTER TYPE leave_request_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'leave_requests_cancellation_reason_nonblank'
       AND conrelid = 'leave_requests'::regclass
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_cancellation_reason_nonblank
      CHECK (
        cancellation_reason IS NULL
        OR btrim(cancellation_reason) <> ''
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'leave_requests_cancellation_metadata_complete'
       AND conrelid = 'leave_requests'::regclass
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_cancellation_metadata_complete
      CHECK (
        (
          cancelled_by_user_id IS NULL
          AND cancelled_at IS NULL
          AND cancellation_reason IS NULL
        )
        OR
        (
          cancelled_by_user_id IS NOT NULL
          AND cancelled_at IS NOT NULL
          AND cancellation_reason IS NOT NULL
        )
      );
  END IF;
END
$$;
