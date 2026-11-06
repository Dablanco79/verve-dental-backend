DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM coverage_group_members LIMIT 1)
     OR EXISTS (SELECT 1 FROM coverage_groups LIMIT 1) THEN
    RAISE EXCEPTION 'Migration 060 rollback refused: coverage groups or members exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM clinics
     WHERE leave_overlap_warnings_enabled = true
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Migration 060 rollback refused: a clinic has leave overlap warnings enabled';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS user_assignment_remove_coverage_members
  ON user_clinic_assignments;
DROP FUNCTION IF EXISTS remove_ineligible_coverage_group_members();
DROP TRIGGER IF EXISTS coverage_group_member_roster_eligibility
  ON coverage_group_members;
DROP FUNCTION IF EXISTS validate_coverage_group_member_roster_eligibility();
DROP TABLE IF EXISTS coverage_group_members;
DROP TABLE IF EXISTS coverage_groups;
ALTER TABLE clinics
  DROP COLUMN IF EXISTS leave_overlap_warnings_enabled;
