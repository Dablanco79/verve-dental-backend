import { randomUUID } from "node:crypto";

import type {
  CreateProcurementPolicyInput,
  ProcurementPolicy,
  ProcurementPolicyStatus,
  UpdateProcurementPolicyInput,
} from "../types/procurementPolicy.js";
import {
  SEED_CLINIC_A_ID,
} from "./userRepository.js";
import {
  SEED_RELATIONSHIP_A1_ID,
  SEED_RELATIONSHIP_B1_ID,
} from "./supplierRelationshipRepository.js";
import { SEED_MASTER_CATALOG_IDS } from "./seed/inventorySeed.js";

// ─── Seed constants ───────────────────────────────────────────────────────────

/**
 * Fixed UUIDs for demo procurement policy records seeded in development / test.
 * Must be stable across restarts for idempotent seeding.
 */
export const SEED_POLICY_IDS = {
  /** Clinic A — Nitrile Gloves — Dental Depot Australia (preferred, priority 1). */
  clinicAGlovesPreferred: "eeeeeeee-0000-4000-8000-000000000001",
  /** Clinic A — Nitrile Gloves — Medigate Medical (fallback, priority 2). */
  clinicAGlovesFallback: "eeeeeeee-0000-4000-8000-000000000002",
  /** Clinic A — General (no specific product) — Dental Depot Australia (preferred, priority 1). */
  clinicAGeneralPreferred: "eeeeeeee-0000-4000-8000-000000000003",
} as const;

// ─── In-memory seed data ──────────────────────────────────────────────────────

const SEED_TIMESTAMP = new Date("2026-06-01T00:00:00.000Z");

