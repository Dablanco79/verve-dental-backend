/**
 * resolveDisplayName.test.ts
 *
 * Unit tests for the safe canonical display-name helper.
 *
 * Key invariant: the returned string must NEVER contain the literal text
 * "null" or "undefined", and must never be produced from a half-null
 * concatenation like "Daniel null" or "null Smith".
 */

import { resolveDisplayName } from "../src/utils/resolveDisplayName.js";

describe("resolveDisplayName", () => {
  // ── displayName present ────────────────────────────────────────────────────

  it("returns displayName when all three fields are populated", () => {
    expect(resolveDisplayName("Jane Smith", "Jane", "Smith")).toBe("Jane Smith");
  });

  it("returns displayName even when it differs from firstName + lastName", () => {
    expect(resolveDisplayName("Dr Jane", "Jane", "Smith")).toBe("Dr Jane");
  });

  it("returns displayName when firstName and lastName are null", () => {
    expect(resolveDisplayName("Jane Smith", null, null)).toBe("Jane Smith");
  });

  // ── displayName absent or blank — fall back to first + last ───────────────

  it("returns 'First Last' when displayName is null", () => {
    expect(resolveDisplayName(null, "Jane", "Smith")).toBe("Jane Smith");
  });

  it("returns 'First Last' when displayName is empty string", () => {
    expect(resolveDisplayName("", "Jane", "Smith")).toBe("Jane Smith");
  });

  it("falls back to firstName + lastName when displayName is whitespace-only", () => {
    expect(resolveDisplayName("   ", "Jane", "Smith")).toBe("Jane Smith");
  });

  // ── Partial name fields ────────────────────────────────────────────────────

  it("returns first name only when lastName is null", () => {
    expect(resolveDisplayName(null, "Jane", null)).toBe("Jane");
  });

  it("returns last name only when firstName is null", () => {
    expect(resolveDisplayName(null, null, "Smith")).toBe("Smith");
  });

  it("returns first name only when lastName is empty string", () => {
    expect(resolveDisplayName(null, "Jane", "")).toBe("Jane");
  });

  it("returns last name only when firstName is whitespace", () => {
    expect(resolveDisplayName(null, "  ", "Smith")).toBe("Smith");
  });

  // ── All names absent ───────────────────────────────────────────────────────

  it("returns empty string when all three fields are null", () => {
    expect(resolveDisplayName(null, null, null)).toBe("");
  });

  it("returns empty string when all three fields are undefined", () => {
    expect(resolveDisplayName(undefined, undefined, undefined)).toBe("");
  });

  it("returns empty string when all three fields are empty strings", () => {
    expect(resolveDisplayName("", "", "")).toBe("");
  });

  it("returns empty string when all three fields are whitespace", () => {
    expect(resolveDisplayName("   ", "  ", "\t")).toBe("");
  });

  // ── Null-safety invariant ──────────────────────────────────────────────────
  // The returned value must never contain the literal text "null" or "undefined".

  it("never returns the literal string 'null'", () => {
    const result = resolveDisplayName(null, null, null);
    expect(result).not.toContain("null");
  });

  it("never returns a string containing 'null' from partial fields", () => {
    // This would happen with naive `${firstName} ${lastName}` concatenation.
    expect(resolveDisplayName(null, "Daniel", null)).toBe("Daniel");
    expect(resolveDisplayName(null, null, "Smith")).toBe("Smith");
    expect(resolveDisplayName(null, "Daniel", null)).not.toContain("null");
  });

  it("never returns the literal string 'undefined'", () => {
    expect(resolveDisplayName(undefined, undefined, undefined)).not.toContain("undefined");
    expect(resolveDisplayName(undefined, "Jane", undefined)).not.toContain("undefined");
  });
});
