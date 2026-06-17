import type { AuthUser } from "../../src/types/index.js";

export const TEST_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_CLINIC_NAME = "Verve Dental Clinic A";

export function createStaffUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
    ...overrides,
  };
}

export function createManagerUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
    ...overrides,
  };
}
