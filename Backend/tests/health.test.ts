import request from "supertest";
import { generateSync } from "otplib";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_ADMIN_TOTP_SECRET,
} from "../src/repositories/userRepository.js";
import type { ReadinessResult } from "../src/services/healthService.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string; requestId?: string } };

type LoginData = {
  requiresMfa: boolean;
  accessToken?: string;
  mfaToken?: string;
  user: { homeClinicId: string; email: string };
};

// ---------------------------------------------------------------------------
// GET /api/v1/health — liveness probe
// ---------------------------------------------------------------------------
describe("GET /api/v1/health", () => {
  it("returns 200 with service metadata", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);

    const body = response.body as {
      status: string;
      service: string;
      timestamp: string;
    };

    expect(body.status).toBe("ok");
    expect(body.service).toBe("@verve/backend");
    expect(body.timestamp).toEqual(expect.any(String));
    // Timestamp must be a valid ISO-8601 date string.
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it("does not require authentication", async () => {
    const app = await createTestApp();
    // No Authorization header — must still return 200.
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/ready — readiness probe (in-memory / test environment)
// ---------------------------------------------------------------------------
describe("GET /api/v1/ready", () => {
  it("returns 200 with readiness status and check details", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");

    // In test mode DATABASE_URL and REDIS_URL are not set — both checks report
    // 'ok' with an in-memory note, so overall status is 'ok'.
    expect(response.status).toBe(200);

    const body = response.body as ReadinessResult;

    expect(body.status).toBe("ok");
    expect(body.timestamp).toEqual(expect.any(String));
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();

    expect(body.checks).toBeDefined();
    expect(body.checks.database).toMatchObject({ status: "ok" });
    expect(body.checks.redis).toMatchObject({ status: "ok" });
  });

  it("includes ready: true when all checks pass", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");
    const body = response.body as ReadinessResult;

    expect(typeof body.ready).toBe("boolean");
    expect(body.ready).toBe(true);
  });

  it("includes critical flag per check (database=true, redis=false)", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");
    const body = response.body as ReadinessResult;

    expect(body.checks.database.critical).toBe(true);
    expect(body.checks.redis.critical).toBe(false);
  });

  it("includes latencyMs for each check", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");
    const body = response.body as ReadinessResult;

    expect(typeof body.checks.database.latencyMs).toBe("number");
    expect(typeof body.checks.redis.latencyMs).toBe("number");
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports in-memory mode message when no infrastructure is configured", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");
    const body = response.body as ReadinessResult;

    // Both checks use in-memory fallbacks in the test environment.
    expect(body.checks.database.message).toMatch(/in-memory/);
    expect(body.checks.redis.message).toMatch(/in-memory/);
  });

  it("does not require authentication", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/ready");
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Structured logging — X-Request-Id header propagation
// ---------------------------------------------------------------------------
describe("Structured logging — X-Request-Id", () => {
  it("returns X-Request-Id header on every response", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).toHaveLength(36); // UUID v4
  });

  it("echoes a client-supplied x-request-id back in the response header", async () => {
    const app = await createTestApp();
    const clientId = "test-trace-id-abc123";

    const response = await request(app)
      .get("/api/v1/health")
      .set("x-request-id", clientId);

    expect(response.headers["x-request-id"]).toBe(clientId);
  });

  it("generates a unique X-Request-Id when none is supplied", async () => {
    const app = await createTestApp();

    const [r1, r2] = await Promise.all([
      request(app).get("/api/v1/health"),
      request(app).get("/api/v1/health"),
    ]);

    const id1 = r1.headers["x-request-id"] as string;
    const id2 = r2.headers["x-request-id"] as string;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

describe("Auth API", () => {
  it("logs in clinical staff without MFA", async () => {
    const app = await createTestApp();

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    const body = response.body as ApiData<LoginData>;

    expect(response.status).toBe(200);
    expect(body.data.requiresMfa).toBe(false);
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.user.homeClinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("requires MFA for owner/admin accounts with MFA enabled", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "admin@clinic-a.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;

    expect(loginResponse.status).toBe(200);
    expect(loginBody.data.requiresMfa).toBe(true);

    const validCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const mfaResponse = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken: loginBody.data.mfaToken,
      code: validCode,
    });

    const mfaBody = mfaResponse.body as ApiData<{ accessToken: string }>;

    expect(mfaResponse.status).toBe(200);
    expect(mfaBody.data.accessToken).toEqual(expect.any(String));
  });

  it("rejects an invalid TOTP code during MFA verification", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "admin@clinic-a.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;
    expect(loginResponse.status).toBe(200);
    expect(loginBody.data.requiresMfa).toBe(true);

    // Derive a code that is guaranteed to differ from the real current token.
    const realCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const wrongCode = realCode === "000000" ? "000001" : "000000";

    const mfaResponse = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken: loginBody.data.mfaToken,
      code: wrongCode,
    });

    const errorBody = mfaResponse.body as ApiError;

    expect(mfaResponse.status).toBe(401);
    expect(errorBody.error.code).toBe("INVALID_MFA_CODE");
  });

  it("returns current user from /auth/me", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;
    const accessToken = loginBody.data.accessToken ?? "";

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    const meBody = meResponse.body as ApiData<{ email: string }>;

    expect(meResponse.status).toBe(200);
    expect(meBody.data.email).toBe("staff@clinic-a.au");
  });

  it("blocks cross-tenant clinic access for clinical staff", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;
    const accessToken = loginBody.data.accessToken ?? "";

    const summaryResponse = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/summary`)
      .set("Authorization", `Bearer ${accessToken}`);

    const errorBody = summaryResponse.body as ApiError;

    expect(summaryResponse.status).toBe(403);
    expect(errorBody.error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("allows owner/admin cross-clinic access", async () => {
    const app = await createTestApp();

    // admin@clinic-b.au is owner_admin with MFA — use the MFA-aware helper
    const accessToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const summaryResponse = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/summary`)
      .set("Authorization", `Bearer ${accessToken}`);

    const summaryBody = summaryResponse.body as ApiData<{ clinicId: string }>;

    expect(summaryResponse.status).toBe(200);
    expect(summaryBody.data.clinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("rejects protected routes without a token", async () => {
    const app = await createTestApp();

    const response = await request(app).get("/api/v1/auth/me");
    const errorBody = response.body as ApiError;

    expect(response.status).toBe(401);
    expect(errorBody.error.code).toBe("UNAUTHORIZED");
  });

  it("refreshes tokens and returns a new access token", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    expect(loginResponse.status).toBe(200);

    // Extract the HttpOnly refresh cookie set by login
    const setCookieHeader = loginResponse.headers["set-cookie"] as string | string[] | undefined;
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
    const refreshCookieFull = cookies.find((c) => c.startsWith("refreshToken="));
    expect(refreshCookieFull).toBeDefined();
    const refreshCookie = (refreshCookieFull as string).split(";")[0] ?? "";

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie)
      .send();

    const refreshBody = refreshResponse.body as ApiData<{ accessToken: string; user: { email: string } }>;

    expect(refreshResponse.status).toBe(200);
    expect(refreshBody.data.accessToken).toEqual(expect.any(String));
    expect(refreshBody.data.user.email).toBe("staff@clinic-a.au");
  });

  it("rejects admin routes for clinical staff", async () => {
    const app = await createTestApp();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;
    const accessToken = loginBody.data.accessToken ?? "";

    const adminResponse = await request(app)
      .get("/api/v1/admin/ping")
      .set("Authorization", `Bearer ${accessToken}`);

    const errorBody = adminResponse.body as ApiError;

    expect(adminResponse.status).toBe(403);
    expect(errorBody.error.code).toBe("FORBIDDEN");
  });
});
