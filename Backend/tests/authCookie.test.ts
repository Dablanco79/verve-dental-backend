/**
 * Sprint 4C — Cookie-Only Refresh Token Tests
 *
 * Verifies that:
 *   1. Login sets an HttpOnly refresh cookie and does NOT include refreshToken in body.
 *   2. MFA verify sets an HttpOnly refresh cookie and does NOT include refreshToken in body.
 *   3. /auth/refresh succeeds via cookie only (no body token path).
 *   4. /auth/refresh returns 400 when no cookie is present.
 *   5. /auth/logout clears the refresh cookie via cookie only.
 *
 * All tests use isolated in-memory repositories (no DATABASE_URL / REDIS_URL).
 */

import request from "supertest";
import { generateSync } from "otplib";

import { SEED_ADMIN_TOTP_SECRET } from "../src/repositories/userRepository.js";
import { createTestApp } from "./helpers/testApp.js";

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
