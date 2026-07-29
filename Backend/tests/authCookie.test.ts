/**
 * Sprint 4C — Cookie-Only Refresh Token Tests
 *
 * Verifies that:
 *   1. Login sets an HttpOnly refresh cookie and does NOT include refreshToken in body.
 *   2. MFA verify sets an HttpOnly refresh cookie and does NOT include refreshToken in body.
 *   3. /auth/refresh succeeds via cookie only (no body token path).
 *   4. /auth/refresh returns 400 when no cookie is present.
 *   5. /auth/logout clears the refresh cookie via cookie only.
 *   6. Cookie has SameSite=None in production mode (cross-origin deployment fix).
 *   7. Cookie has SameSite=Strict in non-production mode.
 *
 * All tests use isolated in-memory repositories (no DATABASE_URL / REDIS_URL).
 */

import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import request from "supertest";
import { generateSync } from "otplib";

import { SEED_ADMIN_TOTP_SECRET } from "../src/repositories/userRepository.js";
import { createAuthHandlers } from "../src/controllers/authController.js";
import type { EnvConfig } from "../src/config/index.js";
import { loadConfig } from "../src/config/index.js";
import { createApp } from "../src/app.js";
import { createAppDependencies } from "../src/bootstrap/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import {
  createTestApp,
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
  TEST_MFA_ENCRYPTION_KEY,
} from "./helpers/testApp.js";

// ---------------------------------------------------------------------------
// Typed response helpers
// ---------------------------------------------------------------------------

/** Safely extract the error code from an error-envelope response body. */
function bodyErrorCode(res: request.Response): string {
  return (res.body as { error: { code: string } }).error.code;
}

// ---------------------------------------------------------------------------
// Cookie parsing helpers
// ---------------------------------------------------------------------------

/** Extract all Set-Cookie headers from a supertest response as a string array. */
function getSetCookieHeaders(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as string | string[] | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** Find the refreshToken Set-Cookie entry. */
function findRefreshCookie(res: request.Response): string | undefined {
  return getSetCookieHeaders(res).find((c) => c.startsWith("refreshToken="));
}

/** Extract the raw cookie value (just "name=value") from a Set-Cookie string. */
function cookieNameValue(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] ?? "";
}

/**
 * Perform a login and return the supertest response.
 * Skips MFA — use a non-MFA account (e.g. staff@clinic-a.au).
 */
