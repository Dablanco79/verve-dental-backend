/**
 * CLI entry point for the production first-admin bootstrap.
 *
 * Run via:  npm run bootstrap:admin
 *
 * This script creates the first clinic and owner_admin user in an empty
 * production database.  It is a one-time operator action — not part of
 * normal application startup.
 *
 * Required env vars (set in .env or export in the shell):
 *   BOOTSTRAP_ADMIN_EMAIL      — email for the first owner_admin account
 *   BOOTSTRAP_ADMIN_PASSWORD   — password (hashed with bcrypt cost 12)
 *   BOOTSTRAP_CLINIC_NAME      — display name for the first clinic
 *   BOOTSTRAP_CLINIC_TIMEZONE  — IANA timezone (default: Australia/Melbourne)
 *
 * Also requires the standard server env vars:
 *   DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, MFA_ENCRYPTION_KEY, …
 *
 * Safety:
 *   • Refuses to run if any user already exists.
 *   • Never logs the password or its hash.
 *   • Exits with code 1 on any error.
 *
 * See docs/runbooks/bootstrap-admin.md for the full operator runbook.
 */

import "dotenv/config";

import { loadConfig } from "../config/index.js";
import { createDatabasePool } from "./pool.js";
import { createLogger } from "../utils/logger.js";
import {
  bootstrapFirstAdmin,
  resolveBootstrapInput,
} from "./bootstrapAdmin.js";

const config = loadConfig();
const logger = createLogger(config);

let input;
try {
  input = resolveBootstrapInput(process.env);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  // Use console.error here — pino logger is not yet verified reachable.
  console.error(`[bootstrap] ${message}`);
  process.exit(1);
}

const pool = createDatabasePool(config);

if (!pool) {
  logger.error(
    "DATABASE_URL is required to run bootstrap — set it in the environment",
  );
  process.exit(1);
}

try {
  await bootstrapFirstAdmin(pool, logger, input);
} catch (err) {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
} finally {
  await pool.end().catch(() => undefined);
}
