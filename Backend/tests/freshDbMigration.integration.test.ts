/**
 * freshDbMigration.integration.test.ts
 *
 * Clean-slate and lifecycle integration gate for the multi-clinic rostering
 * package (migrations 047_user_clinic_assignments, 048_rls_own_roster_entries,
 * 049_clinic_preferred_name, 050_fix_timesheet_roster_unique, and
 * 051_geofence_columns).
 *
 * TWO GATING VARIABLES:
 *
 *   FRESH_DATABASE_URL  — a genuinely empty database used only for clean-slate
 *                         assertions (Phase 1: full migration chain from scratch).
 *                         These tests SKIP when FRESH_DATABASE_URL is not set so
 *                         they never assume the shared CI DATABASE_URL is empty.
 *
 *   DATABASE_URL        — the ordinary shared test database (already migrated +
 *                         seeded by test:db:setup).  Used for schema-shape,
 *                         lifecycle, and RLS-function tests that are valid against
 *                         any fully-migrated database.  These tests SKIP when
 *                         DATABASE_URL is not set.
 *
 * Running locally against verve_test_multiclinic:
 *   FRESH_DATABASE_URL="postgresql://verve:vervetest@localhost:5432/verve_test_multiclinic" \
 *   DATABASE_URL="postgresql://verve:vervetest@localhost:5432/verve_test_multiclinic" \
 *   NODE_ENV=test \
 *   node --experimental-vm-modules ../node_modules/jest/bin/jest.js \
 *     tests/freshDbMigration.integration.test.ts --runInBand --forceExit --verbose
 */

import pg from "pg";
import { jest } from "@jest/globals";
import { runBootstrapMigrations, BOOTSTRAP_MIGRATIONS } from "../src/db/migrate.js";
import { seedClinics, seedDemoUsers, seedInventory } from "../src/db/seed.js";
import type { Logger } from "../src/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal no-op logger — avoids loadConfig() which requires JWT secrets
// ─────────────────────────────────────────────────────────────────────────────

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
//
//  FRESH_DB_URL  — provided only for clean-slate tests; never falls back to
//                  DATABASE_URL to avoid silently running destructive assertions
//                  against a shared, already-populated database.
//  SHARED_DB_URL — ordinary CI / local test database (already migrated+seeded).
// ─────────────────────────────────────────────────────────────────────────────

const FRESH_DB_URL  = process.env["FRESH_DATABASE_URL"];
const SHARED_DB_URL = process.env["DATABASE_URL"];

// Clean-slate tests only run when an explicit fresh DB URL is supplied.
const SKIP_FRESH  = !FRESH_DB_URL;
// All DB tests require at least one of the URLs.
const SKIP_ALL    = !FRESH_DB_URL && !SHARED_DB_URL;

// ─────────────────────────────────────────────────────────────────────────────
// Pools — created once for each category of test
// ─────────────────────────────────────────────────────────────────────────────

let freshPool:  pg.Pool | undefined;
let sharedPool: pg.Pool | undefined;

beforeAll(() => {
  if (FRESH_DB_URL) {
    freshPool = new pg.Pool({
      connectionString: FRESH_DB_URL,
      connectionTimeoutMillis: 15_000,
      max: 3,
    });
  }
  if (SHARED_DB_URL) {
    sharedPool = new pg.Pool({
      connectionString: SHARED_DB_URL,
      connectionTimeoutMillis: 15_000,
      max: 3,
    });
  }
});

