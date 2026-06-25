/**
 * Procurement Policy Service — Sprint 4E.
 *
 * Business logic for managing clinic procurement policies.
 *
 * RBAC:
 *   owner_admin              — full access across all clinics
 *   group_practice_manager   — full access to own clinic
 *   clinical_staff           — read-only access to own clinic
 *
 * VALIDATION RULES (enforced here, before any repository call):
 *   1. priority >= 1
 *   2. Only one preferred supplier per active (clinic, product) combination.
 *   3. fallback_priority must be > priority when set.
 *   4. price_difference_threshold_percent must be 0–100 when set.
 *   5. No two active policies for the same (clinic, product) may share a priority.
 *
 * Soft-deactivate only — no hard deletes.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateProcurementPolicyInput,
  ProcurementPolicy,
  ProcurementPolicyStatus,
  UpdateProcurementPolicyInput,
} from "../types/procurementPolicy.js";
import type { ProcurementPolicyRepository } from "../repositories/procurementPolicyRepository.js";
import { AppError } from "../types/errors.js";

export type ProcurementPolicyService = ReturnType<
  typeof createProcurementPolicyService
>;

export function createProcurementPolicyService(
  policyRepo: ProcurementPolicyRepository,
) {
  // ── Tenant / role guards ────────────────────────────────────────────────────

  function assertTenantAccess(
    caller: AuthenticatedUser,
    clinicId: string,
  ): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(
        403,
        "PROCUREMENT_POLICY_TENANT_VIOLATION",
        "Access denied: you do not belong to this clinic",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "PROCUREMENT_POLICY_FORBIDDEN",
        "Clinical staff have read-only access to procurement policies",
      );
    }
  }

  // ── Business-rule validation ────────────────────────────────────────────────

  function validatePriority(priority: number): void {
    if (!Number.isInteger(priority) || priority < 1) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "priority must be an integer >= 1",
        [{ field: "priority", message: "Must be an integer >= 1" }],
      );
    }
  }

  function validateFallbackPriority(
    priority: number,
    fallbackPriority: number | null | undefined,
  ): void {
    if (fallbackPriority == null) return;
    if (!Number.isInteger(fallbackPriority) || fallbackPriority < 1) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "fallback_priority must be an integer >= 1",
        [{ field: "fallbackPriority", message: "Must be an integer >= 1" }],
      );
    }
    if (fallbackPriority <= priority) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "fallback_priority must be greater than priority (fallback has lower precedence than preferred)",
        [
          {
            field: "fallbackPriority",
            message: `Must be greater than priority (${String(priority)})`,
          },
        ],
      );
    }
  }

  function validateThreshold(
    pct: number | null | undefined,
  ): void {
    if (pct == null) return;
    if (pct < 0 || pct > 100) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "price_difference_threshold_percent must be between 0 and 100",
        [
          {
            field: "priceDifferenceThresholdPercent",
            message: "Must be between 0 and 100",
          },
        ],
      );
    }
  }

  async function assertNoDuplicatePriority(
    clinicId: string,
    masterCatalogItemId: string | null,
    priority: number,
    excludePolicyId?: string,
  ): Promise<void> {
    const conflicts = await policyRepo.findActiveByPriority(
      clinicId,
      masterCatalogItemId,
      priority,
      excludePolicyId,
    );
    if (conflicts.length > 0) {
      throw new AppError(
        409,
        "DUPLICATE_POLICY_PRIORITY",
        `An active policy for this clinic/product already uses priority ${String(priority)}`,
        [
          {
            field: "priority",
            message: `Priority ${String(priority)} is already in use by another active policy`,
          },
        ],
      );
    }
  }

  async function assertPreferredUnique(
    clinicId: string,
    masterCatalogItemId: string | null,
    excludePolicyId?: string,
  ): Promise<void> {
    const existing = await policyRepo.findActivePreferred(
      clinicId,
      masterCatalogItemId,
      excludePolicyId,
    );
    if (existing) {
      throw new AppError(
        409,
        "DUPLICATE_PREFERRED_SUPPLIER",
        "An active policy for this clinic/product already designates a preferred supplier",
        [
          {
            field: "preferredSupplier",
            message: "Only one preferred supplier is allowed per clinic/product",
          },
        ],
      );
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  return {
    async listByClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options: { status?: ProcurementPolicyStatus } = {},
    ): Promise<ProcurementPolicy[]> {
      assertTenantAccess(caller, clinicId);
      return policyRepo.listByClinic(clinicId, options);
    },

    async listByRelationship(
      caller: AuthenticatedUser,
      supplierRelationshipId: string,
      clinicId: string,
    ): Promise<ProcurementPolicy[]> {
      assertTenantAccess(caller, clinicId);
      const policies = await policyRepo.listByRelationship(
        supplierRelationshipId,
      );
      return policies.filter((p) => p.clinicId === clinicId);
    },

    async getById(
      caller: AuthenticatedUser,
      policyId: string,
    ): Promise<ProcurementPolicy> {
      const policy = await policyRepo.getById(policyId);
      if (!policy) {
        throw new AppError(404, "NOT_FOUND", "Procurement policy not found");
      }
      assertTenantAccess(caller, policy.clinicId);
      return policy;
    },

    async create(
      caller: AuthenticatedUser,
      clinicId: string,
      input: CreateProcurementPolicyInput,
    ): Promise<ProcurementPolicy> {
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      // ── Validate fields ────────────────────────────────────────────────────
      validatePriority(input.priority);
      validateFallbackPriority(input.priority, input.fallbackPriority);
      validateThreshold(input.priceDifferenceThresholdPercent);

      const isActive = (input.policyStatus ?? "active") === "active";

      if (isActive) {
        // Rule 5: no duplicate priorities for the same clinic/product scope.
        await assertNoDuplicatePriority(
          clinicId,
          input.masterCatalogItemId ?? null,
          input.priority,
        );

        // Rule 2: only one preferred supplier per clinic/product.
        if (input.preferredSupplier === true) {
          await assertPreferredUnique(
            clinicId,
            input.masterCatalogItemId ?? null,
          );
        }
      }

      return policyRepo.create(clinicId, input);
    },

    async update(
      caller: AuthenticatedUser,
      policyId: string,
      input: UpdateProcurementPolicyInput,
    ): Promise<ProcurementPolicy> {
      const existing = await policyRepo.getById(policyId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Procurement policy not found");
      }
      assertTenantAccess(caller, existing.clinicId);
      assertWriteAccess(caller);

      // Resolve effective values after the patch.
      const effectivePriority = input.priority ?? existing.priority;
      const effectiveFallbackPriority =
        input.fallbackPriority !== undefined
          ? input.fallbackPriority
          : existing.fallbackPriority;
      const effectivePreferred =
        input.preferredSupplier !== undefined
          ? input.preferredSupplier
          : existing.preferredSupplier;
      const effectiveThreshold =
        input.priceDifferenceThresholdPercent !== undefined
          ? input.priceDifferenceThresholdPercent
          : existing.priceDifferenceThresholdPercent;
      const effectiveStatus = input.policyStatus ?? existing.policyStatus;
      const effectiveCatalogItemId = existing.masterCatalogItemId;

      validatePriority(effectivePriority);
      validateFallbackPriority(effectivePriority, effectiveFallbackPriority);
      validateThreshold(effectiveThreshold);

      if (effectiveStatus === "active") {
        // Rule 5: priority conflict check (excluding this policy).
        if (input.priority !== undefined) {
          await assertNoDuplicatePriority(
            existing.clinicId,
            effectiveCatalogItemId,
            effectivePriority,
            policyId,
          );
        }

        // Rule 2: preferred uniqueness (excluding this policy).
        if (effectivePreferred) {
          await assertPreferredUnique(
            existing.clinicId,
            effectiveCatalogItemId,
            policyId,
          );
        }
      }

      const updated = await policyRepo.update(policyId, input);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to update procurement policy",
        );
      }
      return updated;
    },

    async deactivate(
      caller: AuthenticatedUser,
      policyId: string,
    ): Promise<ProcurementPolicy> {
      const existing = await policyRepo.getById(policyId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Procurement policy not found");
      }
      assertTenantAccess(caller, existing.clinicId);
      assertWriteAccess(caller);

      if (existing.policyStatus === "inactive") {
        throw new AppError(
          409,
          "PROCUREMENT_POLICY_ALREADY_INACTIVE",
          "Procurement policy is already inactive",
        );
      }

      const updated = await policyRepo.deactivate(policyId);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to deactivate procurement policy",
        );
      }
      return updated;
    },
  };
}
