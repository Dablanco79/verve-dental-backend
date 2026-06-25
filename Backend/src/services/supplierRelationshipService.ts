/**
 * Supplier Relationship Service — Sprint 4D.
 *
 * Business logic for managing clinic-specific supplier relationships.
 *
 * RBAC:
 *   owner_admin              — full access across all clinics
 *   group_practice_manager   — full access to own clinic
 *   clinical_staff           — read-only access to own clinic
 *
 * Soft delete only — no hard deletes. Deactivate sets status to 'inactive'.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateSupplierRelationshipInput,
  SupplierRelationship,
  SupplierRelationshipStatus,
  UpdateSupplierRelationshipInput,
} from "../types/supplierRelationship.js";
import type { SupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import { AppError } from "../types/errors.js";

export type SupplierRelationshipService = ReturnType<
  typeof createSupplierRelationshipService
>;

export function createSupplierRelationshipService(
  relationshipRepo: SupplierRelationshipRepository,
  supplierRepo: SupplierRepository,
) {
  // ── Tenant / role guards ────────────────────────────────────────────────────

  function assertTenantAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(
        403,
        "SUPPLIER_RELATIONSHIP_TENANT_VIOLATION",
        "Access denied: you do not belong to this clinic",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "SUPPLIER_RELATIONSHIP_FORBIDDEN",
        "Clinical staff have read-only access to supplier relationships",
      );
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  return {
    async listByClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options: { status?: SupplierRelationshipStatus } = {},
    ): Promise<SupplierRelationship[]> {
      assertTenantAccess(caller, clinicId);
      return relationshipRepo.listByClinic(clinicId, options);
    },

    async listBySupplier(
      caller: AuthenticatedUser,
      supplierId: string,
    ): Promise<SupplierRelationship[]> {
      // owner_admin only — cross-clinic read
      if (caller.role !== "owner_admin") {
        throw new AppError(
          403,
          "SUPPLIER_RELATIONSHIP_FORBIDDEN",
          "Only owner admins can list relationships across all clinics for a supplier",
        );
      }
      return relationshipRepo.listBySupplier(supplierId);
    },

    async getById(
      caller: AuthenticatedUser,
      relationshipId: string,
    ): Promise<SupplierRelationship> {
      const relationship = await relationshipRepo.getById(relationshipId);
      if (!relationship) {
        throw new AppError(404, "NOT_FOUND", "Supplier relationship not found");
      }
      assertTenantAccess(caller, relationship.clinicId);
      return relationship;
    },

    async create(
      caller: AuthenticatedUser,
      clinicId: string,
      input: CreateSupplierRelationshipInput,
    ): Promise<SupplierRelationship> {
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      // Verify the supplier exists in the Supplier Master.
      const supplier = await supplierRepo.findSupplierById(input.supplierId);
      if (!supplier) {
        throw new AppError(
          404,
          "SUPPLIER_NOT_FOUND",
          `Supplier '${input.supplierId}' not found in Supplier Master`,
        );
      }

      // Duplicate check is enforced by the repository layer (DB unique constraint).
      return relationshipRepo.create(clinicId, input);
    },

    async update(
      caller: AuthenticatedUser,
      relationshipId: string,
      input: UpdateSupplierRelationshipInput,
    ): Promise<SupplierRelationship> {
      const existing = await relationshipRepo.getById(relationshipId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Supplier relationship not found");
      }
      assertTenantAccess(caller, existing.clinicId);
      assertWriteAccess(caller);

      const updated = await relationshipRepo.update(relationshipId, input);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to update supplier relationship",
        );
      }
      return updated;
    },

    async deactivate(
      caller: AuthenticatedUser,
      relationshipId: string,
    ): Promise<SupplierRelationship> {
      const existing = await relationshipRepo.getById(relationshipId);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Supplier relationship not found");
      }
      assertTenantAccess(caller, existing.clinicId);
      assertWriteAccess(caller);

      if (existing.relationshipStatus === "inactive") {
        throw new AppError(
          409,
          "SUPPLIER_RELATIONSHIP_ALREADY_INACTIVE",
          "Supplier relationship is already inactive",
        );
      }

      const updated = await relationshipRepo.deactivate(relationshipId);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to deactivate supplier relationship",
        );
      }
      return updated;
    },
  };
}
