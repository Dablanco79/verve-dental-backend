/**
 * Auth Session Lifecycle tests
 *
 * Covers the scenarios that health.test.ts does not:
 *   - Refresh token rotation (old token rejected, new token usable)
 *   - Logout revokes the presented refresh token
 *   - Logout without a token body is harmless (no revocation)
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
import { loginAndGetTokens } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };
type RefreshData = { accessToken: string; refreshToken: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function doRefresh(app: Awaited<ReturnType<typeof createTestApp>>, refreshToken: string) {
  return request(app).post("/api/v1/auth/refresh").send({ refreshToken });
}

async function doLogout(app: Awaited<ReturnType<typeof createTestApp>>, body: object) {
  return request(app).post("/api/v1/auth/logout").send(body);
}

// ---------------------------------------------------------------------------
// Refresh token rotation
// ---------------------------------------------------------------------------

describe("Refresh token rotation", () => {
  it("returns a new access token and a new refresh token on each rotation", async () => {
    const app = await createTestApp();
    const { refreshToken: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const res = await doRefresh(app, original);

    expect(res.status).toBe(200);
    const data = (res.body as { data: RefreshData }).data;
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toEqual(expect.any(String));
    // The rotated refresh token must be a different value
    expect(data.refreshToken).not.toBe(original);
  });

  it("rejects the original refresh token once it has been rotated", async () => {
    const app = await createTestApp();
    const { refreshToken: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    // First rotation — consumes the original token
    await doRefresh(app, original);

    // Replay of the original must be rejected
    const replayRes = await doRefresh(app, original);
    expect(replayRes.status).toBe(401);
    expect((replayRes.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("the rotated token can itself be used for a further rotation", async () => {
    const app = await createTestApp();
    const { refreshToken: original } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const first = await doRefresh(app, original);
    const { refreshToken: rotated } = (first.body as { data: RefreshData }).data;

    const second = await doRefresh(app, rotated);
    expect(second.status).toBe(200);
    expect((second.body as { data: RefreshData }).data.refreshToken).not.toBe(rotated);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe("Logout", () => {
  it("returns 204 and revokes the presented refresh token", async () => {
    const app = await createTestApp();
    const { refreshToken } = await loginAndGetTokens(app, "staff@clinic-a.au");

    const logoutRes = await doLogout(app, { refreshToken });
    expect(logoutRes.status).toBe(204);

    const refreshRes = await doRefresh(app, refreshToken);
    expect(refreshRes.status).toBe(401);
    expect((refreshRes.body as ApiError).error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("returns 204 when no refresh token is supplied and does not invalidate the active token", async () => {
    const app = await createTestApp();
    const { refreshToken } = await loginAndGetTokens(app, "staff@clinic-a.au");

    // Logout with an empty body — valid but performs no revocation
    const logoutRes = await doLogout(app, {});
    expect(logoutRes.status).toBe(204);

    // The original token is still valid
    const refreshRes = await doRefresh(app, refreshToken);
    expect(refreshRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Invalid / malformed tokens
// ---------------------------------------------------------------------------

describe("Invalid refresh tokens", () => {
  it("rejects a malformed (non-JWT) refresh token with 401", async () => {
    const app = await createTestApp();

    const res = await doRefresh(app, "this.is.not.a.jwt");
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

    const res = await doRefresh(app, fakeToken);
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
    await doLogout(app, { refreshToken: session1.refreshToken });

    // Session 1 is revoked
    const res1 = await doRefresh(app, session1.refreshToken);
    expect(res1.status).toBe(401);

    // Session 2 is unaffected
    const res2 = await doRefresh(app, session2.refreshToken);
    expect(res2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// changePassword revokes all sessions
// ---------------------------------------------------------------------------

describe("changePassword", () => {
  it("revokes all active refresh tokens for the user who changed their password", async () => {
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

    const res1 = await doRefresh(app, session1.refreshToken);
    expect(res1.status).toBe(401);

    const res2 = await doRefresh(app, session2.refreshToken);
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

    // Both staff refresh tokens must now be invalid
    const res1 = await doRefresh(app, staffSession1.refreshToken);
    expect(res1.status).toBe(401);

    const res2 = await doRefresh(app, staffSession2.refreshToken);
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
    const staffRes = await doRefresh(app, staffSession.refreshToken);
    expect(staffRes.status).toBe(401);

    // Manager's own session is unaffected
    const managerRes = await doRefresh(app, managerTokens.refreshToken);
    expect(managerRes.status).toBe(200);
  });
});
