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

import {
  getCurrentTenantCtx,
  installRlsPoolHook,
  rlsTenantContextMiddleware,
  runWithTenantContext,
} from "../tenantContext.js";
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

// ─── Regression: sequential pool.query() calls in one request ─────────────────
//
// PATCH /clinics/:clinicId (updateClinic) makes TWO sequential pool.query()
// calls — one for findById (SELECT) and one for update (UPDATE).  Before the
// WeakSet fix, each checkout wrapped client.release() again, building a chain
// of N async reset queries that grew with every reuse.  After N checkouts the
// chain held the connection "in use" for N round-trips, and while it was busy
// the pool had to create a new connection for the second query.  If that new
// connection stalled (e.g. PostgreSQL max_connections reached), the second
// pool.query() waited indefinitely — causing the 30-second hang.
//
// These tests prove that both sequential pool.query() calls resolve, that the
// wrapper chain never grows beyond one level, and that tenant context cannot
// leak across requests on the same physical connection.

describe("installRlsPoolHook — regression: sequential checkouts in one request", () => {
  it("two sequential pool.query() calls in one request context both resolve", async () => {
    const bundle1 = makeMockClient();
    const bundle2 = makeMockClient();
    let connectCallCount = 0;

    // Simulate a pool that issues C1 on the first checkout and C2 on the
    // second (mirroring real pg behaviour: C1 is still in the async-reset
    // "in use" window when the second checkout fires, so the pool creates C2).
    const pool = {
      connect: jest.fn().mockImplementation(() => {
        connectCallCount++;
        return Promise.resolve(connectCallCount === 1 ? bundle1.client : bundle2.client);
      }),
    } as unknown as DatabasePool;
    installRlsPoolHook(pool);

    const resolved: string[] = [];

    await withRlsContext(async () => {
      // First pool.query() — mirrors clinicRepository.findById
      const r1 = await new Promise<string>((resolve, reject) => {
        void (pool as unknown as PoolWithCb).connect((err, c, done) => {
          if (err !== null || c === null) {
            reject(err ?? new Error("no client"));
            return;
          }
          void c
            .query("SELECT id FROM clinics WHERE id = $1", ["clinic-1"])
            .then(() => { done(); resolve("select"); })
            .catch((e: unknown) => {
              reject(e instanceof Error ? e : new Error(String(e)));
            });
        });
      });
      resolved.push(r1);

      // Second pool.query() — mirrors clinicRepository.update
      const r2 = await new Promise<string>((resolve, reject) => {
        void (pool as unknown as PoolWithCb).connect((err, c, done) => {
          if (err !== null || c === null) {
            reject(err ?? new Error("no client"));
            return;
          }
          void c
            .query("UPDATE clinics SET name = $1 WHERE id = $2", ["Verve", "clinic-1"])
            .then(() => { done(); resolve("update"); })
            .catch((e: unknown) => {
              reject(e instanceof Error ? e : new Error(String(e)));
            });
        });
      });
      resolved.push(r2);
    }, { clinicId: "clinic-1" });

    // Both calls must have resolved — no hang
    expect(resolved).toEqual(["select", "update"]);
    // Each call checked out its own connection
    expect(connectCallCount).toBe(2);

    // Allow both async resets to drain
    await new Promise<void>((r) => { setTimeout(r, 50); });

    // C1 must have had exactly one reset query (not a growing chain)
    const c1Resets = bundle1.client.queries.filter(
      (q) => q.sql.includes("set_config") && q.params.length === 0,
    );
    expect(c1Resets).toHaveLength(1);

    // C2 must also have exactly one reset query
    const c2Resets = bundle2.client.queries.filter(
      (q) => q.sql.includes("set_config") && q.params.length === 0,
    );
    expect(c2Resets).toHaveLength(1);
  });
});

// ─── Regression: no nested release wrappers on repeated reuse ─────────────────

