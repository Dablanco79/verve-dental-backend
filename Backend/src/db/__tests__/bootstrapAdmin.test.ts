/**
 * bootstrapAdmin.test.ts — unit tests for the production admin bootstrap
 *
 * Tests resolveBootstrapInput and bootstrapFirstAdmin using a mock pool
 * and mock PoolClient — no real database connection is required.
 *
 * The mock client records every SQL query so tests can assert on exact
 * statements issued without executing them against Postgres.
 *
 * bcryptRounds is passed as 1 in all bootstrapFirstAdmin calls so the test
 * suite runs in milliseconds while still exercising the full hash flow.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import {
  bootstrapFirstAdmin,
  countUsersWithOwnerAdminContext,
  resolveBootstrapInput,
  BOOTSTRAP_ADVISORY_LOCK_KEY,
  BOOTSTRAP_BCRYPT_ROUNDS,
  BOOTSTRAP_PASSWORD_MIN_LENGTH,
  BOOTSTRAP_PASSWORD_MAX_LENGTH,
} from "../bootstrapAdmin.js";
import type { DatabasePool } from "../pool.js";
import type { Logger } from "../../utils/logger.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type QueryCall = { sql: string; params: unknown[] };

/**
 * Creates a mock PoolClient whose query() resolves based on SQL content.
 * Queries succeed unless `failOnSql` matches; the COUNT query returns the
 * supplied userCount.
 * Every call is recorded in the `queries` array for later assertions.
 */
function makeMockClient(userCount: number, failOnSql?: string) {
  const queries: QueryCall[] = [];

  const query = jest.fn().mockImplementation((...args: unknown[]) => {
    const sql = typeof args[0] === "string" ? args[0] : "";
    const params = Array.isArray(args[1]) ? (args[1] as unknown[]) : [];
    queries.push({ sql, params });

    if (failOnSql && sql.includes(failOnSql)) {
      return Promise.reject(new Error(`Simulated query failure: ${failOnSql}`));
    }
    if (sql.includes("COUNT(*)")) {
      return Promise.resolve({ rows: [{ count: String(userCount) }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const release = jest.fn<() => void>();

  return { query, release, queries };
}

/** Wraps a mock client in a minimal DatabasePool stub. */
function makeMockPool(
  client: ReturnType<typeof makeMockClient>,
): DatabasePool {
  return {
    connect: jest.fn().mockImplementation(() => Promise.resolve(client as unknown)),
  } as unknown as DatabasePool;
}

/** Silent logger — all methods are no-ops in tests. */
const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(),
} as unknown as Logger;

const VALID_INPUT = {
  adminEmail: "admin@example.com",
  adminPassword: "SecurePassword123!",
  clinicName: "Verve Dental",
  clinicTimezone: "Australia/Melbourne",
};

// ─── resolveBootstrapInput ────────────────────────────────────────────────────

describe("resolveBootstrapInput", () => {
  it("returns valid BootstrapInput from complete env vars", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "SecurePass12!",
      BOOTSTRAP_CLINIC_NAME: "Test Clinic",
      BOOTSTRAP_CLINIC_TIMEZONE: "Australia/Perth",
    };
    expect(resolveBootstrapInput(env)).toEqual({
      adminEmail: "admin@example.com",
      adminPassword: "SecurePass12!",
      clinicName: "Test Clinic",
      clinicTimezone: "Australia/Perth",
    });
  });

  it("defaults clinicTimezone to Australia/Melbourne when not provided", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "SecurePass12!",
      BOOTSTRAP_CLINIC_NAME: "Test Clinic",
    };
    expect(resolveBootstrapInput(env).clinicTimezone).toBe("Australia/Melbourne");
  });

  it("trims whitespace from adminEmail", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "  admin@example.com  ",
      BOOTSTRAP_ADMIN_PASSWORD: "SecurePass12!",
      BOOTSTRAP_CLINIC_NAME: "Test Clinic",
    };
    expect(resolveBootstrapInput(env).adminEmail).toBe("admin@example.com");
  });

  it("trims whitespace from clinicName", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "SecurePass12!",
      BOOTSTRAP_CLINIC_NAME: "  Clinic Name  ",
    };
    expect(resolveBootstrapInput(env).clinicName).toBe("Clinic Name");
  });

  it("throws when BOOTSTRAP_ADMIN_EMAIL is missing", () => {
    const env = {
      BOOTSTRAP_ADMIN_PASSWORD: "secret",
      BOOTSTRAP_CLINIC_NAME: "Test Clinic",
    };
    expect(() => resolveBootstrapInput(env)).toThrow("BOOTSTRAP_ADMIN_EMAIL");
  });

  it("throws when BOOTSTRAP_ADMIN_PASSWORD is missing", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_CLINIC_NAME: "Test Clinic",
    };
    expect(() => resolveBootstrapInput(env)).toThrow("BOOTSTRAP_ADMIN_PASSWORD");
  });

  it("throws when BOOTSTRAP_CLINIC_NAME is missing", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "SecurePass12!",
    };
    expect(() => resolveBootstrapInput(env)).toThrow("BOOTSTRAP_CLINIC_NAME");
  });

  it("lists all missing variables in a single error when all are absent", () => {
    expect(() => resolveBootstrapInput({})).toThrow(
      /BOOTSTRAP_ADMIN_EMAIL.*BOOTSTRAP_ADMIN_PASSWORD.*BOOTSTRAP_CLINIC_NAME/,
    );
  });

  it("preserves the plaintext password without modification", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "my-P@ssw0rd!",
      BOOTSTRAP_CLINIC_NAME: "Clinic",
    };
    expect(resolveBootstrapInput(env).adminPassword).toBe("my-P@ssw0rd!");
  });

  it("rejects a password shorter than the bootstrap minimum", () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "TooShort1!",
      BOOTSTRAP_CLINIC_NAME: "Clinic",
    };

    expect(() => resolveBootstrapInput(env)).toThrow(
      `between ${String(BOOTSTRAP_PASSWORD_MIN_LENGTH)} and ${String(BOOTSTRAP_PASSWORD_MAX_LENGTH)}`,
    );
  });
});

