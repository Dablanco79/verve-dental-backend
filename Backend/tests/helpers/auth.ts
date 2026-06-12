import type { Express } from "express";
import request from "supertest";

type LoginData = {
  requiresMfa: boolean;
  accessToken?: string;
  mfaToken?: string;
};

export async function loginAndGetAccessToken(
  app: Express,
  email: string,
  password = "password123",
): Promise<string> {
  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  const body = loginResponse.body as { data: LoginData };

  if (loginResponse.status !== 200) {
    throw new Error(`Login failed for ${email}: ${String(loginResponse.status)}`);
  }

  if (body.data.requiresMfa) {
    const mfaResponse = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken: body.data.mfaToken,
      code: "000000",
    });

    const mfaBody = mfaResponse.body as { data: { accessToken: string } };

    if (mfaResponse.status !== 200) {
      throw new Error(`MFA failed for ${email}: ${String(mfaResponse.status)}`);
    }

    return mfaBody.data.accessToken;
  }

  if (!body.data.accessToken) {
    throw new Error(`Missing access token for ${email}`);
  }

  return body.data.accessToken;
}