describe("installRlsPoolHook — regression: no nested release wrappers", () => {
  it("does not nest release wrappers across repeated checkout-release cycles", async () => {
    const CYCLES = 5;
    const bundle = makeMockClient();
    const pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);

    // Execute CYCLES sequential checkout-query-release cycles on the SAME
    // physical connection (the mock always returns bundle.client).
    for (let i = 0; i < CYCLES; i++) {
      await withRlsContext(
        async () => {
          const client = await pool.connect();
          await client.query("SELECT " + String(i));
          // Call the (possibly wrapped) release
          client.release();
          // Let the async reset microtask complete before the next iteration
          await new Promise<void>((r) => { setTimeout(r, 20); });
        },
        { clinicId: "clinic-cycle-" + String(i) },
      );
    }

    // Count reset queries — queries that clear the session variables.
    // Injection queries carry positional params ($1, $2); reset queries use
    // inline empty-string literals and are called with no params array.
    const resetQueries = bundle.client.queries.filter(
      (q) => q.sql.includes("set_config") && q.params.length === 0,
    );

    // With the fix:  CYCLES resets (one per checkout, chain depth = 1).
    // Without the fix: 1+2+3+…+CYCLES = CYCLES*(CYCLES+1)/2 resets because
    // each re-wrap adds another async reset to the chain.
    expect(resetQueries).toHaveLength(CYCLES);

    // originalRelease must have been called exactly once per checkout
    expect(bundle.releaseMock).toHaveBeenCalledTimes(CYCLES);
    // … and never with an error argument (healthy release path)
    expect(bundle.releaseMock).not.toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── Regression: tenant context isolation between requests ────────────────────

describe("installRlsPoolHook — regression: context isolation between requests", () => {
  it("tenant context from request A does not leak into request B on the same connection", async () => {
    const bundle = makeMockClient();
    const pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);

    // Request A — uses clinic-AAAA
    await withRlsContext(
      async () => {
        const client = await pool.connect();
        await client.query("SELECT 'request A'");
        client.release();
        // Wait for the async reset to finish recording before request B starts
        await new Promise<void>((r) => { setTimeout(r, 20); });
      },
      { clinicId: "clinic-AAAA" },
    );

    // Request B — uses clinic-BBBB (same physical connection reused by mock)
    await withRlsContext(
      async () => {
        const client = await pool.connect();
        await client.query("SELECT 'request B'");
        client.release();
        await new Promise<void>((r) => { setTimeout(r, 20); });
      },
      { clinicId: "clinic-BBBB" },
    );

    // Segregate the set_config calls recorded by the mock
    const allSetConfig = bundle.client.queries.filter((q) =>
      q.sql.includes("set_config"),
    );
    // Injection queries supply the clinic ID as a bound parameter
    const injections = allSetConfig.filter((q) => q.params.length > 0);
    // Reset queries use inline empty literals — no bound params
    const resets = allSetConfig.filter((q) => q.params.length === 0);

    // Exactly one injection and one reset per request
    expect(injections).toHaveLength(2);
    expect(resets).toHaveLength(2);

    // Each injection targets the correct clinic
    expect(injections[0]?.params[0]).toBe("clinic-AAAA");
    expect(injections[1]?.params[0]).toBe("clinic-BBBB");

    // CRITICAL: reset-A must appear in the query log BEFORE inject-B.
    // This proves that the connection was fully cleared of clinic-AAAA's
    // context before it was assigned clinic-BBBB's context — no leakage.
    const queryLog = bundle.client.queries;
    // Length assertions above guarantee these elements exist; use type casts
    // instead of non-null assertions to satisfy the no-non-null-assertion rule.
    const resetA = resets[0] as QueryArgs;
    const injectB = injections[1] as QueryArgs;
    const idxOfResetA = queryLog.indexOf(resetA);
    const idxOfInjectB = queryLog.indexOf(injectB);
    expect(idxOfResetA).toBeGreaterThanOrEqual(0);
    expect(idxOfInjectB).toBeGreaterThan(idxOfResetA);
  });
});

// ─── runWithTenantContext — explicit context for non-middleware code paths ─────
//
// Master Product Library import provisions clinic_inventory_items rows from a
// GLOBAL route (/master-products/import) that never passes through
// rlsTenantContextMiddleware. runWithTenantContext() is the mechanism that
// establishes an RLS context in exactly that situation. These tests prove it
// drives the same installRlsPoolHook injection path as the middleware does,
// and that the context does not leak outside its callback.

describe("runWithTenantContext — explicit context for global (non-clinic-scoped) routes", () => {
  let bundle: MockClientBundle;
  let pool: DatabasePool;

  beforeEach(() => {
    bundle = makeMockClient();
    pool = makeMockPool(bundle.client);
    installRlsPoolHook(pool);
  });

  it("injects set_config for the given clinicId and ownerAdmin=true", async () => {
    await runWithTenantContext("clinic-owner-admin-1", true, async () => {
      await pool.connect();
    });

    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery).toBeDefined();
    expect(rlsQuery?.params).toContain("clinic-owner-admin-1");
    expect(rlsQuery?.params).toContain("true");
  });

  it("injects set_config for the given clinicId and ownerAdmin=false", async () => {
    await runWithTenantContext("clinic-manager-1", false, async () => {
      await pool.connect();
    });

    const rlsQuery = bundle.client.queries.find((q) => q.sql.includes("set_config"));
    expect(rlsQuery).toBeDefined();
    expect(rlsQuery?.params).toContain("clinic-manager-1");
    expect(rlsQuery?.params).toContain("false");
  });

  it("exposes the active context via getCurrentTenantCtx() only inside the callback", async () => {
    expect(getCurrentTenantCtx()).toBeNull();

    let capturedInside: ReturnType<typeof getCurrentTenantCtx> = null;
    await runWithTenantContext("clinic-scoped-1", true, () => {
      capturedInside = getCurrentTenantCtx();
      return Promise.resolve();
    });

    expect(capturedInside).toEqual({ clinicId: "clinic-scoped-1", ownerAdmin: true });
    expect(getCurrentTenantCtx()).toBeNull();
  });

  it("propagates the callback's return value and rejection", async () => {
    const value = await runWithTenantContext("clinic-x", false, () => Promise.resolve(42));
    expect(value).toBe(42);

    await expect(
      runWithTenantContext("clinic-x", false, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
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
