/**
 * Sprint 4A — HttpOnly Refresh Cookie Bridge Tests
 *
 * Verifies that:
 *   1. Login sets an HttpOnly refresh cookie (in addition to JSON body).
 *   2. MFA verify sets an HttpOnly refresh cookie.
 *   3. /auth/refresh succeeds using the cookie only (no body token).
 *   4. /auth/refresh still works with the token in the request body (backwards compat).
 *   5. /auth/logout clears the refresh cookie.
 *
 * All tests use isolated in-memory repositories (no DATABASE_URL / REDIS_URL).
 */

import request from "supertest";
import { generateSync } from "otplib";

import { SEED_ADMIN_TOTP_SECRET } from "../src/repositories/userRepository.js";
import { createTestApp } from "./helpers/testApp.js";

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
// 1. Login sets HttpOnly cookie
// ---------------------------------------------------------------------------

describe("Login — HttpOnly cookie", () => {
  it("sets a refreshToken cookie flagged HttpOnly on successful login", async () => {
    const app = await createTestApp();
    const res = await doLogin(app);

    expect(res.status).toBe(200);

    const cookie = findRefreshCookie(res);
    expect(cookie).toBeDefined();

    // Cookie must carry the HttpOnly flag (case-insensitive as per spec).
    expect(cookie!.toLowerCase()).toContain("httponly");
  });

  it("includes the refreshToken in the JSON body as well (bridge mode)", async () => {
    const app = await createTestApp();
    const res = await doLogin(app);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.refreshToken).toBe("string");
    expect(res.body.data.refreshToken.length).toBeGreaterThan(0);
  });

  it("does not set a refresh cookie when MFA is required (tokens not yet issued)", async () => {
    const app = await createTestApp();
    // admin@clinic-a.au has mfaEnabled=true in the in-memory seed
    const res = await doLogin(app, "admin@clinic-a.au");

    expect(res.status).toBe(200);
    expect(res.body.data.requiresMfa).toBe(true);

    // No refresh cookie should be set at this stage — tokens are issued after MFA
    const cookie = findRefreshCookie(res);
    expect(cookie).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. MFA verify sets HttpOnly cookie
// ---------------------------------------------------------------------------

describe("MFA verify — HttpOnly cookie", () => {
  it("sets a refreshToken cookie after a successful MFA verification", async () => {
    const app = await createTestApp();

    // Step 1: trigger MFA challenge
    const loginRes = await doLogin(app, "admin@clinic-a.au");
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.requiresMfa).toBe(true);
    const { mfaToken } = loginRes.body.data as { mfaToken: string };

    // Step 2: verify with a real TOTP code from the known seed secret
    const totpCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const mfaRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: totpCode });

    expect(mfaRes.status).toBe(200);

    const cookie = findRefreshCookie(mfaRes);
    expect(cookie).toBeDefined();
    expect(cookie!.toLowerCase()).toContain("httponly");
  });

  it("also returns refreshToken in the JSON body after MFA verify (bridge mode)", async () => {
    const app = await createTestApp();

    const loginRes = await doLogin(app, "admin@clinic-a.au");
    const { mfaToken } = loginRes.body.data as { mfaToken: string };
    const totpCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const mfaRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: totpCode });

    expect(mfaRes.status).toBe(200);
    expect(typeof mfaRes.body.data.refreshToken).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 3. /auth/refresh via cookie only
// ---------------------------------------------------------------------------

describe("Refresh — cookie only (no body token)", () => {
  it("returns a new token pair when only the cookie is sent", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    expect(loginRes.status).toBe(200);

    const cookieHeader = findRefreshCookie(loginRes)!;
    const cookieValue = cookieNameValue(cookieHeader); // "refreshToken=<jwt>"

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      // Deliberately omit body — cookie path only
      .send({});

    expect(refreshRes.status).toBe(200);
    expect(typeof refreshRes.body.data.accessToken).toBe("string");
    expect(typeof refreshRes.body.data.refreshToken).toBe("string");
  });

  it("rotates the cookie on each cookie-based refresh", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);

    const firstCookie = cookieNameValue(findRefreshCookie(loginRes)!);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstCookie)
      .send({});

    expect(refreshRes.status).toBe(200);

    const rotatedCookie = findRefreshCookie(refreshRes);
    expect(rotatedCookie).toBeDefined();
    // Rotated cookie value must differ from the original
    expect(cookieNameValue(rotatedCookie!)).not.toBe(firstCookie);
  });

  it("returns 400 when neither cookie nor body token is provided", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_REFRESH_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// 4. /auth/refresh via body (backwards compat)
// ---------------------------------------------------------------------------

describe("Refresh — body token fallback (backwards compatibility)", () => {
  it("still works when the token is sent in the JSON body without a cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    const { refreshToken } = loginRes.body.data as { refreshToken: string };

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      // No Cookie header — body only
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(typeof refreshRes.body.data.accessToken).toBe("string");
  });

  it("cookie token takes precedence over a body token when both are present", async () => {
    const app = await createTestApp();

    // Get two separate sessions so we have two distinct valid tokens
    const session1 = await doLogin(app);
    const session2 = await doLogin(app);

    const cookieToken = cookieNameValue(findRefreshCookie(session1)!);
    const bodyToken = (session2.body.data as { refreshToken: string }).refreshToken;

    // Send cookie from session1 + body token from session2
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieToken)
      .send({ refreshToken: bodyToken });

    expect(refreshRes.status).toBe(200);

    // After this, session1's token is consumed; session2's body token must still be valid
    // (it was ignored in favour of the cookie)
    const session2BodyRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: bodyToken });
    expect(session2BodyRefresh.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. /auth/logout clears cookie
// ---------------------------------------------------------------------------

describe("Logout — clears the refresh cookie", () => {
  it("sends a Set-Cookie header that expires the refresh cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    const cookieValue = cookieNameValue(findRefreshCookie(loginRes)!);
    const { refreshToken } = loginRes.body.data as { refreshToken: string };

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieValue)
      .send({ refreshToken });

    expect(logoutRes.status).toBe(204);

    // The response must clear the cookie (value empty or Expires in the past)
    const setCookies = getSetCookieHeaders(logoutRes);
    const clearedCookie = setCookies.find((c) => c.startsWith("refreshToken="));
    expect(clearedCookie).toBeDefined();
    // clearCookie sets Expires to epoch or Max-Age=0
    const lower = clearedCookie!.toLowerCase();
    expect(lower.includes("expires=") || lower.includes("max-age=0")).toBe(true);
  });

  it("revokes the refresh token when it comes from the cookie", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    const cookieValue = cookieNameValue(findRefreshCookie(loginRes)!);

    // Logout sending cookie only (no body token)
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieValue)
      .send({});
    expect(logoutRes.status).toBe(204);

    // The cookie token is now revoked — a refresh attempt must fail
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieValue)
      .send({});
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("revokes the refresh token when it comes from the body (legacy path)", async () => {
    const app = await createTestApp();
    const loginRes = await doLogin(app);
    const { refreshToken } = loginRes.body.data as { refreshToken: string };

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken });
    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });
});
