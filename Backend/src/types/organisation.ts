/**
 * Sprint 4A — Organisation Foundation.
 *
 * An Organisation is the top-level business object in the enterprise hierarchy.
 * It wraps one or more Clinics without replacing them.
 *
 * Design constraints:
 *   • Minimal fields for this sprint — ABN/legal-entity columns belong to
 *     the Legal Entity layer introduced in a future sprint.
 *   • `status` mirrors the `is_active` boolean pattern used on other entities
 *     but uses a string enum so future states ('suspended', 'archived') can be
 *     added without a schema migration.
 *   • No delete operation — organisations are never removed, only deactivated.
 */

export type OrganisationStatus = "active" | "inactive";

/**
 * Full organisation entity as returned from the repository layer.
 * Timestamps are hydrated as `Date` objects — never raw strings.
 */
export type Organisation = {
  id: string;
  name: string;
  status: OrganisationStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Input for creating a new organisation.
 * `id` is optional — supply a fixed UUID when seeding predictable data,
 * omit it in production to let the database generate one.
 */
export type CreateOrganisationInput = {
  id?: string;
  name: string;
  status?: OrganisationStatus;
};

/**
 * Partial update applied by PATCH /organisations/:id.
 * Only fields present in the payload are written; absent fields are unchanged.
 */
export type UpdateOrganisationInput = {
  name?: string;
  status?: OrganisationStatus;
};
