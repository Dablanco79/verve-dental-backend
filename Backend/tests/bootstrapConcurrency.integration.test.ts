/**
 * Concurrent first-admin bootstrap integration test.
 *
 * Runs only with an explicitly isolated local database:
 *   BOOTSTRAP_CONCURRENCY_DATABASE_URL=postgresql://.../verve_test_bootstrap_concurrency
 *
 * The database must be disposable and empty. Hosted/non-local URLs are refused.
 */

import pg from "pg";
import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";

import {
  bootstrapFirstAdmin,
  countUsersWithOwnerAdminContext,
} from "../src/db/bootstrapAdmin.js";
import { runBootstrapMigrations } from "../src/db/migrate.js";
import {
  AUTH_BYPASS_CLINIC_ID,
  withTenantContext,
} from "../src/db/tenantContext.js";
import type { Logger } from "../src/utils/logger.js";

const DATABASE_URL = process.env["BOOTSTRAP_CONCURRENCY_DATABASE_URL"];
const describeLocal = DATABASE_URL ? describe : describe.skip;

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as Logger;

describeLocal("first-admin bootstrap concurrency", () => {
  let pool: pg.Pool;
  let shouldCleanup = false;

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL as string);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("Bootstrap concurrency test refuses non-local PostgreSQL hosts");
    }
    if (!parsed.pathname.endsWith("_bootstrap_concurrency")) {
      throw new Error(
        "Bootstrap concurrency test database name must end with _bootstrap_concurrency",
      );
    }

    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 10_000,
    });
    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "test",
      mode: "apply",
    });

    const userCount = await countUsersWithOwnerAdminContext(pool);
    const existing = await pool.query<{ clinics: string }>(
      "SELECT COUNT(*)::text AS clinics FROM clinics",
    );
    const clinicCount = existing.rows.at(0)?.clinics;
    if (userCount !== 0 || clinicCount !== "0") {
      throw new Error("Bootstrap concurrency test requires an empty disposable database");
    }
    shouldCleanup = true;
  }, 120_000);

  afterAll(async () => {
    try {
      if (shouldCleanup) {
        await withTenantContext(
          pool,
          AUTH_BYPASS_CLINIC_ID,
          async (client) => {
            await client.query("DELETE FROM user_clinic_assignments");
            await client.query("DELETE FROM users");
            await client.query("DELETE FROM clinics");
          },
          true,
        );
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  it("allows exactly one of two simultaneous bootstrap attempts to commit", async () => {
    const results = await Promise.allSettled([
      bootstrapFirstAdmin(
        pool,
        logger,
        {
          adminEmail: "first-bootstrap@test.invalid",
          adminPassword: "FirstBootstrapPassword123!",
          clinicName: "First Bootstrap Clinic",
          clinicTimezone: "Australia/Melbourne",
        },
        1,
      ),
      bootstrapFirstAdmin(
        pool,
        logger,
        {
          adminEmail: "second-bootstrap@test.invalid",
          adminPassword: "SecondBootstrapPassword123!",
          clinicName: "Second Bootstrap Clinic",
          clinicTimezone: "Australia/Melbourne",
        },
        1,
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toMatch(/Bootstrap refused: 1 user/);

    const counts = await withTenantContext(
      pool,
      AUTH_BYPASS_CLINIC_ID,
      async (client) => client.query<{
        users: string;
        clinics: string;
        assignments: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM users) AS users,
           (SELECT COUNT(*)::text FROM clinics) AS clinics,
           (SELECT COUNT(*)::text FROM user_clinic_assignments) AS assignments`,
      ),
      true,
    );
    expect(counts.rows[0]).toEqual({
      users: "1",
      clinics: "1",
      assignments: "1",
    });
  }, 30_000);
});
