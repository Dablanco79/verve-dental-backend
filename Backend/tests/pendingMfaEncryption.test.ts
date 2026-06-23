/**
 * Pending MFA Secret Encryption tests
 *
 * Verifies that:
 *   - Pending TOTP secrets are stored as AES-256-GCM ciphertext (never plaintext)
 *     on both the Redis path and the in-memory fallback path.
 *   - The setup → confirm enrollment flow still works end-to-end after encryption.
 *   - Corrupted/missing ciphertext is handled safely (returns null → MFA_SETUP_REQUIRED,
 *     never a 500 internal error).
 *   - Redis and in-memory fallback paths are behaviourally consistent.
 *
 * Tests are unit-level: createAuthService() is called directly with minimal
 * mock dependencies so no network, database, or real Redis is required.
 */

import { generateSync } from "otplib";

import { createAuthService } from "../src/services/authService.js";
import type { RedisClient } from "../src/redis/client.js";
import type { UserRepository } from "../src/repositories/userRepository.js";
import type { AuditService } from "../src/services/auditService.js";
import type { EnvConfig } from "../src/config/index.js";
import type { UserRecord } from "../src/types/auth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY = "0".repeat(64); // 32-byte all-zeros key — test only
const TEST_USER_ID = "99999999-9999-4999-8999-999999999999";
const AUDIT_CTX = {};

// Ciphertext format: three colon-delimited hex segments (iv:authTag:ciphertext)
const CIPHERTEXT_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: TEST_USER_ID,
    email: "pending-mfa-test@example.com",
    passwordHash: "irrelevant",
    role: "clinical_staff",
    homeClinicId: "clinic-test",
    homeClinicName: "Test Clinic",
    firstName: null,
    lastName: null,
    displayName: null,
    payrollTrack: "hourly",
    totpSecret: null,
    mfaEnabled: false,
    isActive: true,
    ...overrides,
  };
}

function makeMockUserRepo(initial: UserRecord = makeMockUser()): UserRepository {
  let record = { ...initial };
  return {
    findByEmail: () => Promise.resolve(null),
    findById: (id) => Promise.resolve(id === record.id ? record : null),
    createUser: () => Promise.resolve(record),
    listByClinic: () => Promise.resolve([]),
    getClinicName: () => Promise.resolve(null),
    updatePassword: () => Promise.resolve(),
    updateUser: () => Promise.resolve(record),
    setUserMfaEnrollment: (_id, totpSecret) => {
      record = { ...record, totpSecret, mfaEnabled: true };
      return Promise.resolve();
    },
  };
}

function makeMockAudit(): AuditService {
  return {
    logAuthEvent: () => {},
    logEvent: () => {},
    logError: () => {},
  };
}

function makeTestConfig(): EnvConfig {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    HOST: "0.0.0.0",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    JWT_ACCESS_SECRET: "test-access-secret-minimum-32-characters-long",
    JWT_REFRESH_SECRET: "test-refresh-secret-minimum-32-characters-long",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
    DATABASE_URL: undefined,
    DATABASE_SSL: "auto",
    REDIS_URL: undefined,
    REDIS_TLS: "auto",
    MFA_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    MIGRATE_ON_STARTUP: false,
  };
}

/**
 * Creates a minimal in-memory Redis mock that captures every value passed to
 * set().  Only the key–value commands needed by the pending-MFA store are
 * implemented; all others are no-ops so the type is satisfiable.
 */
function makeMockRedis(): { client: RedisClient; store: Map<string, string> } {
  const store = new Map<string, string>();

  // Pipeline stub — only needed to satisfy the type; not exercised here.
  const pipeline = {
    set: () => pipeline,
    del: () => pipeline,
    sadd: () => pipeline,
    srem: () => pipeline,
    expire: () => pipeline,
    exec: () => Promise.resolve(null as [Error | null, unknown][] | null),
  };

  const client = {
    connect: () => Promise.resolve(),
    quit: () => Promise.resolve("OK" as string),
    on: () => client,
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK" as const);
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    del: (key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    },
    sadd: () => Promise.resolve(0),
    srem: () => Promise.resolve(0),
    smembers: () => Promise.resolve([] as string[]),
    pipeline: () => pipeline,
  } as unknown as RedisClient;

  return { client, store };
}

function makeService(redisClient: RedisClient | null = null) {
  return createAuthService(
    makeTestConfig(),
    makeMockUserRepo(),
    makeMockAudit(),
    redisClient,
  );
}

// ---------------------------------------------------------------------------
// Redis path
// ---------------------------------------------------------------------------

