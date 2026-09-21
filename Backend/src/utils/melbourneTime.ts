/**
 * melbourneTime.ts — Operational-timezone formatting for payroll exports.
 *
 * All payroll-facing timestamps (Clock In, Clock Out, Approved At) must be
 * presented in Australia/Melbourne local time, not UTC.  DST transitions are:
 *   AEST  UTC+10  last Sun in April → first Sun in October  (winter)
 *   AEDT  UTC+11  first Sun in October → last Sun in April  (summer)
 *
 * Node.js's Intl API (V8 ICU data) resolves the transition automatically —
 * callers do not need to compute offsets manually.
 */

/**
 * IANA timezone string for the operational timezone used in all exports.
 * Exposed as a named constant so column headers and tests can reference
 * the same string without repeating the literal.
 */
export const OPERATIONAL_TZ = "Australia/Melbourne";

/**
 * Formats a UTC Date value as a Melbourne-local datetime string.
 *
 * Output format: "DD/MM/YYYY HH:MM"  (24-hour, space-separated).
 * The timezone is communicated via the column header in the export workbook,
 * e.g. "Clock In (Australia/Melbourne)".
 *
 * DST is handled dynamically:
 *   formatMelbourneDateTime(new Date("2026-07-15T08:00:00Z"))  → "15/07/2026 18:00"  (AEST, UTC+10)
 *   formatMelbourneDateTime(new Date("2026-01-15T08:00:00Z"))  → "15/01/2026 19:00"  (AEDT, UTC+11)
 *
 * @param date  Any Date object (UTC internally, as all JS Date values are).
 */
export function formatMelbourneDateTime(date: Date): string {
  // formatToParts gives us named tokens so we can reconstruct the string
  // in exactly the format we want without relying on locale-dependent separators.
  // hourCycle: "h23" guarantees midnight = "00", not "24" (which h24 would give).
  // This is more explicit than hour12: false, which leaves the cycle to the locale.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: OPERATIONAL_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/**
 * Returns the Melbourne-local calendar date for a UTC Date value as a
 * YYYY-MM-DD string.  Used to derive shiftDate server-side so callers never
 * need to compute or send the date separately.
 *
 * Examples (Melbourne local date may differ from the UTC date near midnight):
 *   formatMelbourneDate(new Date("2026-09-21T14:00:00Z"))  → "2026-09-22"  (AEST UTC+10)
 *   formatMelbourneDate(new Date("2026-01-15T08:00:00Z"))  → "2026-01-15"  (AEDT UTC+11)
 *
 * @param date  Any Date object (UTC internally, as all JS Date values are).
 */
export function formatMelbourneDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  // formatToParts returns day/month in DD and MM (zero-padded) so we can
  // assemble an unambiguous ISO date string directly.
  return `${get("year")}-${get("month")}-${get("day")}`;
}
