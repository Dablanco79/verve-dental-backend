-- Module 03 hotfix: persist users in PostgreSQL so seed accounts survive redeployment.
-- The in-memory UserRepository is still used as a fallback when DATABASE_URL is absent.
-- Module 13 will add RLS policies and tenant isolation to this table.

CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  role          text        NOT NULL
    CONSTRAINT users_role_check
      CHECK (role IN ('owner_admin', 'group_practice_manager', 'clinical_staff')),
  clinic_id     uuid        NOT NULL,
  clinic_name   text        NOT NULL,
  mfa_enabled   boolean     NOT NULL DEFAULT false,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_clinic_id ON users (clinic_id);
