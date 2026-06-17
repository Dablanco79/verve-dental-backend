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
  return client.query.mock.calls.map((c) => c[0] as string);
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

    // No "Bootstrap migration applied" info logs should fire.
    const infoCalls = (logger.info as ReturnType<typeof jest.fn>).mock.calls;
    const migrationLogs = infoCalls.filter((args) =>
      JSON.stringify(args).includes("Bootstrap migration applied"),
    );
    expect(migrationLogs).toHaveLength(0);
  });
});
