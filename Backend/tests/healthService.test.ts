/**
 * Health Service — unit and HTTP-integration tests.
 *
 * Unit tests exercise getReadiness() and individual check functions directly
 * with lightweight mocks so every status/ready/criticality combination can be
 * tested without a real database or Redis instance.
 *
 * HTTP tests exercise GET /api/v1/ready end-to-end by creating a real Express
 * app (in-memory repos, no DB/Redis) and substituting only the healthService
 * dependency so the correct status codes are verified at the transport layer.
 */

import request from "supertest";

import { createApp } from "../src/app.js";
import { createAppDependencies } from "../src/bootstrap/dependencies.js";
import { loadConfig } from "../src/config/index.js";
import type { DatabasePool } from "../src/db/pool.js";
import type { RedisClient } from "../src/redis/client.js";
import {
  createHealthService,
  type HealthService,
  type ReadinessResult,
} from "../src/services/healthService.js";
import { createLogger } from "../src/utils/logger.js";
import {
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
  TEST_MFA_ENCRYPTION_KEY,
} from "./helpers/testApp.js";

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/** A pg.Pool mock whose query() resolves immediately — simulates a healthy DB. */
function makeHealthyPool(): DatabasePool {
  return {
    query: () =>
      Promise.resolve({
        rows: [{ "?column?": 1 }],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      }),
  } as unknown as DatabasePool;
}

/** A pg.Pool mock whose query() rejects — simulates an unreachable DB. */
function makeFailingPool(): DatabasePool {
  return {
    query: () =>
      Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
  } as unknown as DatabasePool;
}

/** An ioredis mock whose ping() resolves with "PONG" — simulates a healthy Redis. */
function makeHealthyRedis(): RedisClient {
  return {
    ping: () => Promise.resolve("PONG"),
  } as unknown as RedisClient;
}

/** An ioredis mock whose ping() rejects — simulates an unreachable Redis. */
function makeFailingRedis(): RedisClient {
  return {
    ping: () =>
      Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379")),
  } as unknown as RedisClient;
}

// ---------------------------------------------------------------------------
// HTTP test helper
// Creates a full Express app (in-memory repos, no real DB/Redis) but injects
// a custom healthService so the readiness probe reflects test-controlled state.
// ---------------------------------------------------------------------------
async function createAppWithHealthService(healthService: HealthService) {
  process.env["NODE_ENV"] = "test";
  process.env["JWT_ACCESS_SECRET"] = TEST_JWT_ACCESS_SECRET;
  process.env["JWT_REFRESH_SECRET"] = TEST_JWT_REFRESH_SECRET;
  process.env["CORS_ORIGIN"] = "http://localhost:5173";
  process.env["MFA_ENCRYPTION_KEY"] = TEST_MFA_ENCRYPTION_KEY;
  delete process.env["DATABASE_URL"];
  delete process.env["REDIS_URL"];

  const config = loadConfig();
  const logger = createLogger(config);
  const deps = await createAppDependencies(config, logger);
  // Spread the full in-memory deps and replace only the healthService.
  return createApp(config, logger, { ...deps, healthService });
}