const SEED_POLICIES: ProcurementPolicy[] = [
  {
    id: SEED_POLICY_IDS.clinicAGlovesPreferred,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_A1_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    policyName: "Nitrile Gloves — Preferred Supplier",
    policyStatus: "active",
    priority: 1,
    preferredSupplier: true,
    allowFallback: true,
    fallbackPriority: 2,
    minimumOrderQuantity: 5,
    preferredOrderDay: "monday",
    preferredDeliveryDay: "thursday",
    priceDifferenceThresholdPercent: 5,
    approvalRequired: false,
    reorderStrategy: "standard",
    notes: "Primary glove supplier — 30 day net terms",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: SEED_POLICY_IDS.clinicAGlovesFallback,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_B1_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    policyName: "Nitrile Gloves — Fallback Supplier",
    policyStatus: "active",
    priority: 2,
    preferredSupplier: false,
    allowFallback: false,
    fallbackPriority: null,
    minimumOrderQuantity: null,
    preferredOrderDay: null,
    preferredDeliveryDay: null,
    priceDifferenceThresholdPercent: null,
    approvalRequired: true,
    reorderStrategy: "standard",
    notes: "Use only when primary supplier is unable to supply",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: SEED_POLICY_IDS.clinicAGeneralPreferred,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_A1_ID,
    masterCatalogItemId: null,
    policyName: "General Consumables — Preferred Supplier",
    policyStatus: "active",
    priority: 1,
    preferredSupplier: true,
    allowFallback: false,
    fallbackPriority: null,
    minimumOrderQuantity: null,
    preferredOrderDay: "monday",
    preferredDeliveryDay: null,
    priceDifferenceThresholdPercent: null,
    approvalRequired: false,
    reorderStrategy: "standard",
    notes: null,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

// ─── Repository interface ─────────────────────────────────────────────────────

export interface ProcurementPolicyRepository {
  /** All policies for a clinic ordered by priority, optionally filtered by status. */
  listByClinic(
    clinicId: string,
    options?: { status?: ProcurementPolicyStatus },
  ): Promise<ProcurementPolicy[]>;

  /** All policies tied to a specific supplier relationship. */
  listByRelationship(
    supplierRelationshipId: string,
  ): Promise<ProcurementPolicy[]>;

  /** Fetch a single policy by UUID, or null when not found. */
  getById(policyId: string): Promise<ProcurementPolicy | null>;

  /**
   * Create a new procurement policy.
   * Business-rule validation is enforced by the service layer before this call.
   */
  create(
    clinicId: string,
    input: CreateProcurementPolicyInput,
  ): Promise<ProcurementPolicy>;

  /**
   * Partial update — only keys present in `input` are written.
   * Returns null when the policyId does not exist.
   */
  update(
    policyId: string,
    input: UpdateProcurementPolicyInput,
  ): Promise<ProcurementPolicy | null>;

  /**
   * Soft-deactivate: sets policy_status to 'inactive'.
   * No hard delete is ever performed.
   * Returns null when the policyId does not exist.
   */
  deactivate(policyId: string): Promise<ProcurementPolicy | null>;

  /**
   * Returns the active preferred policy for a (clinic, product) combination,
   * optionally excluding a specific policy ID (used for update validation).
   * masterCatalogItemId = null finds preferred general policies.
   */
  findActivePreferred(
    clinicId: string,
    masterCatalogItemId: string | null,
    excludePolicyId?: string,
  ): Promise<ProcurementPolicy | null>;

  /**
   * Returns any active policies for (clinic, product) with the given priority,
   * optionally excluding a specific policy ID (used for update validation).
   * Used to detect duplicate active priorities.
   */
  findActiveByPriority(
    clinicId: string,
    masterCatalogItemId: string | null,
    priority: number,
    excludePolicyId?: string,
  ): Promise<ProcurementPolicy[]>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemoryProcurementPolicyRepository(): ProcurementPolicyRepository {
  const store: ProcurementPolicy[] = SEED_POLICIES.map((p) => ({ ...p }));

  return {
    listByClinic(
      clinicId: string,
      options: { status?: ProcurementPolicyStatus } = {},
    ): Promise<ProcurementPolicy[]> {
      let result = store
        .filter((p) => p.clinicId === clinicId)
        .map((p) => ({ ...p }));
      if (options.status !== undefined) {
        result = result.filter((p) => p.policyStatus === options.status);
      }
      result.sort((a, b) => a.priority - b.priority);
      return Promise.resolve(result);
    },

    listByRelationship(
      supplierRelationshipId: string,
    ): Promise<ProcurementPolicy[]> {
      return Promise.resolve(
        store
          .filter((p) => p.supplierRelationshipId === supplierRelationshipId)
          .map((p) => ({ ...p }))
          .sort((a, b) => a.priority - b.priority),
      );
    },

    getById(policyId: string): Promise<ProcurementPolicy | null> {
      const found = store.find((p) => p.id === policyId);
      return Promise.resolve(found ? { ...found } : null);
    },

    async create(
      clinicId: string,
      input: CreateProcurementPolicyInput,
    ): Promise<ProcurementPolicy> {
      const now = new Date();
      const record: ProcurementPolicy = {
        id: randomUUID(),
        clinicId,
        supplierRelationshipId: input.supplierRelationshipId,
        masterCatalogItemId: input.masterCatalogItemId ?? null,
        policyName: input.policyName,
        policyStatus: input.policyStatus ?? "active",
        priority: input.priority,
        preferredSupplier: input.preferredSupplier ?? false,
        allowFallback: input.allowFallback ?? false,
        fallbackPriority: input.fallbackPriority ?? null,
        minimumOrderQuantity: input.minimumOrderQuantity ?? null,
        preferredOrderDay: input.preferredOrderDay ?? null,
        preferredDeliveryDay: input.preferredDeliveryDay ?? null,
        priceDifferenceThresholdPercent:
          input.priceDifferenceThresholdPercent ?? null,
        approvalRequired: input.approvalRequired ?? false,
        reorderStrategy: input.reorderStrategy ?? "standard",
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.push(record);
      return Promise.resolve({ ...record });
    },

    update(
      policyId: string,
      input: UpdateProcurementPolicyInput,
    ): Promise<ProcurementPolicy | null> {
      const idx = store.findIndex((p) => p.id === policyId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: ProcurementPolicy = {
        ...existing,
        ...(input.policyName !== undefined && { policyName: input.policyName }),
        ...(input.policyStatus !== undefined && {
          policyStatus: input.policyStatus,
        }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.preferredSupplier !== undefined && {
          preferredSupplier: input.preferredSupplier,
        }),
        ...(input.allowFallback !== undefined && {
          allowFallback: input.allowFallback,
        }),
        ...(input.fallbackPriority !== undefined && {
          fallbackPriority: input.fallbackPriority,
        }),
        ...(input.minimumOrderQuantity !== undefined && {
          minimumOrderQuantity: input.minimumOrderQuantity,
        }),
        ...(input.preferredOrderDay !== undefined && {
          preferredOrderDay: input.preferredOrderDay,
        }),
        ...(input.preferredDeliveryDay !== undefined && {
          preferredDeliveryDay: input.preferredDeliveryDay,
        }),
        ...(input.priceDifferenceThresholdPercent !== undefined && {
          priceDifferenceThresholdPercent:
            input.priceDifferenceThresholdPercent,
        }),
        ...(input.approvalRequired !== undefined && {
          approvalRequired: input.approvalRequired,
        }),
        ...(input.reorderStrategy !== undefined && {
          reorderStrategy: input.reorderStrategy,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    deactivate(policyId: string): Promise<ProcurementPolicy | null> {
      const idx = store.findIndex((p) => p.id === policyId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: ProcurementPolicy = {
        ...existing,
        policyStatus: "inactive",
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    findActivePreferred(
      clinicId: string,
      masterCatalogItemId: string | null,
      excludePolicyId?: string,
    ): Promise<ProcurementPolicy | null> {
      const found = store.find(
        (p) =>
          p.clinicId === clinicId &&
          p.masterCatalogItemId === masterCatalogItemId &&
          p.preferredSupplier &&
          p.policyStatus === "active" &&
          p.id !== excludePolicyId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    findActiveByPriority(
      clinicId: string,
      masterCatalogItemId: string | null,
      priority: number,
      excludePolicyId?: string,
    ): Promise<ProcurementPolicy[]> {
      const results = store
        .filter(
          (p) =>
            p.clinicId === clinicId &&
            p.masterCatalogItemId === masterCatalogItemId &&
            p.priority === priority &&
            p.policyStatus === "active" &&
            p.id !== excludePolicyId,
        )
        .map((p) => ({ ...p }));
      return Promise.resolve(results);
    },
  };
}
