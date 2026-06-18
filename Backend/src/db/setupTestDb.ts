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

  // Create a non-superuser application role used by RLS integration tests.
  //
  // The GitHub Actions postgres service creates POSTGRES_USER as a PostgreSQL
  // superuser by default.  Superusers bypass ALL row-level security — including
  // FORCE ROW LEVEL SECURITY — so tests that assert RLS enforcement (no-context
  // SELECT returns 0, DELETE blocked on append-only tables, cross-clinic
  // isolation) would silently pass or fail for the wrong reasons.
  //
  // The integration tests use SET LOCAL ROLE verve_app within their transactions
  // to run assertions as this non-superuser role so that FORCE RLS is exercised.
  // The role is non-login (connection is still made as the superuser; SET ROLE
  // is used only within test transactions).
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verve_app') THEN
        CREATE ROLE verve_app
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
      END IF;
    END
    $$
  `);

  // Grant table-level DML so verve_app can actually run queries — RLS policies
  // then enforce the per-clinic row restrictions on top of this access.
  await pool.query(
    "GRANT USAGE ON SCHEMA public TO verve_app",
  );
  await pool.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO verve_app",
  );
  await pool.query(
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO verve_app",
  );

  logger.info(
    "verve_app role created/verified — non-superuser role for RLS integration tests",
  );
  logger.info("Test database ready — all migrations applied and demo data seeded");
} finally {
  await pool.end().catch(() => undefined);
}