// ─── BOOTSTRAP_BCRYPT_ROUNDS constant ────────────────────────────────────────

describe("BOOTSTRAP_BCRYPT_ROUNDS", () => {
  it("is 12", () => {
    expect(BOOTSTRAP_BCRYPT_ROUNDS).toBe(12);
  });
});

// ─── bootstrapFirstAdmin ─────────────────────────────────────────────────────

describe("bootstrapFirstAdmin", () => {
  describe("guard: refuses when users already exist", () => {
    it("rejects when COUNT(*) returns a positive value", async () => {
      const client = makeMockClient(3);
      const pool = makeMockPool(client);

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).rejects.toThrow("Bootstrap refused");
    });

    it("includes the existing user count in the error message", async () => {
      const client = makeMockClient(2);
      const pool = makeMockPool(client);

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).rejects.toThrow("2 user(s) already exist");
    });

    it("does not issue any INSERT when the guard fires", async () => {
      const client = makeMockClient(1);
      const pool = makeMockPool(client);

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).rejects.toThrow();

      const insertCalls = client.queries.filter((q) =>
        q.sql.trimStart().toUpperCase().startsWith("INSERT"),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("acquires the bootstrap advisory lock before counting users", async () => {
      const client = makeMockClient(1);
      const pool = makeMockPool(client);

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).rejects.toThrow("Bootstrap refused");

      const lockIndex = client.queries.findIndex((query) =>
        query.sql.includes("pg_advisory_xact_lock"),
      );
      const countIndex = client.queries.findIndex((query) =>
        query.sql.includes("COUNT(*)"),
      );
      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(lockIndex).toBeLessThan(countIndex);
      expect(client.queries[lockIndex]?.params).toEqual([
        BOOTSTRAP_ADVISORY_LOCK_KEY,
      ]);
    });
  });

  describe("happy path: empty database", () => {
    let client: ReturnType<typeof makeMockClient>;
    let pool: DatabasePool;

    beforeEach(() => {
      client = makeMockClient(0);
      pool = makeMockPool(client);
    });

    it("resolves without error", async () => {
      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).resolves.toBeUndefined();
    });

    it("issues exactly one INSERT INTO clinics", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);
      const clinicInserts = client.queries.filter((q) =>
        q.sql.includes("INSERT INTO clinics"),
      );
      expect(clinicInserts).toHaveLength(1);
    });

    it("issues exactly one INSERT INTO users", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);
      const userInserts = client.queries.filter((q) =>
        q.sql.includes("INSERT INTO users"),
      );
      expect(userInserts).toHaveLength(1);
    });

    it("inserts the clinic with the correct name and timezone", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);
      const q = client.queries.find((c) => c.sql.includes("INSERT INTO clinics"));
      expect(q?.params).toContain(VALID_INPUT.clinicName);
      expect(q?.params).toContain(VALID_INPUT.clinicTimezone);
    });

    it("embeds 'owner_admin' role directly in the users INSERT SQL", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);
      const q = client.queries.find((c) => c.sql.includes("INSERT INTO users"));
      expect(q?.sql).toContain("owner_admin");
    });

    it("normalizes the admin email to lowercase in the users INSERT", async () => {
      const inputUpper = { ...VALID_INPUT, adminEmail: "Admin@EXAMPLE.COM" };
      await bootstrapFirstAdmin(pool, silentLogger, inputUpper, 1);
      const q = client.queries.find((c) => c.sql.includes("INSERT INTO users"));
      expect(q?.params).toContain("admin@example.com");
      expect(q?.params).not.toContain("Admin@EXAMPLE.COM");
    });

    it("links the user home_clinic_id to the created clinic id", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);

      const clinicInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO clinics"),
      );
      const userInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO users"),
      );

      // clinics INSERT: ($1=id, $2=name, $3=timezone)
      const clinicId = clinicInsert?.params[0];
      // users INSERT: ($1=id, $2=email, $3=hash, $4=home_clinic_id, $5=name)
      const homeClinicId = userInsert?.params[3];

      expect(typeof clinicId).toBe("string");
      expect(clinicId).toBe(homeClinicId);
    });

    it("creates the admin's home-clinic assignment with roster and operational access", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);

      const userInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO users"),
      );
      const clinicInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO clinics"),
      );
      const assignmentInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO user_clinic_assignments"),
      );

      expect(assignmentInsert).toBeDefined();
      expect(assignmentInsert?.params).toEqual([
        userInsert?.params[0],
        clinicInsert?.params[0],
      ]);
      expect(assignmentInsert?.sql).toContain("can_roster, can_operate");
      expect(assignmentInsert?.sql).toContain("true, true");
    });

    it("wraps all three INSERTs in a single transaction (one pool.connect call)", async () => {
      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);
      const connectMock = (pool as unknown as { connect: jest.Mock }).connect;
      expect(connectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("password security", () => {
    it("rejects an invalid password before connecting to the database", async () => {
      const client = makeMockClient(0);
      const pool = makeMockPool(client);
      const input = { ...VALID_INPUT, adminPassword: "TooShort1!" };

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, input, 1),
      ).rejects.toThrow(
        `between ${String(BOOTSTRAP_PASSWORD_MIN_LENGTH)} and ${String(BOOTSTRAP_PASSWORD_MAX_LENGTH)}`,
      );

      const connectMock = (pool as unknown as { connect: jest.Mock }).connect;
      expect(connectMock).not.toHaveBeenCalled();
      expect(client.queries).toHaveLength(0);
    });

    it("does not pass the plaintext password to any SQL query", async () => {
      const client = makeMockClient(0);
      const pool = makeMockPool(client);

      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);

      const allParams = client.queries.flatMap((q) => q.params);
      expect(allParams).not.toContain(VALID_INPUT.adminPassword);
    });

    it("stores a bcrypt hash (not plaintext) in the users INSERT", async () => {
      const client = makeMockClient(0);
      const pool = makeMockPool(client);

      await bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1);

      const userInsert = client.queries.find((q) =>
        q.sql.includes("INSERT INTO users"),
      );
      // password_hash is the 3rd param (index 2): $3 in the INSERT
      const passwordHash = userInsert?.params[2];

      expect(typeof passwordHash).toBe("string");
      expect(String(passwordHash)).toMatch(/^\$2[ab]\$\d{2}\$/);
      expect(passwordHash).not.toBe(VALID_INPUT.adminPassword);
    });

    it("does not log the plaintext password", async () => {
      const client = makeMockClient(0);
      const pool = makeMockPool(client);
      const spyLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn(),
      } as unknown as Logger;

      await bootstrapFirstAdmin(pool, spyLogger, VALID_INPUT, 1);

      const allLogArgs = [
        ...(spyLogger.info as jest.Mock).mock.calls,
        ...(spyLogger.warn as jest.Mock).mock.calls,
        ...(spyLogger.error as jest.Mock).mock.calls,
        ...(spyLogger.debug as jest.Mock).mock.calls,
      ];
      const logSnapshot = JSON.stringify(allLogArgs);
      expect(logSnapshot).not.toContain(VALID_INPUT.adminPassword);
    });
  });

  describe("transaction rollback", () => {
    it("rolls back clinic and user creation when assignment creation fails", async () => {
      const client = makeMockClient(0, "INSERT INTO user_clinic_assignments");
      const pool = makeMockPool(client);

      await expect(
        bootstrapFirstAdmin(pool, silentLogger, VALID_INPUT, 1),
      ).rejects.toThrow("Simulated query failure");

      expect(client.queries.some((q) => q.sql.includes("INSERT INTO clinics"))).toBe(true);
      expect(client.queries.some((q) => q.sql.includes("INSERT INTO users"))).toBe(true);
      expect(client.queries.some((q) => q.sql === "ROLLBACK")).toBe(true);
      expect(client.queries.some((q) => q.sql === "COMMIT")).toBe(false);
    });
  });
});

describe("countUsersWithOwnerAdminContext", () => {
  it("counts users only after establishing transaction-local owner-admin context", async () => {
    const client = makeMockClient(4);
    const pool = makeMockPool(client);

    await expect(countUsersWithOwnerAdminContext(pool)).resolves.toBe(4);

    const contextIndex = client.queries.findIndex((query) =>
      query.sql.includes("app.owner_admin_mode"),
    );
    const countIndex = client.queries.findIndex((query) =>
      query.sql.includes("COUNT(*)"),
    );
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeLessThan(countIndex);
    expect(client.queries[contextIndex]?.params[1]).toBe("true");
  });
});
