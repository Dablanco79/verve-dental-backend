/**
 * freshDbMigration.integration.test.ts
 *
 * Clean-slate integration gate: proves the full migration chain (all 47
 * migrations including 047_user_clinic_assignments and
 * 048_rls_own_roster_entries) applies cleanly to a brand-new database,
 * the backfill works, and the RLS extension is live.
 *
 * Requires a fresh PostgreSQL database with no existing schema.
 * Set FRESH_DATABASE_URL in the environment before running.
 *
 * Usage (from WSL):
 *   DATABASE_URL="postgresql://verve:vervetest@localhost:5432/verve_test_multiclinic" \
 *   FRESH_DATABASE_URL="postgresql://verve:vervetest@localhost:5432/verve_test_multiclinic" \
 *   NODE_ENV=test \
 *   node --experimental-vm-modules ../node_modules/jest/bin/jest.js \
 *     tests/freshDbMigration.integration.test.ts --runInBand --forceExit --verbose
 */

import pg from "pg";
import { jest } from "@jest/globals";
import { runBootstrapMigrations, BOOTSTRAP_MIGRATIONS } from "../src/db/migrate.js";
import { seedClinics, seedDemoUsers, seedInventory } from "../src/db/seed.js";
import type { Logger } from "../src/utils/logger.js";

// Minimal no-op logger — avoids loadConfig() which requires JWT secrets
const minLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn().mockReturnThis() as unknown as Logger["child"],
} as unknown as Logger;

// ─────────────────────────────────────────────────────────────────────────────
// Environment gating
// ─────────────────────────────────────────────────────────────────────────────

const FRESH_DB_URL =
  process.env["FRESH_DATABASE_URL"] ?? process.env["DATABASE_URL"];
const SKIP = !FRESH_DB_URL;

// ─────────────────────────────────────────────────────────────────────────────
// Shared pool — created once for all tests in this file
// ─────────────────────────────────────────────────────────────────────────────

let pool: pg.Pool;

beforeAll(async () => {
  if (SKIP) return;
  pool = new pg.Pool({
    connectionString: FRESH_DB_URL,
    connectionTimeoutMillis: 15_000,
    max: 3,
  });
});

