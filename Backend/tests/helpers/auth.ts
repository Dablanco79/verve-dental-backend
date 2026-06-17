import type { Express } from "express";
import { generateSync } from "otplib";
import request from "supertest";

import { SEED_ADMIN_TOTP_SECRET } from "../../src/repositories/userRepository.js";

type LoginData = {
  requiresMfa: boolean;
  accessToken?: string;
  mfaToken?: string;
};

type TokenPair = {
  accessToken: string;
  /** "refreshToken=<jwt>" — ready to pass to .set("Cookie", ...) */
  refreshCookie: string;
};

/** Extract "refreshToken=<value>" from a supertest response's Set-Cookie headers. */
export function extractRefreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as string | string[] | undefined;
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = cookies.find((c) => c.startsWith("refreshToken="));
  if (!found) throw new Error("No refreshToken cookie in response");
  return found.split(";")[0] ?? "";
}

/**
 * Log in and return only the access token. MFA-aware: generates a real TOTP
 * code from the seed user's known secret rather than using a static bypass.
 */
export async function loginAndGetAccessToken(
  app: Express,
  email: string,
  password = "password123",
): Promise<string> {
  const { accessToken } = await loginAndGetTokens(app, email, password);
  return accessToken;
}

/**
 * Log in and return the access token plus the HttpOnly refresh cookie string.
 * Handles the MFA challenge flow by generating a real TOTP code from the
 * seed admin's known Base32 secret (SEED_ADMIN_TOTP_SECRET).
 */
export async function loginAndGetTokens(
  app: Express,
  email: string,
  password = "password123",
): Promise<TokenPair> {
  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  const body = loginResponse.body as { data: LoginData };

  if (loginResponse.status !== 200) {
    throw new Error(`Login failed for ${email}: ${String(loginResponse.status)}`);
  }

  if (body.data.requiresMfa) {
    const totpCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const mfaResponse = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken: body.data.mfaToken,
      code: totpCode,
    });

    if (mfaResponse.status !== 200) {
      throw new Error(`MFA failed for ${email}: ${String(mfaResponse.status)}`);
    }

    const mfaBody = mfaResponse.body as { data: { accessToken: string } };
    return {
      accessToken: mfaBody.data.accessToken,
      refreshCookie: extractRefreshCookie(mfaResponse),
    };
  }

  if (!body.data.accessToken) {
    throw new Error(`Missing access token for ${email}`);
  }

  return {
    accessToken: body.data.accessToken,
    refreshCookie: extractRefreshCookie(loginResponse),
  };
}
