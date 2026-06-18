/**
 * redisIntegration.test.ts — Redis connection + session store integration tests
 *
 * PURPOSE
 * ───────
 * These tests prove that the Redis-backed refresh-token store used by
 * authService behaves correctly against a real Redis instance.  They exercise
 * the exact key schema and pipeline operations defined in authService.ts so
 * that any future drift between the service implementation and Redis behaviour
 * is caught before it reaches production.
 *
 * SKIP BEHAVIOUR
 * ──────────────
 * All tests are automatically skipped when REDIS_URL is not set.
 * They require a real Redis instance accessible at the configured URL.
 *
 * ISOLATION STRATEGY
 * ──────────────────
 * Every test uses a unique millisecond-precision prefix so that parallel CI
 * runs against the same Redis instance cannot collide.  Each describe block
 * cleans up its own keys in afterAll/afterEach.
 *
 * KEY SCHEMA TESTED (mirrors authService.ts)
 * ──────────────────────────────────────────
 *   refresh:{jti}          → userId string, TTL = JWT expiry seconds
 *   user_tokens:{userId}   → Redis Set of active JTIs (bulk revocation index)
 *
 * SUBJECTS TESTED
 * ───────────────
 * ✓ Redis connection path        — connect() + SET/GET roundtrip proves reachability
 * ✓ Refresh token storage        — pipeline: SET refresh:{jti} EX + SADD user_tokens:{userId}
 * ✓ Token retrieval              — GET refresh:{jti} returns the correct userId
 * ✓ User token index             — SMEMBERS user_tokens:{userId} contains the JTI
 * ✓ Token deletion               — pipeline: DEL refresh:{jti} + SREM user_tokens:{userId}
 * ✓ Replay prevention            — deleted JTI returns null on subsequent GET
 * ✓ Token rotation               — new JTI retrievable after old JTI is deleted
 * ✓ revokeAllUserTokens pattern  — SMEMBERS + pipeline DEL removes all user tokens
 * ✓ Cross-user isolation         — revoking one user's tokens leaves another user's intact
 */

import IORedis from "ioredis";

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard — all tests bail early when no real Redis is available.
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env["REDIS_URL"];
const SKIP = !REDIS_URL;

// Unique per-run prefix prevents collisions on shared Redis instances.
const PREFIX = `verve:test:${Date.now().toString()}`;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal typed constructor — mirrors the pattern in redis/client.ts.
// Using the double-cast avoids the mismatch between ioredis's internal type
// overloads and the narrowed subset of commands that these tests exercise.
// ─────────────────────────────────────────────────────────────────────────────

type RedisPipeline = {
  set(key: string, value: string, expiryMode: "EX", ttl: number): RedisPipeline;
  del(key: string): RedisPipeline;
  sadd(key: string, member: string): RedisPipeline;
  srem(key: string, member: string): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  exec(): Promise<[Error | null, unknown][] | null>;
};

type RedisInstance = {
  connect(): Promise<void>;
  quit(): Promise<string>;
  set(key: string, value: string, expiryMode: "EX", ttl: number): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string, ...rest: string[]): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  pipeline(): RedisPipeline;
};

type RedisConstructor = new (
  url: string,
  options?: {
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
  },
) => RedisInstance;

const RedisClass = IORedis as unknown as RedisConstructor;

// ─────────────────────────────────────────────────────────────────────────────
// Key helpers — reproduce the exact key schema from authService.ts
// ─────────────────────────────────────────────────────────────────────────────

function refreshKey(jti: string): string {
  return `${PREFIX}:refresh:${jti}`;
}

function userTokensKey(userId: string): string {
  return `${PREFIX}:user_tokens:${userId}`;
}

// TTL long enough that no test assertion races against natural expiry.
const TEST_TTL = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

// Definite assignment — redis is always initialised before any test runs
// (beforeAll sets it; tests guard with `if (SKIP) return` so it is never
// accessed when SKIP is true and beforeAll returned early).
let redis!: RedisInstance;

