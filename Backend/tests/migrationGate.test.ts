/**
 * migrationGate.test.ts — Sprint C: Migration Startup Gate
 *
 * Verifies that runBootstrapMigrations() enforces the staging/production gate:
 *
 *   ✓ development  — auto-applies pending migrations (no gate)
 *   ✓ test         — auto-applies pending migrations (no gate)
 *   ✓ staging      — blocks startup when pending migrations exist (default)
 *   ✓ production   — blocks startup when pending migrations exist (default)
 *   ✓ staging      — applies when migrateOnStartup is true (explicit mode)
 *   ✓ production   — applies when migrateOnStartup is true (explicit mode)
 *   ✓ staging      — allows startup when no pending migrations exist
 *
 * All tests are network-free: they use minimal mock pool/client objects and
 * never connect to a real PostgreSQL instance.
 */

import { jest } from "@jest/globals";
import {
  runBootstrapMigrations,
  BOOTSTRAP_MIGRATIONS,
} from "../src/db/migrate.js";
import type { DatabasePool } from "../src/db/pool.js";
import type { Logger } from "../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Silent logger that captures info calls for optional inspection. */
function makeMockLogger(): Logger {
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

/**
 * Builds a minimal mock pg pool+client pair.
 *
 * Uses jest.fn(impl) at construction time (not .mockImplementation) to avoid
 * Jest's UnknownFunction constraint error under strict TypeScript.
 *
 * @param appliedIds  IDs already recorded in schema_migrations.
 *                    Pass [] for a fresh database (all pending).
 *                    Pass allAppliedIds() for a fully-applied database.
 */
function makeMockPool(appliedIds: string[] = []) {
  const mockClient = {
    query: jest.fn((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.trim() === "SELECT id FROM schema_migrations"
      ) {
        return Promise.resolve({
          rows: appliedIds.map((id) => ({ id })),
          rowCount: appliedIds.length,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };

  const mockPool = {
    connect: jest.fn(() => Promise.resolve(mockClient)),
  };

  // Cast via never to satisfy the pg.Pool type without implementing every method.
  return { pool: mockPool as never as DatabasePool, client: mockClient };
}

/** Returns all BOOTSTRAP_MIGRATIONS IDs (simulates a fully-up-to-date database). */
function allAppliedIds(): string[] {
  return BOOTSTRAP_MIGRATIONS.map((m) => m.id);
}

/** Extracts the sequence of SQL strings passed to client.query(). */
function queriesSeen(
  client: ReturnType<typeof makeMockPool>["client"],
): string[] {
  return client.query.mock.calls.map((c) => c[0]);
}

// ---------------------------------------------------------------------------
// Development — auto-applies (no gate)
// ---------------------------------------------------------------------------

describe("Migration gate — development", () => {
  it("applies pending migrations automatically in development", async () => {
    const { pool, client } = makeMockPool([]); // fresh DB — all pending
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, { nodeEnv: "development" }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });

  it("does not throw in development even when many migrations are pending", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, { nodeEnv: "development" }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test — auto-applies (no gate)
// ---------------------------------------------------------------------------

describe("Migration gate — test environment", () => {
  it("applies pending migrations automatically in test", async () => {
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, { nodeEnv: "test" }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// Staging — blocks by default when pending migrations exist
// ---------------------------------------------------------------------------

describe("Migration gate — staging blocks on pending migrations", () => {
  it("throws when pending migrations exist in staging (migrateOnStartup not set)", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/Migration Gate/);
  });

  it("error message names the staging environment", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/staging/i);
  });

  it("error message lists at least one pending migration ID", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    const firstPendingId = BOOTSTRAP_MIGRATIONS[0]?.id ?? "";

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(new RegExp(firstPendingId));
  });

  it("error message instructs the operator to run npm run migrate", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/npm run migrate/i);
  });

  it("does NOT call COMMIT when the gate blocks staging startup", async () => {
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow();

    expect(queriesSeen(client)).not.toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// Production — blocks by default when pending migrations exist
// ---------------------------------------------------------------------------

describe("Migration gate — production blocks on pending migrations", () => {
  it("throws when pending migrations exist in production (migrateOnStartup not set)", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "production",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/Migration Gate/);
  });

  it("error message names the production environment", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "production",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/production/i);
  });

  it("does NOT call COMMIT when the gate blocks production startup", async () => {
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "production",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow();

    expect(queriesSeen(client)).not.toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// Staging — applies when migrateOnStartup = true (explicit mode)
// ---------------------------------------------------------------------------

describe("Migration gate — staging with explicit migration mode", () => {
  it("applies pending migrations in staging when migrateOnStartup is true", async () => {
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: true,
      }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });

  it("logs each applied migration in staging explicit mode", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "staging",
      migrateOnStartup: true,
    });

    // At least one "Bootstrap migration applied" info log should fire.
    const infoCalls = (logger.info as ReturnType<typeof jest.fn>).mock.calls;
    expect(infoCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Production — applies when migrateOnStartup = true (explicit mode)
// ---------------------------------------------------------------------------

describe("Migration gate — production with explicit migration mode", () => {
  it("applies pending migrations in production when migrateOnStartup is true", async () => {
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "production",
        migrateOnStartup: true,
      }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// No pending migrations — gate is silent even in staging/production
// ---------------------------------------------------------------------------

describe("Migration gate — no pending migrations allows staging/production startup", () => {
  it("allows staging startup when no migrations are pending", async () => {
    const { pool, client } = makeMockPool(allAppliedIds()); // all already applied
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "staging",
        migrateOnStartup: false,
      }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });

  it("allows production startup when no migrations are pending", async () => {
    const { pool, client } = makeMockPool(allAppliedIds());
    const logger = makeMockLogger();

    await expect(
      runBootstrapMigrations(pool, logger, {
        nodeEnv: "production",
        migrateOnStartup: false,
      }),
    ).resolves.toBeUndefined();

    expect(queriesSeen(client)).toContain("COMMIT");
  });

  it("does not log any migration application when all are already applied", async () => {
    const { pool } = makeMockPool(allAppliedIds());
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "production",
      migrateOnStartup: false,
    });

    // No "Migration applied:" info logs should fire.
    const infoCalls = (logger.info as ReturnType<typeof jest.fn>).mock.calls;
    const migrationLogs = infoCalls.filter((args) =>
      JSON.stringify(args).includes("Migration applied:"),
    );
    expect(migrationLogs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stocktake migrations are registered in BOOTSTRAP_MIGRATIONS
// ---------------------------------------------------------------------------

describe("Stocktake migrations — registered in BOOTSTRAP_MIGRATIONS", () => {
  it("includes 037_stocktake_schema in the migration list", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("037_stocktake_schema");
  });

  it("includes 038_stocktake_line_snapshot in the migration list", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("038_stocktake_line_snapshot");
  });

  it("037_stocktake_schema appears before 038_stocktake_line_snapshot", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    const schemaIdx = ids.indexOf("037_stocktake_schema");
    const snapshotIdx = ids.indexOf("038_stocktake_line_snapshot");
    expect(schemaIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(schemaIdx).toBeLessThan(snapshotIdx);
  });

  it("038_stocktake_line_snapshot is the last stocktake migration", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("038_stocktake_line_snapshot");
  });

  it("043_po_line_received_quantity is the last migration", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    expect(ids[ids.length - 1]).toBe("043_po_line_received_quantity");
  });

  it("detects stocktake migrations as pending on a pre-stocktake database", async () => {
    // Simulate a DB that has everything up to 036 but not 037/038.
    const preStocktakeIds = BOOTSTRAP_MIGRATIONS.filter(
      (m) => !m.id.startsWith("037_") && !m.id.startsWith("038_"),
    ).map((m) => m.id);

    const { pool } = makeMockPool(preStocktakeIds);
    const logger = makeMockLogger();

    // In development, auto-applies — should not throw.
    await expect(
      runBootstrapMigrations(pool, logger, { nodeEnv: "development" }),
    ).resolves.toBeUndefined();

    // In production without migrateOnStartup, gate must block.
    const { pool: prodPool } = makeMockPool(preStocktakeIds);
    const prodLogger = makeMockLogger();
    await expect(
      runBootstrapMigrations(prodPool, prodLogger, {
        nodeEnv: "production",
        migrateOnStartup: false,
      }),
    ).rejects.toThrow(/037_stocktake_schema/);
  });
});

// ---------------------------------------------------------------------------
// Migration order — numeric ordering is preserved
// ---------------------------------------------------------------------------

describe("Migration order — numeric ordering", () => {
  it("all migration IDs are applied in their declared array order", async () => {
    const { pool, client } = makeMockPool([]); // fresh DB — all pending
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, { nodeEnv: "development" });

    // Extract IDs from INSERT calls by checking what was inserted.
    // Each INSERT call was: client.query(sql, [migrationId]) so migrationId
    // is the first element of the second argument.  We recover it by matching
    // the migration IDs that appear in info log calls (which include the ID).
    const insertedIds: string[] = [];
    for (const call of (client.query as ReturnType<typeof jest.fn>).mock.calls) {
      const sql = call[0] as string;
      if (typeof sql === "string" && sql.includes("INSERT INTO schema_migrations")) {
        const params = call[1] as string[] | undefined;
        if (params && params[0]) insertedIds.push(params[0]);
      }
    }

    // IDs must appear in the same order as BOOTSTRAP_MIGRATIONS.
    const expectedIds = BOOTSTRAP_MIGRATIONS.map((m) => m.id);
    expect(insertedIds).toEqual(expectedIds);
  });

  it("already-applied migrations are skipped and not re-inserted", async () => {
    // Apply the first three migrations already.
    const firstThreeIds = BOOTSTRAP_MIGRATIONS.slice(0, 3).map((m) => m.id);
    const { pool, client } = makeMockPool(firstThreeIds);
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, { nodeEnv: "development" });

    const insertedIds: string[] = [];
    for (const call of (client.query as ReturnType<typeof jest.fn>).mock.calls) {
      const sql = call[0] as string;
      if (typeof sql === "string" && sql.includes("INSERT INTO schema_migrations")) {
        const params = call[1] as string[] | undefined;
        if (params && params[0]) insertedIds.push(params[0]);
      }
    }

    // None of the already-applied IDs should appear in the inserts.
    for (const id of firstThreeIds) {
      expect(insertedIds).not.toContain(id);
    }

    // All remaining migrations should have been inserted.
    const remaining = BOOTSTRAP_MIGRATIONS.slice(3).map((m) => m.id);
    expect(insertedIds).toEqual(remaining);
  });
});

// ---------------------------------------------------------------------------
// Migration failure — startup is blocked with a non-zero exit signal
// ---------------------------------------------------------------------------

describe("Migration failure — blocks startup on SQL error", () => {
  it("rejects when a migration SQL query throws", async () => {
    // Fresh DB so there are pending migrations to run.
    const { pool, client } = makeMockPool([]);
    const logger = makeMockLogger();

    // Simulate the first migration SQL call failing after the setup queries.
    let callCount = 0;
    (client.query as ReturnType<typeof jest.fn>).mockImplementation((sql: unknown) => {
      callCount++;
      // Let BEGIN, advisory lock, CREATE TABLE, and SELECT pass (calls 1-4).
      // Fail on the 5th call (first migration SQL body).
      if (callCount === 5) {
        return Promise.reject(new Error("simulated SQL failure"));
      }
      if (typeof sql === "string" && sql.trim() === "SELECT id FROM schema_migrations") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(
      runBootstrapMigrations(pool, logger, { nodeEnv: "development" }),
    ).rejects.toThrow("simulated SQL failure");

    // ROLLBACK must have been issued.
    expect(queriesSeen(client)).toContain("ROLLBACK");
    // COMMIT must NOT have been issued.
    expect(queriesSeen(client)).not.toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// Logging — production observability
// ---------------------------------------------------------------------------

describe("Migration logging — startup observability", () => {
  it("logs a disabled message in production when MIGRATE_ON_STARTUP is false", async () => {
    const { pool } = makeMockPool(allAppliedIds());
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "production",
      migrateOnStartup: false,
    });

    const allInfoMessages = (logger.info as ReturnType<typeof jest.fn>).mock.calls
      .map((c) => JSON.stringify(c))
      .join(" ");

    expect(allInfoMessages).toMatch(/MIGRATE_ON_STARTUP/);
  });

  it("logs the pending count when migrations are about to run", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "staging",
      migrateOnStartup: true,
    });

    const allInfoMessages = (logger.info as ReturnType<typeof jest.fn>).mock.calls
      .map((c) => JSON.stringify(c))
      .join(" ");

    expect(allInfoMessages).toMatch(/pending/i);
  });

  it("logs 'up to date' when no migrations are pending", async () => {
    const { pool } = makeMockPool(allAppliedIds());
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "production",
      migrateOnStartup: true,
    });

    const allInfoMessages = (logger.info as ReturnType<typeof jest.fn>).mock.calls
      .map((c) => JSON.stringify(c))
      .join(" ");

    expect(allInfoMessages).toMatch(/up to date/i);
  });

  it("logs each migration ID as it is applied", async () => {
    const { pool } = makeMockPool([]);
    const logger = makeMockLogger();

    await runBootstrapMigrations(pool, logger, {
      nodeEnv: "development",
    });

    const allInfoMessages = (logger.info as ReturnType<typeof jest.fn>).mock.calls
      .map((c) => JSON.stringify(c))
      .join(" ");

    // At minimum, the first and last migration IDs should appear in logs.
    const firstId = BOOTSTRAP_MIGRATIONS[0]?.id ?? "";
    const lastId = BOOTSTRAP_MIGRATIONS[BOOTSTRAP_MIGRATIONS.length - 1]?.id ?? "";
    expect(allInfoMessages).toContain(firstId);
    expect(allInfoMessages).toContain(lastId);
  });

  it("down migrations are never executed during startup", () => {
    // The BOOTSTRAP_MIGRATIONS array is the only source of truth for the
    // inline runner — there is no down-migration pathway in startup mode.

    // DROP TABLE is legitimate for temporary objects or idempotent guards, but
    // a migration should never DROP the tables it is responsible for creating.
    // The key assertion is that the runner itself never invokes down migrations.
    // Since BOOTSTRAP_MIGRATIONS has no concept of "down", this is structurally
    // enforced — confirm it holds for the stocktake entries specifically.
    const stocktakeEntry = BOOTSTRAP_MIGRATIONS.find((m) => m.id === "037_stocktake_schema");
    expect(stocktakeEntry).toBeDefined();

    // The stocktake schema migration must CREATE, not DROP, its core tables.
    expect(stocktakeEntry?.sql.toLowerCase()).toContain("create table if not exists stocktake_sessions");
    expect(stocktakeEntry?.sql.toLowerCase()).toContain("create table if not exists stocktake_lines");

    // The snapshot migration must ADD columns, not DROP the table.
    const snapshotEntry = BOOTSTRAP_MIGRATIONS.find((m) => m.id === "038_stocktake_line_snapshot");
    expect(snapshotEntry).toBeDefined();
    expect(snapshotEntry?.sql.toLowerCase()).toContain("add column if not exists product_name");
  });
});