afterAll(async () => {
  if (pool) await pool.end().catch(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Full migration chain
// ─────────────────────────────────────────────────────────────────────────────

describe("Full migration chain — clean database", () => {
  it("applies all 47 migrations without error", async () => {
    if (SKIP) {
      console.warn("SKIP: FRESH_DATABASE_URL / DATABASE_URL not set");
      return;
    }

    await expect(
      runBootstrapMigrations(pool as never, minLogger, {
        nodeEnv: "test",
        migrateOnStartup: true,
      }),
    ).resolves.toBeUndefined();
  }, 120_000);

  it("schema_migrations table contains exactly 47 entries", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM schema_migrations",
    );
    expect(Number(rows[0]?.count)).toBe(BOOTSTRAP_MIGRATIONS.length);
  });

  it("last migration recorded is 048_rls_own_roster_entries", async () => {
    if (SKIP) return;

    // Migrations are inserted in a single transaction so applied_at timestamps
    // are identical for all. Order by ID (lexicographic matches numeric order
    // for zero-padded IDs like 001_ … 048_) to get the canonical last entry.
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.id).toBe("048_rls_own_roster_entries");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Seed data + verve_app role
// ─────────────────────────────────────────────────────────────────────────────

describe("Seed data — verve_test_multiclinic", () => {
  it("seeds clinics, demo users, and inventory without error", async () => {
    if (SKIP) return;

    await expect(seedClinics(pool as never, minLogger)).resolves.toBeUndefined();
    await expect(
      seedDemoUsers(pool as never, minLogger, "test"),
    ).resolves.toBeUndefined();
    await expect(
      seedInventory(pool as never, minLogger),
    ).resolves.toBeUndefined();
  }, 60_000);

  it("creates verve_app role (non-superuser role for RLS tests)", async () => {
    if (SKIP) return;

    await expect(
      pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verve_app') THEN
            CREATE ROLE verve_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
          END IF;
        END
        $$
      `),
    ).resolves.toBeDefined();

    await pool.query("GRANT USAGE ON SCHEMA public TO verve_app");
    await pool.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO verve_app",
    );
    await pool.query(
      "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO verve_app",
    );

    // Grant SET ROLE verve_app to the verve user for RLS tests
    await pool
      .query("GRANT verve_app TO verve")
      .catch(() => {
        /* Already granted or user differs */
      });
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Migration 047: user_clinic_assignments schema + backfill
// ─────────────────────────────────────────────────────────────────────────────

describe("Migration 047 — user_clinic_assignments", () => {
  it("user_clinic_assignments table exists with expected columns", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'user_clinic_assignments'
       ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toContain("id");
    expect(cols).toContain("user_id");
    expect(cols).toContain("clinic_id");
    expect(cols).toContain("can_roster");
    expect(cols).toContain("can_operate");
    expect(cols).toContain("assigned_by_user_id");
    expect(cols).toContain("assigned_at");
    expect(cols).toContain("updated_at");
  });

  it("unique constraint exists on (user_id, clinic_id)", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'user_clinic_assignments'
         AND constraint_type = 'UNIQUE'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.constraint_name === "user_clinic_assignments_unique")).toBe(true);
  });

  it("backfill inserted one row per user with can_roster=true and can_operate=true", async () => {
    if (SKIP) return;

    // Count users
    const { rows: userRows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE home_clinic_id IS NOT NULL",
    );
    const userCount = Number(userRows[0]?.count ?? 0);

    if (userCount === 0) {
      // No users yet — backfill will be empty (seed runs after migration)
      console.log("No users with home_clinic_id — backfill check skipped (seed not yet run)");
      return;
    }

    // Every user with home_clinic_id should have a can_roster=true / can_operate=true assignment
    const { rows: assignRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM user_clinic_assignments
       WHERE can_roster = true AND can_operate = true`,
    );
    const assignCount = Number(assignRows[0]?.count ?? 0);
    expect(assignCount).toBeGreaterThanOrEqual(userCount);
  });

  it("no duplicate (user_id, clinic_id) rows in user_clinic_assignments", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT user_id, clinic_id, COUNT(*) AS n
         FROM user_clinic_assignments
         GROUP BY user_id, clinic_id
         HAVING COUNT(*) > 1
       ) dupes`,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Migration 048: app_current_user_id() RLS function
// ─────────────────────────────────────────────────────────────────────────────

describe("Migration 048 — app_current_user_id RLS function", () => {
  it("app_current_user_id() function exists and returns empty string by default", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ val: string }>(
      "SELECT app_current_user_id() AS val",
    );
    // When no session variable is set, it should return empty string
    expect(rows[0]?.val).toBe("");
  });

  it("app_current_user_id() returns the value of app.current_user_id session var", async () => {
    if (SKIP) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.current_user_id = 'test-user-uuid-123'");
      const { rows } = await client.query<{ val: string }>(
        "SELECT app_current_user_id() AS val",
      );
      expect(rows[0]?.val).toBe("test-user-uuid-123");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("roster_entries RLS policy exists and includes own-row clause", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual FROM pg_policies
       WHERE tablename = 'roster_entries'
         AND policyname = 'rls_roster_entries_tenant'`,
    );
    expect(rows.length).toBe(1);
    // The policy should reference app_current_user_id or staff_user_id
    const qual = rows[0]?.qual ?? "";
    expect(qual.toLowerCase()).toMatch(/app_current_user_id|staff_user_id/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — Post-seed backfill verification
// ─────────────────────────────────────────────────────────────────────────────

describe("Post-seed backfill — all demo users have home clinic assignments", () => {
  it("every seeded user with a home_clinic_id has a can_roster assignment", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ missing: string }>(
      `SELECT u.id AS missing
       FROM users u
       WHERE u.home_clinic_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_clinic_assignments a
           WHERE a.user_id = u.id AND a.clinic_id = u.home_clinic_id
             AND a.can_roster = true
         )`,
    );
    expect(rows).toHaveLength(0);
  });

  it("every seeded user with a home_clinic_id has a can_operate assignment", async () => {
    if (SKIP) return;

    const { rows } = await pool.query<{ missing: string }>(
      `SELECT u.id AS missing
       FROM users u
       WHERE u.home_clinic_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_clinic_assignments a
           WHERE a.user_id = u.id AND a.clinic_id = u.home_clinic_id
             AND a.can_operate = true
         )`,
    );
    expect(rows).toHaveLength(0);
  });
});
