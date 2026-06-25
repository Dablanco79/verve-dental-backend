import { randomUUID } from "node:crypto";

import type {
  CreateOrganisationInput,
  Organisation,
  UpdateOrganisationInput,
} from "../types/organisation.js";

// ─── Seed constant ────────────────────────────────────────────────────────────

/**
 * Fixed UUID for the default demo organisation used in development/test seeds.
 * Must be stable across restarts so that clinic backfills are idempotent.
 */
export const SEED_ORGANISATION_ID =
  "aaaaaaaa-0000-4000-8000-000000000001";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface OrganisationRepository {
  /** Returns a single organisation by its UUID, or null when not found. */
  findById(id: string): Promise<Organisation | null>;

  /**
   * Returns all organisations ordered by name ascending.
   * Includes both active and inactive — callers that need active-only
   * must filter on `organisation.status`.
   */
  findAll(): Promise<Organisation[]>;

  /** Persists a new organisation and returns the hydrated entity. */
  create(input: CreateOrganisationInput): Promise<Organisation>;

  /**
   * Applies a partial update to an existing organisation.
   * Only keys present in `input` are written; absent keys are unchanged.
   * Returns the updated entity, or null when the ID does not exist.
   */
  update(id: string, input: UpdateOrganisationInput): Promise<Organisation | null>;
}

// ─── In-Memory implementation (used in tests + DATABASE_URL-less dev) ─────────

export function createInMemoryOrganisationRepository(): OrganisationRepository {
  const SEED_CREATED_AT = new Date("2024-01-01T00:00:00.000Z");

  const organisations: Organisation[] = [
    {
      id: SEED_ORGANISATION_ID,
      name: "Verve Demo Organisation",
      status: "active",
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
  ];

  return {
    findById(id: string): Promise<Organisation | null> {
      const found = organisations.find((o) => o.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    findAll(): Promise<Organisation[]> {
      return Promise.resolve(
        [...organisations].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },

    create(input: CreateOrganisationInput): Promise<Organisation> {
      const now = new Date();
      const org: Organisation = {
        id: input.id ?? randomUUID(),
        name: input.name,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      };
      organisations.push(org);
      return Promise.resolve({ ...org });
    },

    update(
      id: string,
      input: UpdateOrganisationInput,
    ): Promise<Organisation | null> {
      const index = organisations.findIndex((o) => o.id === id);
      const existing = organisations[index];
      if (index === -1 || !existing) return Promise.resolve(null);

      const updated: Organisation = {
        ...existing,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      };
      organisations[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
