/**
 * Module 06 — Clinic entity types.
 *
 * A `Clinic` is the first-class tenant entity in the platform.  Every
 * tenant-scoped resource (inventory, roster, timesheets, leave) carries a
 * `clinic_id` UUID that references this table.
 *
 * Prior to Module 06, clinic names were derived from `users.home_clinic_name`
 * as a deterministic workaround.  This module introduces the canonical source
 * of truth so all downstream consumers resolve clinic metadata from one place.
 */

export type ClinicSubscriptionTier = "standard" | "premium" | "enterprise";

/**
 * Full clinic entity as returned from the repository layer.
 * Timestamps are hydrated as `Date` objects — never raw strings.
 */
export type Clinic = {
  id: string;
  name: string;
  /** Australian Business Number — 9-digit string without spaces. Nullable until set by admin. */
  abn: string | null;
  addressLine1: string | null;
  suburb: string | null;
  /** Two or three-letter state code: NSW, VIC, QLD, SA, WA, TAS, ACT, NT. */
  state: string | null;
  /** Four-digit Australian postcode. */
  postcode: string | null;
  /** IANA timezone string, e.g. "Australia/Sydney". Defaults to "Australia/Sydney". */
  timezone: string;
  subscriptionTier: ClinicSubscriptionTier;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Input for creating a new clinic.
 *
 * `id` is optional — supply a fixed UUID when seeding predictable test data,
 * omit it in production to let the database generate one via gen_random_uuid().
 */
export type CreateClinicInput = {
  /** Fixed UUID for deterministic seed data.  Omit to auto-generate. */
  id?: string;
  name: string;
  abn?: string | null;
  addressLine1?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  timezone?: string;
  subscriptionTier?: ClinicSubscriptionTier;
};

/**
 * Partial update applied by PATCH /clinics/:clinicId.
 * Only fields present in the payload are written; absent fields are unchanged.
 *
 * BILLING SAFETY: `subscriptionTier` is intentionally absent from this type.
 * Tier changes carry billing and entitlement consequences that must be gated
 * behind a dedicated administrative workflow.  Including the field here would
 * expose a client-side escalation vector — any PATCH body could silently
 * upgrade a clinic's tier.  Use `ClinicTierMigrationPayload` instead and route
 * it exclusively through the tier-migration administrative routine.
 */
export type UpdateClinicInput = {
  name?: string;
  abn?: string | null;
  addressLine1?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  timezone?: string;
  isActive?: boolean;
};

/**
 * Dedicated payload for migrating a clinic's subscription tier.
 *
 * This type is intentionally separated from `UpdateClinicInput` so that tier
 * changes can only be executed through a purpose-built administrative routine
 * (e.g. a billing-module service method or an internal back-office endpoint)
 * and never through the standard self-serve PATCH /clinics/:clinicId workflow.
 *
 * The containing service/repository method should require elevated
 * authorisation (owner_admin + explicit billing scope) and emit a dedicated
 * audit event distinct from a normal clinic update.
 */
export type ClinicTierMigrationPayload = {
  subscriptionTier: ClinicSubscriptionTier;
};
