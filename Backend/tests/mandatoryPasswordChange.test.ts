import jwt from "jsonwebtoken";
import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetTokens } from "./helpers/auth.js";
import {
  createTestApp,
  TEST_JWT_ACCESS_SECRET,
} from "./helpers/testApp.js";

type PasswordChangeRequiredData = {
  requiresPasswordChange: true;
  passwordChangeToken: string;
  accessToken?: never;
};

async function createTemporaryUser(
  app: Awaited<ReturnType<typeof createTestApp>>,
  role: "clinical_staff" | "group_practice_manager" = "clinical_staff",
) {
  const { accessToken } = await loginAndGetTokens(app, "admin@clinic-a.au");
  const email = `temporary-${role}-${Date.now()}-${Math.random()}@clinic-a.au`;
  const response = await request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      email,
      password: "TemporaryPassword123!",
      role,
      clinicName: "Verve Dental Clinic A",
      firstName: "Temporary",
      lastName: "User",
    });
  expect(response.status).toBe(201);
  return {
    email,
    userId: (response.body as { data: { id: string } }).data.id,
  };
}

async function loginForPasswordChange(
  app: Awaited<ReturnType<typeof createTestApp>>,
  email: string,
  password = "TemporaryPassword123!",
) {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  expect(response.status).toBe(200);
  const data = (response.body as { data: PasswordChangeRequiredData }).data;
  expect(data.requiresPasswordChange).toBe(true);
  expect(data.passwordChangeToken).toEqual(expect.any(String));
  expect(data.accessToken).toBeUndefined();
  expect(response.headers["set-cookie"]).toBeUndefined();
  return data.passwordChangeToken;
}

async function completePasswordChange(
  app: Awaited<ReturnType<typeof createTestApp>>,
  passwordChangeToken: string,
  newPassword = "NewPermanentPassword456!",
) {
  return request(app)
    .post("/api/v1/auth/required-password-change")
    .set("Authorization", `Bearer ${passwordChangeToken}`)
    .send({ newPassword });
}