// ---------------------------------------------------------------------------
// Unit tests — getReadiness() 4-state logic
// ---------------------------------------------------------------------------
describe("HealthService — getReadiness() status logic", () => {
  it("all healthy → status ok, ready true, HTTP 200", async () => {
    const svc = createHealthService(makeHealthyPool(), makeHealthyRedis());
    const result = await svc.getReadiness();

    expect(result.status).toBe("ok");
    expect(result.ready).toBe(true);
    expect(result.checks.database.status).toBe("ok");
    expect(result.checks.redis.status).toBe("ok");
  });

  it("only Redis down → status degraded, ready true (non-critical failure)", async () => {
    const svc = createHealthService(makeHealthyPool(), makeFailingRedis());
    const result = await svc.getReadiness();

    expect(result.status).toBe("degraded");
    expect(result.ready).toBe(true);
    expect(result.checks.database.status).toBe("ok");
    expect(result.checks.redis.status).toBe("error");
  });

  it("only DB down → status degraded, ready false (critical failure)", async () => {
    const svc = createHealthService(makeFailingPool(), makeHealthyRedis());
    const result = await svc.getReadiness();

    expect(result.status).toBe("degraded");
    expect(result.ready).toBe(false);
    expect(result.checks.database.status).toBe("error");
    expect(result.checks.redis.status).toBe("ok");
  });

  it("both down → status unavailable, ready false", async () => {
    const svc = createHealthService(makeFailingPool(), makeFailingRedis());
    const result = await svc.getReadiness();

    expect(result.status).toBe("unavailable");
    expect(result.ready).toBe(false);
    expect(result.checks.database.status).toBe("error");
    expect(result.checks.redis.status).toBe("error");
  });

  it("in-memory mode (null pool, null redis) → status ok, ready true", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.getReadiness();

    expect(result.status).toBe("ok");
    expect(result.ready).toBe(true);
  });

  it("result includes a valid ISO timestamp", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.getReadiness();

    expect(result.timestamp).toEqual(expect.any(String));
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — per-check criticality
// ---------------------------------------------------------------------------
describe("HealthService — criticality flags", () => {
  it("database check is always critical=true (healthy)", async () => {
    const svc = createHealthService(makeHealthyPool(), null);
    const result = await svc.checkDatabase();
    expect(result.critical).toBe(true);
  });

  it("database check is always critical=true (failing)", async () => {
    const svc = createHealthService(makeFailingPool(), null);
    const result = await svc.checkDatabase();
    expect(result.critical).toBe(true);
  });

  it("database check is critical=true in in-memory mode", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.checkDatabase();
    expect(result.critical).toBe(true);
  });

  it("redis check is always critical=false (healthy)", async () => {
    const svc = createHealthService(null, makeHealthyRedis());
    const result = await svc.checkRedis();
    expect(result.critical).toBe(false);
  });

  it("redis check is always critical=false (failing)", async () => {
    const svc = createHealthService(null, makeFailingRedis());
    const result = await svc.checkRedis();
    expect(result.critical).toBe(false);
  });

  it("redis check is critical=false in in-memory mode", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.checkRedis();
    expect(result.critical).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — latency and error messages
// ---------------------------------------------------------------------------
describe("HealthService — check details", () => {
  it("database error check includes an error message", async () => {
    const svc = createHealthService(makeFailingPool(), null);
    const result = await svc.checkDatabase();

    expect(result.status).toBe("error");
    expect(typeof result.message).toBe("string");
    expect(result.message).toMatch(/ECONNREFUSED/);
  });

  it("redis error check includes an error message", async () => {
    const svc = createHealthService(null, makeFailingRedis());
    const result = await svc.checkRedis();

    expect(result.status).toBe("error");
    expect(typeof result.message).toBe("string");
    expect(result.message).toMatch(/ECONNREFUSED/);
  });

  it("in-memory database check includes an in-memory message", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.checkDatabase();
    expect(result.message).toMatch(/in-memory/);
  });

  it("in-memory redis check includes an in-memory message", async () => {
    const svc = createHealthService(null, null);
    const result = await svc.checkRedis();
    expect(result.message).toMatch(/in-memory/);
  });

  it("latencyMs is a non-negative number in every scenario", async () => {
    const scenarios: HealthService[] = [
      createHealthService(makeHealthyPool(), makeHealthyRedis()),
      createHealthService(makeFailingPool(), makeFailingRedis()),
      createHealthService(null, null),
    ];

    for (const svc of scenarios) {
      const result = await svc.getReadiness();
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP tests — /api/v1/ready status codes
// ---------------------------------------------------------------------------
describe("GET /api/v1/ready — HTTP status codes", () => {
  it("all healthy → HTTP 200, ready true, status ok", async () => {
    const svc = createHealthService(makeHealthyPool(), makeHealthyRedis());
    const app = await createAppWithHealthService(svc);
    const res = await request(app).get("/api/v1/ready");

    expect(res.status).toBe(200);
    const body = res.body as ReadinessResult;
    expect(body.ready).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.checks.database.critical).toBe(true);
    expect(body.checks.redis.critical).toBe(false);
  });

  it("only Redis down → HTTP 200, ready true, status degraded", async () => {
    const svc = createHealthService(makeHealthyPool(), makeFailingRedis());
    const app = await createAppWithHealthService(svc);
    const res = await request(app).get("/api/v1/ready");

    expect(res.status).toBe(200);
    const body = res.body as ReadinessResult;
    expect(body.ready).toBe(true);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.redis.status).toBe("error");
    expect(body.checks.redis.critical).toBe(false);
  });

  it("DB down → HTTP 503, ready false, status degraded", async () => {
    const svc = createHealthService(makeFailingPool(), makeHealthyRedis());
    const app = await createAppWithHealthService(svc);
    const res = await request(app).get("/api/v1/ready");

    expect(res.status).toBe(503);
    const body = res.body as ReadinessResult;
    expect(body.ready).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("error");
    expect(body.checks.database.critical).toBe(true);
    expect(body.checks.redis.status).toBe("ok");
  });

  it("both down → HTTP 503, ready false, status unavailable", async () => {
    const svc = createHealthService(makeFailingPool(), makeFailingRedis());
    const app = await createAppWithHealthService(svc);
    const res = await request(app).get("/api/v1/ready");

    expect(res.status).toBe(503);
    const body = res.body as ReadinessResult;
    expect(body.ready).toBe(false);
    expect(body.status).toBe("unavailable");
    expect(body.checks.database.status).toBe("error");
    expect(body.checks.redis.status).toBe("error");
  });

  it("response body always includes timestamp", async () => {
    const svc = createHealthService(makeFailingPool(), makeFailingRedis());
    const app = await createAppWithHealthService(svc);
    const res = await request(app).get("/api/v1/ready");
    const body = res.body as ReadinessResult;

    expect(body.timestamp).toEqual(expect.any(String));
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it("no authentication required for readiness probe", async () => {
    const svc = createHealthService(null, null);
    const app = await createAppWithHealthService(svc);
    // Deliberately no Authorization header.
    const res = await request(app).get("/api/v1/ready");
    expect(res.status).toBe(200);
  });
});
