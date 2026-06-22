/**
 * tenantContext.test.ts — unit tests for installRlsPoolHook
 *
 * Regression suite proving:
 *   1. pool.query() resolves after installRlsPoolHook (the production bug)
 *   2. Promise-form pool.connect() returns a client
 *   3. Callback-form pool.connect() invokes the callback
 *   4. RLS context is injected when a tenant context is active
 *   5. client.release(err) destroys the connection without resetting RLS
 *   6. client.release() resets RLS and then calls originalRelease
 *
 * No real database connection is used.  All pg interactions are mocked.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { PoolClient } from "pg";

import { installRlsPoolHook, rlsTenantContextMiddleware } from "../tenantContext.js";
import type { DatabasePool } from "../pool.js";

// ─── Mock helpers ──────────────────────────────────────────────────────────────

type QueryArgs = { sql: string; params: unknown[] };

/** Return value of makeMockClient, keeping the release fn typed as jest.Mock. */
type MockClientBundle = {
  client: PoolClient & { queries: QueryArgs[] };
  releaseMock: jest.Mock<(err?: Error) => void>;
  queryMock: jest.Mock;
};

/**
 * Creates a mock PoolClient whose query() always resolves and records calls.
 * Returns the client and its mock functions separately so tests can assert on
 * them without triggering the `unbound-method` lint rule.
 */
