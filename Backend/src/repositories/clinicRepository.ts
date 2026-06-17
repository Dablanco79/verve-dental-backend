import { randomUUID } from "node:crypto";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "./userRepository.js";
import type {
  Clinic,
  CreateClinicInput,
  UpdateClinicInput,
} from "../types/clinic.js";

// ─── Re-export seed constants so callers can import from one place ───────────
export { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID };

// ─── Interface ───────────────────────────────────────────────────────────────

export interface ClinicRepository {
  /**
   * Returns a single clinic by its UUID, or null when not found.
   * Returns inactive clinics — callers that need active-only must check
   * `clinic.isActive` themselves.
   */
  findById(id: string): Promise<Clinic | null>;

  /**
   * Returns all active clinics ordered by name ascending.
   * Used by the owner_admin "list all clinics" endpoint.
   */
  findAll(): Promise<Clinic[]>;

  /** Persists a new clinic record and returns the hydrated entity. */
  create(input: CreateClinicInput): Promise<Clinic>;

  /**
   * Applies a partial update to an existing clinic.
   * Only keys present in `input` are written; absent keys are left unchanged.
   * Returns the updated entity, or null when the clinic ID does not exist.
   */
  update(id: string, input: UpdateClinicInput): Promise<Clinic | null>;
}

// ─── In-Memory implementation (used in tests + DATABASE_URL-less dev) ────────

/**
 * Pre-seeded with the canonical Clinic A and Clinic B UUIDs so all
 * integration tests run against a predictable baseline without a database.
 */
export function createInMemoryClinicRepository(): ClinicRepository {
  const SEED_CREATED_AT = new Date("2024-01-01T00:00:00.000Z");

  const clinics: Clinic[] = [
    {
      id: SEED_CLINIC_A_ID,
      name: "Verve Dental Clinic A",
      abn: null,
      addressLine1: null,
      suburb: null,
      state: null,
      postcode: null,
      timezone: "Australia/Sydney",
      subscriptionTier: "standard",
      isActive: true,
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
    {
      id: SEED_CLINIC_B_ID,
      name: "Verve Dental Clinic B",
      abn: null,
      addressLine1: null,
      suburb: null,
      state: null,
      postcode: null,
      timezone: "Australia/Sydney",
      subscriptionTier: "standard",
      isActive: true,
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
  ];

  return {
    findById(id: string): Promise<Clinic | null> {
      const found = clinics.find((c) => c.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    findAll(): Promise<Clinic[]> {
      return Promise.resolve(
        clinics
          .filter((c) => c.isActive)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ ...c })),
      );
    },

    create(input: CreateClinicInput): Promise<Clinic> {
      const now = new Date();
      const clinic: Clinic = {
        id: input.id ?? randomUUID(),
        name: input.name,
        abn: input.abn ?? null,
        addressLine1: input.addressLine1 ?? null,
        suburb: input.suburb ?? null,
        state: input.state ?? null,
        postcode: input.postcode ?? null,
        timezone: input.timezone ?? "Australia/Sydney",
        subscriptionTier: input.subscriptionTier ?? "standard",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      clinics.push(clinic);
      return Promise.resolve({ ...clinic });
    },

    update(id: string, input: UpdateClinicInput): Promise<Clinic | null> {
      const index = clinics.findIndex((c) => c.id === id);
      const existing = clinics[index];
      if (index === -1 || !existing) return Promise.resolve(null);
      const updated: Clinic = {
        ...existing,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.abn !== undefined && { abn: input.abn }),
        ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
        ...(input.suburb !== undefined && { suburb: input.suburb }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.postcode !== undefined && { postcode: input.postcode }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: new Date(),
      };
      clinics[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