afterAll(async () => {
  await freshPool?.end().catch(() => undefined);
  await sharedPool?.end().catch(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Full migration chain (FRESH DB ONLY)
//
// These assertions require an empty database.  They are skipped when
// FRESH_DATABASE_URL is not set so the normal CI suite is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

describe("Full migration chain — clean database (requires FRESH_DATABASE_URL)", () => {
  it("applies all migrations without error", async () => {
    if (SKIP_FRESH) {
      console.warn("SKIP: FRESH_DATABASE_URL not set — clean-slate migration test skipped");
      return;
    }

    await expect(
      runBootstrapMigrations(freshPool as never, minLogger, {
        nodeEnv: "test",
        migrateOnStartup: true,
      }),
    ).resolves.toBeUndefined();
  }, 120_000);

  it("schema_migrations table contains exactly the expected number of entries", async () => {
    if (SKIP_FRESH) return;

    const { rows } = await (freshPool as pg.Pool).query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM schema_migrations",
    );
    expect(Number(rows[0]?.count)).toBe(BOOTSTRAP_MIGRATIONS.length);
  });

  it("last migration recorded is 051_geofence_columns", async () => {
    if (SKIP_FRESH) return;

    // Migrations run in a single transaction so applied_at timestamps are
    // identical. Order by ID (zero-padded, lexicographic = numeric order).
    const { rows } = await (freshPool as pg.Pool).query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.id).toBe("051_geofence_columns");
  });

  it("seeds clinics, demo users, and inventory without error", async () => {
    if (SKIP_FRESH) return;

    await expect(seedClinics(freshPool as never, minLogger)).resolves.toBeUndefined();
    await expect(
      seedDemoUsers(freshPool as never, minLogger, "test"),
    ).resolves.toBeUndefined();
    await expect(seedInventory(freshPool as never, minLogger)).resolves.toBeUndefined();
  }, 60_000);

  it("creates verve_app role (non-superuser role for RLS tests)", async () => {
    if (SKIP_FRESH) return;

    await expect(
      (freshPool as pg.Pool).query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verve_app') THEN
            CREATE ROLE verve_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
          END IF;
        END
        $$
      `),
    ).resolves.toBeDefined();

    await (freshPool as pg.Pool).query("GRANT USAGE ON SCHEMA public TO verve_app");
    await (freshPool as pg.Pool).query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO verve_app",
    );
    await (freshPool as pg.Pool).query(
      "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO verve_app",
    );
    await (freshPool as pg.Pool)
      .query("GRANT verve_app TO verve")
      .catch(() => { /* Already granted or user name differs in CI */ });
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Schema shape (any fully-migrated DB: FRESH_DATABASE_URL or DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────────

// Use whichever pool is available; prefer the fresh one for local runs.
function anyPool(): pg.Pool {
  return (freshPool ?? sharedPool) as pg.Pool;
}

describe("Migration 047 — user_clinic_assignments schema", () => {
  it("user_clinic_assignments table exists with expected columns", async () => {
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ column_name: string }>(
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
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'user_clinic_assignments'
         AND constraint_type = 'UNIQUE'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.constraint_name === "user_clinic_assignments_unique")).toBe(true);
  });
});

describe("Migration 048 — app_current_user_id RLS function", () => {
  it("app_current_user_id() function exists and returns empty string by default", async () => {
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ val: string }>(
      "SELECT app_current_user_id() AS val",
    );
    expect(rows[0]?.val).toBe("");
  });

  it("app_current_user_id() returns the value set via SET LOCAL", async () => {
    if (SKIP_ALL) return;

    const client = await anyPool().connect();
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

  it("rls_roster_entries_tenant policy exists and references own-row clause", async () => {
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual FROM pg_policies
       WHERE tablename = 'roster_entries'
         AND policyname = 'rls_roster_entries_tenant'`,
    );
    expect(rows.length).toBe(1);
    const qual = rows[0]?.qual ?? "";
    expect(qual.toLowerCase()).toMatch(/app_current_user_id|staff_user_id/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — User-creation lifecycle (any fully-migrated+seeded DB)
//
// These tests prove that users created AFTER migration 047 deployment
// automatically receive their home-clinic assignment, mirroring what
// createUser() in userRepository.postgres.ts now does.
// ─────────────────────────────────────────────────────────────────────────────

describe("User-creation lifecycle — home-clinic assignment", () => {
  it("every user with a home_clinic_id has a can_roster=true assignment", async () => {
    if (SKIP_ALL) return;

    // Run as superuser (verve). The users table has FORCE RLS; without owner_admin
    // context the query returns 0 rows.  We use pg_catalog to bypass RLS by
    // querying the table directly as superuser (verve bypasses RLS when connecting
    // directly — not through the verve_app non-superuser role).
    // If this returns rows, those users are missing their assignment.
    const { rows } = await anyPool().query<{ user_id: string; email: string }>(
      `SELECT u.id AS user_id, u.email
       FROM users u
       WHERE u.home_clinic_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_clinic_assignments a
           WHERE a.user_id = u.id
             AND a.clinic_id = u.home_clinic_id
             AND a.can_roster = true
         )`,
    );
    if (rows.length > 0) {
      const missing = rows.map((r) => r.email).join(", ");
      throw new Error(
        `${String(rows.length)} user(s) have no can_roster home-clinic assignment: ${missing}`,
      );
    }
    expect(rows).toHaveLength(0);
  });

  it("every user with a home_clinic_id has a can_operate=true assignment", async () => {
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ user_id: string; email: string }>(
      `SELECT u.id AS user_id, u.email
       FROM users u
       WHERE u.home_clinic_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_clinic_assignments a
           WHERE a.user_id = u.id
             AND a.clinic_id = u.home_clinic_id
             AND a.can_operate = true
         )`,
    );
    if (rows.length > 0) {
      const missing = rows.map((r) => r.email).join(", ");
      throw new Error(
        `${String(rows.length)} user(s) have no can_operate home-clinic assignment: ${missing}`,
      );
    }
    expect(rows).toHaveLength(0);
  });

  it("no duplicate (user_id, clinic_id) rows in user_clinic_assignments", async () => {
    if (SKIP_ALL) return;

    const { rows } = await anyPool().query<{ count: string }>(
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

  it("user_clinic_assignments has at least as many rows as users with a home_clinic_id", async () => {
    if (SKIP_ALL) return;

    const { rows: userRows } = await anyPool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE home_clinic_id IS NOT NULL",
    );
    const userCount = Number(userRows[0]?.count ?? 0);

    const { rows: assignRows } = await anyPool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM user_clinic_assignments WHERE can_roster = true AND can_operate = true",
    );
    const assignCount = Number(assignRows[0]?.count ?? 0);

    // Every user should have at least their home-clinic assignment.
    // (They may have more if Owner/Admin added cross-clinic access.)
    expect(assignCount).toBeGreaterThanOrEqual(userCount);
  });
});
