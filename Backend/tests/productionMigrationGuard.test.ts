import { jest } from "@jest/globals";

import {
  BOOTSTRAP_MIGRATIONS,
} from "../src/db/migrate.js";
import type { DatabasePool } from "../src/db/pool.js";
import {
  PRODUCTION_TARGET_MIGRATION_IDS,
  runProductionGuardedMigration,
} from "../src/db/productionMigrationGuard.js";
import type { Logger } from "../src/utils/logger.js";

const EXPECTED_IDENTITY = {
  databaseName: "expected-production",
  systemIdentifier: "1234567890123456789",
};
const RELEASE_IDS = BOOTSTRAP_MIGRATIONS.map((migration) => migration.id);
const BASELINE_IDS = RELEASE_IDS.slice(
  0,
  -PRODUCTION_TARGET_MIGRATION_IDS.length,
);
const TARGET_SQL = new Set(
  BOOTSTRAP_MIGRATIONS
    .filter((migration) =>
      PRODUCTION_TARGET_MIGRATION_IDS.includes(
        migration.id as (typeof PRODUCTION_TARGET_MIGRATION_IDS)[number],
      ),
    )
    .map((migration) => migration.sql),
);

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeGuardedPool(
  initialAppliedIds: readonly string[],
  identity: typeof EXPECTED_IDENTITY & { isPrimary?: boolean } =
    EXPECTED_IDENTITY,
) {
  const appliedIds = new Set(initialAppliedIds);
  const queries: string[] = [];
  const insertedIds: string[] = [];

  const client = {
    query: jest.fn((sql: string, params?: readonly unknown[]) => {
      queries.push(sql);
      if (sql.includes("pg_control_system()")) {
        return Promise.resolve({
          rows: [{
            database_name: identity.databaseName,
            system_identifier: identity.systemIdentifier,
            is_primary: identity.isPrimary ?? true,
          }],
          rowCount: 1,
        });
      }
      if (sql.includes("to_regclass")) {
        return Promise.resolve({
          rows: [{ table_name: "schema_migrations" }],
          rowCount: 1,
        });
      }
      if (sql.trim() === "SELECT id FROM schema_migrations") {
        return Promise.resolve({
          rows: [...appliedIds].map((id) => ({ id })),
          rowCount: appliedIds.size,
        });
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        const id = params?.[0];
        if (typeof id === "string") {
          appliedIds.add(id);
          insertedIds.push(id);
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn(() => Promise.resolve(client)),
  } as never as DatabasePool;

  return { pool, queries, insertedIds, appliedIds };
}

function sawDdl(queries: readonly string[]): boolean {
  return queries.some(
    (sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations") ||
      TARGET_SQL.has(sql) ||
      sql.startsWith("INSERT INTO schema_migrations"),
  );
}

describe("Production migration safety guard", () => {
  it("applies only 060 and 061 in approved order for the correct identity", async () => {
    const state = makeGuardedPool(BASELINE_IDS);

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).resolves.toBeUndefined();

    expect(state.insertedIds).toEqual(PRODUCTION_TARGET_MIGRATION_IDS);
    expect([...state.appliedIds]).toEqual(RELEASE_IDS);
    const lockIndex = state.queries.findIndex((sql) =>
      sql.includes("pg_advisory_xact_lock"),
    );
    const identityIndex = state.queries.findIndex((sql) =>
      sql.includes("pg_control_system()"),
    );
    const firstDdlIndex = state.queries.findIndex((sql) =>
      TARGET_SQL.has(sql),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(identityIndex).toBeGreaterThan(lockIndex);
    expect(firstDdlIndex).toBeGreaterThan(identityIndex);
  });

  it("verifies the exact 59-ID release ledger without modifying it", async () => {
    const state = makeGuardedPool(RELEASE_IDS);

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "verify",
        EXPECTED_IDENTITY,
      ),
    ).resolves.toBeUndefined();

    expect(state.insertedIds).toEqual([]);
    expect(sawDdl(state.queries)).toBe(false);
    expect(
      state.queries.some((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBe(true);
  });

  it("rejects the wrong database name before DDL", async () => {
    const state = makeGuardedPool(BASELINE_IDS, {
      ...EXPECTED_IDENTITY,
      databaseName: "not-production",
    });

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("does not match");
    expect(sawDdl(state.queries)).toBe(false);
  });

  it("rejects the wrong cluster identifier before DDL", async () => {
    const state = makeGuardedPool(BASELINE_IDS, {
      ...EXPECTED_IDENTITY,
      systemIdentifier: "9876543210987654321",
    });

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("does not match");
    expect(sawDdl(state.queries)).toBe(false);
  });

  it("rejects a read replica before DDL", async () => {
    const state = makeGuardedPool(BASELINE_IDS, {
      ...EXPECTED_IDENTITY,
      isPrimary: false,
    });

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("does not match");
    expect(sawDdl(state.queries)).toBe(false);
  });

  it("rejects a missing baseline migration before DDL", async () => {
    const state = makeGuardedPool(BASELINE_IDS.slice(1));

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("does not match the approved baseline");
    expect(sawDdl(state.queries)).toBe(false);
  });

  it("rejects an unexpected migration before DDL", async () => {
    const state = makeGuardedPool([...BASELINE_IDS, "999_unreviewed"]);

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("Unknown applied migration");
    expect(sawDdl(state.queries)).toBe(false);
  });

  it.each(PRODUCTION_TARGET_MIGRATION_IDS)(
    "rejects unexpectedly pre-applied target %s before DDL",
    async (targetId) => {
      const state = makeGuardedPool([...BASELINE_IDS, targetId]);

      await expect(
        runProductionGuardedMigration(
          state.pool,
          makeLogger(),
          "apply",
          EXPECTED_IDENTITY,
        ),
      ).rejects.toThrow("does not match the approved baseline");
      expect(sawDdl(state.queries)).toBe(false);
    },
  );

  it("refuses a repeated apply after a successful guarded application", async () => {
    const state = makeGuardedPool(BASELINE_IDS);

    await runProductionGuardedMigration(
      state.pool,
      makeLogger(),
      "apply",
      EXPECTED_IDENTITY,
    );
    const firstRunQueryCount = state.queries.length;

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        EXPECTED_IDENTITY,
      ),
    ).rejects.toThrow("does not match the approved baseline");

    expect(
      sawDdl(state.queries.slice(firstRunQueryCount)),
    ).toBe(false);
  });

  it("fails closed before connecting when expected identity input is invalid", async () => {
    const state = makeGuardedPool(BASELINE_IDS);

    await expect(
      runProductionGuardedMigration(
        state.pool,
        makeLogger(),
        "apply",
        { databaseName: "", systemIdentifier: "not-numeric" },
      ),
    ).rejects.toThrow("missing or invalid");

    expect(state.queries).toEqual([]);
  });
});
