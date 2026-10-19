/**
 * Production-safe first-admin bootstrap.
 *
 * Creates the first clinic, owner_admin user, and home-clinic assignment in an
 * empty database.
 * Invoked by the `npm run bootstrap:admin` CLI command via runBootstrapAdmin.ts.
 *
 * SAFETY CONSTRAINTS
 * ──────────────────
 * • Refuses to run if any user already exists (idempotency guard).
 * • All inputs come from environment variables — nothing is hardcoded.
 * • Password is hashed with bcrypt at cost 12 before storage.
 * • The password and its hash are never logged.
 * • Clinic, user, and assignment creation run inside a single transaction —
 *   partial state is impossible even if the process is interrupted mid-way.
 * • Uses owner_admin RLS context via withTenantContext — the same pattern
 *   used by the migration seed tooling.
 * • Demo seeding is not affected; this path is independent of seed.ts.
 *
 * REQUIRED ENV VARS (read by resolveBootstrapInput)
 * ──────────────────────────────────────────────────
 * BOOTSTRAP_ADMIN_EMAIL      — email address for the owner_admin account
 * BOOTSTRAP_ADMIN_PASSWORD   — plaintext password (hashed before storage)
 * BOOTSTRAP_CLINIC_NAME      — display name for the first clinic
 * BOOTSTRAP_CLINIC_TIMEZONE  — IANA timezone string (default: Australia/Melbourne)
 *
 * See docs/runbooks/bootstrap-admin.md for the full operator runbook.
 */

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "./tenantContext.js";
import type { DatabasePool } from "./pool.js";
import type { Logger } from "../utils/logger.js";

export const BOOTSTRAP_BCRYPT_ROUNDS = 12;
export const BOOTSTRAP_PASSWORD_MIN_LENGTH = 12;
export const BOOTSTRAP_PASSWORD_MAX_LENGTH = 128;
export const BOOTSTRAP_ADVISORY_LOCK_KEY = 5_432_002n;

export type BootstrapInput = {
  adminEmail: string;
  adminPassword: string;
  clinicName: string;
  clinicTimezone: string;
};

/**
 * Counts all users through the same owner-admin RLS context used by bootstrap.
 * This is used by deployed startup diagnostics; an unscoped count is
 * indistinguishable from an empty table once FORCE RLS is enabled.
 */
export async function countUsersWithOwnerAdminContext(
  pool: DatabasePool,
): Promise<number> {
  return withTenantContext(
    pool,
    AUTH_BYPASS_CLINIC_ID,
    async (client) => {
      const { rows } = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users",
      );
      return parseInt(rows[0]?.count ?? "0", 10);
    },
    true,
  );
}

