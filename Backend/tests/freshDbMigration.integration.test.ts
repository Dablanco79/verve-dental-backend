/**
 * freshDbMigration.integration.test.ts
 *
 * Clean-slate and lifecycle integration gate for the migration chain through
 * 047_user_clinic_assignments, 048_rls_own_roster_entries,
 * 049_clinic_preferred_name, 050_fix_timesheet_roster_unique,
 * 051_geofence_columns, 052_module_permissions_backfill,
 * 053_timesheet_staff_notes, 054_staff_pay_rates, and
 * 055_leave_pilot_safety, 056_approved_leave_cancellation, and
 * 057_leave_cancellation_requests.
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

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

  it("last migration recorded is 057_leave_cancellation_requests", async () => {
    if (SKIP_FRESH) return;

    // Migrations run in a single transaction so applied_at timestamps are
    // identical. Order by ID (zero-padded, lexicographic = numeric order).
    const { rows } = await (freshPool as pg.Pool).query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.id).toBe("057_leave_cancellation_requests");
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

async function expectLeavePilotMigrationToRejectWithoutRewrite(
  invalidTotalDays: number,
): Promise<void> {
  const pool = anyPool();
  const client = await pool.connect();
  const schema = `leave_055_${randomUUID().replaceAll("-", "")}`;
  const leaveId = randomUUID();
  const migration = BOOTSTRAP_MIGRATIONS.find(
    (candidate) => candidate.id === "055_leave_pilot_safety",
  );
  if (!migration) throw new Error("Migration 055 is not registered");

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`
      CREATE TABLE "${schema}".leave_requests (
        id uuid PRIMARY KEY,
        staff_user_id uuid NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        total_days numeric NOT NULL,
        status text NOT NULL
      )
    `);
    await client.query(
      `INSERT INTO "${schema}".leave_requests
         (id, staff_user_id, start_date, end_date, total_days, status)
       VALUES ($1, $2, '2035-01-15', '2035-01-15', $3, 'pending')`,
      [leaveId, randomUUID(), invalidTotalDays],
    );

    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    let migrationError: unknown;
    try {
      await client.query(migration.sql);
    } catch (error) {
      migrationError = error;
    }
    expect(migrationError).toBeDefined();
    await client.query("ROLLBACK");

    const { rows } = await client.query<{ total_days: string }>(
      `SELECT total_days::text AS total_days
         FROM "${schema}".leave_requests
        WHERE id = $1`,
      [leaveId],
    );
    expect(rows[0]?.total_days).toBe(String(invalidTotalDays));

    const constraint = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM pg_constraint
        WHERE conrelid = $1::regclass
          AND conname = 'leave_requests_whole_day_count'`,
      [`${schema}.leave_requests`],
    );
    expect(Number(constraint.rows[0]?.count)).toBe(0);

    const index = await client.query<{ index_name: string | null }>(
      "SELECT to_regclass($1) AS index_name",
      [`${schema}.idx_leave_requests_staff_approved_range`],
    );
    expect(index.rows[0]?.index_name).toBeNull();
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
}

describe("Migration 055 — leave pilot safety", () => {
  it("installs the whole-day constraint and person-wide approved-leave index", async () => {
    if (SKIP_ALL) return;

    const constraint = await anyPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM pg_constraint
        WHERE conrelid = 'leave_requests'::regclass
          AND conname = 'leave_requests_whole_day_count'`,
    );
    expect(Number(constraint.rows[0]?.count)).toBe(1);

    const index = await anyPool().query<{ index_name: string | null }>(
      "SELECT to_regclass('idx_leave_requests_staff_approved_range') AS index_name",
    );
    expect(index.rows[0]?.index_name).toBe("idx_leave_requests_staff_approved_range");
  });

  it("rejects fractional total_days, rolls back, and preserves the invalid row", async () => {
    if (SKIP_ALL) return;
    await expectLeavePilotMigrationToRejectWithoutRewrite(0.5);
  });

  it("rejects integer-but-inconsistent total_days, rolls back, and preserves the invalid row", async () => {
    if (SKIP_ALL) return;
    await expectLeavePilotMigrationToRejectWithoutRewrite(2);
  });
});

describe("Migration 056 — approved leave cancellation", () => {
  it("adds the cancelled status and durable cancellation metadata", async () => {
    if (SKIP_ALL) return;

    const enumValues = await anyPool().query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum
        WHERE enumtypid = 'leave_request_status'::regtype
        ORDER BY enumsortorder`,
    );
    expect(enumValues.rows.map((row) => row.enumlabel)).toContain("cancelled");

    const columns = await anyPool().query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leave_requests'
          AND column_name IN (
            'cancelled_by_user_id',
            'cancelled_at',
            'cancellation_reason'
          )`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "cancellation_reason",
      "cancelled_at",
      "cancelled_by_user_id",
    ]);

    const constraint = await anyPool().query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conrelid = 'leave_requests'::regclass
          AND conname IN (
            'leave_requests_cancellation_reason_nonblank',
            'leave_requests_cancellation_metadata_complete'
          )
        ORDER BY conname`,
    );
    expect(constraint.rows.map((row) => row.conname)).toEqual([
      "leave_requests_cancellation_metadata_complete",
      "leave_requests_cancellation_reason_nonblank",
    ]);
  });
});

describe("Migration 057 — leave cancellation requests", () => {
  it("creates the request table, pending uniqueness, and durable exception column", async () => {
    if (SKIP_ALL) return;
    const table = await anyPool().query<{ name: string | null }>(
      "SELECT to_regclass('leave_cancellation_requests')::text AS name",
    );
    expect(table.rows[0]?.name).toBe("leave_cancellation_requests");
    const index = await anyPool().query<{ name: string | null }>(
      "SELECT to_regclass('leave_cancellation_requests_one_pending_per_leave')::text AS name",
    );
    expect(index.rows[0]?.name).toBe("leave_cancellation_requests_one_pending_per_leave");
    const column = await anyPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'leave_requests'
          AND column_name = 'cancellation_self_review_exception_used'`,
    );
    expect(Number(column.rows[0]?.count)).toBe(1);
  });

  it("down migration refuses rollback and preserves cancellation history", async () => {
    if (SKIP_ALL) return;
    const leaveId = randomUUID();
    const cancellationId = randomUUID();
    const db = anyPool();
    await db.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'staff@clinic-a.au',
               '11111111-1111-4111-8111-111111111111', 'annual',
               '2038-01-10', '2038-01-10', 1, 'approved',
               'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now())`,
      [leaveId],
    );
    await db.query(
      `INSERT INTO leave_cancellation_requests
         (id, leave_request_id, clinic_id, staff_user_id, requested_by_user_id, request_reason)
       VALUES ($1, $2, '11111111-1111-4111-8111-111111111111',
               'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
               'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Preserve this history')`,
      [cancellationId, leaveId],
    );

    try {
      const downSql = readFileSync(
        new URL("../migrations/057_leave_cancellation_requests.down.sql", import.meta.url),
        "utf8",
      );
      await expect(db.query(downSql)).rejects.toThrow(
        "Migration 057 rollback refused",
      );
      const preserved = await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM leave_cancellation_requests WHERE id = $1",
        [cancellationId],
      );
      expect(preserved.rows[0]?.count).toBe("1");

      await db.query("DELETE FROM leave_cancellation_requests WHERE id = $1", [cancellationId]);
      await db.query(
        `UPDATE leave_requests
            SET cancellation_self_review_exception_used = true
          WHERE id = $1`,
        [leaveId],
      );
      await expect(db.query(downSql)).rejects.toThrow(
        "leave_requests contains sole-review exception history",
      );
      const parentHistory = await db.query<{ preserved: boolean }>(
        `SELECT cancellation_self_review_exception_used AS preserved
           FROM leave_requests
          WHERE id = $1`,
        [leaveId],
      );
      expect(parentHistory.rows[0]?.preserved).toBe(true);
    } finally {
      await db.query("DELETE FROM leave_cancellation_requests WHERE id = $1", [cancellationId]);
      await db.query("DELETE FROM leave_requests WHERE id = $1", [leaveId]);
    }
  });
});

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
