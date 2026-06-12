import bcrypt from "bcryptjs";

import type { UserRecord } from "../types/auth.js";

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export const SEED_CLINIC_A_ID = "11111111-1111-4111-8111-111111111111";
export const SEED_CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";

export const SEED_USER_IDS = {
  clinicAAdmin: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clinicAStaff: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  clinicAManager: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  clinicBAdmin: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const DEFAULT_DEV_PASSWORD = "password123";

export async function createInMemoryUserRepository(): Promise<UserRepository> {
  const passwordHash = await bcrypt.hash(DEFAULT_DEV_PASSWORD, 10);

  const users: UserRecord[] = [
    {
      id: SEED_USER_IDS.clinicAAdmin,
      email: "admin@clinic-a.au",
      passwordHash,
      role: "owner_admin",
      clinicId: SEED_CLINIC_A_ID,
      clinicName: "Verve Dental Clinic A",
      mfaEnabled: true,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicAStaff,
      email: "staff@clinic-a.au",
      passwordHash,
      role: "clinical_staff",
      clinicId: SEED_CLINIC_A_ID,
      clinicName: "Verve Dental Clinic A",
      mfaEnabled: false,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicAManager,
      email: "manager@clinic-a.au",
      passwordHash,
      role: "group_practice_manager",
      clinicId: SEED_CLINIC_A_ID,
      clinicName: "Verve Dental Clinic A",
      mfaEnabled: true,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicBAdmin,
      email: "admin@clinic-b.au",
      passwordHash,
      role: "owner_admin",
      clinicId: SEED_CLINIC_B_ID,
      clinicName: "Verve Dental Clinic B",
      mfaEnabled: false,
      isActive: true,
    },
  ];

  return {
    findByEmail(email: string): Promise<UserRecord | null> {
      const normalized = email.trim().toLowerCase();
      return Promise.resolve(users.find((user) => user.email === normalized) ?? null);
    },

    findById(id: string): Promise<UserRecord | null> {
      return Promise.resolve(users.find((user) => user.id === id) ?? null);
    },
  };
}
