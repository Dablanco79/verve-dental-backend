/**
 * PostgreSQL-backed UserRepository.
 *
 * Implements the same UserRepository interface as the in-memory version so
 * it can be swapped in transparently via createAppDependencies() when a
 * DATABASE_URL is present.
 *
 * Column → field mapping:
 *   password_hash → passwordHash
 *   clinic_id     → clinicId
 *   clinic_name   → clinicName
 *   mfa_enabled   → mfaEnabled
 *   is_active     → isActive
 */

import { randomUUID } from "node:crypto";

import type { UserRecord, UserRole } from "../types/auth.js";
import type { DatabasePool } from "../db/pool.js";
import type { CreateUserInput, UserRepository } from "./userRepository.js";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  home_clinic_id: string;
  home_clinic_name: string;
  mfa_enabled: boolean;
  is_active: boolean;
};

function rowToUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    homeClinicId: row.home_clinic_id,
    homeClinicName: row.home_clinic_name,
    mfaEnabled: row.mfa_enabled,
    isActive: row.is_active,
  };
}

export function createPostgresUserRepository(pool: DatabasePool): UserRepository {
  return {
    async findByEmail(email: string): Promise<UserRecord | null> {
      const { rows } = await pool.query<UserRow>(
        "SELECT * FROM users WHERE email = $1 LIMIT 1",
        [email.trim().toLowerCase()],
      );

      return rows[0] ? rowToUserRecord(rows[0]) : null;
    },

    async findById(id: string): Promise<UserRecord | null> {
      const { rows } = await pool.query<UserRow>(
        "SELECT * FROM users WHERE id = $1 LIMIT 1",
        [id],
      );

      return rows[0] ? rowToUserRecord(rows[0]) : null;
    },

    async createUser(input: CreateUserInput): Promise<UserRecord> {
      const id = randomUUID();
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (id, email, password_hash, role, home_clinic_id, home_clinic_name, mfa_enabled, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, false, true)
         RETURNING *`,
        [
          id,
          input.email.trim().toLowerCase(),
          input.passwordHash,
          input.role,
          input.homeClinicId,
          input.homeClinicName,
        ],
      );

      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create user — no row returned");
      }

      return rowToUserRecord(row);
    },

    async listByClinic(clinicId: string): Promise<UserRecord[]> {
      const { rows } = await pool.query<UserRow>(
        "SELECT * FROM users WHERE home_clinic_id = $1 ORDER BY email",
        [clinicId],
      );

      return rows.map(rowToUserRecord);
    },

    async getClinicName(clinicId: string): Promise<string | null> {
      const { rows } = await pool.query<{ home_clinic_name: string }>(
        "SELECT home_clinic_name FROM users WHERE home_clinic_id = $1 ORDER BY email LIMIT 1",
        [clinicId],
      );
      return rows[0]?.home_clinic_name ?? null;
    },

    async updatePassword(userId: string, hashedPassword: string): Promise<void> {
      await pool.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        [hashedPassword, userId],
      );
    },
  };
}