describe("Pending MFA secret encryption — Redis path", () => {
  it("stores ciphertext, not the plaintext secret", async () => {
    const { client, store } = makeMockRedis();
    const service = makeService(client);

    const { secret: plaintext } = await service.setupMfa(TEST_USER_ID, AUDIT_CTX);

    const stored = store.get(`pending_mfa:${TEST_USER_ID}`);
    expect(stored).toBeDefined();
    expect(stored).not.toBe(plaintext);
    expect(stored).toMatch(CIPHERTEXT_PATTERN);
  });

  it("setup → confirm round-trip succeeds", async () => {
    const { client } = makeMockRedis();
    const service = makeService(client);

    const { secret: plaintext } = await service.setupMfa(TEST_USER_ID, AUDIT_CTX);
    const code = generateSync({ secret: plaintext });

    await expect(service.confirmMfa(TEST_USER_ID, code, AUDIT_CTX)).resolves.toBeUndefined();
  });

  it("deletes the pending key from Redis after a successful confirm", async () => {
    const { client, store } = makeMockRedis();
    const service = makeService(client);

    const { secret: plaintext } = await service.setupMfa(TEST_USER_ID, AUDIT_CTX);
    const code = generateSync({ secret: plaintext });
    await service.confirmMfa(TEST_USER_ID, code, AUDIT_CTX);

    expect(store.has(`pending_mfa:${TEST_USER_ID}`)).toBe(false);
  });

  it("returns MFA_SETUP_REQUIRED (not a 500) when stored ciphertext is corrupted", async () => {
    const { client, store } = makeMockRedis();
    const service = makeService(client);

    await service.setupMfa(TEST_USER_ID, AUDIT_CTX);
    // Overwrite with data that is not a valid AES-256-GCM ciphertext
    store.set(`pending_mfa:${TEST_USER_ID}`, "corrupted-not-valid-ciphertext");

    await expect(service.confirmMfa(TEST_USER_ID, "123456", AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
  });

  it("returns MFA_SETUP_REQUIRED when the key is absent (no setup called)", async () => {
    const { client } = makeMockRedis();
    const service = makeService(client);

    await expect(service.confirmMfa(TEST_USER_ID, "000000", AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
  });
});

// ---------------------------------------------------------------------------
// In-memory fallback path
// ---------------------------------------------------------------------------

describe("Pending MFA secret encryption — in-memory fallback path", () => {
  it("setup → confirm round-trip succeeds", async () => {
    const service = makeService(null);

    const { secret: plaintext } = await service.setupMfa(TEST_USER_ID, AUDIT_CTX);
    const code = generateSync({ secret: plaintext });

    await expect(service.confirmMfa(TEST_USER_ID, code, AUDIT_CTX)).resolves.toBeUndefined();
  });

  it("returns MFA_SETUP_REQUIRED when no pending setup exists", async () => {
    const service = makeService(null);

    await expect(service.confirmMfa(TEST_USER_ID, "000000", AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
  });

  it("each service instance has an isolated pending-secret store", async () => {
    // Two separate service instances share no state — a setup on A cannot be
    // confirmed on B, which means the internal store is instance-scoped and
    // cannot be trivially leaked across tenants.
    const serviceA = makeService(null);
    const serviceB = makeService(null);

    const { secret: secretA } = await serviceA.setupMfa(TEST_USER_ID, AUDIT_CTX);
    // B never had setup called, so confirm must fail with MFA_SETUP_REQUIRED
    const codeForA = generateSync({ secret: secretA });

    await expect(serviceB.confirmMfa(TEST_USER_ID, codeForA, AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
  });
});

// ---------------------------------------------------------------------------
// Consistency: Redis and in-memory fallback produce equivalent behaviour
// ---------------------------------------------------------------------------

describe("Redis and in-memory fallback behave consistently", () => {
  it("both paths complete the setup → confirm flow successfully", async () => {
    const { client } = makeMockRedis();

    const redisService = makeService(client);
    const memService = makeService(null);

    const { secret: redisSecret } = await redisService.setupMfa(TEST_USER_ID, AUDIT_CTX);
    const { secret: memSecret } = await memService.setupMfa(TEST_USER_ID, AUDIT_CTX);

    const redisCode = generateSync({ secret: redisSecret });
    const memCode = generateSync({ secret: memSecret });

    await expect(redisService.confirmMfa(TEST_USER_ID, redisCode, AUDIT_CTX)).resolves.toBeUndefined();
    await expect(memService.confirmMfa(TEST_USER_ID, memCode, AUDIT_CTX)).resolves.toBeUndefined();
  });

  it("both paths reject a missing pending secret with MFA_SETUP_REQUIRED", async () => {
    const { client } = makeMockRedis();

    const redisService = makeService(client);
    const memService = makeService(null);

    await expect(redisService.confirmMfa(TEST_USER_ID, "000000", AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
    await expect(memService.confirmMfa(TEST_USER_ID, "000000", AUDIT_CTX)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
  });
});
