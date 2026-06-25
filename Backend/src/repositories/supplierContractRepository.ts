import { randomUUID } from "node:crypto";

import type {
  CreateSupplierContractInput,
  SupplierContract,
  SupplierContractStatus,
  UpdateSupplierContractInput,
} from "../types/supplierContract.js";

// ─── Seed constants ───────────────────────────────────────────────────────────

/**
 * Fixed UUIDs for demo supplier contract records seeded in development / test.
 * Must be stable across restarts for idempotent seeding.
 */
export const SEED_CONTRACT_DENTAL_DEPOT_ID = "eeeeeeee-0000-4000-8000-000000000001";
export const SEED_CONTRACT_MEDIGATE_EXPIRED_ID = "eeeeeeee-0000-4000-8000-000000000002";

// ─── Repository interface ─────────────────────────────────────────────────────

export interface SupplierContractRepository {
  /** All contracts for a given supplier relationship. */
  listByRelationship(
    relationshipId: string,
    options?: { status?: SupplierContractStatus },
  ): Promise<SupplierContract[]>;

  /** Fetch a single contract by its UUID, or null when not found. */
  getById(contractId: string): Promise<SupplierContract | null>;

  /**
   * Create a new contract for a supplier relationship.
   * Throws DUPLICATE_ACTIVE_CONTRACT when an active contract already exists
   * for this relationship and the new contract status is 'active'.
   */
  create(
    relationshipId: string,
    input: CreateSupplierContractInput,
  ): Promise<SupplierContract>;

  /**
   * Partial update — only keys present in `input` are written.
   * Returns null when the contractId does not exist.
   */
  update(
    contractId: string,
    input: UpdateSupplierContractInput,
  ): Promise<SupplierContract | null>;

  /**
   * Soft-expire: sets status to 'expired'.
   * No hard delete is ever performed.
   * Returns null when the contractId does not exist.
   */
  expire(contractId: string): Promise<SupplierContract | null>;

  /**
   * Soft-terminate: sets status to 'terminated'.
   * No hard delete is ever performed.
   * Returns null when the contractId does not exist.
   */
  terminate(contractId: string): Promise<SupplierContract | null>;

  /**
   * Returns the single ACTIVE contract for a relationship, or null.
   * Optionally excludes a specific contract ID (used for update validation).
   */
  findActiveByRelationship(
    relationshipId: string,
    excludeContractId?: string,
  ): Promise<SupplierContract | null>;
}

// ─── In-memory seed data ──────────────────────────────────────────────────────

// Imported at runtime from supplierRelationshipRepository to avoid circular deps.
// Resolved via string literals that match the constants in that module.
const RELATIONSHIP_A1 = "dddddddd-0000-4000-8000-000000000001"; // Dental Depot Australia → Clinic A
const RELATIONSHIP_B1 = "dddddddd-0000-4000-8000-000000000002"; // Medigate Medical Supplies → Clinic A

