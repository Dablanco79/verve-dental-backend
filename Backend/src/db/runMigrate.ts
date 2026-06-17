/**
 * Standalone migration CLI.
 *
 * Run via:  npm run migrate
 *
 * Unlike the normal app startup path (which blocks in staging/production when
 * pending migrations exist), this script ALWAYS applies pending migrations.
 * This is the deliberate operator opt-in required before deploying schema
 * changes to staging or production.
 *
 * Usage:
 *   npm run migrate               # apply pending migrations with current env
 *   NODE_ENV=staging npm run migrate
 */

import "dotenv/config";

import { loadConfig } from "../config/index.js";
import { createDatabasePool } from "./pool.js";
import { createLogger } from "../utils/logger.js";
import { runBootstrapMigrations } from "./migrate.js";

const config = loadConfig();
const logger = createLogger(config);

const pool = createDatabasePool(config);

if (!pool) {
  logger.error(
    "DATABASE_URL is required to run migrations — set it in the environment",
  );
  process.exit(1);
}

try {
  await runBootstrapMigrations(pool, logger, {
    nodeEnv: config.NODE_ENV,
    migrateOnStartup: true,
  });
  logger.info("All migrations applied successfully");
} finally {
  await pool.end().catch(() => undefined);
}
