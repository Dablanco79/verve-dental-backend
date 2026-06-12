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
    id: "003_users_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        email         text        NOT NULL UNIQUE,
        password_hash text        NOT NULL,
        role          text        NOT NULL
          CONSTRAINT users_role_check
            CHECK (role IN ('owner_admin', 'group_practice_manager', 'clinical_staff')),
        clinic_id     uuid        NOT NULL,
        clinic_name   text        NOT NULL,
        mfa_enabled   boolean     NOT NULL DEFAULT false,
        is_active     boolean     NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email     ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_clinic_id ON users (clinic_id);
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
