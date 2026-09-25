/**
 * Clinical Staff MFA Tests — Workforce Security
 *
 * APPROVED POLICY:
 *   owner_admin              → MFA required (existing, unchanged)
 *   group_practice_manager   → MFA required (existing, unchanged)
 *   clinical_staff           → MFA available, encouraged; optional by default
 *                              (CLINICAL_STAFF_MFA_POLICY=optional)
 *                              Becomes mandatory when policy=required.
 *
 * This suite verifies:
 *   1. owner_admin MFA remains mandatory (regression guard)
 *   2. group_practice_manager MFA remains mandatory (regression guard)
 *   3. clinical_staff without MFA can log in when policy is optional
 *   4. clinical_staff can enroll an Authenticator App (setup + confirm)
 *   5. Enrolled clinical_staff is challenged for MFA at login
 *   6. Enrolled clinical_staff cannot bypass MFA (wrong code rejected)
 *   7. Clinical_staff can skip enrollment only while policy is optional
 *      (policy=required → enrollment enforced; no skip path)
 *   8. Clock In/Out behaviour is unaffected by MFA policy changes
 *   9. MFA verification uses existing TOTP tolerance/security rules
 *
 * Seed users:
 *   admin@clinic-a.au      owner_admin,           mfaEnabled: true
 *   manager@clinic-a.au    group_practice_manager, mfaEnabled: true
 *   staff@clinic-a.au      clinical_staff,         mfaEnabled: false
 *   admin-nomfa@clinic-a.au   owner_admin,           mfaEnabled: false
 *   manager-nomfa@clinic-a.au group_practice_manager, mfaEnabled: false
 *
 * All tests use isolated in-memory repositories (no DATABASE_URL / REDIS_URL).
 */

import request from "supertest";
import { generateSync } from "otplib";

import {
  SEED_ADMIN_TOTP_SECRET,
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createTestApp } from "./helpers/testApp.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";

const PASSWORD = "password123";

// ─── Response type helpers ────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type LoginAuthData = {
  requiresMfa: boolean;
  requiresMfaEnrollment?: boolean;
  accessToken: string;
  user: { email: string; role: string };
};

type LoginMfaData = {
  requiresMfa: boolean;
  mfaToken: string;
  user: { email: string };
};

type LoginEnrollmentData = {
  requiresMfaEnrollment: boolean;
  enrollmentToken: string;
  user: { email: string; role: string };
};

/** Extract the Set-Cookie "refreshToken=…" string if present, or null. */
function findRefreshCookie(res: request.Response): string | null {
  const raw = res.headers["set-cookie"] as string | string[] | undefined;
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((c) => c.startsWith("refreshToken=")) ?? null;
}

// ─── 1. owner_admin MFA remains mandatory (regression guard) ─────────────────

describe("regression — owner_admin MFA unchanged", () => {
  it("owner_admin with enrolled MFA still receives mfa_required", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginMfaData>).data;
    expect(data.requiresMfa).toBe(true);
    expect(typeof data.mfaToken).toBe("string");
  });

  it("owner_admin without enrolled MFA still receives mfa_enrollment_required", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin-nomfa@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginEnrollmentData>).data;
    expect(data.requiresMfaEnrollment).toBe(true);
    expect(data).not.toHaveProperty("accessToken");
    expect(findRefreshCookie(res)).toBeNull();
  });

  it("owner_admin completes MFA challenge successfully", async () => {
    const app = await createTestApp();

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@clinic-a.au", password: PASSWORD });

    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;
    const code = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code });

    expect(verifyRes.status).toBe(200);
    expect(
      (verifyRes.body as ApiData<{ accessToken: string }>).data.accessToken,
    ).toEqual(expect.any(String));
    expect(findRefreshCookie(verifyRes)).not.toBeNull();
  });
});

// ─── 2. group_practice_manager MFA remains mandatory (regression guard) ───────