const SEED_CONTRACTS: SupplierContract[] = [
  {
    id: SEED_CONTRACT_DENTAL_DEPOT_ID,
    supplierRelationshipId: RELATIONSHIP_A1,
    contractName: "2026 Supply Agreement",
    contractNumber: "DD-2026-CLA-001",
    status: "active",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    renewalNoticeDays: 90,
    paymentTerms: "30 days net",
    freightTerms: "Free over $500",
    minimumOrderValueCents: 25000,
    rebateDescription: null,
    estimatedAnnualCommitmentCents: 8000000,
    annualSpendTargetCents: 7500000,
    contractDocumentStorageKey: null,
    notes: "Primary dental supply agreement for Clinic A",
    createdAt: new Date("2025-12-15"),
    updatedAt: new Date("2025-12-15"),
  },
  {
    id: SEED_CONTRACT_MEDIGATE_EXPIRED_ID,
    supplierRelationshipId: RELATIONSHIP_B1,
    contractName: "2025 Supply Agreement",
    contractNumber: "MG-2025-CLA-001",
    status: "expired",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"),
    renewalNoticeDays: 60,
    paymentTerms: "COD",
    freightTerms: null,
    minimumOrderValueCents: null,
    rebateDescription: null,
    estimatedAnnualCommitmentCents: null,
    annualSpendTargetCents: null,
    contractDocumentStorageKey: null,
    notes: null,
    createdAt: new Date("2024-12-01"),
    updatedAt: new Date("2025-12-31"),
  },
];

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemorySupplierContractRepository(): SupplierContractRepository {
  const store: SupplierContract[] = SEED_CONTRACTS.map((c) => ({ ...c }));

  return {
    listByRelationship(
      relationshipId: string,
      options: { status?: SupplierContractStatus } = {},
    ): Promise<SupplierContract[]> {
      let result = store
        .filter((c) => c.supplierRelationshipId === relationshipId)
        .map((c) => ({ ...c }));
      if (options.status !== undefined) {
        result = result.filter((c) => c.status === options.status);
      }
      result.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
      return Promise.resolve(result);
    },

    getById(contractId: string): Promise<SupplierContract | null> {
      const found = store.find((c) => c.id === contractId);
      return Promise.resolve(found ? { ...found } : null);
    },

    async create(
      relationshipId: string,
      input: CreateSupplierContractInput,
    ): Promise<SupplierContract> {
      const now = new Date();
      const record: SupplierContract = {
        id: randomUUID(),
        supplierRelationshipId: relationshipId,
        contractName: input.contractName,
        contractNumber: input.contractNumber ?? null,
        status: input.status ?? "draft",
        startDate: input.startDate,
        endDate: input.endDate,
        renewalNoticeDays: input.renewalNoticeDays ?? 0,
        paymentTerms: input.paymentTerms,
        freightTerms: input.freightTerms ?? null,
        minimumOrderValueCents: input.minimumOrderValueCents ?? null,
        rebateDescription: input.rebateDescription ?? null,
        estimatedAnnualCommitmentCents:
          input.estimatedAnnualCommitmentCents ?? null,
        annualSpendTargetCents: input.annualSpendTargetCents ?? null,
        contractDocumentStorageKey: input.contractDocumentStorageKey ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.push(record);
      return Promise.resolve({ ...record });
    },

    update(
      contractId: string,
      input: UpdateSupplierContractInput,
    ): Promise<SupplierContract | null> {
      const idx = store.findIndex((c) => c.id === contractId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierContract = {
        ...existing,
        ...(input.contractName !== undefined && {
          contractName: input.contractName,
        }),
        ...(input.contractNumber !== undefined && {
          contractNumber: input.contractNumber,
        }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.endDate !== undefined && { endDate: input.endDate }),
        ...(input.renewalNoticeDays !== undefined && {
          renewalNoticeDays: input.renewalNoticeDays,
        }),
        ...(input.paymentTerms !== undefined && {
          paymentTerms: input.paymentTerms,
        }),
        ...(input.freightTerms !== undefined && {
          freightTerms: input.freightTerms,
        }),
        ...(input.minimumOrderValueCents !== undefined && {
          minimumOrderValueCents: input.minimumOrderValueCents,
        }),
        ...(input.rebateDescription !== undefined && {
          rebateDescription: input.rebateDescription,
        }),
        ...(input.estimatedAnnualCommitmentCents !== undefined && {
          estimatedAnnualCommitmentCents: input.estimatedAnnualCommitmentCents,
        }),
        ...(input.annualSpendTargetCents !== undefined && {
          annualSpendTargetCents: input.annualSpendTargetCents,
        }),
        ...(input.contractDocumentStorageKey !== undefined && {
          contractDocumentStorageKey: input.contractDocumentStorageKey,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    expire(contractId: string): Promise<SupplierContract | null> {
      const idx = store.findIndex((c) => c.id === contractId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierContract = {
        ...existing,
        status: "expired",
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    terminate(contractId: string): Promise<SupplierContract | null> {
      const idx = store.findIndex((c) => c.id === contractId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierContract = {
        ...existing,
        status: "terminated",
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    findActiveByRelationship(
      relationshipId: string,
      excludeContractId?: string,
    ): Promise<SupplierContract | null> {
      const found = store.find(
        (c) =>
          c.supplierRelationshipId === relationshipId &&
          c.status === "active" &&
          c.id !== excludeContractId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },
  };
}
