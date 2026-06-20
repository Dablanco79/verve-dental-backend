/**
 * Production-safe first-admin bootstrap.
 *
 * Creates the first clinic and owner_admin user in an empty database.
 * Invoked by the `npm run bootstrap:admin` CLI command via runBootstrapAdmin.ts.
 *
 * SAFETY CONSTRAINTS
 * ──────────────────
 * • Refuses to run if any user already exists (idempotency guard).
 * • All inputs come from environment variables — nothing is hardcoded.
 * • Password is hashed with bcrypt at cost 12 before storage.
 * • The password and its hash are never logged.
 * • Clinic and user creation run inside a single transaction — partial state
 *   is impossible even if the process is interrupted mid-way.
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

export type BootstrapInput = {
  adminEmail: string;
  adminPassword: string;
  clinicName: string;
  clinicTimezone: string;
};

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

  return { adminEmail, adminPassword, clinicName, clinicTimezone };
}

/**
 * Creates the first clinic and owner_admin user in an empty database.
 *
 * Both INSERTs run inside a single transaction (via withTenantContext).
 * If either INSERT fails, the transaction rolls back automatically —
 * partial state cannot persist.
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
  await withTenantContext(
    pool,
    AUTH_BYPASS_CLINIC_ID,
    async (client) => {
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
