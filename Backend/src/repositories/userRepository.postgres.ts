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

import type { UserRecord, UserRole } from "../types/auth.js";
import type { DatabasePool } from "../db/pool.js";
import type { UserRepository } from "./userRepository.js";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  clinic_id: string;
  clinic_name: string;
  mfa_enabled: boolean;
  is_active: boolean;
};

function rowToUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
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
  };
}
