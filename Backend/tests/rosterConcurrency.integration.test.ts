/**
 * rosterConcurrency.integration.test.ts
 *
 * Real PostgreSQL integration test proving that two simultaneous overlapping
 * shift creations for the same staff member cannot both succeed.
 *
 * Mechanism under test
 * ─────────────────────
 * createEntry now acquires pg_advisory_xact_lock(hashtext(staffUserId)::bigint)
 * INSIDE the same DB transaction as the overlap check and INSERT.  The lock
 * is transaction-scoped so it is released automatically on COMMIT / ROLLBACK.
 *
 * Concurrency model
 * ─────────────────
 * Promise.allSettled fires both calls before either is awaited.  Because both
 * calls immediately issue asynchronous DB round-trips (BEGIN, set_config,
 * advisory-lock acquire), Node's event loop interleaves the I/O so both
 * transactions are live at the same time.  The first to commit wins; the second
 * finds the inserted row during its overlap check and throws ROSTER_CONFLICT.
 *
 * DATABASE_URL behaviour
 * ─────────────────────
 * Absent  → entire suite is skipped (acceptable for local dev without a DB).
 * Present → test MUST pass; schema and seed fixtures MUST exist.
 *           If fixtures are missing, the test throws a hard error so CI cannot
 *           silently pass with a broken database setup.
 *
 * Run manually (Windows):
 *   $env:DATABASE_URL = "postgresql://..."; npm test --prefix Backend -- rosterConcurrency
 */

import pg from "pg";
import { randomUUID } from "node:crypto";

import {
  AUTH_BYPASS_CLINIC_ID,
  installRlsPoolHook,
  runWithTenantContext,
} from "../src/db/tenantContext.js";
import { createPostgresRosterRepository } from "../src/repositories/rosterRepository.postgres.js";
import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import type { DatabasePool } from "../src/db/pool.js";
import { AppError } from "../src/types/errors.js";

// ── Test gate ─────────────────────────────────────────────────────────────────

const DB_URL = process.env["DATABASE_URL"];
const SKIP = !DB_URL;

// ── Fixture UUIDs ─────────────────────────────────────────────────────────────

const STAFF_USER_ID = SEED_USER_IDS.clinicAStaff; // real seeded staff member
const CLINIC_ID = SEED_CLINIC_A_ID;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tomorrow 08:00–17:00 local time, serialised as UTC ISO. */
function makeTomorrowWindow(): { windowStart: Date; windowEnd: Date } {
  const d = new Date(Date.now() + 86_400_000); // +1 day
  d.setHours(8, 0, 0, 0);
  const windowStart = new Date(d);
  d.setHours(17, 0, 0, 0);
  const windowEnd = new Date(d);
  return { windowStart, windowEnd };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Roster concurrency — advisory lock (Postgres)", () => {
  if (SKIP) {
    it.skip("Skipped: DATABASE_URL not set — this test runs in CI only", () => {
      // no-op
    });
    return;
  }

  let pool: DatabasePool;
  const createdIds: string[] = [];

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
    installRlsPoolHook(pool);
  }, 15_000);

  afterAll(async () => {
    if (createdIds.length > 0) {
      await pool.query(
        `DELETE FROM roster_entries WHERE id = ANY($1::uuid[])`,
        [createdIds],
      );
    }
    await pool.end();
  }, 15_000);

  it(
    "two simultaneous overlapping creations → exactly one ROSTER_CONFLICT",
    async () => {
      const { windowStart, windowEnd } = makeTomorrowWindow();

      // Unique clinic name to avoid false collisions with other test fixtures.
      const uniqueClinicName = `Concurrency Test Clinic ${randomUUID().slice(0, 8)}`;

      const baseInput = {
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        rosteredClinicId: CLINIC_ID,
        rosteredClinicName: uniqueClinicName,
        shiftStartAt: windowStart,
        shiftEndAt: windowEnd,
        shiftType: "standard" as const,
        notes: null,
        createdByUserId: SEED_USER_IDS.clinicAAdmin,
        createdByEmail: "admin@clinic-a.au",
      };

      const conflictCheck = { windowStart, windowEnd, staffDisplayName: "Test Staff" };

      const repo = createPostgresRosterRepository(pool);

      // Fire both requests simultaneously via owner-admin context
      // (runWithTenantContext sets AsyncLocalStorage so the pool hook injects
      //  RLS session variables — the INSERT is authorised by owner_admin_mode).
      const results = await Promise.allSettled([
        runWithTenantContext(AUTH_BYPASS_CLINIC_ID, true, () =>
          repo.createEntry({ ...baseInput }, conflictCheck),
        ),
        runWithTenantContext(AUTH_BYPASS_CLINIC_ID, true, () =>
          repo.createEntry({ ...baseInput }, conflictCheck),
        ),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof repo.createEntry>>> =>
          r.status === "fulfilled",
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );

      // Track the successful insert for cleanup.
      for (const r of fulfilled) {
        createdIds.push(r.value.id);
      }

      // EXACTLY one must succeed; the other must be a ROSTER_CONFLICT.
      //
      // Fail-closed: if DATABASE_URL is present, the required schema and seed
      // fixtures MUST exist.  A silent pass would let a broken CI database setup
      // go undetected.  Only a completely absent DATABASE_URL (dev laptop with
      // no local Postgres) is an acceptable skip reason — handled above.
      if (fulfilled.length === 0) {
        const firstErr = rejected[0]?.reason as Error | undefined;
        const isMissingFixtures =
          firstErr !== undefined &&
          !(firstErr instanceof AppError && firstErr.code === "ROSTER_CONFLICT");
        if (isMissingFixtures) {
          // Re-throw as a hard failure so CI surfaces the broken DB setup.
          throw new Error(
            `[rosterConcurrency] DATABASE_URL is set but required test fixtures are missing. ` +
              `Both concurrent creates failed: "${firstErr.message}". ` +
              `Run 'npm run test:db:setup --workspace=@verve/backend' to migrate and seed.`,
          );
        }
      }

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const err = (rejected[0] as PromiseRejectedResult).reason as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("ROSTER_CONFLICT");
    },
    30_000, // allow up to 30 s for two live DB round-trips
  );
});
