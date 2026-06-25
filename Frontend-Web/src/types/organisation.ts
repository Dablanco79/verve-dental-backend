/**
 * Sprint 4A — Organisation Foundation.
 *
 * Frontend types mirror the Backend Organisation entity.
 * Timestamps are ISO date strings (JSON serialisation converts Date → string
 * over the wire), matching the pattern used in clinic.ts.
 *
 * No UI for this sprint — types are provided so the API client is fully typed
 * and future UI sprints can import from here without modification.
 */

export type OrganisationStatus = "active" | "inactive";

/** Full organisation record as returned from GET /organisations/:id. */
export type OrganisationData = {
  id: string;
  name: string;
  status: OrganisationStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * Payload for POST /organisations.
 * name is required; status defaults to 'active' on the server.
 */
export type CreateOrganisationData = {
  name: string;
  status?: OrganisationStatus;
};

/**
 * Partial update payload for PATCH /organisations/:id.
 * Only fields present in the object are written; absent fields are unchanged.
 */
export type UpdateOrganisationData = {
  name?: string;
  status?: OrganisationStatus;
};
