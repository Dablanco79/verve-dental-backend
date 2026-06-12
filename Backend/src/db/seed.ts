/**
 * Seed demo users into PostgreSQL on first boot.
 *
 * Runs only when the users table is empty — safe to call on every cold start.
 * Passwords are bcrypt-hashed at runtime; nothing sensitive is hardcoded.
 *
 * MFA is disabled for all seeded accounts because real TOTP is wired in
 * Module 04+. The DEV_MFA_CODE bypass is blocked in production, so leaving
 * mfa_enabled = true would prevent login until TOTP is implemented.
 */

import bcrypt from "bcryptjs";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../repositories/userRepository.js";
import type { UserRole } from "../types/auth.js";
import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "./pool.js";

const DEMO_PASSWORD = "password123";

type DemoUser = {
  id: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
};

const DEMO_USERS: DemoUser[] = [
  {
    id: SEED_USER_IDS.clinicAAdmin,
    email: "admin@clinic-a.au",
    role: "owner_admin",
    clinicId: SEED_CLINIC_A_ID,
    clinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicAManager,
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    clinicId: SEED_CLINIC_A_ID,
    clinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicAStaff,
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    clinicId: SEED_CLINIC_A_ID,
    clinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicBAdmin,
    email: "admin@clinic-b.au",
    role: "owner_admin",
    clinicId: SEED_CLINIC_B_ID,
    clinicName: "Verve Dental Clinic B",
  },
];

export async function seedDemoUsers(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM users",
  );

  const existingCount = parseInt(rows[0]?.count ?? "0", 10);

  if (existingCount > 0) {
    logger.info(
      { userCount: existingCount },
      "Users table already populated — skipping demo seed",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of DEMO_USERS) {
    await pool.query(
      `INSERT INTO users
         (id, email, password_hash, role, clinic_id, clinic_name, mfa_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (id) DO NOTHING`,
      [
        user.id,
        user.email,
        passwordHash,
        user.role,
        user.clinicId,
        user.clinicName,
      ],
    );
  }

  logger.info(
    { count: DEMO_USERS.length },
    "Demo users seeded into PostgreSQL (password: password123, mfa_enabled: false)",
  );
}
