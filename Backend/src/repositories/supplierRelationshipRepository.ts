import { randomUUID } from "node:crypto";

import type {
  CreateSupplierRelationshipInput,
  SupplierRelationship,
  SupplierRelationshipStatus,
  UpdateSupplierRelationshipInput,
} from "../types/supplierRelationship.js";
import { AppError } from "../types/errors.js";

// ─── Seed constants ───────────────────────────────────────────────────────────

/**
 * Fixed UUIDs for demo supplier records seeded in development / test.
 * Must be stable across restarts for idempotent seeding.
 */
export const SEED_SUPPLIER_A_ID = "cccccccc-0000-4000-8000-000000000001";
export const SEED_SUPPLIER_B_ID = "cccccccc-0000-4000-8000-000000000002";

/**
 * Fixed UUIDs for demo supplier relationship records.
 * Format: SEED_REL_{SUPPLIER}_{CLINIC}
 */
export const SEED_RELATIONSHIP_A1_ID = "dddddddd-0000-4000-8000-000000000001"; // A + Clinic A
export const SEED_RELATIONSHIP_B1_ID = "dddddddd-0000-4000-8000-000000000002"; // B + Clinic A
export const SEED_RELATIONSHIP_A2_ID = "dddddddd-0000-4000-8000-000000000003"; // A + Clinic B

// ─── Repository interface ─────────────────────────────────────────────────────

export interface SupplierRelationshipRepository {
  /** All active + inactive relationships for a given clinic. */
  listByClinic(
    clinicId: string,
    options?: { status?: SupplierRelationshipStatus },
  ): Promise<SupplierRelationship[]>;

  /** All relationships across all clinics for a given supplier. */
  listBySupplier(supplierId: string): Promise<SupplierRelationship[]>;

  /** Fetch a single relationship by its UUID, or null when not found. */
  getById(relationshipId: string): Promise<SupplierRelationship | null>;

  /**
   * Fetch by the composite (supplierId, clinicId) pair.
   * Returns null when no relationship exists.
   */
  findByClinicAndSupplier(
    clinicId: string,
    supplierId: string,
  ): Promise<SupplierRelationship | null>;

  /**
   * Create a new clinic-supplier relationship.
   * Throws DUPLICATE_SUPPLIER_RELATIONSHIP when the (supplierId, clinicId)
   * pair already exists regardless of status.
   */
  create(
    clinicId: string,
    input: CreateSupplierRelationshipInput,
  ): Promise<SupplierRelationship>;

  /**
   * Partial update — only keys present in `input` are written.
   * Returns null when the relationshipId does not exist.
   */
  update(
    relationshipId: string,
    input: UpdateSupplierRelationshipInput,
  ): Promise<SupplierRelationship | null>;

  /**
   * Soft-deactivate: sets relationship_status to 'inactive'.
   * No hard delete is ever performed.
   * Returns null when the relationshipId does not exist.
   */
  deactivate(relationshipId: string): Promise<SupplierRelationship | null>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemorySupplierRelationshipRepository(): SupplierRelationshipRepository {
  const store: SupplierRelationship[] = [];

  return {
    listByClinic(
      clinicId: string,
      options: { status?: SupplierRelationshipStatus } = {},
    ): Promise<SupplierRelationship[]> {
      let result = store
        .filter((r) => r.clinicId === clinicId)
        .map((r) => ({ ...r }));
      if (options.status !== undefined) {
        result = result.filter((r) => r.relationshipStatus === options.status);
      }
      result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve(result);
    },

    listBySupplier(supplierId: string): Promise<SupplierRelationship[]> {
      return Promise.resolve(
        store
          .filter((r) => r.supplierId === supplierId)
          .map((r) => ({ ...r }))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      );
    },

    getById(relationshipId: string): Promise<SupplierRelationship | null> {
      const found = store.find((r) => r.id === relationshipId);
      return Promise.resolve(found ? { ...found } : null);
    },

    findByClinicAndSupplier(
      clinicId: string,
      supplierId: string,
    ): Promise<SupplierRelationship | null> {
      const found = store.find(
        (r) => r.clinicId === clinicId && r.supplierId === supplierId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    async create(
      clinicId: string,
      input: CreateSupplierRelationshipInput,
    ): Promise<SupplierRelationship> {
      const existing = store.find(
        (r) => r.clinicId === clinicId && r.supplierId === input.supplierId,
      );
      if (existing) {
        throw new AppError(
          409,
          "DUPLICATE_SUPPLIER_RELATIONSHIP",
          "A relationship between this supplier and clinic already exists",
        );
      }
      const now = new Date();
      const record: SupplierRelationship = {
        id: randomUUID(),
        supplierId: input.supplierId,
        clinicId,
        relationshipStatus: input.relationshipStatus ?? "active",
        preferredSupplier: input.preferredSupplier ?? false,
        accountNumber: input.accountNumber ?? null,
        customerNumber: input.customerNumber ?? null,
        creditTerms: input.creditTerms ?? null,
        creditLimitCents: input.creditLimitCents ?? null,
        orderingEmail: input.orderingEmail ?? null,
        deliveryAddress: input.deliveryAddress ?? null,
        invoiceAddress: input.invoiceAddress ?? null,
        representativeName: input.representativeName ?? null,
        representativeEmail: input.representativeEmail ?? null,
        representativePhone: input.representativePhone ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.push(record);
      return Promise.resolve({ ...record });
    },

    update(
      relationshipId: string,
      input: UpdateSupplierRelationshipInput,
    ): Promise<SupplierRelationship | null> {
      const idx = store.findIndex((r) => r.id === relationshipId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierRelationship = {
        ...existing,
        ...(input.relationshipStatus !== undefined && {
          relationshipStatus: input.relationshipStatus,
        }),
        ...(input.preferredSupplier !== undefined && {
          preferredSupplier: input.preferredSupplier,
        }),
        ...(input.accountNumber !== undefined && { accountNumber: input.accountNumber }),
        ...(input.customerNumber !== undefined && { customerNumber: input.customerNumber }),
        ...(input.creditTerms !== undefined && { creditTerms: input.creditTerms }),
        ...(input.creditLimitCents !== undefined && { creditLimitCents: input.creditLimitCents }),
        ...(input.orderingEmail !== undefined && { orderingEmail: input.orderingEmail }),
        ...(input.deliveryAddress !== undefined && { deliveryAddress: input.deliveryAddress }),
        ...(input.invoiceAddress !== undefined && { invoiceAddress: input.invoiceAddress }),
        ...(input.representativeName !== undefined && { representativeName: input.representativeName }),
        ...(input.representativeEmail !== undefined && { representativeEmail: input.representativeEmail }),
        ...(input.representativePhone !== undefined && { representativePhone: input.representativePhone }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    deactivate(
      relationshipId: string,
    ): Promise<SupplierRelationship | null> {
      const idx = store.findIndex((r) => r.id === relationshipId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierRelationship = {
        ...existing,
        relationshipStatus: "inactive",
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