function makeMockClient(): MockClientBundle {
  const queries: QueryArgs[] = [];

  const queryMock = jest.fn().mockImplementation((...args: unknown[]) => {
    const sql = typeof args[0] === "string" ? args[0] : "";
    const params = Array.isArray(args[1]) ? (args[1] as unknown[]) : [];
    queries.push({ sql, params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const releaseMock = jest.fn<(err?: Error) => void>();

  const client = {
    query: queryMock,
    release: releaseMock,
    queries,
  } as unknown as PoolClient & { queries: QueryArgs[] };

  return { client, releaseMock, queryMock };
}

/**
 * Creates a mock DatabasePool whose connect() resolves to the given client.
 */
function makeMockPool(client: PoolClient): DatabasePool {
  return {
    connect: jest.fn().mockImplementation(() => Promise.resolve(client)),
  } as unknown as DatabasePool;
}

// ─── Callback-form type alias ─────────────────────────────────────────────────

type ConnectCallback = (
  err: Error | null,
  client: PoolClient | null,
  release: (err?: Error) => void,
) => void;

type PoolWithCb = {
  connect: (cb?: ConnectCallback) => Promise<PoolClient> | undefined;
};

// ─── Helper: run callback inside a tenant RLS context ─────────────────────────

/**
 * Executes `fn` inside an active tenant context by invoking the
 * rlsTenantContextMiddleware with a synthetic request.
 *
 * rlsTenantContextMiddleware calls tenantStorage.run(ctx, next) synchronously,
 * so `fn` executes within the correct AsyncLocalStorage scope.
 */
async function withRlsContext(
  fn: () => Promise<void>,
  opts: { role?: "owner_admin" | "clinical_staff"; clinicId?: string } = {},
): Promise<void> {
  const role = opts.role ?? "owner_admin";
  const clinicId = opts.clinicId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const req = {
    user: {
      role,
      homeClinicId: clinicId,
      id: "user-1",
      email: "test@example.com",
    },
    params: {},
  };

  const middleware = rlsTenantContextMiddleware();

  await new Promise<void>((resolve, reject) => {
    middleware(req as never, {} as never, () => {
      fn().then(
        () => { resolve(); },
        (err: unknown) => { reject(err instanceof Error ? err : new Error(String(err))); },
      );
    });
  });
}

// ─── No-context path ──────────────────────────────────────────────────────────

describe("installRlsPoolHook — no active tenant context", () => {
  let bundle: MockClientBundle;
  let pool: DatabasePool;

  beforeEach(() => {
    bundle = makeMockClient();
    pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);
  });

  it("promise form: await pool.connect() returns a client", async () => {
    const result = await pool.connect();
    expect(result).toBe(bundle.client);
  });

  it("callback form: pool.connect(cb) invokes the callback with the client", async () => {
    const received = await new Promise<{ err: Error | null; c: PoolClient | null }>(
      (resolve) => {
        void (pool as unknown as PoolWithCb).connect((err, c) => {
          resolve({ err, c });
        });
      },
    );

    expect(received.err).toBeNull();
    expect(received.c).toBe(bundle.client);
  });

  it("callback form: done() calls client.release()", async () => {
    await new Promise<void>((resolve) => {
      void (pool as unknown as PoolWithCb).connect((_err, _c, done) => {
        done();
        resolve();
      });
    });

    expect(bundle.releaseMock).toHaveBeenCalled();
  });

  it("no RLS set_config query is issued when there is no tenant context", async () => {
    await pool.connect();
    const rlsQueries = bundle.client.queries.filter((q) => q.sql.includes("set_config"));
    expect(rlsQueries).toHaveLength(0);
  });

  // ── pool.query() simulation ────────────────────────────────────────────────
  // pg.Pool.query() calls pool.connect(callback) internally.  This test
  // simulates that pattern to prove the production hang is fixed.

  it("pool.query() simulation: callback form resolves the query", async () => {
    const queryResult = await new Promise<string>((resolve, reject) => {
      void (pool as unknown as PoolWithCb).connect((err, c, done) => {
        if (err !== null || c === null) {
          reject(err ?? new Error("no client"));
          return;
        }
        void c.query("SELECT 1").then(() => {
          done();
          resolve("query resolved");
        });
      });
    });

    expect(queryResult).toBe("query resolved");
  });
});

// ─── Active tenant context path ────────────────────────────────────────────────

describe("installRlsPoolHook — active tenant context", () => {
  let bundle: MockClientBundle;
  let pool: DatabasePool;

  beforeEach(() => {
    bundle = makeMockClient();
    pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);
  });

  it("promise form: injects set_config for current_clinic_id and owner_admin_mode", async () => {
    await withRlsContext(async () => {
      await pool.connect();
    }, { clinicId: "clinic-uuid-111" });

    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery).toBeDefined();
    expect(rlsQuery?.params).toContain("clinic-uuid-111");
    expect(rlsQuery?.params).toContain("true"); // owner_admin → ownerAdmin=true
  });

  it("callback form: injects RLS context before invoking the callback", async () => {
    await withRlsContext(async () => {
      await new Promise<void>((resolve, reject) => {
        void (pool as unknown as PoolWithCb).connect((err) => {
          if (err) { reject(err); return; }
          resolve();
        });
      });
    }, { clinicId: "clinic-uuid-222" });

    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery).toBeDefined();
    expect(rlsQuery?.params).toContain("clinic-uuid-222");
  });

  it("callback form: pool.query() simulation resolves with RLS context active", async () => {
    let resolved = false;

    await withRlsContext(async () => {
      resolved = await new Promise<boolean>((resolve, reject) => {
        void (pool as unknown as PoolWithCb).connect((err, c, done) => {
          if (err !== null || c === null) {
            reject(err ?? new Error("no client"));
            return;
          }
          void c
            .query("SELECT * FROM users WHERE home_clinic_id = $1", ["clinic-abc"])
            .then(
              () => { done(); resolve(true); },
              (qErr: unknown) => {
                done(qErr instanceof Error ? qErr : new Error(String(qErr)));
                reject(qErr instanceof Error ? qErr : new Error(String(qErr)));
              },
            );
        });
      });
    });

    expect(resolved).toBe(true);

    // RLS set_config should have been called
    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery).toBeDefined();
  });

  it("non-owner role sets owner_admin_mode to 'false'", async () => {
    await withRlsContext(async () => {
      await pool.connect();
    }, { role: "clinical_staff", clinicId: "clinic-uuid-333" });

    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery?.params).toContain("false");
    expect(rlsQuery?.params).not.toContain("true");
  });
});

