import { randomUUID } from "node:crypto";

import type {
  CreateLegalEntityInput,
  LegalEntity,
  UpdateLegalEntityInput,
} from "../types/legalEntity.js";

// ─── Seed constant ────────────────────────────────────────────────────────────

/**
 * Fixed UUID for the default demo legal entity used in development/test seeds.
 * Must be stable across restarts so that clinic backfills are idempotent.
 */
export const SEED_LEGAL_ENTITY_ID = "bbbbbbbb-0000-4000-8000-000000000001";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface LegalEntityRepository {
  /**
   * Returns all legal entities belonging to a given organisation,
   * ordered by legal_name ascending.
   */
  listByOrganisation(organisationId: string): Promise<LegalEntity[]>;

  /** Returns a single legal entity by its UUID, or null when not found. */
  getById(id: string): Promise<LegalEntity | null>;

  /** Persists a new legal entity under the given organisation and returns it. */
  create(
    organisationId: string,
    input: CreateLegalEntityInput,
  ): Promise<LegalEntity>;

  /**
   * Applies a partial update to an existing legal entity.
   * Only keys present in `input` are written; absent keys are unchanged.
   * Returns the updated entity, or null when the ID does not exist.
   */
  update(id: string, input: UpdateLegalEntityInput): Promise<LegalEntity | null>;
}

// ─── In-Memory implementation (used in tests + DATABASE_URL-less dev) ─────────

export function createInMemoryLegalEntityRepository(): LegalEntityRepository {
  const SEED_CREATED_AT = new Date("2024-01-01T00:00:00.000Z");

  // Import SEED_ORGANISATION_ID lazily to avoid circular deps; use the known value.
  const SEED_ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

  const entities: LegalEntity[] = [
    {
      id: SEED_LEGAL_ENTITY_ID,
      organisationId: SEED_ORG_ID,
      legalName: "Verve Demo Holdings Pty Ltd",
      tradingName: "Verve Dental",
      abn: null,
      taxId: null,
      countryCode: "AU",
      currencyCode: "AUD",
      registeredAddress: null,
      status: "active",
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
  ];

  return {
    listByOrganisation(organisationId: string): Promise<LegalEntity[]> {
      return Promise.resolve(
        entities
          .filter((e) => e.organisationId === organisationId)
          .sort((a, b) => a.legalName.localeCompare(b.legalName))
          .map((e) => ({ ...e })),
      );
    },

    getById(id: string): Promise<LegalEntity | null> {
      const found = entities.find((e) => e.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    create(
      organisationId: string,
      input: CreateLegalEntityInput,
    ): Promise<LegalEntity> {
      const now = new Date();
      const entity: LegalEntity = {
        id: input.id ?? randomUUID(),
        organisationId,
        legalName: input.legalName,
        tradingName: input.tradingName ?? null,
        abn: input.abn ?? null,
        taxId: input.taxId ?? null,
        countryCode: input.countryCode ?? "AU",
        currencyCode: input.currencyCode ?? "AUD",
        registeredAddress: input.registeredAddress ?? null,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      };
      entities.push(entity);
      return Promise.resolve({ ...entity });
    },

    update(
      id: string,
      input: UpdateLegalEntityInput,
    ): Promise<LegalEntity | null> {
      const index = entities.findIndex((e) => e.id === id);
      const existing = entities[index];
      if (index === -1 || !existing) return Promise.resolve(null);

      const updated: LegalEntity = {
        ...existing,
        ...(input.legalName !== undefined && { legalName: input.legalName }),
        ...(input.tradingName !== undefined && { tradingName: input.tradingName }),
        ...(input.abn !== undefined && { abn: input.abn }),
        ...(input.taxId !== undefined && { taxId: input.taxId }),
        ...(input.countryCode !== undefined && { countryCode: input.countryCode }),
        ...(input.currencyCode !== undefined && { currencyCode: input.currencyCode }),
        ...(input.registeredAddress !== undefined && {
          registeredAddress: input.registeredAddress,
        }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      };
      entities[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
