import type { StaffUser } from "../types/index.js";

/**
 * Derive a readable label from a StaffUser:
 *   "First Last" > displayName > email
 */
export function staffDisplayName(
  s: Pick<StaffUser, "firstName" | "lastName" | "displayName" | "email">,
): string {
  if (s.firstName && s.lastName) return `${s.firstName} ${s.lastName}`;
  if (s.displayName) return s.displayName;
  return s.email;
}

/**
 * Fallback: derive a pseudo-name from an email local part when no StaffUser
 * record is available (e.g. for read-only viewers who don't load the staff list).
 * "jane.smith@clinic.au" → "Jane Smith"
 */
export function staffLabelFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
