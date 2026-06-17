import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import type { UserRecord, UserRole } from "../types/auth.js";
import type { StaffPayrollTrack } from "../types/payroll.js";
import { encryptTotpSecret } from "../utils/mfaCrypto.js";

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
  /** Defaults to 'hourly' when not supplied (backward-compat with pre-009 callers). */
  payrollTrack?: StaffPayrollTrack;
};

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  listByClinic(clinicId: string): Promise<UserRecord[]>;
  /**
   * Returns the canonical display name for a clinic, or null when the clinic
   * has no members.  Used by RosterService to derive rostered_clinic_name
   * server-side rather than trusting the client payload.
   */
  getClinicName(clinicId: string): Promise<string | null>;
  updatePassword(userId: string, hashedPassword: string): Promise<void>;
  /**
   * Persists a confirmed TOTP secret and sets mfa_enabled = true atomically.
   * Called only after the user submits a valid first code during enrollment.
   */
  setUserMfaEnrollment(userId: string, totpSecret: string): Promise<void>;
}

export const SEED_CLINIC_A_ID = "11111111-1111-4111-8111-111111111111";
export const SEED_CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Fixed Base32 TOTP secret for the in-memory dev/test admin seed user.
 * Used by tests to generate valid TOTP codes without a real enrollment flow.
 * Never appears in production — Postgres seeds keep mfa_enabled=false and
 * totp_secret=null until a real user enrolls via /auth/mfa/setup.
 */
export const SEED_ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export const SEED_USER_IDS = {
  clinicAAdmin: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clinicAStaff: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  clinicAManager: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  clinicBAdmin: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const DEFAULT_DEV_PASSWORD = "password123";

export async function createInMemoryUserRepository(
  encryptionKey: string,
): Promise<UserRepository> {
  const passwordHash = await bcrypt.hash(DEFAULT_DEV_PASSWORD, 10);

  const users: UserRecord[] = [
    {
      id: SEED_USER_IDS.clinicAAdmin,
      email: "admin@clinic-a.au",
      passwordHash,
      role: "owner_admin",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      payrollTrack: "commission",
      totpSecret: encryptTotpSecret(SEED_ADMIN_TOTP_SECRET, encryptionKey),
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
      payrollTrack: "hourly",
      totpSecret: null,
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
      payrollTrack: "hourly",
      totpSecret: null,
      mfaEnabled: false,
      isActive: true,
    },
    {
      id: SEED_USER_IDS.clinicBAdmin,
      email: "admin@clinic-b.au",
      passwordHash,
      role: "owner_admin",
      homeClinicId: SEED_CLINIC_B_ID,
      homeClinicName: "Verve Dental Clinic B",
      payrollTrack: "commission",
      totpSecret: null,
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
        payrollTrack: input.payrollTrack ?? "hourly",
        totpSecret: null,
        mfaEnabled: false,
        isActive: true,
      };
      users.push(record);
      return Promise.resolve(record);
    },

    listByClinic(clinicId: string): Promise<UserRecord[]> {
      return Promise.resolve(users.filter((u) => u.homeClinicId === clinicId));
    },

    getClinicName(clinicId: string): Promise<string | null> {
      const member = users.find((u) => u.homeClinicId === clinicId);
      return Promise.resolve(member?.homeClinicName ?? null);
    },

    updatePassword(userId: string, hashedPassword: string): Promise<void> {
      const user = users.find((u) => u.id === userId);
      if (user) {
        user.passwordHash = hashedPassword;
      }
      return Promise.resolve();
    },

    setUserMfaEnrollment(userId: string, totpSecret: string): Promise<void> {
      const user = users.find((u) => u.id === userId);
      if (user) {
        user.totpSecret = totpSecret;
        user.mfaEnabled = true;
      }
      return Promise.resolve();
    },
  };
}
