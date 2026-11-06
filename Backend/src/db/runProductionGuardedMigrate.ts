/**
 * Production-only guarded migration CLI.
 *
 * The expected database identity is supplied temporarily through:
 *   PRODUCTION_MIGRATION_EXPECTED_DATABASE_NAME
 *   PRODUCTION_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER
 *
 * Usage:
 *   npm run migrate:production-guarded -- apply
 *   npm run migrate:production-guarded -- verify
 */

import "dotenv/config";

import { loadConfig } from "../config/index.js";
import { createLogger } from "../utils/logger.js";
import { createDatabasePool } from "./pool.js";
import {
  runProductionGuardedMigration,
  type ProductionMigrationGuardMode,
} from "./productionMigrationGuard.js";

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[Migration Guard] Required temporary environment setting ${name} is missing.`,
    );
  }
  return value;
}

const requestedMode = process.argv[2];
if (requestedMode !== "apply" && requestedMode !== "verify") {
  throw new Error(
    "[Migration Guard] Pass exactly one mode: apply or verify.",
  );
}
const mode: ProductionMigrationGuardMode = requestedMode;

const config = loadConfig();
if (config.NODE_ENV !== "production") {
  throw new Error(
    "[Migration Guard] NODE_ENV must be production for guarded migration execution.",
  );
}

const identity = {
  databaseName: requiredEnvironmentValue(
    "PRODUCTION_MIGRATION_EXPECTED_DATABASE_NAME",
  ),
  systemIdentifier: requiredEnvironmentValue(
    "PRODUCTION_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER",
  ),
};

const logger = createLogger(config);
const pool = createDatabasePool(config);
if (!pool) {
  throw new Error(
    "[Migration Guard] DATABASE_URL is required for guarded migration execution.",
  );
}

try {
  await runProductionGuardedMigration(pool, logger, mode, identity);
  logger.info(
    { mode },
    mode === "apply"
      ? "Guarded Production migrations applied successfully"
      : "Guarded Production migration verification completed successfully",
  );
} finally {
  await pool.end().catch(() => undefined);
}