// ─── client.release() behaviour ───────────────────────────────────────────────

describe("installRlsPoolHook — client.release() behaviour", () => {
  let bundle: MockClientBundle;
  let pool: DatabasePool;

  beforeEach(() => {
    bundle = makeMockClient();
    pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);
  });

  it("release(err) skips the RLS reset query and destroys the connection", async () => {
    const destroyError = new Error("query failed");
    let wrappedClient: PoolClient | null = null;

    await withRlsContext(async () => {
      wrappedClient = await pool.connect();
    });

    expect(wrappedClient).not.toBeNull();
    const queryCountBeforeRelease = bundle.client.queries.length;

    // Call release with an error — should destroy immediately, NOT run a reset query
    (wrappedClient as unknown as PoolClient).release(destroyError);

    // Give any async operations a tick to complete
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });

    const newQueries = bundle.client.queries.slice(queryCountBeforeRelease);
    expect(newQueries.filter((q) => q.sql.includes("set_config"))).toHaveLength(0);
    expect(bundle.releaseMock).toHaveBeenCalledWith(destroyError);
  });

  it("release() (no error) issues the RLS reset query then calls originalRelease", async () => {
    let wrappedClient: PoolClient | null = null;

    await withRlsContext(async () => {
      wrappedClient = await pool.connect();
    });

    expect(wrappedClient).not.toBeNull();
    const queryCountBeforeRelease = bundle.client.queries.length;

    (wrappedClient as unknown as PoolClient).release();

    // The reset is async — wait for it
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });

    const resetQueries = bundle.client.queries
      .slice(queryCountBeforeRelease)
      .filter((q) => q.sql.includes("set_config('app.current_clinic_id', '',"));

    expect(resetQueries.length).toBeGreaterThanOrEqual(1);

    // originalRelease should eventually be called without an error argument
    expect(bundle.releaseMock).toHaveBeenCalledWith();
  });
});

// ─── Fail-closed: injection failure ───────────────────────────────────────────

describe("installRlsPoolHook — injection failure is fail-closed", () => {
  it("destroys the connection and throws when set_config fails", async () => {
    const injectionError = new Error("pg connection reset");
    const failBundle = makeMockClient();

    // Make the set_config query fail
    failBundle.queryMock.mockImplementation((...args: unknown[]) => {
      const sql = typeof args[0] === "string" ? args[0] : "";
      if (sql.includes("set_config")) {
        return Promise.reject(injectionError);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const failPool = makeMockPool(failBundle.client);
    installRlsPoolHook(failPool);

    await expect(
      withRlsContext(async () => {
        await failPool.connect();
      }),
    ).rejects.toThrow("RLS context injection failed");

    // The connection must be destroyed, not returned to the pool
    expect(failBundle.releaseMock).toHaveBeenCalledWith(expect.any(Error));
  });

  it("callback form: invokes cb(err) when injection fails", async () => {
    const injectionError = new Error("pg timeout");
    const failBundle = makeMockClient();

    failBundle.queryMock.mockImplementation((...args: unknown[]) => {
      const sql = typeof args[0] === "string" ? args[0] : "";
      if (sql.includes("set_config")) {
        return Promise.reject(injectionError);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const failPool = makeMockPool(failBundle.client);
    installRlsPoolHook(failPool);

    const receivedErr = await new Promise<Error | null>((resolve) => {
      withRlsContext(async () => {
        await new Promise<void>((innerResolve) => {
          void (failPool as unknown as PoolWithCb).connect((err) => {
            resolve(err);
            innerResolve();
          });
        });
      }).catch((err: unknown) => {
        resolve(err instanceof Error ? err : new Error(String(err)));
      });
    });

    expect(receivedErr).toBeInstanceOf(Error);
  });
});
