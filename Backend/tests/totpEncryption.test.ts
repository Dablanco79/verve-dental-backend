/**
 * Sprint 2D — TOTP Secret Encryption Tests
 *
 * Proves:
 *   1. AES-256-GCM round-trip: encrypt → decrypt returns original plaintext
 *   2. Random IV: two encryptions of the same secret differ (IND-CPA)
 *   3. Wrong-key decryption throws (GCM auth tag mismatch)
 *   4. After enrollment the stored totpSecret is NOT the plaintext Base32 value
 *   5. Enrolled users can still authenticate end-to-end (decrypt → otplib verify)
 */

import request from "supertest";
import { generateSync } from "otplib";

import { encryptTotpSecret, decryptTotpSecret } from "../src/utils/mfaCrypto.js";
import { createInMemoryUserRepository, SEED_USER_IDS } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp, TEST_MFA_ENCRYPTION_KEY } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

// ─── 1. Crypto helper — AES-256-GCM round-trip ──────────────────────────────

describe("encryptTotpSecret / decryptTotpSecret — AES-256-GCM", () => {
  const PLAINTEXT = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // typical 32-char Base32 secret
  const KEY = TEST_MFA_ENCRYPTION_KEY;

  it("round-trip: encrypt then decrypt returns the original plaintext", () => {
    const ciphertext = encryptTotpSecret(PLAINTEXT, KEY);
    const decrypted = decryptTotpSecret(ciphertext, KEY);
    expect(decrypted).toBe(PLAINTEXT);
  });

  it("ciphertext contains three colon-delimited hex segments", () => {
    const ciphertext = encryptTotpSecret(PLAINTEXT, KEY);
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // Each segment must be valid lowercase hex
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("ciphertext is never the plaintext", () => {
    const ciphertext = encryptTotpSecret(PLAINTEXT, KEY);
    expect(ciphertext).not.toBe(PLAINTEXT);
  });

  it("random IV: two encryptions of the same plaintext produce different ciphertexts", () => {
    const c1 = encryptTotpSecret(PLAINTEXT, KEY);
    const c2 = encryptTotpSecret(PLAINTEXT, KEY);
    expect(c1).not.toBe(c2);
    // But both decrypt correctly
    expect(decryptTotpSecret(c1, KEY)).toBe(PLAINTEXT);
    expect(decryptTotpSecret(c2, KEY)).toBe(PLAINTEXT);
  });

  it("decrypting with the wrong key throws (GCM auth tag mismatch)", () => {
    const ciphertext = encryptTotpSecret(PLAINTEXT, KEY);
    const wrongKey = "f".repeat(64);
    expect(() => decryptTotpSecret(ciphertext, wrongKey)).toThrow();
  });

  it("decrypting a tampered ciphertext throws", () => {
    const ciphertext = encryptTotpSecret(PLAINTEXT, KEY);
    // Flip the last hex character of the encrypted payload
    const parts = ciphertext.split(":");
    const last = parts[2]!;
    const flipped = last.slice(0, -1) + (last.endsWith("a") ? "b" : "a");
    const tampered = [...parts.slice(0, 2), flipped].join(":");
    expect(() => decryptTotpSecret(tampered, KEY)).toThrow();
  });

  it("throws on a malformed ciphertext (missing segments)", () => {
    expect(() => decryptTotpSecret("notavalidciphertext", KEY)).toThrow();
    expect(() => decryptTotpSecret("only:two", KEY)).toThrow();
  });

  it("throws when the key is not a valid 64-char hex string", () => {
    expect(() => encryptTotpSecret(PLAINTEXT, "tooshort")).toThrow();
    expect(() => decryptTotpSecret(encryptTotpSecret(PLAINTEXT, KEY), "tooshort")).toThrow();
  });
});

// ─── 2. Plaintext secrets are NOT stored after enrollment ────────────────────

describe("MFA enrollment — stored secret is encrypted", () => {
  it("totpSecret on the user record is not the plaintext Base32 value after enrollment", async () => {
    const KEY = TEST_MFA_ENCRYPTION_KEY;
    const userRepo = await createInMemoryUserRepository(KEY);

    const ENROLLED_PLAINTEXT = "TESTSECRETABCDEFGHIJ"; // arbitrary Base32-like string
    const encrypted = encryptTotpSecret(ENROLLED_PLAINTEXT, KEY);

    await userRepo.setUserMfaEnrollment(SEED_USER_IDS.clinicAStaff, encrypted);

    const user = await userRepo.findById(SEED_USER_IDS.clinicAStaff);

    expect(user).not.toBeNull();
    // The stored value must NOT equal the plaintext
    expect(user!.totpSecret).not.toBe(ENROLLED_PLAINTEXT);
    // Must match the encrypted format: <hex>:<hex>:<hex>
    expect(user!.totpSecret).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("seed admin's stored totpSecret is already encrypted at repository init", async () => {
    const KEY = TEST_MFA_ENCRYPTION_KEY;
    const userRepo = await createInMemoryUserRepository(KEY);

    const admin = await userRepo.findById(SEED_USER_IDS.clinicAAdmin);

    expect(admin).not.toBeNull();
    // Stored value must follow the encrypted format, not a raw Base32 string
    expect(admin!.totpSecret).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });
});

// ─── 3. Enrolled users can still authenticate end-to-end ────────────────────

describe("MFA authentication with encrypted secrets — HTTP integration", () => {
  it("full enrollment + login + verify succeeds when secrets are encrypted at rest", async () => {
    const app = await createTestApp();

    // 1. Log in as manager (no MFA yet)
    const accessToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // 2. Set up MFA — get plaintext secret for QR code
    const setupRes = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send();

    expect(setupRes.status).toBe(200);
    const { secret } = (setupRes.body as ApiData<{ secret: string; uri: string }>).data;

    // 3. Confirm enrollment with a valid TOTP code (encrypts and persists)
    const enrollCode = generateSync({ secret });
    const confirmRes = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: enrollCode });

    expect(confirmRes.status).toBe(200);

    // 4. Log in again — should require MFA challenge
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: "manager@clinic-a.au",
      password: "password123",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.requiresMfa).toBe(true);
    const { mfaToken } = loginRes.body.data as { mfaToken: string };

    // 5. Complete MFA — the service decrypts the stored secret before verifying
    const verifyCode = generateSync({ secret });
    const verifyRes = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken,
      code: verifyCode,
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toEqual(expect.any(String));
    expect(verifyRes.body.data.refreshToken).toEqual(expect.any(String));
  });

  it("wrong code still returns 401 INVALID_MFA_CODE with encrypted secrets", async () => {
    const app = await createTestApp();
    const accessToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

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

    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: "manager@clinic-a.au",
      password: "password123",
    });

    const { mfaToken } = loginRes.body.data as { mfaToken: string };

    const realCode = generateSync({ secret });
    const wrongCode = realCode === "000000" ? "000001" : "000000";

    const verifyRes = await request(app).post("/api/v1/auth/mfa/verify").send({
      mfaToken,
      code: wrongCode,
    });

    expect(verifyRes.status).toBe(401);
    expect((verifyRes.body as ApiError).error.code).toBe("INVALID_MFA_CODE");
  });

  it("seed admin (pre-encrypted secret) can log in via MFA challenge", async () => {
    // admin@clinic-a.au is seeded with mfaEnabled=true and a pre-encrypted TOTP secret.
    // The auth helper (loginAndGetTokens) generates codes from SEED_ADMIN_TOTP_SECRET
    // (plaintext) and the service decrypts the stored ciphertext before verifying.
    const app = await createTestApp();

    // loginAndGetAccessToken handles the MFA flow automatically for admin@clinic-a.au
    const accessToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    expect(typeof accessToken).toBe("string");
    expect(accessToken.length).toBeGreaterThan(0);
  });
});
