/**
 * demoSeedGuard.test.ts — Sprint A: Disable Demo Seeding Outside Development
 *
 * Verifies that seedDemoUsers() is an unconditional no-op in staging and
 * production, and that it proceeds (attempts database access) in development
 * and test environments.
 *
 * All tests are network-free: they use minimal mock pool/client objects and
 * never connect to a real PostgreSQL instance.
 */

import { jest } from "@jest/globals";
import type { Logger } from "../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Silent logger that tracks warn() calls. */
function makeMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as Logger & { warn: ReturnType<typeof jest.fn> };
}

/**
 * Minimal mock pg.Pool client.
 *
 * Handles the query sequence that withTenantContext + seedDemoUsers issue:
 *   BEGIN
 *   SELECT set_config(...)     — RLS context
 *   SELECT COUNT(*) FROM users — empty-table check
 *   INSERT INTO users ...      — one per DEMO_USERS entry
 *   COMMIT
 *
 * We track every SQL string so tests can assert on presence/absence of INSERTs.
 */
function makeMockClient() {
  const queries: string[] = [];

  const client = {
    query: jest.fn((sql: string) => {
      queries.push(typeof sql === "string" ? sql : "?");
      if (typeof sql === "string" && sql.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };

  return { client, queries };
}

/** Minimal mock pg.Pool whose connect() returns the given client. */
function makeMockPool(client: ReturnType<typeof makeMockClient>["client"]) {
  return {
    connect: jest.fn(() => Promise.resolve(client)),
    query: jest.fn(() => Promise.resolve({ rows: [] })),
    end: jest.fn(() => Promise.resolve(undefined)),
  };
}

// ---------------------------------------------------------------------------
// Import under test (dynamic import avoids top-level ESM issues with jest.fn)
// ---------------------------------------------------------------------------

// We import statically since the module has no side-effects on load.
import { seedDemoUsers } from "../src/db/seed.js";

// ---------------------------------------------------------------------------
// Staging — seeding must be blocked
// ---------------------------------------------------------------------------

describe("seedDemoUsers — staging environment", () => {
  it("returns immediately without calling pool.connect()", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "staging");

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("logs a warning that seeding is disabled", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "staging");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ env: "staging" }),
      expect.stringMatching(/disabled/i),
    );
  });

  it("never issues INSERT INTO users", async () => {
    const logger = makeMockLogger();
    const { client, queries } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "staging");

    const insertCalls = queries.filter((q) =>
      q.toLowerCase().includes("insert into users"),
    );
    expect(insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Production — seeding must be blocked
// ---------------------------------------------------------------------------

describe("seedDemoUsers — production environment", () => {
  it("returns immediately without calling pool.connect()", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "production");

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("logs a warning that seeding is disabled", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "production");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ env: "production" }),
      expect.stringMatching(/disabled/i),
    );
  });

  it("never issues INSERT INTO users", async () => {
    const logger = makeMockLogger();
    const { client, queries } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "production");

    const insertCalls = queries.filter((q) =>
      q.toLowerCase().includes("insert into users"),
    );
    expect(insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Development — seeding must proceed
// ---------------------------------------------------------------------------

describe("seedDemoUsers — development environment", () => {
  it("calls pool.connect() to begin database work", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "development");

    expect(pool.connect).toHaveBeenCalled();
  });

  it("issues INSERT INTO users (empty table path)", async () => {
    const logger = makeMockLogger();
    const { client, queries } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "development");

    const insertCalls = queries.filter((q) =>
      q.toLowerCase().includes("insert into users"),
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it("does not log the disabled warning", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "development");

    const disabledWarnings = (logger.warn as ReturnType<typeof jest.fn>).mock
      .calls.filter((args) =>
        String(args[1] ?? "").toLowerCase().includes("disabled"),
      );
    expect(disabledWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test environment — seeding must proceed
// ---------------------------------------------------------------------------

describe("seedDemoUsers — test environment", () => {
  it("calls pool.connect() to begin database work", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "test");

    expect(pool.connect).toHaveBeenCalled();
  });

  it("issues INSERT INTO users (empty table path)", async () => {
    const logger = makeMockLogger();
    const { client, queries } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "test");

    const insertCalls = queries.filter((q) =>
      q.toLowerCase().includes("insert into users"),
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it("does not log the disabled warning", async () => {
    const logger = makeMockLogger();
    const { client } = makeMockClient();
    const pool = makeMockPool(client);

    await seedDemoUsers(pool as never, logger, "test");

    const disabledWarnings = (logger.warn as ReturnType<typeof jest.fn>).mock
      .calls.filter((args) =>
        String(args[1] ?? "").toLowerCase().includes("disabled"),
      );
    expect(disabledWarnings).toHaveLength(0);
  });
});
