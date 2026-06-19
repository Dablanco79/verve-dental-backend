import type { AuditService } from "./auditService.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import { AppError } from "../types/errors.js";
import type {
  CreateSupplierProductInput,
  SupplierProduct,
  UpdateSupplierProductInput,
} from "../types/supplier.js";

export function createSupplierCatalogueService(
  supplierCatalogueRepository: SupplierCatalogueRepository,
  supplierRepository: SupplierRepository,
  catalogRepository: CatalogRepository,
  auditService: AuditService,
) {
  async function assertSupplierExists(supplierId: string): Promise<void> {
    const supplier = await supplierRepository.findSupplierById(supplierId);
    if (!supplier) {
      throw new AppError(404, "NOT_FOUND", "Supplier not found");
    }
    if (!supplier.active) {
      throw new AppError(422, "SUPPLIER_INACTIVE", "Supplier is not active");
    }
  }

  async function assertProductExists(productId: string): Promise<void> {
    const product = await catalogRepository.findMasterItemById(productId);
    if (!product) {
      throw new AppError(404, "NOT_FOUND", "Product not found in master catalog");
    }
  }

  return {
    async listSupplierProducts(options: {
      supplierId?: string;
      productId?: string;
      active?: boolean;
    } = {}): Promise<SupplierProduct[]> {
      return supplierCatalogueRepository.listSupplierProducts(options);
    },

    async getSupplierProduct(supplierProductId: string): Promise<SupplierProduct> {
      const entry = await supplierCatalogueRepository.findSupplierProductById(
        supplierProductId,
      );
      if (!entry) {
        throw new AppError(404, "NOT_FOUND", "Supplier product entry not found");
      }
      return entry;
    },

    async listPricingForProduct(productId: string): Promise<SupplierProduct[]> {
      await assertProductExists(productId);
      return supplierCatalogueRepository.listPricingForProduct(productId);
    },

    async createSupplierProduct(
      input: CreateSupplierProductInput,
      actorId: string,
    ): Promise<SupplierProduct> {
      await assertSupplierExists(input.supplierId);
      await assertProductExists(input.productId);

      const existing = await supplierCatalogueRepository.findSupplierProductByPair(
        input.supplierId,
        input.productId,
      );
      if (existing) {
        throw new AppError(
          409,
          "CONFLICT",
          "An active price entry already exists for this supplier and product. Use PATCH to update it.",
        );
      }

      const entry = await supplierCatalogueRepository.createSupplierProduct(input);

      auditService.logEvent("supplier_product.created", {
        userId: actorId,
        resourceId: entry.id,
      });

      return entry;
    },

    async updateSupplierProduct(
      supplierProductId: string,
      input: UpdateSupplierProductInput,
      actorId: string,
    ): Promise<SupplierProduct> {
      const entry = await supplierCatalogueRepository.findSupplierProductById(
        supplierProductId,
      );
      if (!entry) {
        throw new AppError(404, "NOT_FOUND", "Supplier product entry not found");
      }

      const updated = await supplierCatalogueRepository.updateSupplierProduct(
        supplierProductId,
        input,
      );
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Supplier product entry not found");
      }

      auditService.logEvent("supplier_product.updated", {
        userId: actorId,
        resourceId: supplierProductId,
      });

      return updated;
    },
  };
}

export type SupplierCatalogueService = ReturnType<
  typeof createSupplierCatalogueService
>;
