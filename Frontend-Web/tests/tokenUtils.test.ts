/**
 * Unit tests for decodeTokenPermissions() in src/auth/tokenUtils.ts.
 *
 * Focus: correct Base64URL decoding.  JWT payloads use Base64URL (RFC 4648 §5)
 * which replaces:
 *   '+' (base64 value 62) → '-'
 *   '/' (base64 value 63) → '_'
 * and omits '=' padding.
 *
 * atob() only understands standard Base64, so the function must normalise
 * before calling it.  These tests prove that all three normalisation steps
 * (- → +, _ → /, padding restoration) work correctly.
 */

import { describe, expect, it } from "vitest";

import { decodeTokenPermissions } from "../src/auth/tokenUtils.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Encodes a payload object as a fake JWT (header.payload.signature) using
 * Base64URL — exactly as the backend's `jsonwebtoken` library does.
 *
 * Base64URL encoding:
 *   1. JSON-stringify the payload
 *   2. btoa() → standard Base64
 *   3. Replace '+' → '-' and '/' → '_'
 *   4. Strip trailing '=' padding
 */
function makeFakeJwt(payload: object): string {
  const json = JSON.stringify(payload);
  // btoa() is safe here because all test payloads are ASCII-only.
  const standardB64 = btoa(json);
  const b64url = standardB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  // Use a real-looking (but unsigned) header so the token looks like a JWT.
  return `eyJhbGciOiJIUzI1NiJ9.${b64url}.fakesignature`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeTokenPermissions", () => {

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns the permissions array from a well-formed JWT payload", () => {
    const token = makeFakeJwt({
      sub: "user-123",
      role: "clinical_staff",
      permissions: ["module:inventory", "module:timesheets", "module:roster"],
    });
    expect(decodeTokenPermissions(token)).toEqual([
      "module:inventory",
      "module:timesheets",
      "module:roster",
    ]);
  });

  it("returns an empty array when permissions is an empty array", () => {
    const token = makeFakeJwt({ sub: "user-123", permissions: [] });
    expect(decodeTokenPermissions(token)).toEqual([]);
  });

  // ── Base64URL special-character handling ───────────────────────────────────
  //
  // The payload '{"permissions":[">>>?"]}' was chosen because the bytes
  // 0x5B 0x22 0x3E (characters [">") appear in the byte stream at a position
  // where the 4th 6-bit group maps to base64 value 62 ('+'), and the bytes
  // 0x3E 0x3E 0x3F (">>?") form a group whose 4th 6-bit value is 63 ('/').
  //
  // Concretely:
  //   bytes 0x5B 0x22 0x3E → 6-bit groups 22 50 8 62 → "WyI+" (+ at end)
  //   bytes 0x3E 0x3E 0x3F → 6-bit groups 15 35 56 63 → "Pj4/" (/ at end)
  //
  // After Base64URL conversion: '+' → '-' and '/' → '_', giving "WyI-Pj4_".
  // The function must reverse this to recover the original JSON.

  it("correctly handles Base64URL '-' and '_' characters (maps '+' and '/' back)", () => {
    const json = '{"permissions":[">>>?"]}';
    const standardB64 = btoa(json);

    // Assert that this specific test exercises both special characters.
    // If either expect below fails, the payload choice was wrong and the test
    // needs a new payload — it does not indicate a bug in the function.
    expect(standardB64).toMatch(/\+/);  // confirms '+' (→ '-' in Base64URL) is present
    expect(standardB64).toMatch(/\//);  // confirms '/' (→ '_' in Base64URL) is present

    // Build the Base64URL form (what the backend JWT library produces).
    const b64url = standardB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(b64url).toMatch(/-/);   // '-' must appear in the payload segment
    expect(b64url).toMatch(/_/);   // '_' must appear in the payload segment

    const token = `eyJhbGciOiJIUzI1NiJ9.${b64url}.fakesignature`;

    // The function must correctly restore '-' → '+' and '_' → '/' before
    // calling atob(), then JSON-parse to recover the original permissions.
    expect(decodeTokenPermissions(token)).toEqual([">>>?"]);
  });

  // ── Padding restoration ────────────────────────────────────────────────────
  //
  // Standard Base64 pads output to a multiple of 4 chars with '='.
  // Base64URL omits this padding entirely.  The function must restore it.
  //
  //   22-byte JSON → Math.ceil(22/3)*4 = 32 base64 chars → 2 '=' padding chars
  //   23-byte JSON → Math.ceil(23/3)*4 = 32 base64 chars → 1 '=' padding char
  //   21-byte JSON → Math.ceil(21/3)*4 = 28 base64 chars → 0 '=' padding chars

  it("restores two missing '=' padding chars (22-byte JSON payload)", () => {
    const json = '{"permissions":["xx"]}';
    expect(json.length).toBe(22); // 22 bytes → 2 padding chars
    const standardB64 = btoa(json);
    expect(standardB64).toMatch(/==$/); // assert padding is present in std b64

    // makeFakeJwt strips the padding — decodeTokenPermissions must restore it.
    const token = makeFakeJwt({ permissions: ["xx"] });
    expect(decodeTokenPermissions(token)).toEqual(["xx"]);
  });

  it("restores one missing '=' padding char (23-byte JSON payload)", () => {
    const json = '{"permissions":["xxx"]}';
    expect(json.length).toBe(23); // 23 bytes → 1 padding char
    const standardB64 = btoa(json);
    expect(standardB64).toMatch(/[^=]=$/)  ; // exactly one trailing '='

    const token = makeFakeJwt({ permissions: ["xxx"] });
    expect(decodeTokenPermissions(token)).toEqual(["xxx"]);
  });

  it("handles payloads with no padding required (21-byte JSON payload)", () => {
    const json = '{"permissions":["x"]}';
    expect(json.length).toBe(21); // 21 bytes → 0 padding
    const standardB64 = btoa(json);
    expect(standardB64).not.toMatch(/=$/); // no trailing '='

    const token = makeFakeJwt({ permissions: ["x"] });
    expect(decodeTokenPermissions(token)).toEqual(["x"]);
  });

  // ── Fallback / error cases ─────────────────────────────────────────────────

  it("returns [] for a token with only two segments (malformed JWT)", () => {
    expect(decodeTokenPermissions("header.payload")).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(decodeTokenPermissions("")).toEqual([]);
  });

  it("returns [] for a token whose payload is not valid Base64URL", () => {
    expect(decodeTokenPermissions("header.!!!.sig")).toEqual([]);
  });

  it("returns [] when the payload JSON has no permissions field", () => {
    const token = makeFakeJwt({ sub: "u1", role: "clinical_staff" });
    expect(decodeTokenPermissions(token)).toEqual([]);
  });

  it("returns [] when permissions is a string instead of an array", () => {
    const token = makeFakeJwt({ sub: "u1", permissions: "module:inventory" });
    expect(decodeTokenPermissions(token)).toEqual([]);
  });

  it("returns [] when permissions is null", () => {
    const token = makeFakeJwt({ sub: "u1", permissions: null });
    expect(decodeTokenPermissions(token)).toEqual([]);
  });
});
