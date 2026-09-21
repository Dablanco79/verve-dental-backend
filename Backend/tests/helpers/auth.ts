import type { Express } from "express";
import { generateSync } from "otplib";
import request from "supertest";

import { SEED_ADMIN_TOTP_SECRET } from "../../src/repositories/userRepository.js";

/**
 * Waits until we are at least `bufferMs` milliseconds clear of a TOTP period
 * boundary before returning.
 *
 * TOTP codes rotate every 30 seconds (otplib default `period`).  In otplib v13
 * the default `epochTolerance` is 0 — the verifier accepts only the exact
 * current period's code.  A code generated in the last <bufferMs> of period N
 * may land in period N+1 by the time the HTTP round-trip completes, producing
 * an intermittent 401 that is not reproducible locally but appears regularly
 * in CI where many suites run concurrently and shared-infra latency is higher.
 *
 * This guard ensures the code is generated well inside a fresh period so it
 * has at least (30 000 − bufferMs) ms of validity remaining for the verify
 * round-trip.  Maximum wait added per MFA login: ~2.2 seconds in the worst case.
 *
 * NOTE: the production authService also adds epochTolerance: 30 (RFC 6238 §5.2)
 * to handle genuine network latency for real users.  Both fixes are required for
 * a robust system; this guard alone is not sufficient if latency exceeds 30 s,
 * and the production tolerance alone is insufficient if both code generation and
 * the full verify call straddle a period boundary within the tolerance window.
 */
async function waitForSafeTotpWindow(bufferMs = 2000): Promise<void> {
  const STEP_MS = 30_000; // otplib default TOTP period
  const msInPeriod = Date.now() % STEP_MS;
  const msUntilBoundary = STEP_MS - msInPeriod;
  if (msUntilBoundary < bufferMs) {
    // Wait past the boundary plus a 200 ms cushion so we are safely into the
    // new period before generateSync() is called.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, msUntilBoundary + 200),
    );
  }
}

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
    // Generate the TOTP code as late as possible — AFTER receiving the MFA
    // challenge, not before the login call.  This reduces the generation-to-
    // verification window from two HTTP round-trips to one, cutting the
    // probability of a period-boundary crossing in half.
    //
    // waitForSafeTotpWindow() then ensures we are not in the last 2 s of a
    // period, so the generated code has ≥28 s of validity for the verify call.
    await waitForSafeTotpWindow();
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
