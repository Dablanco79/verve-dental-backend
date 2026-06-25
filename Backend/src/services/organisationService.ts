import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateOrganisationInput,
  Organisation,
  UpdateOrganisationInput,
} from "../types/organisation.js";
import { AppError } from "../types/errors.js";
import type { OrganisationRepository } from "../repositories/organisationRepository.js";

export type OrganisationService = ReturnType<typeof createOrganisationService>;

/**
 * Service for Organisation CRUD operations.
 *
 * Access policy (Sprint 4A):
 *   All reads and writes are restricted to `owner_admin`.
 *   Organisations are invisible to non-admin roles in this sprint —
 *   they are metadata infrastructure only, with no visible UI.
 *
 * No delete operation — organisations are deactivated via status update,
 * never removed.  This preserves referential integrity with clinics.
 */
export function createOrganisationService(
  organisationRepository: OrganisationRepository,
) {
  function assertOwnerAdmin(caller: AuthenticatedUser): void {
    if (caller.role !== "owner_admin") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only owner_admin may manage organisations",
      );
    }
  }

  return {
    /**
     * Returns all organisations ordered by name.
     * Restricted to owner_admin.
     */
    async listOrganisations(
      caller: AuthenticatedUser,
    ): Promise<Organisation[]> {
      assertOwnerAdmin(caller);
      return organisationRepository.findAll();
    },

    /**
     * Returns a single organisation by ID.
     * Throws 404 when the organisation does not exist.
     * Restricted to owner_admin.
     */
    async getOrganisation(
      caller: AuthenticatedUser,
      organisationId: string,
    ): Promise<Organisation> {
      assertOwnerAdmin(caller);

      const org = await organisationRepository.findById(organisationId);
      if (!org) {
        throw new AppError(
          404,
          "ORGANISATION_NOT_FOUND",
          "Organisation not found",
        );
      }
      return org;
    },

    /**
     * Creates a new organisation.
     * Restricted to owner_admin.
     */
    async createOrganisation(
      caller: AuthenticatedUser,
      input: CreateOrganisationInput,
    ): Promise<Organisation> {
      assertOwnerAdmin(caller);
      return organisationRepository.create(input);
    },

    /**
     * Applies a partial update to an existing organisation.
     * Throws 404 when the organisation does not exist.
     * Restricted to owner_admin.
     *
     * Note: status can be set to 'inactive' to deactivate an organisation.
     * There is no hard-delete path.
     */
    async updateOrganisation(
      caller: AuthenticatedUser,
      organisationId: string,
      input: UpdateOrganisationInput,
    ): Promise<Organisation> {
      assertOwnerAdmin(caller);

      const existing = await organisationRepository.findById(organisationId);
      if (!existing) {
        throw new AppError(
          404,
          "ORGANISATION_NOT_FOUND",
          "Organisation not found",
        );
      }

      const updated = await organisationRepository.update(
        organisationId,
        input,
      );

      if (!updated) {
        throw new AppError(
          500,
          "UPDATE_FAILED",
          "Organisation update failed unexpectedly",
        );
      }

      return updated;
    },
  };
}