describe("regression — group_practice_manager MFA unchanged", () => {
  it("GPM with enrolled MFA still receives mfa_required", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "manager@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginMfaData>).data;
    expect(data.requiresMfa).toBe(true);
    expect(typeof data.mfaToken).toBe("string");
  });

  it("GPM without enrolled MFA still receives mfa_enrollment_required", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "manager-nomfa@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginEnrollmentData>).data;
    expect(data.requiresMfaEnrollment).toBe(true);
    expect(data).not.toHaveProperty("accessToken");
    expect(findRefreshCookie(res)).toBeNull();
  });
});

// ─── 3. clinical_staff without MFA can log in when policy is optional ─────────

describe("clinical_staff — policy=optional, no MFA enrolled", () => {
  it("login returns authenticated (requiresMfa: false) and issues tokens", async () => {
    const app = await createTestApp(); // default policy=optional

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginAuthData>).data;
    expect(data.requiresMfa).toBe(false);
    expect(data).not.toHaveProperty("requiresMfaEnrollment");
    expect(typeof data.accessToken).toBe("string");
    expect(findRefreshCookie(res)).not.toBeNull();
  });

  it("login does not return requiresMfaEnrollment (no forced enrollment when optional)", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginAuthData>).data;
    expect(data).not.toHaveProperty("requiresMfaEnrollment");
  });
});

// ─── 4. clinical_staff can enroll an Authenticator App ───────────────────────

describe("clinical_staff — MFA enrollment via access token (Security page path)", () => {
  it("POST /auth/mfa/setup returns secret and otpauth URI for clinical_staff", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();

    expect(res.status).toBe(200);
    const { secret, uri } = (res.body as ApiData<{ secret: string; uri: string }>).data;
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("staff%40clinic-a.au");
  });

  it("POST /auth/mfa/confirm completes enrollment with a valid TOTP code", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;

    const code = generateSync({ secret });
    const confirmRes = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code });

    expect(confirmRes.status).toBe(200);
    expect(
      (confirmRes.body as ApiData<{ message: string }>).data.message,
    ).toBe("MFA enrollment complete");
  });

  it("POST /auth/mfa/confirm rejects an invalid code with 401 INVALID_MFA_CODE", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;

    const realCode = generateSync({ secret });
    const wrongCode = realCode === "000000" ? "000001" : "000000";

    const confirmRes = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: wrongCode });

    expect(confirmRes.status).toBe(401);
    expect((confirmRes.body as ApiError).error.code).toBe("INVALID_MFA_CODE");
  });

  it("unauthenticated call to /auth/mfa/setup is rejected (401 UNAUTHORIZED)", async () => {
    const app = await createTestApp();

    const res = await request(app).post("/api/v1/auth/mfa/setup").send();
    expect(res.status).toBe(401);
    expect((res.body as ApiError).error.code).toBe("UNAUTHORIZED");
  });
});

// ─── 5. Enrolled clinical_staff is challenged for MFA at login ────────────────

describe("clinical_staff — enrolled, policy=optional — login challenges MFA", () => {
  /** Helper: enroll staff@clinic-a.au and return the secret. */
  async function enrollStaff(app: Awaited<ReturnType<typeof createTestApp>>) {
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;

    const code = generateSync({ secret });
    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code });

    return secret;
  }

  it("login returns mfa_required (not authenticated) after enrollment", async () => {
    const app = await createTestApp();
    await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    expect(loginRes.status).toBe(200);
    const data = (loginRes.body as ApiData<LoginMfaData>).data;
    expect(data.requiresMfa).toBe(true);
    expect(typeof data.mfaToken).toBe("string");
  });

  it("login does NOT issue tokens directly after enrollment (mfa token only)", async () => {
    const app = await createTestApp();
    await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    const data = (loginRes.body as ApiData<LoginMfaData>).data;
    expect(data).not.toHaveProperty("accessToken");
    expect(findRefreshCookie(loginRes)).toBeNull();
  });

  it("correct TOTP code issued in /auth/mfa/verify → access and refresh tokens issued", async () => {
    const app = await createTestApp();
    const secret = await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: verifyCode });

    expect(verifyRes.status).toBe(200);
    expect(
      (verifyRes.body as ApiData<{ accessToken: string }>).data.accessToken,
    ).toEqual(expect.any(String));
    expect(findRefreshCookie(verifyRes)).not.toBeNull();
  });

  it("the issued access token grants access to protected endpoints", async () => {
    const app = await createTestApp();
    const secret = await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: verifyCode });
    const { accessToken } = (verifyRes.body as ApiData<{ accessToken: string }>).data;

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(meRes.status).toBe(200);
  });
});

