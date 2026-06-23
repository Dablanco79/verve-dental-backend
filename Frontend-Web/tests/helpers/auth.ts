import type { AuthUser } from "../../src/types/index.js";

export const TEST_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_CLINIC_NAME = "Verve Dental Clinic A";

export const TEST_CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";
export const TEST_CLINIC_B_NAME = "Verve Dental Clinic B";

export function createStaffUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
    firstName: null,
    lastName: null,
    displayName: null,
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
    firstName: null,
    lastName: null,
    displayName: null,
    ...overrides,
  };
}

export function createAdminUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "admin@clinic-a.au",
    role: "owner_admin",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
    firstName: null,
    lastName: null,
    displayName: null,
    ...overrides,
  };
}
