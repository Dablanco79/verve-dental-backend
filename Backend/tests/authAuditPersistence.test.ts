/**
 * Sprint G — Auth Audit Persistence tests
 *
 * Verifies that high-value security/auth events are persisted to audit_events
 * (via the in-memory AnalyticsRepository) alongside the log output, and that:
 *   - The correct action string is recorded.
 *   - actor_email / actor_id are populated correctly.
 *   - No sensitive values (tokens, passwords, MFA codes) appear in the row.
 *   - A persistence failure does NOT break the auth flow.
 */

import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { createAppDependencies } from "../src/bootstrap/dependencies.js";
import { loadConfig } from "../src/config/index.js";
import { createLogger } from "../src/utils/logger.js";
import type { AnalyticsRepository } from "../src/repositories/analyticsRepository.js";
import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import {
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
  TEST_MFA_ENCRYPTION_KEY,
} from "./helpers/testApp.js";
import { extractRefreshCookie, loginAndGetTokens } from "./helpers/auth.js";
import type { AuditEvent } from "../src/types/analytics.js";

// ─── test setup ─────────────────────────────────────────────────────────────

type TestEnv = {
  app: Express;
  analyticsRepository: AnalyticsRepository;
};

async function createTestEnv(): Promise<TestEnv> {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
  process.env.CORS_ORIGIN = "http://localhost:5173";
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const config = loadConfig();
  const logger = createLogger(config);
  const deps = await createAppDependencies(config, logger);
  const app = createApp(config, logger, deps);

  return { app, analyticsRepository: deps.analyticsRepository };
}

/**
 * Flush the microtask queue so that fire-and-forget `.catch()` promises from
 * the audit persistence path complete before we assert on repo contents.
 */
async function flushMicrotasks(): Promise<void> {
  // Two rounds: first round resolves the recordEventAdmin() promise,
  // second round resolves the .catch() handler in persistAuthAuditEvent().
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * List all auth_events for the sentinel clinic used by auth operations.
 * Auth events may be stored under SEED_CLINIC_A_ID (known user) or
 * AUTH_BYPASS_CLINIC_ID (unknown user / system sentinel).
 */
async function getAuthEvents(
  analyticsRepository: AnalyticsRepository,
  action: string,
): Promise<AuditEvent[]> {
  const [pageA, pageSystem] = await Promise.all([
    analyticsRepository.listEvents(SEED_CLINIC_A_ID, { limit: 200 }),
    analyticsRepository.listEvents("00000000-0000-0000-0000-000000000000", { limit: 200 }),
  ]);

  return [...pageA.events, ...pageSystem.events].filter(
    (e) => e.action === action,
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the metadata object contains obviously sensitive data.
 *
 * Checks:
 *  1. Key names — any metadata key that sounds credential-like.
 *  2. Values — any value that looks like a JWT (three long base64url segments).
 *
 * Deliberately does NOT search raw values for keywords such as "token" because
 * safe reason strings like "invalid_refresh_token" would produce false positives.
 */
function containsSensitiveData(metadata: Record<string, unknown>): boolean {
  const sensitiveKeywords = ["password", "token", "secret", "hash", "totp", "code"];
  for (const key of Object.keys(metadata)) {
    if (sensitiveKeywords.some((kw) => key.toLowerCase().includes(kw))) return true;
  }
  // Detect JWT-shaped strings in values: three long base64url segments joined by dots.
  const valueJson = JSON.stringify(Object.values(metadata));
  return /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(valueJson);
}

// ─── login success ───────────────────────────────────────────────────────────

describe("auth.login.success persisted to audit_events", () => {
  it("records auth.login.success with correct actor and no secrets", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });
    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.login.success");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.login.success event");
    expect(ev.entityType).toBe("auth");
    expect(ev.actorEmail).toBe("staff@clinic-a.au");
    expect(ev.actorId).toBe(SEED_USER_IDS.clinicAStaff);
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  });
});

// ─── login failure ───────────────────────────────────────────────────────────

describe("auth.login.failure persisted to audit_events", () => {
  it("records auth.login.failure when password is wrong", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "wrong-password",
    });
    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.login.failure");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.login.failure event");
    expect(ev.entityType).toBe("auth");
    expect(ev.actorEmail).toBe("staff@clinic-a.au");
    expect(containsSensitiveData(ev.metadata)).toBe(false);
    expect(ev.metadata.reason).toBe("invalid_credentials");
  });

  it("records auth.login.failure when email is unknown", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    await request(app).post("/api/v1/auth/login").send({
      email: "nobody@unknown.au",
      password: "whatever",
    });
    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.login.failure");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.login.failure event");
    expect(ev.entityType).toBe("auth");
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  });
});

// ─── MFA enrolled ────────────────────────────────────────────────────────────

