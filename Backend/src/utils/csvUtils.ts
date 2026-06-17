/**
 * CSV serialisation utilities.
 *
 * sanitizeCsvValue — defence against spreadsheet formula injection (CSV injection).
 *   Any field value beginning with one of the formula-trigger characters
 *   (= + - @ TAB CR) is prefixed with a single-quote so that spreadsheet
 *   applications (Excel, LibreOffice Calc, Google Sheets) treat the cell as
 *   literal text rather than evaluating it as a formula.
 *   Apply BEFORE RFC 4180 escaping so the prefix quote is not re-escaped.
 *
 * escapeCsv — RFC 4180 compliant field serialisation.
 *   Fields containing commas, double-quotes, CR, or LF are wrapped in
 *   double-quotes; any embedded double-quotes are doubled ("").
 *
 * toCsvField — compose sanitize then escape (the standard export pipeline).
 */

const FORMULA_INJECTION_RE = /^[=+\-@\t\r\n]/;

/**
 * Protect against CSV formula injection by prefixing dangerous values with a
 * single-quote.  Apply this BEFORE RFC4180 escaping.
 */
export function sanitizeCsvValue(raw: string | number): string {
  const str = String(raw);
  return FORMULA_INJECTION_RE.test(str) ? `'${str}` : str;
}

/** RFC4180 compliant field escaping. */
export function escapeCsv(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Sanitize then escape a CSV field value (the normal export pipeline). */
export function toCsvField(value: string | number): string {
  return escapeCsv(sanitizeCsvValue(value));
}