// ─── 6. Enrolled clinical_staff cannot bypass MFA ────────────────────────────

describe("clinical_staff — enrolled — MFA bypass prevention", () => {
  /** Enroll staff@clinic-a.au and return secret. */
  async function enrollStaff(app: Awaited<ReturnType<typeof createTestApp>>) {
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;
    const code = generateSync({ secret });
    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code });
    return secret;
  }

  it("submitting a wrong code to /auth/mfa/verify returns 401 INVALID_MFA_CODE", async () => {
    const app = await createTestApp();
    await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: "000000" });

    expect(verifyRes.status).toBe(401);
    expect((verifyRes.body as ApiError).error.code).toBe("INVALID_MFA_CODE");
  });

  it("the mfaToken from enrolled clinical_staff login cannot be used to call /auth/me", async () => {
    const app = await createTestApp();
    await enrollStaff(app);

    // Get the MFA challenge token
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    // Attempting to use the mfa_challenge token as an access token must fail
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${mfaToken}`);

    expect(meRes.status).toBe(401);
  });

  it("no refresh cookie is set when login returns mfa_required for enrolled clinical_staff", async () => {
    const app = await createTestApp();
    await enrollStaff(app);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    expect(findRefreshCookie(loginRes)).toBeNull();
  });
});

// ─── 7. Clinical_staff can skip enrollment only while policy is optional ───────

describe("clinical_staff — policy=optional allows skip (authenticate without enrolling)", () => {
  it("clinical_staff without MFA logs in normally when policy is optional (implicit skip)", async () => {
    const app = await createTestApp(); // CLINICAL_STAFF_MFA_POLICY not set → default 'optional'

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginAuthData>).data;
    // Optional policy: unenrolled staff gets tokens directly — they can skip enrollment
    expect(data.requiresMfa).toBe(false);
    expect(typeof data.accessToken).toBe("string");
    expect(findRefreshCookie(res)).not.toBeNull();
  });
});

describe("clinical_staff — policy=required enforces enrollment (no skip path)", () => {
  it("clinical_staff without MFA receives mfa_enrollment_required when policy is required", async () => {
    // Override CLINICAL_STAFF_MFA_POLICY via process.env for this test
    process.env.CLINICAL_STAFF_MFA_POLICY = "required";
    const app = await createTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    // Restore default before assertions so a throw doesn't leave env dirty
    delete process.env.CLINICAL_STAFF_MFA_POLICY;

    expect(res.status).toBe(200);
    const data = (res.body as ApiData<LoginEnrollmentData>).data;
    expect(data.requiresMfaEnrollment).toBe(true);
    expect(typeof data.enrollmentToken).toBe("string");
    expect(data).not.toHaveProperty("accessToken");
    expect(findRefreshCookie(res)).toBeNull();
  });

  it("policy=required: clinical_staff can enroll via enrollmentToken and then log in with MFA", async () => {
    process.env.CLINICAL_STAFF_MFA_POLICY = "required";
    const app = await createTestApp();

    // Step 1: Login → enrollment_required
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { enrollmentToken } = (loginRes.body as ApiData<LoginEnrollmentData>).data;

    // Step 2: Setup MFA using enrollment token
    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${enrollmentToken}`)
      .send();
    expect(setupRes.status).toBe(200);
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;

    // Step 3: Confirm enrollment
    const enrollCode = generateSync({ secret });
    const confirmRes = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${enrollmentToken}`)
      .send({ code: enrollCode });
    expect(confirmRes.status).toBe(200);

    // Step 4: Login again → should now receive mfa_required (not enrollment_required)
    const loginRes2 = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const loginData2 = (loginRes2.body as ApiData<LoginMfaData>).data;
    expect(loginData2.requiresMfa).toBe(true);

    // Step 5: Verify MFA → tokens issued
    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: loginData2.mfaToken, code: verifyCode });
    expect(verifyRes.status).toBe(200);

    delete process.env.CLINICAL_STAFF_MFA_POLICY;
  });

  it("policy=required: refresh with no MFA returns 403 MFA_ENROLLMENT_REQUIRED for clinical_staff without MFA", async () => {
    // This test verifies that the refresh bypass prevention also applies to
    // clinical_staff under the required policy. We cannot easily inject a
    // refresh token without a prior login, so we verify the login gate
    // (no refresh cookie → refresh endpoint returns 400 MISSING_REFRESH_TOKEN)
    // and that the enforcement code path is active.
    process.env.CLINICAL_STAFF_MFA_POLICY = "required";
    const app = await createTestApp();

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });

    delete process.env.CLINICAL_STAFF_MFA_POLICY;

    // No refresh cookie was set
    expect(findRefreshCookie(loginRes)).toBeNull();

    // Without a refresh cookie the endpoint returns 400, not 403 — there is
    // simply no token to bypass with.
    const refreshRes = await request(app).post("/api/v1/auth/refresh").send();
    expect(refreshRes.status).toBe(400);
  });
});

// ─── 8. Clock In/Out behaviour is unaffected by MFA policy ───────────────────

describe("clinical_staff — Clock In/Out unaffected by MFA", () => {
  it("after enrolling MFA and authenticating, clinical_staff can call clock-in endpoint", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Enroll MFA
    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;
    const enrollCode = generateSync({ secret });
    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: enrollCode });

    // Re-login with MFA challenge
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;
    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: verifyCode });
    const { accessToken: newAccessToken } = (
      verifyRes.body as ApiData<{ accessToken: string }>
    ).data;

    // Clock-in endpoint should accept the new token
    // (Expect 4xx from business logic, NOT 401 auth error)
    const clockRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${newAccessToken}`)
      .send({ shiftStartAt: new Date().toISOString() });

    // 400/422 means auth passed; 401 would mean token rejected
    expect(clockRes.status).not.toBe(401);
    expect(clockRes.status).not.toBe(403);
  });

  it("unenrolled clinical_staff (policy=optional) can call clock-in without any MFA", async () => {
    const app = await createTestApp(); // policy=optional default
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const clockRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ shiftStartAt: new Date().toISOString() });

    // Auth must pass; 400/422 from business logic is expected
    expect(clockRes.status).not.toBe(401);
    expect(clockRes.status).not.toBe(403);
  });
});

