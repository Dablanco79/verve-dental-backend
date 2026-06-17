import request from "supertest";
import { generateSync } from "otplib";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_ADMIN_TOTP_SECRET,
} from "../src/repositories/userRepository.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type LoginData = {
  requiresMfa: boolean;
  accessToken?: string;
  mfaToken?: string;
  user: { homeClinicId: string; email: string };
};

describe("GET /api/v1/health", () => {
  it("returns service health status", async () => {
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

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "admin@clinic-b.au",
      password: "password123",
    });

    const loginBody = loginResponse.body as ApiData<LoginData>;
    const accessToken = loginBody.data.accessToken ?? "";

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
