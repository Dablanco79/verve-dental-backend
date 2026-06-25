import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateLegalEntityInput,
  LegalEntity,
  UpdateLegalEntityInput,
} from "../types/legalEntity.js";
import { AppError } from "../types/errors.js";
import type { LegalEntityRepository } from "../repositories/legalEntityRepository.js";

export type LegalEntityService = ReturnType<typeof createLegalEntityService>;

/**
 * Service for Legal Entity CRUD operations.
 *
 * Access policy (Sprint 4B):
 *   All reads and writes are restricted to `owner_admin`.
 *   Legal entities are metadata infrastructure only — no visible UI in this sprint.
 *
 * No delete operation — entities are deactivated via status update, never removed.
 * This preserves referential integrity with any future supplier contract assignments.
 *
 * Validation:
 *   • legal_name is required on create.
 *   • organisation_id is required on create (passed as a parameter, not in the body).
 *   • country_code must be exactly 2 characters when provided.
 *   • currency_code must be exactly 3 characters when provided.
 *   • abn is optional; no format validation in this sprint.
 */
export function createLegalEntityService(
  legalEntityRepository: LegalEntityRepository,
) {
  function assertOwnerAdmin(caller: AuthenticatedUser): void {
    if (caller.role !== "owner_admin") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only owner_admin may manage legal entities",
      );
    }
  }

  function validateCreate(input: CreateLegalEntityInput): void {
    if (!input.legalName || input.legalName.trim().length === 0) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "legal_name is required",
      );
    }
    if (
      input.countryCode !== undefined &&
      input.countryCode.trim().length !== 2
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "country_code must be exactly 2 characters",
      );
    }
    if (
      input.currencyCode !== undefined &&
      input.currencyCode.trim().length !== 3
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "currency_code must be exactly 3 characters",
      );
    }
  }

  function validateUpdate(input: UpdateLegalEntityInput): void {
    if (input.legalName !== undefined && input.legalName.trim().length === 0) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "legal_name cannot be empty",
      );
    }
    if (
      input.countryCode !== undefined &&
      input.countryCode.trim().length !== 2
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "country_code must be exactly 2 characters",
      );
    }
    if (
      input.currencyCode !== undefined &&
      input.currencyCode.trim().length !== 3
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "currency_code must be exactly 3 characters",
      );
    }
  }

  return {
    async listByOrganisation(
      caller: AuthenticatedUser,
      organisationId: string,
    ): Promise<LegalEntity[]> {
      assertOwnerAdmin(caller);
      return legalEntityRepository.listByOrganisation(organisationId);
    },

    async getLegalEntity(
      caller: AuthenticatedUser,
      id: string,
    ): Promise<LegalEntity> {
      assertOwnerAdmin(caller);

      const entity = await legalEntityRepository.getById(id);
      if (!entity) {
        throw new AppError(
          404,
          "LEGAL_ENTITY_NOT_FOUND",
          "Legal entity not found",
        );
      }
      return entity;
    },

    async createLegalEntity(
      caller: AuthenticatedUser,
      organisationId: string,
      input: CreateLegalEntityInput,
    ): Promise<LegalEntity> {
      assertOwnerAdmin(caller);
      validateCreate(input);
      return legalEntityRepository.create(organisationId, input);
    },

    async updateLegalEntity(
      caller: AuthenticatedUser,
      id: string,
      input: UpdateLegalEntityInput,
    ): Promise<LegalEntity> {
      assertOwnerAdmin(caller);
      validateUpdate(input);

      const existing = await legalEntityRepository.getById(id);
      if (!existing) {
        throw new AppError(
          404,
          "LEGAL_ENTITY_NOT_FOUND",
          "Legal entity not found",
        );
      }

      const updated = await legalEntityRepository.update(id, input);
      if (!updated) {
        throw new AppError(
          500,
          "UPDATE_FAILED",
          "Legal entity update failed unexpectedly",
        );
      }

      return updated;
    },
  };
}
