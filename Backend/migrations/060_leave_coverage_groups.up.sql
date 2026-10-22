ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS leave_overlap_warnings_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS coverage_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_groups_id_clinic_unique UNIQUE (id, clinic_id),
  CONSTRAINT coverage_groups_clinic_name_unique UNIQUE (clinic_id, name)
);

CREATE TABLE IF NOT EXISTS coverage_group_members (
  group_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT coverage_group_members_group_clinic_fk
    FOREIGN KEY (group_id, clinic_id)
    REFERENCES coverage_groups(id, clinic_id) ON DELETE CASCADE,
  CONSTRAINT coverage_group_members_assignment_fk
    FOREIGN KEY (user_id, clinic_id)
    REFERENCES user_clinic_assignments(user_id, clinic_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS coverage_groups_clinic_idx
  ON coverage_groups (clinic_id, name, id);
CREATE INDEX IF NOT EXISTS coverage_group_members_clinic_user_idx
  ON coverage_group_members (clinic_id, user_id, group_id);

CREATE OR REPLACE FUNCTION validate_coverage_group_member_roster_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_clinic_assignments
     WHERE user_id = NEW.user_id
       AND clinic_id = NEW.clinic_id
       AND can_roster = true
  ) THEN
    RAISE EXCEPTION 'Coverage group member must have can_roster=true for the clinic'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS coverage_group_member_roster_eligibility ON coverage_group_members;
CREATE TRIGGER coverage_group_member_roster_eligibility
BEFORE INSERT OR UPDATE OF user_id, clinic_id ON coverage_group_members
FOR EACH ROW EXECUTE FUNCTION validate_coverage_group_member_roster_eligibility();

CREATE OR REPLACE FUNCTION remove_ineligible_coverage_group_members()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.can_roster = true AND NEW.can_roster = false THEN
    DELETE FROM coverage_group_members
     WHERE user_id = NEW.user_id AND clinic_id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS user_assignment_remove_coverage_members ON user_clinic_assignments;
CREATE TRIGGER user_assignment_remove_coverage_members
AFTER UPDATE OF can_roster ON user_clinic_assignments
FOR EACH ROW EXECUTE FUNCTION remove_ineligible_coverage_group_members();

ALTER TABLE coverage_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coverage_groups_tenant ON coverage_groups;
CREATE POLICY rls_coverage_groups_tenant ON coverage_groups FOR ALL
  USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
  WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());

ALTER TABLE coverage_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_group_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coverage_group_members_tenant ON coverage_group_members;
CREATE POLICY rls_coverage_group_members_tenant ON coverage_group_members FOR ALL
  USING (app_is_owner_admin() OR clinic_id = app_current_clinic_id())
  WITH CHECK (app_is_owner_admin() OR clinic_id = app_current_clinic_id());