async function doLogin(
  app: Awaited<ReturnType<typeof createTestApp>>,
  email = "staff@clinic-a.au",
  password = "password123",
) {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

// ---------------------------------------------------------------------------
// 1. Login sets HttpOnly cookie — no refreshToken in body
// ---------------------------------------------------------------------------

describe("Login — HttpOnly cookie (cookie-only mode)", () => {
  it("sets a refreshToken cookie flagged HttpOnly on successful login", async () => {
    const app = await createTestApp();
    const res = await doLogin(app);

    expect(res.status).toBe(200);

    const cookie = findRefreshCookie(res);
    expect(cookie).toBeDefined();
    expect((cookie as string).toLowerCase()).toContain("httponly");
  });

  it("does NOT include refreshToken in the JSON body", async () => {
    const app = await createTestApp();
    const res = await doLogin(app);

    expect(res.status).toBe(200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("refreshToken");
  });

  it("does not set a refresh cookie when MFA is required (tokens not yet issued)", async () => {
    const app = await createTestApp();
    // admin@clinic-a.au has mfaEnabled=true in the in-memory seed
    const res = await doLogin(app, "admin@clinic-a.au");

    expect(res.status).toBe(200);
    expect((res.body as { data: { requiresMfa: boolean } }).data.requiresMfa).toBe(true);

    // No refresh cookie should be set at this stage — tokens are issued after MFA
    const cookie = findRefreshCookie(res);
    expect(cookie).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. MFA verify sets HttpOnly cookie — no refreshToken in body
// ---------------------------------------------------------------------------

describe("MFA verify — HttpOnly cookie (cookie-only mode)", () => {
  it("sets a refreshToken cookie after a successful MFA verification", async () => {
    const app = await createTestApp();

    // Step 1: trigger MFA challenge
    const loginRes = await doLogin(app, "admin@clinic-a.au");
    expect(loginRes.status).toBe(200);
    const { mfaToken } = (loginRes.body as { data: { mfaToken: string } }).data;

    // Step 2: verify with a real TOTP code from the known seed secret
    const totpCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const mfaRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: totpCode });

    expect(mfaRes.status).toBe(200);

    const cookie = findRefreshCookie(mfaRes);
    expect(cookie).toBeDefined();
    expect((cookie as string).toLowerCase()).toContain("httponly");
  });

  it("does NOT include refreshToken in the JSON body after MFA verify", async () => {
    const app = await createTestApp();

    const loginRes = await doLogin(app, "admin@clinic-a.au");
    const { mfaToken } = (loginRes.body as { data: { mfaToken: string } }).data;
    const totpCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const mfaRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: totpCode });

    expect(mfaRes.status).toBe(200);
    const data = (mfaRes.body as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("refreshToken");
  });
});

// ---------------------------------------------------------------------------
// 3. /auth/refresh via cookie only
// ---------------------------------------------------------------------------

describe("Refresh — cookie only", () => {
  it("returns a new access token when only the cookie is sent", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    expect(loginRes.status).toBe(200);

    const rawCookie = findRefreshCookie(loginRes);
    expect(rawCookie).toBeDefined();
    const cookieValue = cookieNameValue(rawCookie as string);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send();

    expect(refreshRes.status).toBe(200);
    const { accessToken } = (
      refreshRes.body as { data: { accessToken: string } }
    ).data;
    expect(typeof accessToken).toBe("string");
  });

  it("does NOT include refreshToken in the refresh response body", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawCookie = findRefreshCookie(loginRes);
    const cookieValue = cookieNameValue(rawCookie as string);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send();

    expect(refreshRes.status).toBe(200);
    const data = (refreshRes.body as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("refreshToken");
  });

  it("rotates the cookie on each cookie-based refresh", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawLoginCookie = findRefreshCookie(loginRes);
    expect(rawLoginCookie).toBeDefined();
    const firstCookie = cookieNameValue(rawLoginCookie as string);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstCookie)
      .send();

    expect(refreshRes.status).toBe(200);

    const rotatedCookie = findRefreshCookie(refreshRes);
    expect(rotatedCookie).toBeDefined();
    // Rotated cookie value must differ from the original
    expect(cookieNameValue(rotatedCookie as string)).not.toBe(firstCookie);
  });

  it("returns 400 when no cookie is provided", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send();

    expect(res.status).toBe(400);
    expect(bodyErrorCode(res)).toBe("MISSING_REFRESH_TOKEN");
  });

  it("returns 400 when a refreshToken is sent in the body but no cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    const rawCookie = findRefreshCookie(loginRes);
    // Extract the JWT value from the cookie (strip "refreshToken=" prefix)
    const jwtValue = (rawCookie as string).split("=").slice(1).join("=").split(";")[0];

    // Send as JSON body with no Cookie header
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: jwtValue });

    // Body tokens are no longer accepted — must return 400 (missing cookie)
    expect(res.status).toBe(400);
    expect(bodyErrorCode(res)).toBe("MISSING_REFRESH_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// 4. /auth/logout clears cookie (cookie-only)
// ---------------------------------------------------------------------------

describe("Logout — cookie-only", () => {
  it("sends a Set-Cookie header that expires the refresh cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawLoginCookie = findRefreshCookie(loginRes);
    expect(rawLoginCookie).toBeDefined();
    const cookieValue = cookieNameValue(rawLoginCookie as string);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieValue)
      .send();

    expect(logoutRes.status).toBe(204);

    // The response must clear the cookie (value empty or Expires in the past)
    const setCookies = getSetCookieHeaders(logoutRes);
    const clearedCookie = setCookies.find((c) => c.startsWith("refreshToken="));
    expect(clearedCookie).toBeDefined();
    // clearCookie sets Expires to epoch or Max-Age=0
    const lower = (clearedCookie as string).toLowerCase();
    expect(lower.includes("expires=") || lower.includes("max-age=0")).toBe(true);
  });

  it("revokes the refresh token when it comes from the cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawLoginCookie = findRefreshCookie(loginRes);
    expect(rawLoginCookie).toBeDefined();
    const cookieValue = cookieNameValue(rawLoginCookie as string);

    // Logout sending cookie only
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieValue)
      .send();
    expect(logoutRes.status).toBe(204);

    // The cookie token is now revoked — a refresh attempt must fail
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send();
    expect(refreshRes.status).toBe(401);
    expect(bodyErrorCode(refreshRes)).toBe("INVALID_REFRESH_TOKEN");
  });

  it("returns 204 when no cookie is present (no revocation, harmless)", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawLoginCookie = findRefreshCookie(loginRes);
    expect(rawLoginCookie).toBeDefined();
    const cookieValue = cookieNameValue(rawLoginCookie as string);

    // Logout without any cookie — should still succeed
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .send();
    expect(logoutRes.status).toBe(204);

    // Original cookie is still valid (nothing was revoked)
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send();
    expect(refreshRes.status).toBe(200);
  });

  it("does NOT revoke token when sent in request body (body path removed)", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const rawLoginCookie = findRefreshCookie(loginRes);
    expect(rawLoginCookie).toBeDefined();
    const cookieValue = cookieNameValue(rawLoginCookie as string);
    const jwtValue = (rawLoginCookie as string).split("=").slice(1).join("=").split(";")[0];

    // Attempt logout via body only (no Cookie header) — body is ignored
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: jwtValue });
    expect(logoutRes.status).toBe(204);

    // Token still valid because body path no longer revokes it
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send();
    expect(refreshRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. SameSite=None in production — regression for MISSING_REFRESH_TOKEN P1
//
// Root cause: SameSite=Strict prevents cookies from being sent when the
// frontend and backend are on different *.onrender.com origins (cross-site per
// the Public Suffix List).  In production the attribute must be "none" so the
// browser includes the cookie on cross-site POST /auth/refresh requests.
//
// These tests verify `createAuthHandlers` directly so they do not require a
// running database — only the config and a mock Express Response are needed.
// ---------------------------------------------------------------------------

describe("Cookie SameSite — production vs. non-production (P1 regression)", () => {
  /** Minimal config stub — only the fields used by createAuthHandlers. */
  function stubConfig(nodeEnv: "production" | "test" | "development"): EnvConfig {
    return {
      NODE_ENV: nodeEnv,
      JWT_REFRESH_EXPIRES_IN: "7d",
    } as unknown as EnvConfig;
  }

  /** Minimal stub AuthService — only login is exercised in these tests. */
  function stubAuthService() {
    return {
      login: () => Promise.resolve({
        kind: "authenticated" as const,
        tokens: {
          accessToken: "access-token-value",
          refreshToken: "refresh-token-value",
          expiresIn: 900,
        },
        user: {
          id: "u1",
          email: "staff@test.com",
          role: "clinical_staff" as const,
          homeClinicId: "c1",
          homeClinicName: "Test Clinic",
          firstName: null,
          lastName: null,
          displayName: null,
          permissions: [],
        },
      }),
    };
  }

  /** Invoke the login handler with a minimal mock req/res and capture cookie calls. */
  async function captureLoginCookies(nodeEnv: "production" | "test" | "development") {
    const cookieCalls: Array<[string, string, Record<string, unknown>]> = [];
    const config = stubConfig(nodeEnv);

    // Cast the minimal stub to AuthService — we only call login() in these tests.
    const handlers = createAuthHandlers(
      stubAuthService() as unknown as import("../src/services/authService.js").AuthService,
      config,
    );

    const mockReq = {
      body: { email: "staff@test.com", password: "password123" },
      ip: "127.0.0.1",
      get: () => undefined,
    } as unknown as import("express").Request;

    const jsonSpy = () => undefined;
    const mockRes = {
      cookie: (name: string, value: string, opts: Record<string, unknown>) => {
        cookieCalls.push([name, value, opts]);
      },
      status: () => mockRes,
      json: jsonSpy,
    } as unknown as import("express").Response;

    await handlers.login(mockReq, mockRes);
    return cookieCalls;
  }

  it("sets SameSite=None on the refresh cookie in production mode", async () => {
    const calls = await captureLoginCookies("production");
    const refreshCookieOpts = calls.find(([name]) => name === "refreshToken")?.[2];
    expect(refreshCookieOpts).toBeDefined();
    expect(refreshCookieOpts?.sameSite).toBe("none");
  });

  it("sets Secure=true on the refresh cookie in production mode (required by SameSite=None)", async () => {
    const calls = await captureLoginCookies("production");
    const refreshCookieOpts = calls.find(([name]) => name === "refreshToken")?.[2];
    expect(refreshCookieOpts?.secure).toBe(true);
  });

  it("sets SameSite=Strict on the refresh cookie in test (non-production) mode", async () => {
    const calls = await captureLoginCookies("test");
    const refreshCookieOpts = calls.find(([name]) => name === "refreshToken")?.[2];
    expect(refreshCookieOpts).toBeDefined();
    expect(refreshCookieOpts?.sameSite).toBe("strict");
  });

  it("sets SameSite=Strict on the refresh cookie in development mode", async () => {
    const calls = await captureLoginCookies("development");
    const refreshCookieOpts = calls.find(([name]) => name === "refreshToken")?.[2];
    expect(refreshCookieOpts).toBeDefined();
    expect(refreshCookieOpts?.sameSite).toBe("strict");
  });

  it("integration: test-mode login Set-Cookie header contains SameSite=Strict", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    expect(loginRes.status).toBe(200);
    const cookie = findRefreshCookie(loginRes);
    expect(cookie).toBeDefined();
    expect((cookie as string).toLowerCase()).toContain("samesite=strict");
    expect((cookie as string).toLowerCase()).not.toContain("samesite=none");
  });
});

