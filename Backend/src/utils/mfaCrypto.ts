/**
 * AES-256-GCM helpers for encrypting/decrypting TOTP secrets at rest.
 *
 * Ciphertext format (colon-delimited hex):
 *   <12-byte IV>:<16-byte GCM auth tag>:<N-byte ciphertext>
 *
 * The key must be a 64-character hex string (32 bytes).  Pass
 * config.MFA_ENCRYPTION_KEY directly — never hardcode or log it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { AppError } from "../types/errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;  // 96-bit IV — NIST recommended for GCM
const TAG_BYTES = 16; // 128-bit authentication tag

function parseKey(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, "hex");
  if (buf.length !== 32) {
    throw new AppError(
      500,
      "INTERNAL_ERROR",
      "MFA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
    );
  }
  return buf;
}

/**
 * Encrypts a plaintext TOTP secret using AES-256-GCM.
 *
 * Returns a colon-delimited hex string:
 *   "<hex_iv>:<hex_authTag>:<hex_ciphertext>"
 *
 * Each call uses a fresh random IV so two encryptions of the same plaintext
 * produce different ciphertexts (IND-CPA safe).
 */
export function encryptTotpSecret(plaintext: string, hexKey: string): string {
  const key = parseKey(hexKey);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypts a ciphertext produced by encryptTotpSecret.
 *
 * Expects the "<hex_iv>:<hex_authTag>:<hex_ciphertext>" format.
 * Throws INTERNAL_ERROR on format violations or GCM authentication failure
 * (tampered data, wrong key, or bit-flips).
 */
export function decryptTotpSecret(ciphertext: string, hexKey: string): string {
  const key = parseKey(hexKey);
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new AppError(
      500,
      "INTERNAL_ERROR",
      "Invalid encrypted TOTP secret format — expected <iv>:<authTag>:<ciphertext>",
    );
  }

  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  if (iv.length !== IV_BYTES) {
    throw new AppError(500, "INTERNAL_ERROR", "Invalid IV length in encrypted TOTP secret");
  }
  if (authTag.length !== TAG_BYTES) {
    throw new AppError(500, "INTERNAL_ERROR", "Invalid auth tag length in encrypted TOTP secret");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new AppError(
      500,
      "INTERNAL_ERROR",
      "Failed to decrypt TOTP secret — authentication tag mismatch",
    );
  }
}
