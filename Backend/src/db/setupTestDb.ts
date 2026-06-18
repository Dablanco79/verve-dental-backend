/**
 * CI test-database setup script.
 *
 * Applies all bootstrap migrations and seeds demo data into a fresh PostgreSQL
 * database.  Called by the integration-test workflow before running the test
 * suite so that rlsIsolation.test.ts and other database-backed tests find the
 * schema and seed fixtures they expect.
 *
 * All operations are idempotent — safe to run repeatedly against an already-
 * initialised database.
 *
 * Usage (integration workflow):
 *   DATABASE_URL=... NODE_ENV=test npm run test:db:setup --workspace=@verve/backend
 */

import "dotenv/config";

import { loadConfig } from "../config/index.js";
import { createDatabasePool } from "./pool.js";
import { createLogger } from "../utils/logger.js";
import { runBootstrapMigrations } from "./migrate.js";
import { seedClinics, seedDemoUsers, seedInventory } from "./seed.js";

const config = loadConfig();
const logger = createLogger(config);
const pool = createDatabasePool(config);

if (!pool) {
  logger.error(
    "DATABASE_URL is required to set up the test database — set it in the environment",
  );
  process.exit(1);
}

try {
  await runBootstrapMigrations(pool, logger, {
    nodeEnv: config.NODE_ENV,
    migrateOnStartup: true,
  });

  await seedClinics(pool, logger);
  await seedDemoUsers(pool, logger, config.NODE_ENV);
  await seedInventory(pool, logger);

  logger.info("Test database ready — all migrations applied and demo data seeded");
} finally {
  await pool.end().catch(() => undefined);
}
