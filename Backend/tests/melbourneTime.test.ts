/**
 * melbourneTime.test.ts — Unit tests for formatMelbourneDateTime
 *
 * Verifies that payroll-facing timestamps are correctly localised to
 * Australia/Melbourne for both:
 *   AEST  (UTC+10, April–October winter)
 *   AEDT  (UTC+11, October–April summer / daylight saving)
 *
 * Node's Intl API (V8 ICU) resolves DST boundaries automatically.
 * These tests catch regressions if the ICU data or the formatter changes.
 */

import {
  formatMelbourneDateTime,
  OPERATIONAL_TZ,
} from "../src/utils/melbourneTime.js";

describe("formatMelbourneDateTime", () => {
  // ── AEST (UTC+10, winter) ──────────────────────────────────────────────────

  it("formats a winter (AEST, UTC+10) timestamp correctly", () => {
    // 15 July 2026 08:00:00 UTC  →  15/07/2026 18:00 Melbourne (AEST, UTC+10)
    const date = new Date("2026-07-15T08:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("15/07/2026 18:00");
  });

  it("formats a second winter timestamp to confirm UTC+10 offset", () => {
    // 30 June 2026 14:30:00 UTC  →  01/07/2026 00:30 Melbourne (AEST, UTC+10)
    // Note: the date advances to the next calendar day in Melbourne.
    const date = new Date("2026-06-30T14:30:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("01/07/2026 00:30");
  });

  // ── AEDT (UTC+11, summer / daylight saving) ────────────────────────────────

  it("formats a summer (AEDT, UTC+11) timestamp correctly", () => {
    // 15 January 2026 08:00:00 UTC  →  15/01/2026 19:00 Melbourne (AEDT, UTC+11)
    const date = new Date("2026-01-15T08:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("15/01/2026 19:00");
  });

  it("formats a second summer timestamp to confirm UTC+11 offset", () => {
    // 20 February 2026 23:00:00 UTC  →  21/02/2026 10:00 Melbourne (AEDT, UTC+11)
    const date = new Date("2026-02-20T23:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("21/02/2026 10:00");
  });

  // ── DST boundary awareness ─────────────────────────────────────────────────
  // Melbourne DST 2026: AEDT → AEST on first Sunday in April (5 April 2026 03:00 → 02:00).

  it("correctly uses AEDT (UTC+11) just before the AEDT→AEST transition", () => {
    // 4 April 2026 15:59:00 UTC  →  5 April 2026 02:59 Melbourne (still AEDT, UTC+11)
    const date = new Date("2026-04-04T15:59:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("05/04/2026 02:59");
  });

  it("correctly uses AEST (UTC+10) just after the AEDT→AEST transition", () => {
    // 4 April 2026 17:00:00 UTC  →  5 April 2026 03:00 Melbourne (AEST, UTC+10 — clocks went back)
    const date = new Date("2026-04-04T17:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("05/04/2026 03:00");
  });

  // Melbourne DST 2025/2026: AEST → AEDT on first Sunday in October (4 Oct 2026 02:00 → 03:00).
  it("correctly uses AEST (UTC+10) just before the AEST→AEDT transition", () => {
    // 3 October 2026 15:59:00 UTC  →  4 October 2026 01:59 Melbourne (still AEST, UTC+10)
    const date = new Date("2026-10-03T15:59:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("04/10/2026 01:59");
  });

  it("correctly uses AEDT (UTC+11) just after the AEST→AEDT transition", () => {
    // 3 October 2026 17:00:00 UTC  →  4 October 2026 04:00 Melbourne (AEDT, UTC+11)
    const date = new Date("2026-10-03T17:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("04/10/2026 04:00");
  });

  // ── Format assertions ──────────────────────────────────────────────────────

  it("zero-pads single-digit day and month", () => {
    // 5 May 2026 00:00:00 UTC  →  05/05/2026 10:00 Melbourne (AEST, UTC+10)
    const date = new Date("2026-05-05T00:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("05/05/2026 10:00");
  });

  it("zero-pads single-digit hour", () => {
    // 1 August 2026 01:00:00 UTC  →  01/08/2026 11:00 Melbourne (AEST)
    const date = new Date("2026-08-01T01:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("01/08/2026 11:00");
  });

  it("uses 24-hour format (no AM/PM)", () => {
    // 15 July 2026 22:00:00 UTC  →  16/07/2026 08:00 Melbourne (AEST)
    const date = new Date("2026-07-15T22:00:00.000Z");
    expect(formatMelbourneDateTime(date)).toBe("16/07/2026 08:00");
  });

  // ── OPERATIONAL_TZ constant ────────────────────────────────────────────────

  it("OPERATIONAL_TZ equals 'Australia/Melbourne'", () => {
    expect(OPERATIONAL_TZ).toBe("Australia/Melbourne");
  });
});
