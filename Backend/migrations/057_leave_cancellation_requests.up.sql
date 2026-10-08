DO $$ BEGIN
  CREATE TYPE leave_cancellation_request_status AS ENUM ('pending', 'approved', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS cancellation_self_review_exception_used boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS leave_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  staff_user_id uuid NOT NULL REFERENCES users(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  request_reason text NOT NULL CHECK (btrim(request_reason) <> ''),
  status leave_cancellation_request_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_notes text,
  self_review_exception_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_cancellation_requests_requester_is_staff
    CHECK (requested_by_user_id = staff_user_id),
  CONSTRAINT leave_cancellation_requests_review_state_valid
    CHECK (
      (
        status = 'pending'
        AND reviewed_by_user_id IS NULL
        AND reviewed_at IS NULL
        AND review_notes IS NULL
        AND self_review_exception_used = false
      )
      OR
      (
        status IN ('approved', 'declined')
        AND reviewed_by_user_id IS NOT NULL
        AND reviewed_at IS NOT NULL
      )
    ),
  CONSTRAINT leave_cancellation_requests_decline_notes_required
    CHECK (
      status <> 'declined'
      OR (review_notes IS NOT NULL AND btrim(review_notes) <> '')
    ),
  CONSTRAINT leave_cancellation_requests_self_review_exception_valid
    CHECK (
      self_review_exception_used = false
      OR reviewed_by_user_id = staff_user_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_cancellation_requests_one_pending_per_leave
  ON leave_cancellation_requests (leave_request_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_cancellation_requests_clinic_pending_idx
  ON leave_cancellation_requests (clinic_id, requested_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_cancellation_requests_staff_idx
  ON leave_cancellation_requests (staff_user_id, requested_at DESC);

ALTER TABLE leave_cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_cancellation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_leave_cancellation_requests_tenant ON leave_cancellation_requests;
CREATE POLICY rls_leave_cancellation_requests_tenant ON leave_cancellation_requests
  FOR ALL
  USING (
    app_is_owner_admin()
    OR (
      clinic_id = app_current_clinic_id()
      AND app_current_user_id() <> ''
      AND staff_user_id::text = app_current_user_id()
    )
  )
  WITH CHECK (
    app_is_owner_admin()
    OR (
      clinic_id = app_current_clinic_id()
      AND app_current_user_id() <> ''
      AND staff_user_id::text = app_current_user_id()
    )
  );