function assertBootstrapPasswordPolicy(password: string): void {
  if (
    password.length < BOOTSTRAP_PASSWORD_MIN_LENGTH ||
    password.length > BOOTSTRAP_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Bootstrap failed: BOOTSTRAP_ADMIN_PASSWORD must be between ` +
        `${String(BOOTSTRAP_PASSWORD_MIN_LENGTH)} and ` +
        `${String(BOOTSTRAP_PASSWORD_MAX_LENGTH)} characters`,
    );
  }
}

/**
 * Reads and validates bootstrap-specific environment variables.
 *
 * Throws a descriptive error listing every missing required variable.
 * Returns a BootstrapInput ready for bootstrapFirstAdmin().
 *
 * Accepts an `env` parameter for testability without mutating process.env.
 */
export function resolveBootstrapInput(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapInput {
  // Default to empty string so TypeScript knows the type is string (not undefined),
  // letting us return without non-null assertions while still detecting blank values.
  const adminEmail = env["BOOTSTRAP_ADMIN_EMAIL"]?.trim() ?? "";
  const adminPassword = env["BOOTSTRAP_ADMIN_PASSWORD"] ?? "";
  const clinicName = env["BOOTSTRAP_CLINIC_NAME"]?.trim() ?? "";
  const clinicTimezone =
    env["BOOTSTRAP_CLINIC_TIMEZONE"]?.trim() ?? "Australia/Melbourne";

  const missing: string[] = [];
  if (!adminEmail) missing.push("BOOTSTRAP_ADMIN_EMAIL");
  if (!adminPassword) missing.push("BOOTSTRAP_ADMIN_PASSWORD");
  if (!clinicName) missing.push("BOOTSTRAP_CLINIC_NAME");

  if (missing.length > 0) {
    throw new Error(
      `Bootstrap failed: missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  assertBootstrapPasswordPolicy(adminPassword);

  return { adminEmail, adminPassword, clinicName, clinicTimezone };
}

/**
 * Creates the first clinic, owner_admin user, and home-clinic assignment in an
 * empty database.
 *
 * All three INSERTs run inside a single transaction (via withTenantContext).
 * If any INSERT fails, the transaction rolls back automatically and partial
 * state cannot persist.
 *
 * @param pool         Active pg.Pool connected to the target database.
 * @param logger       Pino logger instance.
 * @param input        Validated bootstrap inputs from resolveBootstrapInput.
 * @param bcryptRounds bcrypt cost factor. Override to 1 in unit tests for speed.
 */
export async function bootstrapFirstAdmin(
  pool: DatabasePool,
  logger: Logger,
  input: BootstrapInput,
  bcryptRounds = BOOTSTRAP_BCRYPT_ROUNDS,
): Promise<void> {
  // Validate before opening a database connection so direct callers cannot
  // bypass resolveBootstrapInput() and cause writes with an invalid password.
  assertBootstrapPasswordPolicy(input.adminPassword);

  await withTenantContext(
    pool,
    AUTH_BYPASS_CLINIC_ID,
    async (client) => {
      // Serialize the empty-database check and all first-admin writes. Under
      // READ COMMITTED, two unlocked COUNT-then-INSERT transactions can both
      // observe zero users and create separate owner administrators.
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        BOOTSTRAP_ADVISORY_LOCK_KEY,
      ]);

      // ── Guard: abort if any user already exists ──────────────────────────────
      const { rows: countRows } = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users",
      );
      const userCount = parseInt(countRows[0]?.count ?? "0", 10);

      if (userCount > 0) {
        throw new Error(
          `Bootstrap refused: ${String(userCount)} user(s) already exist in the database. ` +
            "The bootstrap command is only permitted on a database with no users. " +
            "Use the admin interface to manage existing accounts.",
        );
      }

      // ── Create the first clinic ───────────────────────────────────────────────
      const clinicId = randomUUID();

      await client.query(
        `INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
         VALUES ($1, $2, $3, 'standard', true)`,
        [clinicId, input.clinicName, input.clinicTimezone],
      );

      logger.info(
        {
          clinicId,
          clinicName: input.clinicName,
          timezone: input.clinicTimezone,
        },
        "Bootstrap: clinic created",
      );

      // ── Hash password (never stored or logged in plaintext) ───────────────────
      const passwordHash = await bcrypt.hash(input.adminPassword, bcryptRounds);

      // ── Create the owner_admin user ───────────────────────────────────────────
      const userId = randomUUID();
      const normalizedEmail = input.adminEmail.trim().toLowerCase();

      await client.query(
        `INSERT INTO users
           (id, email, password_hash, role, home_clinic_id, home_clinic_name,
            payroll_track, mfa_enabled, is_active)
         VALUES ($1, $2, $3, 'owner_admin', $4, $5, 'hourly', false, true)`,
        [userId, normalizedEmail, passwordHash, clinicId, input.clinicName],
      );

      // Match the membership convention used by normal user creation and the
      // migration 047 backfill: every user's home clinic grants both roster
      // eligibility and operational access.
      await client.query(
        `INSERT INTO user_clinic_assignments
           (user_id, clinic_id, can_roster, can_operate, assigned_at)
         VALUES ($1, $2, true, true, now())
         ON CONFLICT (user_id, clinic_id) DO NOTHING`,
        [userId, clinicId],
      );

      logger.info(
        {
          userId,
          email: normalizedEmail,
          role: "owner_admin",
          clinicId,
          clinicName: input.clinicName,
          mfaEnabled: false,
        },
        "Bootstrap: owner_admin created. MFA enrollment is required on first login.",
      );

      logger.info(
        "Bootstrap complete. Login with the configured credentials and enroll MFA immediately.",
      );
    },
    true, // ownerAdmin — bypass RLS for bootstrap
  );
}
