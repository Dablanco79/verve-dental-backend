import type { AuditService } from "./auditService.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import { AppError } from "../types/errors.js";
import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from "../types/supplier.js";

export function createSupplierService(
  supplierRepository: SupplierRepository,
  auditService: AuditService,
) {
  return {
    async listSuppliers(options: { active?: boolean } = {}): Promise<Supplier[]> {
      return supplierRepository.listSuppliers(options);
    },

    async getSupplier(supplierId: string): Promise<Supplier> {
      const supplier = await supplierRepository.findSupplierById(supplierId);
      if (!supplier) {
        throw new AppError(404, "NOT_FOUND", "Supplier not found");
      }
      return supplier;
    },

    async createSupplier(
      input: CreateSupplierInput,
      actorId: string,
    ): Promise<Supplier> {
      // Unique supplier_code check
      if (input.supplierCode) {
        const existing = await supplierRepository.findSupplierByCode(
          input.supplierCode,
        );
        if (existing) {
          throw new AppError(
            409,
            "CONFLICT",
            `Supplier code "${input.supplierCode}" is already in use`,
          );
        }
      }

      const supplier = await supplierRepository.createSupplier(input);

      auditService.logEvent("supplier.created", {
        userId: actorId,
        resourceId: supplier.id,
      });

      return supplier;
    },

    async updateSupplier(
      supplierId: string,
      input: UpdateSupplierInput,
      actorId: string,
    ): Promise<Supplier> {
      // Unique supplier_code check (exclude self)
      if (input.supplierCode) {
        const existing = await supplierRepository.findSupplierByCode(
          input.supplierCode,
        );
        if (existing && existing.id !== supplierId) {
          throw new AppError(
            409,
            "CONFLICT",
            `Supplier code "${input.supplierCode}" is already in use`,
          );
        }
      }

      const supplier = await supplierRepository.updateSupplier(
        supplierId,
        input,
      );
      if (!supplier) {
        throw new AppError(404, "NOT_FOUND", "Supplier not found");
      }

      auditService.logEvent("supplier.updated", {
        userId: actorId,
        resourceId: supplierId,
      });

      return supplier;
    },
  };
}

export type SupplierService = ReturnType<typeof createSupplierService>;