// ---------------------------------------------------------------------------
// 6. Expired / invalid refresh tokens — secure failure (TEST 6 & TEST 7)
// ---------------------------------------------------------------------------

describe("Expired and invalid refresh tokens — secure failure", () => {
  it("rejects an expired refresh token with 401 INVALID_REFRESH_TOKEN", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    // Extract the raw JWT from the cookie.
    const rawCookie = findRefreshCookie(loginRes) as string;
    const jwtValue = rawCookie.split("=").slice(1).join("=").split(";")[0] ?? "";

    // Manually build an expired token (iat and exp in the past).
    // We re-sign it with the known test secret so jwt.verify accepts the
    // signature but then rejects it because the token has expired.
    const { TEST_JWT_REFRESH_SECRET } = await import("./helpers/testApp.js");

    const decoded = jwt.decode(jwtValue) as Record<string, unknown> | null;
    expect(decoded).not.toBeNull();

    const expiredToken = jwt.sign(
      {
        sub: decoded?.sub,
        jti: decoded?.jti,
        type: "refresh",
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      TEST_JWT_REFRESH_SECRET,
    );

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refreshToken=${expiredToken}`)
      .send();

    expect(res.status).toBe(401);
    expect(bodyErrorCode(res)).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects a well-formed JWT whose JTI is not in the store (revoked / absent)", async () => {
    const app = await createTestApp();

    const { TEST_JWT_REFRESH_SECRET } = await import("./helpers/testApp.js");

    // Valid JWT format and signature, but the JTI was never persisted.
    const unknownToken = jwt.sign(
      { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", jti: randomUUID(), type: "refresh" },
      TEST_JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refreshToken=${unknownToken}`)
      .send();

    expect(res.status).toBe(401);
    expect(bodyErrorCode(res)).toBe("INVALID_REFRESH_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// 7. Production-mode Set-Cookie HTTP integration tests (Security Review)
//
// Verifies the full Set-Cookie header string produced by the real Express
// app when NODE_ENV=production:
//   • HttpOnly — cookie not accessible from JavaScript
//   • Secure   — cookie only sent over HTTPS
//   • SameSite=None — required for cross-site *.onrender.com deployment
//   • Path=/api/v1/auth — scoped to auth endpoints only
//
// Also verifies the cookie-clearing header on logout carries matching
// attributes so the browser correctly expires the cookie on the
// production domain.
//
// The same "deps from test, app from production config" pattern used in
// originGuard.test.ts is used here — no real database connection is needed.
// ---------------------------------------------------------------------------

const PROD_FRONTEND_ORIGIN = "https://verve-dental-frontend.onrender.com";

/**
 * Builds a full Express app with production-mode config but in-memory deps.
 * Uses the same technique as createStagingOriginTestApp in originGuard.test.ts:
 * load deps under test config (no DATABASE_URL required), then override
 * NODE_ENV and CORS_ORIGIN on the config passed to createApp().
 */
async function createProductionCookieTestApp(): Promise<import("express").Express> {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
  process.env.CORS_ORIGIN = "http://localhost:5173";
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const testConfig = loadConfig();
  const logger = createLogger({ LOG_LEVEL: "silent" });
  const deps = await createAppDependencies(testConfig, logger);

  const productionConfig: EnvConfig = {
    ...testConfig,
    NODE_ENV: "production",
    CORS_ORIGIN: PROD_FRONTEND_ORIGIN,
  };

  return createApp(productionConfig, logger, deps);
}

describe("Production-mode Set-Cookie attributes (security review)", () => {
  it("login Set-Cookie contains HttpOnly in production mode", async () => {
    const app = await createProductionCookieTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(res.status).toBe(200);
    const cookie = findRefreshCookie(res);
    expect(cookie).toBeDefined();
    expect((cookie as string).toLowerCase()).toContain("httponly");
  });

  it("login Set-Cookie contains Secure in production mode", async () => {
    const app = await createProductionCookieTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(res.status).toBe(200);
    const cookie = findRefreshCookie(res);
    expect((cookie as string).toLowerCase()).toContain("secure");
  });

  it("login Set-Cookie contains SameSite=None in production mode", async () => {
    const app = await createProductionCookieTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(res.status).toBe(200);
    const cookie = findRefreshCookie(res);
    expect((cookie as string).toLowerCase()).toContain("samesite=none");
    expect((cookie as string).toLowerCase()).not.toContain("samesite=strict");
  });

  it("login Set-Cookie Path is scoped to /api/v1/auth in production mode", async () => {
    const app = await createProductionCookieTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(res.status).toBe(200);
    const cookie = findRefreshCookie(res);
    expect((cookie as string).toLowerCase()).toContain("path=/api/v1/auth");
  });

  it("logout Set-Cookie clears cookie with matching SameSite=None and Secure in production mode", async () => {
    const app = await createProductionCookieTestApp();

    // Log in first to obtain a valid cookie for the logout call.
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(loginRes.status).toBe(200);
    const rawCookie = findRefreshCookie(loginRes) as string;
    const cookieValue = cookieNameValue(rawCookie);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", PROD_FRONTEND_ORIGIN)
      .set("Cookie", cookieValue)
      .send();

    expect(logoutRes.status).toBe(204);

    const clearCookie = findRefreshCookie(logoutRes);
    expect(clearCookie).toBeDefined();

    const lower = (clearCookie as string).toLowerCase();
    // Cookie must be expired / zeroed
    expect(lower.includes("expires=") || lower.includes("max-age=0")).toBe(true);
    // Clearing attributes must match setting attributes — mismatched SameSite
    // would leave a stale cookie in the browser.
    expect(lower).toContain("samesite=none");
    expect(lower).toContain("secure");
    expect(lower).toContain("path=/api/v1/auth");
  });
});
