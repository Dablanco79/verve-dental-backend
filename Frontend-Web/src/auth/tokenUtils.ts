/**
 * tokenUtils.ts — lightweight JWT payload decoder (no signature verification).
 *
 * JWT payloads use Base64URL encoding (RFC 4648 §5), which differs from
 * standard Base64 in three ways:
 *
 *   1. '+' (base64 value 62) is replaced by '-'
 *   2. '/' (base64 value 63) is replaced by '_'
 *   3. Padding characters ('=') are omitted
 *
 * `atob()` only understands standard Base64, so we must normalise before
 * calling it:
 *   1. Replace '-' → '+'
 *   2. Replace '_' → '/'
 *   3. Re-add '=' padding so the length is a multiple of 4
 *      (padding length = (4 - (len % 4)) % 4)
 *
 * We do NOT verify the JWT signature here — the backend already verified the
 * request and issued the token.  This function is called only after a
 * successful login/refresh/MFA flow to read the `permissions` claim so that
 * the React user state is immediately populated with the full grant set
 * (role defaults ∪ explicit user_permission_grants rows).
 */

/**
 * Extracts the `permissions` string array from the payload segment of a JWT
 * access token, using correct Base64URL decoding.
 *
 * Returns `[]` on any parse or decode failure so callers have a safe fallback.
 *
 * @param accessToken - Full JWT string in "header.payload.signature" format.
 */
export function decodeTokenPermissions(accessToken: string): string[] {
  try {
    const parts = accessToken.split(".");
    // A well-formed JWT has exactly three dot-separated segments.
    if (parts.length !== 3 || !parts[1]) return [];

    // ── Base64URL → standard Base64 ──────────────────────────────────────────
    // Step 1 & 2: reverse the character substitutions made by Base64URL.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");

    // Step 3: restore the '=' padding that Base64URL omits.
    // A standard Base64 string must have length that is a multiple of 4.
    // Padding needed = (4 - (len % 4)) % 4, which gives 0, 1, or 2 '=' chars.
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);

    const payload: unknown = JSON.parse(atob(padded));

    if (
      payload !== null &&
      typeof payload === "object" &&
      "permissions" in payload &&
      Array.isArray(payload.permissions)
    ) {
      // Narrowed to object & { permissions: unknown[] } by the guards above.
      // Cast to string[] — the backend JWT issuer guarantees the claim holds strings.
      return payload.permissions as string[];
    }
    return [];
  } catch {
    // Catches malformed Base64, JSON parse errors, and any other unexpected failure.
    return [];
  }
}
