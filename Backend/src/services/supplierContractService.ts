/**
 * Supplier Contract Service — Sprint 4F.
 *
 * Business logic for managing commercial agreements between clinics and
 * suppliers.  Contracts are informational only in this sprint — no purchasing
 * behaviour is affected.
 *
 * RBAC:
 *   owner_admin              — full access across all clinics
 *   group_practice_manager   — full access to own clinic's contracts
 *   clinical_staff           — read-only access to own clinic's contracts
 *
 * Validation:
 *   • End date must be after start date.
 *   • Renewal notice days must be >= 0.
 *   • Only one ACTIVE contract per Supplier Relationship.
 *   • Monetary values cannot be negative.
 *
 * Soft status changes only — no hard deletes.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateSupplierContractInput,
  SupplierContract,
  SupplierContractStatus,
  UpdateSupplierContractInput,
} from "../types/supplierContract.js";
import type { SupplierContractRepository } from "../repositories/supplierContractRepository.js";
import type { SupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.js";
import { AppError } from "../types/errors.js";

export type SupplierContractService = ReturnType<
  typeof createSupplierContractService
>;

export function createSupplierContractService(
  contractRepo: SupplierContractRepository,
  relationshipRepo: SupplierRelationshipRepository,
) {
  // ── Tenant / role guards ────────────────────────────────────────────────────

  function assertTenantAccess(
    caller: AuthenticatedUser,
    clinicId: string,
  ): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(
        403,
        "SUPPLIER_CONTRACT_TENANT_VIOLATION",
        "Access denied: you do not belong to this clinic",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "SUPPLIER_CONTRACT_FORBIDDEN",
        "Clinical staff have read-only access to supplier contracts",
      );
    }
  }

  /** Resolves clinicId from a relationship, throwing 404 when not found. */
  async function resolveClinicIdFromRelationship(
    relationshipId: string,
  ): Promise<string> {
    const rel = await relationshipRepo.getById(relationshipId);
    if (!rel) {
      throw new AppError(
        404,
        "SUPPLIER_RELATIONSHIP_NOT_FOUND",
        `Supplier relationship '${relationshipId}' not found`,
      );
    }
    return rel.clinicId;
  }

  /** Resolves clinicId from a contract, throwing 404 when not found. */
  async function resolveClinicIdFromContract(
    contract: SupplierContract,
  ): Promise<string> {
    return resolveClinicIdFromRelationship(contract.supplierRelationshipId);
  }

  // ── Domain validation ───────────────────────────────────────────────────────

  function validateDates(startDate: Date, endDate: Date): void {
    if (endDate <= startDate) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_INVALID_DATES",
        "End date must be after start date",
      );
    }
  }

  function validateRenewalNoticeDays(days: number): void {
    if (!Number.isInteger(days) || days < 0) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_INVALID_RENEWAL_NOTICE",
        "Renewal notice days must be a non-negative integer",
      );
    }
  }

  function validateMonetaryAmount(
    value: number | null | undefined,
    fieldName: string,
  ): void {
    if (value !== null && value !== undefined && value < 0) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_NEGATIVE_AMOUNT",
        `${fieldName} cannot be negative`,
      );
    }
  }

  function validateCreateInput(input: CreateSupplierContractInput): void {
    validateDates(input.startDate, input.endDate);
    if (input.renewalNoticeDays !== undefined) {
      validateRenewalNoticeDays(input.renewalNoticeDays);
    }
    validateMonetaryAmount(
      input.minimumOrderValueCents,
      "Minimum order value",
    );
    validateMonetaryAmount(
      input.estimatedAnnualCommitmentCents,
      "Estimated annual commitment",
    );
    validateMonetaryAmount(
      input.annualSpendTargetCents,
      "Annual spend target",
    );
  }

  function validateUpdateInput(
    input: UpdateSupplierContractInput,
    existing: SupplierContract,
  ): void {
    const effectiveStart = input.startDate ?? existing.startDate;
    const effectiveEnd = input.endDate ?? existing.endDate;
    if (input.startDate !== undefined || input.endDate !== undefined) {
      validateDates(effectiveStart, effectiveEnd);
    }
    if (input.renewalNoticeDays !== undefined) {
      validateRenewalNoticeDays(input.renewalNoticeDays);
    }
    validateMonetaryAmount(
      input.minimumOrderValueCents,
      "Minimum order value",
    );
    validateMonetaryAmount(
      input.estimatedAnnualCommitmentCents,
      "Estimated annual commitment",
    );
    validateMonetaryAmount(input.annualSpendTargetCents, "Annual spend target");
  }

  async function assertNoActiveConflict(
    relationshipId: string,
    targetStatus: SupplierContractStatus,
    excludeContractId?: string,
  ): Promise<void> {
    if (targetStatus !== "active") return;
    const existing = await contractRepo.findActiveByRelationship(
      relationshipId,
      excludeContractId,
    );
    if (existing) {
      throw new AppError(
        409,
        "DUPLICATE_ACTIVE_CONTRACT",
        `An active contract (id: ${existing.id}) already exists for this supplier relationship`,
      );
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  return {
    async listByRelationship(
      caller: AuthenticatedUser,
      relationshipId: string,
      options: { status?: SupplierContractStatus } = {},
    ): Promise<SupplierContract[]> {
      const clinicId = await resolveClinicIdFromRelationship(relationshipId);
      assertTenantAccess(caller, clinicId);
      return contractRepo.listByRelationship(relationshipId, options);
    },

    async getById(
      caller: AuthenticatedUser,
      contractId: string,
    ): Promise<SupplierContract> {
      const contract = await contractRepo.getById(contractId);
      if (!contract) {
        throw new AppError(404, "NOT_FOUND", "Supplier contract not found");
      }
      const clinicId = await resolveClinicIdFromContract(contract);
      assertTenantAccess(caller, clinicId);
      return contract;
    },

    async create(
      caller: AuthenticatedUser,
      relationshipId: string,
      input: CreateSupplierContractInput,
    ): Promise<SupplierContract> {
      const clinicId = await resolveClinicIdFromRelationship(relationshipId);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      validateCreateInput(input);
      await assertNoActiveConflict(
        relationshipId,
        input.status ?? "draft",
      );

      return contractRepo.create(relationshipId, input);
    },

    async update(
      caller: AuthenticatedUser,
      contractId: string,
      input: UpdateSupplierContractInput,
    ): Promise<SupplierContract> {
      const existing = await contractRepo.getById(contractId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Supplier contract not found");
      }
      const clinicId = await resolveClinicIdFromContract(existing);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      validateUpdateInput(input, existing);

      // If status is being changed to 'active', ensure no other active contract exists.
      if (input.status === "active" && existing.status !== "active") {
        await assertNoActiveConflict(
          existing.supplierRelationshipId,
          "active",
          contractId,
        );
      }

      const updated = await contractRepo.update(contractId, input);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to update supplier contract",
        );
      }
      return updated;
    },

    async expire(
      caller: AuthenticatedUser,
      contractId: string,
    ): Promise<SupplierContract> {
      const existing = await contractRepo.getById(contractId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Supplier contract not found");
      }
      const clinicId = await resolveClinicIdFromContract(existing);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      if (existing.status === "expired") {
        throw new AppError(
          409,
          "SUPPLIER_CONTRACT_ALREADY_EXPIRED",
          "Supplier contract is already expired",
        );
      }
      if (existing.status === "terminated") {
        throw new AppError(
          409,
          "SUPPLIER_CONTRACT_ALREADY_TERMINATED",
          "A terminated contract cannot be expired",
        );
      }

      const updated = await contractRepo.expire(contractId);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to expire supplier contract",
        );
      }
      return updated;
    },

    async terminate(
      caller: AuthenticatedUser,
      contractId: string,
    ): Promise<SupplierContract> {
      const existing = await contractRepo.getById(contractId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Supplier contract not found");
      }
      const clinicId = await resolveClinicIdFromContract(existing);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      if (existing.status === "terminated") {
        throw new AppError(
          409,
          "SUPPLIER_CONTRACT_ALREADY_TERMINATED",
          "Supplier contract is already terminated",
        );
      }
      if (existing.status === "expired") {
        throw new AppError(
          409,
          "SUPPLIER_CONTRACT_ALREADY_EXPIRED",
          "An expired contract cannot be terminated",
        );
      }

      const updated = await contractRepo.terminate(contractId);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to terminate supplier contract",
        );
      }
      return updated;
    },

    async findActiveByRelationship(
      caller: AuthenticatedUser,
      relationshipId: string,
    ): Promise<SupplierContract | null> {
      const clinicId = await resolveClinicIdFromRelationship(relationshipId);
      assertTenantAccess(caller, clinicId);
      return contractRepo.findActiveByRelationship(relationshipId);
    },
  };
}