describe("Mandatory first-login password change", () => {
  it("issues only a password-change challenge and blocks Workforce access", async () => {
    const app = await createTestApp();
    const { email } = await createTemporaryUser(app);
    const challenge = await loginForPasswordChange(app, email);

    const protectedResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${challenge}`);
    expect(protectedResponse.status).toBe(401);
    expect((protectedResponse.body as { error: { code: string } }).error.code)
      .toBe("UNAUTHORIZED");
  }, 20_000);

  it("changes the password once, then requires a fresh normal login", async () => {
    const app = await createTestApp();
    const { email } = await createTemporaryUser(app);
    const challenge = await loginForPasswordChange(app, email);

    const completed = await completePasswordChange(app, challenge);
    expect(completed.status).toBe(200);

    const replay = await completePasswordChange(app, challenge, "AnotherPassword789!");
    expect(replay.status).toBe(401);
    expect((replay.body as { error: { code: string } }).error.code)
      .toBe("INVALID_PASSWORD_CHANGE_CHALLENGE");

    const oldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TemporaryPassword123!" });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "NewPermanentPassword456!" });
    expect(newPassword.status).toBe(200);
    expect((newPassword.body as { data: { requiresMfa: boolean; accessToken: string } })
      .data.requiresMfa).toBe(false);
    expect((newPassword.body as { data: { accessToken: string } }).data.accessToken)
      .toEqual(expect.any(String));
  }, 30_000);

  it("allows only one concurrent completion", async () => {
    const app = await createTestApp();
    const { email } = await createTemporaryUser(app);
    const challenge = await loginForPasswordChange(app, email);

    const results = await Promise.all([
      completePasswordChange(app, challenge, "ConcurrentPasswordOne123!"),
      completePasswordChange(app, challenge, "ConcurrentPasswordTwo123!"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  }, 30_000);

  it("rejects expired challenges and reuse of the temporary password", async () => {
    const app = await createTestApp();
    const { email, userId } = await createTemporaryUser(app);
    const challenge = await loginForPasswordChange(app, email);

    const samePassword = await completePasswordChange(
      app,
      challenge,
      "TemporaryPassword123!",
    );
    expect(samePassword.status).toBe(400);
    expect((samePassword.body as { error: { code: string } }).error.code)
      .toBe("PASSWORD_REUSE_NOT_ALLOWED");

    const expired = jwt.sign(
      {
        sub: userId,
        type: "password_change_challenge",
        passwordVersion: "invalid",
      },
      TEST_JWT_ACCESS_SECRET,
      { expiresIn: -1 },
    );
    const expiredResponse = await completePasswordChange(app, expired);
    expect(expiredResponse.status).toBe(401);
    expect((expiredResponse.body as { error: { code: string } }).error.code)
      .toBe("INVALID_PASSWORD_CHANGE_CHALLENGE");
  }, 20_000);

  it("invalidates an outstanding challenge when an administrator resets again", async () => {
    const app = await createTestApp();
    const { email, userId } = await createTemporaryUser(app);
    const staleChallenge = await loginForPasswordChange(app, email);
    const ownerSession = await loginAndGetTokens(app, "admin@clinic-a.au");

    const reset = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${userId}/reset-password`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .send({ newPassword: "ReplacementTemporaryPassword789!" });
    expect(reset.status).toBe(200);

    const staleResult = await completePasswordChange(app, staleChallenge);
    expect(staleResult.status).toBe(401);
    expect((staleResult.body as { error: { code: string } }).error.code)
      .toBe("INVALID_PASSWORD_CHANGE_CHALLENGE");

    await loginForPasswordChange(
      app,
      email,
      "ReplacementTemporaryPassword789!",
    );
  }, 30_000);

  it("admin reset invalidates existing sessions and requires password change", async () => {
    const app = await createTestApp();
    const staffSession = await loginAndGetTokens(app, "staff@clinic-a.au");
    const managerSession = await loginAndGetTokens(app, "manager@clinic-a.au");

    const reset = await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAStaff}/reset-password`,
      )
      .set("Authorization", `Bearer ${managerSession.accessToken}`)
      .send({ newPassword: "ResetTemporaryPassword123!" });
    expect(reset.status).toBe(200);

    const existingAccess = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${staffSession.accessToken}`);
    expect(existingAccess.status).toBe(403);
    expect((existingAccess.body as { error: { code: string } }).error.code)
      .toBe("PASSWORD_CHANGE_REQUIRED");

    const existingRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", staffSession.refreshCookie);
    expect(existingRefresh.status).toBe(401);

    await loginForPasswordChange(
      app,
      "staff@clinic-a.au",
      "ResetTemporaryPassword123!",
    );
  }, 30_000);

  it("requires the password change before existing MFA enrollment", async () => {
    const app = await createTestApp();
    const { email } = await createTemporaryUser(app, "group_practice_manager");
    const challenge = await loginForPasswordChange(app, email);
    expect((await completePasswordChange(app, challenge)).status).toBe(200);

    const nextLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "NewPermanentPassword456!" });
    expect(nextLogin.status).toBe(200);
    const data = (nextLogin.body as {
      data: {
        requiresMfaEnrollment: boolean;
        enrollmentToken: string;
        accessToken?: string;
      };
    }).data;
    expect(data.requiresMfaEnrollment).toBe(true);
    expect(data.enrollmentToken).toEqual(expect.any(String));
    expect(data.accessToken).toBeUndefined();
    expect(nextLogin.headers["set-cookie"]).toBeUndefined();
  }, 30_000);

  it("does not affect the existing Owner/Admin account", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "admin@clinic-a.au");
    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.refreshCookie).toMatch(/^refreshToken=/);
  }, 20_000);
});
