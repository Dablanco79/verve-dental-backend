/**
 * Returns the display name for a clinic in compact operational UI.
 *
 * Uses the stored `preferredName` when available (owner_admin-configured short label).
 * Falls back to the official `name` when not set.
 *
 * Do NOT use custom truncation logic — prefix truncation causes different
 * clinics sharing a common prefix (e.g. "Verve Dental - Bentleigh East" and
 * "Verve Dental - Heathmont") to collapse to the same visible label.
 *
 * @param name          The canonical clinic name (always present).
 * @param preferredName Optional short display name configured by the owner_admin.
 * @returns             Short label for compact calendar cells and shift cards.
 */
export function displayClinicName(
  name: string,
  preferredName?: string | null,
): string {
  return preferredName?.trim() || name;
}
