/**
 * Lightweight bootstrap migration runner.
 *
 * Applies only the core tables needed for the app to start (auth/users).
 * Full schema migrations (inventory, RLS policies, etc.) are managed via the
 * migrations/ SQL files and will be wired into a proper CLI runner in Module 13.
 *
 * Each entry is idempotent — safe to run on every cold start.
 */

import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "./pool.js";

type BootstrapMigration = {
  id: string;
  sql: string;
};

const BOOTSTRAP_MIGRATIONS: BootstrapMigration[] = [
  {
    /**
     * Creates the users table with home_clinic_id / home_clinic_name columns.
     * "home clinic" is the user's payroll/contract location.
     * It is distinct from the rostered_clinic_id that Roster/Timesheet records
     * will carry when a staff member works at a different location on a given day.
     */
    id: "003_users_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        email            text        NOT NULL UNIQUE,
        password_hash    text        NOT NULL,
        role             text        NOT NULL
          CONSTRAINT users_role_check
            CHECK (role IN ('owner_admin', 'group_practice_manager', 'clinical_staff')),
        home_clinic_id   uuid        NOT NULL,
        home_clinic_name text        NOT NULL,
        mfa_enabled      boolean     NOT NULL DEFAULT false,
        is_active        boolean     NOT NULL DEFAULT true,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email          ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_home_clinic_id ON users (home_clinic_id);
    `,
  },
  {
    /**
     * Renames clinic_id → home_clinic_id and clinic_name → home_clinic_name on
     * existing databases that ran the original 003_users_schema migration.
     * Idempotent: column_name check guards against re-running.
     */
    id: "004_rename_clinic_to_home_clinic",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'clinic_id'
        ) THEN
          ALTER TABLE users RENAME COLUMN clinic_id   TO home_clinic_id;
          ALTER TABLE users RENAME COLUMN clinic_name TO home_clinic_name;

          -- Re-create the index under the new column name.
          DROP INDEX IF EXISTS idx_users_clinic_id;
          CREATE INDEX IF NOT EXISTS idx_users_home_clinic_id ON users (home_clinic_id);
        END IF;
      END
      $$;
    `,
  },
];

export async function runBootstrapMigrations(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of BOOTSTRAP_MIGRATIONS) {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id],
    );

    if (rows.length > 0) {
      continue;
    }

    await pool.query(migration.sql);
    await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    logger.info({ migrationId: migration.id }, "Bootstrap migration applied");
  }
}
