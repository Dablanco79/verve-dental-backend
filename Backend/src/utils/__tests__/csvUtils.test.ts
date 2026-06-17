/**
 * csvUtils.test.ts
 *
 * Unit tests for the CSV serialisation utilities that protect the purchase
 * order CSV export against formula injection and RFC 4180 escaping issues.
 */

import { sanitizeCsvValue, escapeCsv, toCsvField } from "../csvUtils.js";

// ─── sanitizeCsvValue — formula injection protection ─────────────────────────

describe("sanitizeCsvValue — formula injection protection", () => {
  it.each([
    ["=SUM(A1+A2)",           "'=SUM(A1+A2)"],
    ["=HYPERLINK(\"http://x\")", "'=HYPERLINK(\"http://x\")"],
    ["+cmd|' /C calc'!A0",    "'+cmd|' /C calc'!A0"],
    ["-2+3",                  "'-2+3"],
    ["@SUM(1+1)",              "'@SUM(1+1)"],
    ["\tinjected",             "'\tinjected"],
    ["\rinjected",             "'\rinjected"],
    ["\ninjected",             "'\ninjected"],
  ])(
    "prefixes formula trigger character in %p",
    (input: string, expected: string) => {
      expect(sanitizeCsvValue(input)).toBe(expected);
    },
  );

  it.each([
    ["Diamond Burs",           "Diamond Burs"],
    ["VRV-BUR-001",            "VRV-BUR-001"],
    ["below_reorder_point",    "below_reorder_point"],
    ["draft",                  "draft"],
    ["submitted",              "submitted"],
    ["2026-06-16T07:00:00Z",   "2026-06-16T07:00:00Z"],
    [42,                       "42"],
    [0,                        "0"],
    ["",                       ""],
    [" leading space",         " leading space"],
  ])(
    "leaves safe value %p unchanged",
    (input: string | number, expected: string) => {
      expect(sanitizeCsvValue(input)).toBe(expected);
    },
  );

  it("prefixes when value is a single = character", () => {
    expect(sanitizeCsvValue("=")).toBe("'=");
  });

  it("does not prefix when value starts with a digit", () => {
    expect(sanitizeCsvValue("123")).toBe("123");
  });
});

// ─── escapeCsv — RFC 4180 escaping ───────────────────────────────────────────

describe("escapeCsv — RFC 4180 escaping", () => {
  it("wraps fields containing a comma in double-quotes", () => {
    expect(escapeCsv("hello, world")).toBe('"hello, world"');
  });

  it("doubles embedded double-quotes and wraps in double-quotes", () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps fields containing a newline (LF) in double-quotes", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps fields containing a carriage-return in double-quotes", () => {
    expect(escapeCsv("line1\rline2")).toBe('"line1\rline2"');
  });

  it("leaves plain text without special chars unchanged", () => {
    expect(escapeCsv("plaintext")).toBe("plaintext");
  });

  it("converts numeric values to string without quoting", () => {
    expect(escapeCsv(42)).toBe("42");
    expect(escapeCsv(0)).toBe("0");
  });

  it("wraps the empty string unchanged (no quotes needed)", () => {
    expect(escapeCsv("")).toBe("");
  });
});

// ─── toCsvField — sanitize then escape (full pipeline) ───────────────────────

describe("toCsvField — full pipeline", () => {
  it("prefixes a formula and then wraps if it also contains a comma", () => {
    // '=A1,B1 → the single-quote makes the field start with "'", which
    // itself does not trigger quoting, but the comma does.
    expect(toCsvField("=A1,B1")).toBe("\"'=A1,B1\"");
  });

  it("prefixes a plain formula with no special chars (no wrapping needed)", () => {
    expect(toCsvField("=A1")).toBe("'=A1");
  });

  it("handles a safe value with a comma (wrap only)", () => {
    expect(toCsvField("hello, world")).toBe('"hello, world"');
  });

  it("handles a safe plain value (no modification)", () => {
    expect(toCsvField("Diamond Burs")).toBe("Diamond Burs");
  });

  it("handles a numeric value (no modification)", () => {
    expect(toCsvField(7)).toBe("7");
  });

  it("prefixes + formula with embedded double-quote", () => {
    // sanitize → "'..." then escapeCsv wraps because of the quote char
    const input = '+say "hi"';
    const sanitized = `'${input}`;        // "'+say \"hi\""
    const expected = `"${sanitized.replace(/"/g, '""')}"`;
    expect(toCsvField(input)).toBe(expected);
  });
});
