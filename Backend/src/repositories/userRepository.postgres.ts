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
 *
 * RLS CONTEXT NOTES
 * ─────────────────
 * Auth operations (findByEmail, findById, updatePassword) run without a
 * per-clinic context because they are called from auth routes that precede
 * or bypass the rlsTenantContextMiddleware.  These methods use
 * withTenantContext(pool, AUTH_BYPASS_CLINIC_ID, fn, ownerAdmin=true) to
 * explicitly set app_is_owner_admin()=TRUE, which satisfies the RLS SELECT
 * and UPDATE policies without the old NULL-context bypass.
 *
 * Other methods (createUser, listByClinic, getClinicName) are called only
 * from clinic-scoped routes where the pool hook has already injected the
 * correct tenant context — they use pool.query() directly.
 */

import { randomUUID } from "node:crypto";

import type { UserRecord, UserRole } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "../db/tenantContext.js";
import type { DatabasePool } from "../db/pool.js";
import type { CreateUserInput, UpdateUserFields, UserRepository } from "./userRepository.js";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  home_clinic_id: string;
  home_clinic_name: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  payroll_track: string;
  totp_secret: string | null;
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
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    displayName: row.display_name ?? null,
    payrollTrack: row.payroll_track as UserRecord["payrollTrack"],
    totpSecret: row.totp_secret,
    mfaEnabled: row.mfa_enabled,
    isActive: row.is_active,
  };
}

export function createPostgresUserRepository(pool: DatabasePool): UserRepository {
  return {
    async findByEmail(email: string): Promise<UserRecord | null> {
      // Auth lookup: email is globally unique across all clinics.  RLS would
      // block a no-context query after the NULL bypass was removed, so we use
      // owner_admin mode explicitly.  The nil clinic UUID is ignored by RLS
      // when owner_admin_mode=TRUE; it appears in DB audit logs as a signal
      // that this is an auth-path query, not a tenant-scoped data query.
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<UserRow>(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [email.trim().toLowerCase()],
          );
          return rows[0] ? rowToUserRecord(rows[0]) : null;
        },
        true, // ownerAdmin — bypasses tenant clinic_id restriction
      );
    },

    async findById(id: string): Promise<UserRecord | null> {
      // Auth lookup: called from refresh, verifyMfa, and changePassword paths
      // which run on /auth/* routes that have no per-clinic pool context.
      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<UserRow>(
            "SELECT * FROM users WHERE id = $1 LIMIT 1",
            [id],
          );
          return rows[0] ? rowToUserRecord(rows[0]) : null;
        },
        true, // ownerAdmin
      );
    },

    async createUser(input: CreateUserInput): Promise<UserRecord> {
      const id = randomUUID();
      const derivedDisplayName =
        input.displayName ?? `${input.firstName} ${input.lastName}`;
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (
           id, email, password_hash, role,
           home_clinic_id, home_clinic_name,
           first_name, last_name, display_name,
           payroll_track, mfa_enabled, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, true)
         RETURNING *`,
        [
          id,
          input.email.trim().toLowerCase(),
          input.passwordHash,
          input.role,
          input.homeClinicId,
          input.homeClinicName,
          input.firstName,
          input.lastName,
          derivedDisplayName,
          input.payrollTrack ?? "hourly",
        ],
      );

      const row = rows[0];
      if (!row) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to create user");
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

    async setUserMfaEnrollment(userId: string, totpSecret: string): Promise<void> {
      await withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const result = await client.query(
            "UPDATE users SET totp_secret = $1, mfa_enabled = true WHERE id = $2",
            [totpSecret, userId],
          );
          if ((result.rowCount ?? 0) === 0) {
            throw new AppError(
              404,
              "USER_NOT_FOUND",
              `MFA enrollment failed: no user found with id ${userId}`,
            );
          }
        },
        true, // ownerAdmin
      );
    },

    async updateUser(userId: string, fields: UpdateUserFields): Promise<UserRecord> {
      // Build a dynamic SET clause from the provided fields only.
      const sets: string[] = [];
      const values: unknown[] = [];

      if (fields.firstName !== undefined) {
        sets.push(`first_name = $${String(values.length + 1)}`);
        values.push(fields.firstName);
      }
      if (fields.lastName !== undefined) {
        sets.push(`last_name = $${String(values.length + 1)}`);
        values.push(fields.lastName);
      }
      if (fields.displayName !== undefined) {
        sets.push(`display_name = $${String(values.length + 1)}`);
        values.push(fields.displayName);
      }
      if (fields.payrollTrack !== undefined) {
        sets.push(`payroll_track = $${String(values.length + 1)}`);
        values.push(fields.payrollTrack);
      }
      if (fields.role !== undefined) {
        sets.push(`role = $${String(values.length + 1)}`);
        values.push(fields.role);
      }
      if (fields.homeClinicId !== undefined) {
        sets.push(`home_clinic_id = $${String(values.length + 1)}`);
        values.push(fields.homeClinicId);
      }
      if (fields.homeClinicName !== undefined) {
        sets.push(`home_clinic_name = $${String(values.length + 1)}`);
        values.push(fields.homeClinicName);
      }

      if (sets.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one field must be provided");
      }

      values.push(userId);
      const query = `UPDATE users SET ${sets.join(", ")} WHERE id = $${String(values.length)} RETURNING *`;

      return withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const { rows } = await client.query<UserRow>(query, values);
          const row = rows[0];
          if (!row) {
            throw new AppError(404, "NOT_FOUND", "User not found");
          }
          return rowToUserRecord(row);
        },
        true, // ownerAdmin — application layer already validated RBAC
      );
    },

    async updatePassword(userId: string, hashedPassword: string): Promise<void> {
      // Called from two code paths:
      //   1. POST /auth/change-password — user changes own password (no clinic
      //      context on the auth route; pool hook has no context to inject).
      //   2. POST /clinics/:clinicId/users/:userId/reset-password — admin reset
      //      (clinic context IS set, but owner_admin may target any clinic).
      // Using owner_admin mode handles both paths correctly.  The application
      // layer (AuthService / UserService) enforces who may call this operation.
      //
      // rowCount validation: if 0 rows were updated the user does not exist
      // (or was filtered by RLS despite the owner_admin bypass, which should
      // not happen but must not silently succeed).
      await withTenantContext(
        pool,
        AUTH_BYPASS_CLINIC_ID,
        async (client) => {
          const result = await client.query(
            "UPDATE users SET password_hash = $1 WHERE id = $2",
            [hashedPassword, userId],
          );
          if ((result.rowCount ?? 0) === 0) {
            throw new AppError(
              404,
              "USER_NOT_FOUND",
              `Password update failed: no user found with id ${userId}`,
            );
          }
        },
        true, // ownerAdmin
      );
    },
  };
}
