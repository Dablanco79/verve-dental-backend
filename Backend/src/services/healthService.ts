import type { DatabasePool } from "../db/pool.js";
import type { RedisClient } from "../redis/client.js";

export type HealthCheckResult = {
  status: "ok" | "error";
  /**
   * Whether this dependency is required for the application to serve any
   * authenticated or business-data routes.
   *
   * true  → failure makes the service not ready (HTTP 503).
   * false → failure degrades the service but does not block traffic.
   */
  critical: boolean;
  latencyMs: number;
  /** Informational note for ok-with-caveat states, or error description. */
  message?: string;
};

export type ReadinessStatus = "ok" | "degraded" | "unavailable";

export type ReadinessResult = {
  /**
   * Aggregate readiness status:
   *   "ok"          — all checks passed.
   *   "degraded"    — at least one check failed; see ready for traffic decision.
   *   "unavailable" — every configured dependency is unreachable.
   */
  status: ReadinessStatus;
  /**
   * True when the service should receive traffic.
   * False when a critical dependency is down and the pod/dyno should be
   * removed from the load-balancer rotation.
   *
   * Rules:
   *   all ok                  → ready = true,  HTTP 200
   *   only non-critical fail  → ready = true,  HTTP 200   (degraded, still serving)
   *   any critical fail       → ready = false, HTTP 503
   *   all configured fail     → ready = false, HTTP 503
   */
  ready: boolean;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
  };
  timestamp: string;
};

export type HealthService = ReturnType<typeof createHealthService>;

export function createHealthService(
  databasePool: DatabasePool | null,
  redisClient: RedisClient | null,
) {
  async function checkDatabase(): Promise<HealthCheckResult> {
    if (!databasePool) {
      // No DATABASE_URL configured — running with in-memory repositories.
      // Treated as ok because the application IS operational in this mode.
      return {
        status: "ok",
        critical: true,
        latencyMs: 0,
        message: "using in-memory repository",
      };
    }

    const start = Date.now();
    try {
      await databasePool.query("SELECT 1");
      return { status: "ok", critical: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: "error",
        critical: true,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : "Unknown database error",
      };
    }
  }

  async function checkRedis(): Promise<HealthCheckResult> {
    if (!redisClient) {
      // No REDIS_URL configured — using in-memory session store.
      // Treated as ok; the app degrades gracefully without Redis.
      return {
        status: "ok",
        critical: false,
        latencyMs: 0,
        message: "using in-memory session store",
      };
    }

    const start = Date.now();
    try {
      await redisClient.ping();
      return { status: "ok", critical: false, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: "error",
        critical: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : "Unknown Redis error",
      };
    }
  }

  async function getReadiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const dbOk = database.status === "ok";
    const redisOk = redis.status === "ok";

    // Evaluate in priority order — "unavailable" is more specific than "degraded".
    let status: ReadinessStatus;
    let ready: boolean;

    if (dbOk && redisOk) {
      // All dependencies healthy.
      status = "ok";
      ready = true;
    } else if (!dbOk && !redisOk) {
      // Every configured dependency is unreachable — nothing is working.
      status = "unavailable";
      ready = false;
    } else if (!dbOk) {
      // A critical dependency (PostgreSQL) is down.
      // The app cannot serve business-data routes without the database.
      status = "degraded";
      ready = false;
    } else {
      // Only non-critical dependencies (Redis) are down.
      // Core routes still serve; session refresh/revocation is degraded.
      status = "degraded";
      ready = true;
    }

    return {
      status,
      ready,
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  return { checkDatabase, checkRedis, getReadiness };
}