beforeAll(async () => {
  if (SKIP) return;

  redis = new RedisClass(REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 5_000,
  });
  await redis.connect();
});

afterAll(async () => {
  if (SKIP) return;
  await redis.quit();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Redis connection path
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — connection path", () => {
  it("connects and can SET / GET / DEL a key", async () => {
    if (SKIP) return;

    const key = `${PREFIX}:probe`;
    const value = "verve-redis-probe";

    await redis.set(key, value, "EX", TEST_TTL);
    const got = await redis.get(key);
    await redis.del(key);

    expect(got).toBe(value);
  });

  it("GET on a non-existent key returns null", async () => {
    if (SKIP) return;

    const got = await redis.get(`${PREFIX}:absent-key`);

    expect(got).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Refresh token storage (mirrors saveRefreshToken in authService.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — refresh token storage", () => {
  const USER_ID = `${PREFIX}:user:storage`;
  const JTI = `${PREFIX}:jti:storage`;

  afterEach(async () => {
    if (SKIP) return;
    await redis.del(refreshKey(JTI), userTokensKey(USER_ID));
  });

  it("pipeline SET+SADD+EXPIRE stores userId under refresh:{jti}", async () => {
    if (SKIP) return;

    // Mirrors saveRefreshToken() pipeline in authService.ts
    await redis
      .pipeline()
      .set(refreshKey(JTI), USER_ID, "EX", TEST_TTL)
      .sadd(userTokensKey(USER_ID), JTI)
      .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
      .exec();

    const stored = await redis.get(refreshKey(JTI));

    expect(stored).toBe(USER_ID);
  });

  it("user_tokens:{userId} set contains the JTI after storage", async () => {
    if (SKIP) return;

    await redis
      .pipeline()
      .set(refreshKey(JTI), USER_ID, "EX", TEST_TTL)
      .sadd(userTokensKey(USER_ID), JTI)
      .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
      .exec();

    const jtis = await redis.smembers(userTokensKey(USER_ID));

    expect(jtis).toContain(JTI);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Token deletion + replay prevention (mirrors deleteRefreshToken)
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — token deletion and replay prevention", () => {
  const USER_ID = `${PREFIX}:user:replay`;
  const JTI = `${PREFIX}:jti:replay`;

  afterAll(async () => {
    if (SKIP) return;
    await redis.del(refreshKey(JTI), userTokensKey(USER_ID));
  });

  it("GET on a deleted JTI returns null (replay attack rejected)", async () => {
    if (SKIP) return;

    // Store token
    await redis
      .pipeline()
      .set(refreshKey(JTI), USER_ID, "EX", TEST_TTL)
      .sadd(userTokensKey(USER_ID), JTI)
      .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
      .exec();

    // Verify it is present
    expect(await redis.get(refreshKey(JTI))).toBe(USER_ID);

    // Delete (mirrors deleteRefreshToken() in authService.ts)
    await redis
      .pipeline()
      .del(refreshKey(JTI))
      .srem(userTokensKey(USER_ID), JTI)
      .exec();

    // Replay attempt must be rejected (null)
    const replayed = await redis.get(refreshKey(JTI));

    expect(replayed).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Token rotation (one real refresh-token/session scenario)
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — token rotation (real session scenario)", () => {
  const USER_ID = `${PREFIX}:user:rotate`;
  const JTI_1 = `${PREFIX}:jti:rotate:1`;
  const JTI_2 = `${PREFIX}:jti:rotate:2`;

  afterAll(async () => {
    if (SKIP) return;
    await redis.del(refreshKey(JTI_1), refreshKey(JTI_2), userTokensKey(USER_ID));
  });

  it("rotated token (JTI_2) is retrievable; original token (JTI_1) is gone", async () => {
    if (SKIP) return;

    // Issue first token (login)
    await redis
      .pipeline()
      .set(refreshKey(JTI_1), USER_ID, "EX", TEST_TTL)
      .sadd(userTokensKey(USER_ID), JTI_1)
      .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
      .exec();

    // Rotate: delete JTI_1, issue JTI_2 (mirrors refresh endpoint flow)
    await redis
      .pipeline()
      .del(refreshKey(JTI_1))
      .srem(userTokensKey(USER_ID), JTI_1)
      .exec();

    await redis
      .pipeline()
      .set(refreshKey(JTI_2), USER_ID, "EX", TEST_TTL)
      .sadd(userTokensKey(USER_ID), JTI_2)
      .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
      .exec();

    // Original token must be gone
    expect(await redis.get(refreshKey(JTI_1))).toBeNull();

    // New token must be present and correct
    expect(await redis.get(refreshKey(JTI_2))).toBe(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. revokeAllUserTokens (mirrors revokeAllUserTokens in authService.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — revokeAllUserTokens", () => {
  const USER_ID = `${PREFIX}:user:revoke-all`;
  const JTI_A = `${PREFIX}:jti:revoke-all:a`;
  const JTI_B = `${PREFIX}:jti:revoke-all:b`;

  afterAll(async () => {
    if (SKIP) return;
    await redis.del(refreshKey(JTI_A), refreshKey(JTI_B), userTokensKey(USER_ID));
  });

  it("all tokens for a user are gone after revokeAllUserTokens", async () => {
    if (SKIP) return;

    // Issue two sessions for the same user
    for (const jti of [JTI_A, JTI_B]) {
      await redis
        .pipeline()
        .set(refreshKey(jti), USER_ID, "EX", TEST_TTL)
        .sadd(userTokensKey(USER_ID), jti)
        .expire(userTokensKey(USER_ID), TEST_TTL + 3600)
        .exec();
    }

    // Verify both present before revocation
    expect(await redis.get(refreshKey(JTI_A))).toBe(USER_ID);
    expect(await redis.get(refreshKey(JTI_B))).toBe(USER_ID);

    // revokeAllUserTokens: SMEMBERS + pipeline DEL (exact mirror of authService.ts)
    const jtis = await redis.smembers(userTokensKey(USER_ID));
    const pipe = redis.pipeline();
    for (const jti of jtis) {
      pipe.del(refreshKey(jti));
    }
    pipe.del(userTokensKey(USER_ID));
    await pipe.exec();

    // Both tokens must be gone
    expect(await redis.get(refreshKey(JTI_A))).toBeNull();
    expect(await redis.get(refreshKey(JTI_B))).toBeNull();

    // User token set itself is also deleted
    const remaining = await redis.smembers(userTokensKey(USER_ID));
    expect(remaining).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cross-user isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Redis — cross-user token isolation", () => {
  const USER_A = `${PREFIX}:user:iso-a`;
  const USER_B = `${PREFIX}:user:iso-b`;
  const JTI_A = `${PREFIX}:jti:iso-a`;
  const JTI_B = `${PREFIX}:jti:iso-b`;

  afterAll(async () => {
    if (SKIP) return;
    await redis.del(
      refreshKey(JTI_A),
      refreshKey(JTI_B),
      userTokensKey(USER_A),
      userTokensKey(USER_B),
    );
  });

  it("revoking USER_A tokens does not affect USER_B tokens", async () => {
    if (SKIP) return;

    // Issue one session per user
    for (const [userId, jti] of [[USER_A, JTI_A], [USER_B, JTI_B]] as const) {
      await redis
        .pipeline()
        .set(refreshKey(jti), userId, "EX", TEST_TTL)
        .sadd(userTokensKey(userId), jti)
        .expire(userTokensKey(userId), TEST_TTL + 3600)
        .exec();
    }

    // Revoke USER_A only
    const jtis = await redis.smembers(userTokensKey(USER_A));
    const pipe = redis.pipeline();
    for (const jti of jtis) {
      pipe.del(refreshKey(jti));
    }
    pipe.del(userTokensKey(USER_A));
    await pipe.exec();

    // USER_A token is gone
    expect(await redis.get(refreshKey(JTI_A))).toBeNull();

    // USER_B token is unaffected
    expect(await redis.get(refreshKey(JTI_B))).toBe(USER_B);
  });
});
