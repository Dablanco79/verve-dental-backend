import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import type { UserRecord, UserRole } from "../types/auth.js";

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
};

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  listByClinic(clinicId: string): Promise<UserRecord[]>;
  updatePassword(userId: string, hashedPassword: string): Promise<void>;
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
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      mfaEnabled: true,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicAStaff,
      email: "staff@clinic-a.au",
      passwordHash,
      role: "clinical_staff",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      mfaEnabled: false,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicAManager,
      email: "manager@clinic-a.au",
      passwordHash,
      role: "group_practice_manager",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      mfaEnabled: true,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicBAdmin,
      email: "admin@clinic-b.au",
      passwordHash,
      role: "owner_admin",
      homeClinicId: SEED_CLINIC_B_ID,
      homeClinicName: "Verve Dental Clinic B",
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

    createUser(input: CreateUserInput): Promise<UserRecord> {
      const record: UserRecord = {
        id: randomUUID(),
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        homeClinicId: input.homeClinicId,
        homeClinicName: input.homeClinicName,
        mfaEnabled: false,
        isActive: true,
      };
      users.push(record);
      return Promise.resolve(record);
    },

    listByClinic(clinicId: string): Promise<UserRecord[]> {
      return Promise.resolve(users.filter((u) => u.homeClinicId === clinicId));
    },

    updatePassword(userId: string, hashedPassword: string): Promise<void> {
      const user = users.find((u) => u.id === userId);
      if (user) {
        user.passwordHash = hashedPassword;
      }
      return Promise.resolve();
    },
  };
}
