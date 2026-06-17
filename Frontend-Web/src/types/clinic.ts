/**
 * Frontend clinic types — mirrors the Backend Clinic entity from
 * src/types/clinic.ts (Module 06, Session 1).
 *
 * Note: timestamps are ISO date strings here (not Date objects) because JSON
 * serialization converts Date → string over the wire.
 */

export type ClinicSubscriptionTier = "standard" | "premium" | "enterprise";

/** Full clinic record as returned from GET /clinics/:clinicId. */
export type ClinicData = {
  id: string;
  name: string;
  /** Australian Business Number stored as digit-only string. Null until set. */
  abn: string | null;
  addressLine1: string | null;
  suburb: string | null;
  /** Two or three-letter state code: NSW, VIC, QLD, SA, WA, TAS, ACT, NT. */
  state: string | null;
  /** Four-digit Australian postcode. */
  postcode: string | null;
  /** IANA timezone string, e.g. "Australia/Sydney". */
  timezone: string;
  subscriptionTier: ClinicSubscriptionTier;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Partial update payload for PATCH /clinics/:clinicId.
 * Only fields present in the object are written; absent fields are unchanged.
 * subscriptionTier is intentionally omitted — it is read-only on this page to
 * prevent client-side tier escalation; tier changes require a billing workflow.
 */
export type UpdateClinicData = {
  name?: string;
  abn?: string | null;
  addressLine1?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  timezone?: string;
};