describe("auth.mfa.enrolled persisted to audit_events", () => {
  it("records auth.mfa.enrolled after a successful MFA confirmation", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    // Use clinicAAdminNoMfa — privileged user without MFA so setup is available.
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: "admin-nomfa@clinic-a.au",
      password: "password123",
    });

    expect(loginRes.status).toBe(200);
    const loginBody = loginRes.body as {
      data: { requiresMfaEnrollment: boolean; enrollmentToken: string };
    };
    // This user triggers mfa_enrollment_required since they have no MFA.
    expect(loginBody.data.requiresMfaEnrollment).toBe(true);
    const enrollmentToken = loginBody.data.enrollmentToken;

    // POST /auth/mfa/setup
    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${enrollmentToken}`)
      .send();
    expect(setupRes.status).toBe(200);

    const setupBody = setupRes.body as { data: { secret: string } };
    const secret = setupBody.data.secret;

    // Generate a valid TOTP code from the just-returned secret.
    const { generateSync } = await import("otplib");
    const code = generateSync({ secret });

    // POST /auth/mfa/confirm
    const confirmRes = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${enrollmentToken}`)
      .send({ code });
    expect(confirmRes.status).toBe(200);

    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.mfa.enrolled");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.mfa.enrolled event");
    expect(ev.entityType).toBe("auth");
    expect(ev.actorId).toBe(SEED_USER_IDS.clinicAAdminNoMfa);
    // The returned setup secret must not appear in metadata.
    expect(JSON.stringify(ev.metadata)).not.toContain(secret);
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  });
});

// ─── refresh failure ─────────────────────────────────────────────────────────

describe("auth.refresh.failure persisted to audit_events", () => {
  it("records auth.refresh.failure for a tampered refresh token", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refreshToken=not.a.valid.token")
      .send();
    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.refresh.failure");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.refresh.failure event");
    expect(ev.entityType).toBe("auth");
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  });
});

// ─── password change ─────────────────────────────────────────────────────────

// bcrypt.hash in changePassword and bcrypt.compare in login are slow under
// parallel CI load — extend the Jest timeout for these two tests.
describe("auth.password.changed persisted to audit_events", () => {
  it("records auth.password.changed on successful password change", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    const { accessToken } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "password123", newPassword: "NewSecure!999" });
    expect(res.status).toBe(200);

    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.password.changed");
    // The successful change is the last logAuthEvent call (after update).
    const successEvents = events.filter(
      (e) => !e.metadata.reason,
    );
    expect(successEvents.length).toBeGreaterThanOrEqual(1);

    const ev = successEvents[0];
    if (!ev) throw new Error("Expected at least one successful auth.password.changed event");
    expect(ev.entityType).toBe("auth");
    expect(ev.actorId).toBe(SEED_USER_IDS.clinicAStaff);
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  }, 15000);
});

// ─── password reset ──────────────────────────────────────────────────────────

describe("auth.password.reset persisted to audit_events", () => {
  it("records auth.password.reset when an admin resets another user's password", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    const { accessToken } = await loginAndGetTokens(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAStaff}/reset-password`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ newPassword: "AdminReset!999" });
    expect(res.status).toBe(200);

    await flushMicrotasks();

    const events = await getAuthEvents(analyticsRepository, "auth.password.reset");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const ev = events[0];
    if (!ev) throw new Error("Expected at least one auth.password.reset event");
    expect(ev.entityType).toBe("auth");
    expect(ev.actorId).toBe(SEED_USER_IDS.clinicAAdmin);
    expect(containsSensitiveData(ev.metadata)).toBe(false);
  }, 15000);
});

// ─── persistence failure does not break auth ─────────────────────────────────

describe("audit persistence failure does not break auth flow", () => {
  it("login succeeds even when recordEventAdmin throws", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    // Inject a failing recordEventAdmin so every persist call rejects.
    const original = analyticsRepository.recordEventAdmin.bind(analyticsRepository);
    analyticsRepository.recordEventAdmin = () =>
      Promise.reject(new Error("simulated DB outage"));

    const res = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    // Auth MUST succeed — persistence failure is non-fatal.
    expect(res.status).toBe(200);
    const body = res.body as { data: { accessToken: string } };
    expect(body.data.accessToken).toBeTruthy();

    // Restore for cleanup.
    analyticsRepository.recordEventAdmin = original;
  });
});

// ─── no sensitive data stored ─────────────────────────────────────────────────

describe("no sensitive data stored in audit_events metadata", () => {
  it("access tokens, refresh tokens and TOTP codes do not appear in metadata", async () => {
    const { app, analyticsRepository } = await createTestEnv();

    // Successful login — captures auth.login.success event.
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });
    expect(loginRes.status).toBe(200);
    const refreshCookie = extractRefreshCookie(loginRes);

    // Refresh — captures auth.refresh.success event.
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie)
      .send();

    await flushMicrotasks();

    const successEvents = await getAuthEvents(analyticsRepository, "auth.login.success");
    const refreshEvents = await getAuthEvents(analyticsRepository, "auth.refresh.success");
    const allEvents = [...successEvents, ...refreshEvents];

    for (const ev of allEvents) {
      // No token strings (JWTs contain two '.' characters and are typically long).
      const metaJson = JSON.stringify(ev.metadata);
      const hasTokenShape = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
        .test(metaJson);
      expect(hasTokenShape).toBe(false);

      // No password-related keywords.
      expect(containsSensitiveData(ev.metadata)).toBe(false);
    }
  });
});
