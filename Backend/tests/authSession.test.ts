/**
 * Auth Session Lifecycle tests
 *
 * Covers the scenarios that health.test.ts does not:
 *   - Refresh cookie rotation (old cookie rejected, new cookie usable)
 *   - Logout revokes the refresh cookie
 *   - Logout without a cookie is harmless (no revocation)
 *   - Malformed refresh tokens are rejected
 *   - Multiple concurrent sessions (logout one, other survives)
 *   - changePassword revokes all sessions for that user
 *   - Admin resetPassword revokes all sessions for the target user
 *
 * All tests use the in-memory repositories (REDIS_URL and DATABASE_URL are
 * deleted by createTestApp) so each createTestApp() call returns a fully
 * isolated environment with a fresh in-memory refresh-token Map.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { extractRefreshCookie, loginAndGetTokens } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };
type RefreshData = { accessToken: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function doRefresh(app: Awaited<ReturnType<typeof createTestApp>>, refreshCookie: string) {
  return request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", refreshCookie)
    .send();
}

async function doLogout(
  app: Awaited<ReturnType<typeof createTestApp>>,
  refreshCookie?: string,
) {
  const req = request(app).post("/api/v1/auth/logout");
  if (refreshCookie) req.set("Cookie", refreshCookie);
  return req.send();
}

// ---------------------------------------------------------------------------
// Refresh cookie rotation
// ---------------------------------------------------------------------------

describe("Refresh cookie rotation", () => {
  it("returns a new access token and rotates the refresh cookie on each rotation", async () => {
    const app = await createTestApp();
    const { refreshCookie: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const res = await doRefresh(app, original);

    expect(res.status).toBe(200);
    const data = (res.body as { data: RefreshData }).data;
    expect(data.accessToken).toEqual(expect.any(String));

    const rotatedCookie = extractRefreshCookie(res);
    expect(rotatedCookie).not.toBe(original);
  });

  it("rejects the original refresh cookie once it has been rotated", async () => {
    const app = await createTestApp();
    const { refreshCookie: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    // First rotation — consumes the original cookie
    await doRefresh(app, original);

    // Replay of the original must be rejected
    const replayRes = await doRefresh(app, original);
    expect(replayRes.status).toBe(401);
    expect((replayRes.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("the rotated cookie can itself be used for a further rotation", async () => {
    const app = await createTestApp();
    const { refreshCookie: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const first = await doRefresh(app, original);
    const rotated = extractRefreshCookie(first);

    const second = await doRefresh(app, rotated);
    expect(second.status).toBe(200);

    const secondRotated = extractRefreshCookie(second);
    expect(secondRotated).not.toBe(rotated);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe("Logout", () => {
  it("returns 204 and revokes the refresh cookie", async () => {
    const app = await createTestApp();
    const { refreshCookie } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const logoutRes = await doLogout(app, refreshCookie);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await doRefresh(app, refreshCookie);
    expect(refreshRes.status).toBe(401);
    expect((refreshRes.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("returns 204 when no cookie is present and does not invalidate the active token", async () => {
    const app = await createTestApp();
    const { refreshCookie } = await loginAndGetTokens(app, "staff@clinic-a.au");

    // Logout without any cookie — valid but performs no revocation
    const logoutRes = await doLogout(app);
    expect(logoutRes.status).toBe(204);

    // The original cookie is still valid
    const refreshRes = await doRefresh(app, refreshCookie);
    expect(refreshRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Invalid / malformed tokens
// ---------------------------------------------------------------------------

describe("Invalid refresh tokens", () => {
  it("rejects a malformed (non-JWT) refresh token with 401", async () => {
    const app = await createTestApp();

    const res = await doRefresh(app, "refreshToken=this.is.not.a.jwt");
    expect(res.status).toBe(401);
    expect((res.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects a syntactically valid JWT signed with the wrong secret", async () => {
    const app = await createTestApp();

    // A real JWT structure but signed with a different secret — will fail jwt.verify
    const fakeToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiJ1c2VyLTEiLCJ0eXBlIjoicmVmcmVzaCIsImp0aSI6ImZha2UifQ" +
      ".INVALIDSIGNATURE";

    const res = await doRefresh(app, `refreshToken=${fakeToken}`);
    expect(res.status).toBe(401);
    expect((res.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// Multiple concurrent sessions
// ---------------------------------------------------------------------------

describe("Multiple concurrent sessions", () => {
  it("logging out one session leaves all other sessions intact", async () => {
    const app = await createTestApp();
    const session1 = await loginAndGetTokens(app, "staff@clinic-a.au");
    const session2 = await loginAndGetTokens(app, "staff@clinic-a.au");

    // Logout session 1 only
    await doLogout(app, session1.refreshCookie);

    // Session 1 is revoked
    const res1 = await doRefresh(app, session1.refreshCookie);
    expect(res1.status).toBe(401);

    // Session 2 is unaffected
    const res2 = await doRefresh(app, session2.refreshCookie);
    expect(res2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// changePassword revokes all sessions
// ---------------------------------------------------------------------------

describe("changePassword", () => {
  it("revokes all active refresh cookies for the user who changed their password", async () => {
    const app = await createTestApp();
    const session1 = await loginAndGetTokens(app, "staff@clinic-a.au");
    const session2 = await loginAndGetTokens(app, "staff@clinic-a.au");

    // Change password — both sessions should be revoked regardless of which
    // access token is used to authenticate the request
    const changeRes = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${session1.accessToken}`)
      .send({ currentPassword: "password123", newPassword: "newPassword123!" });
    expect(changeRes.status).toBe(200);

    const res1 = await doRefresh(app, session1.refreshCookie);
    expect(res1.status).toBe(401);

    const res2 = await doRefresh(app, session2.refreshCookie);
    expect(res2.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// revokeAllUserTokens via admin resetPassword
// ---------------------------------------------------------------------------

describe("Admin resetPassword (revokeAllUserTokens)", () => {
  it("revokes all active sessions for the target user when a manager resets their password", async () => {
    const app = await createTestApp();

    // Two sessions for the staff member
    const staffSession1 = await loginAndGetTokens(app, "staff@clinic-a.au");
    const staffSession2 = await loginAndGetTokens(app, "staff@clinic-a.au");

    // Manager performs the password reset
    const { accessToken: managerToken } = await loginAndGetTokens(app, "manager@clinic-a.au");
    const resetRes = await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAStaff}/reset-password`,
      )
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ newPassword: "resetPassword456!" });
    expect(resetRes.status).toBe(200);

    // Both staff refresh cookies must now be invalid
    const res1 = await doRefresh(app, staffSession1.refreshCookie);
    expect(res1.status).toBe(401);

    const res2 = await doRefresh(app, staffSession2.refreshCookie);
    expect(res2.status).toBe(401);
  });

  it("does not revoke sessions belonging to other users when one user's password is reset", async () => {
    const app = await createTestApp();

    // Two different users have active sessions
    const staffSession = await loginAndGetTokens(app, "staff@clinic-a.au");
    const managerTokens = await loginAndGetTokens(app, "manager@clinic-a.au");

    // Admin resets the staff member's password (not the manager's)
    const { accessToken: managerToken } = managerTokens;
    await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAStaff}/reset-password`,
      )
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ newPassword: "resetPassword456!" });

    // Staff session is revoked
    const staffRes = await doRefresh(app, staffSession.refreshCookie);
    expect(staffRes.status).toBe(401);

    // Manager's own session is unaffected
    const managerRes = await doRefresh(app, managerTokens.refreshCookie);
    expect(managerRes.status).toBe(200);
  });
});
