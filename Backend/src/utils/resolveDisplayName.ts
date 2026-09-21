/**
 * resolveDisplayName.ts — Safe canonical display-name helper.
 *
 * Used by payroll exports to produce a human-readable "Staff Name" without
 * ever emitting literal "null", "undefined", or partial-null strings like
 * "Daniel null" when only one name field is populated.
 *
 * Resolution order:
 *   1. displayName (trimmed) if non-empty
 *   2. firstName and lastName joined with a single space, skipping null/blank parts
 *   3. "" when all inputs are null, undefined, or whitespace-only
 *
 * This helper never alters stored user data — it only interprets what is
 * already in the DB.
 */

/**
 * Derives a canonical display name from the three nullable user name columns.
 *
 * @param displayName  users.display_name — preferred label set at registration.
 * @param firstName    users.first_name   — legal given name.
 * @param lastName     users.last_name    — legal family name.
 * @returns  Non-null, non-"null" string; empty string when all inputs are absent.
 *
 * @example
 *   resolveDisplayName("Jane Smith", "Jane", "Smith")  → "Jane Smith"
 *   resolveDisplayName(null, "Jane", "Smith")           → "Jane Smith"
 *   resolveDisplayName("  ", "Jane", "Smith")           → "Jane Smith"  (whitespace falls back)
 *   resolveDisplayName(null, "Jane", null)              → "Jane"
 *   resolveDisplayName(null, null, "Smith")             → "Smith"
 *   resolveDisplayName(null, null, null)                → ""
 */
export function resolveDisplayName(
  displayName: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  // 1. Use displayName if it is non-empty after trimming.
  const trimmedDisplay = displayName?.trim();
  if (trimmedDisplay) return trimmedDisplay;

  // 2. Collect only the non-null, non-blank name parts and join them.
  //    This prevents "null null", "Jane null", etc.
  const parts = [firstName?.trim(), lastName?.trim()].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.join(" ");
}