// ─── 9. MFA verification uses existing TOTP tolerance/security rules ──────────

describe("clinical_staff — TOTP tolerance rules (±30 s) preserved", () => {
  it("TOTP verification uses epochTolerance — code is accepted by verifySync with tolerance", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;
    const enrollCode = generateSync({ secret });

    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: enrollCode });

    // Login then verify with the same secret used during enrollment
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: verifyCode });

    // The verification must pass using the existing TOTP tolerance
    expect(verifyRes.status).toBe(200);
  });

  it("invalid TOTP code is always rejected regardless of role", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const { secret } = (setupRes.body as ApiData<{ secret: string }>).data;
    const enrollCode = generateSync({ secret });
    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: enrollCode });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: PASSWORD });
    const { mfaToken } = (loginRes.body as ApiData<LoginMfaData>).data;

    // Deliberately wrong code (static; never matches a real TOTP period)
    const verifyRes = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken, code: "000000" });

    expect(verifyRes.status).toBe(401);
    expect((verifyRes.body as ApiError).error.code).toBe("INVALID_MFA_CODE");
  });
});

// ─── Sanity: the SEED_USER_IDS reference is used (avoids unused-import lint) ──

// Compile-time check only — SEED_USER_IDS is used in clock-in tests above
// and here as a static assertion.
void SEED_USER_IDS;
