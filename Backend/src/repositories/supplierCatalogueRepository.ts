import { randomUUID } from "node:crypto";

import type {
  CreateSupplierProductInput,
  SupplierProduct,
  UpdateSupplierProductInput,
} from "../types/supplier.js";

// ─── Repository interface ─────────────────────────────────────────────────────

export interface SupplierCatalogueRepository {
  listSupplierProducts(options?: {
    supplierId?: string;
    productId?: string;
    active?: boolean;
  }): Promise<SupplierProduct[]>;

  findSupplierProductById(
    supplierProductId: string,
  ): Promise<SupplierProduct | null>;

  findSupplierProductByPair(
    supplierId: string,
    productId: string,
  ): Promise<SupplierProduct | null>;

  listPricingForProduct(productId: string): Promise<SupplierProduct[]>;

  createSupplierProduct(
    input: CreateSupplierProductInput,
  ): Promise<SupplierProduct>;

  updateSupplierProduct(
    supplierProductId: string,
    input: UpdateSupplierProductInput,
  ): Promise<SupplierProduct | null>;

  /**
   * Create a new entry or update the existing active entry for the
   * (supplierId, productId) pair.
   */
  upsertSupplierProduct(input: CreateSupplierProductInput): Promise<{
    record: SupplierProduct;
    created: boolean;
  }>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemorySupplierCatalogueRepository(): SupplierCatalogueRepository {
  const entries: SupplierProduct[] = [];

  return {
    listSupplierProducts(options = {}): Promise<SupplierProduct[]> {
      let result = entries.map((e) => ({ ...e }));
      if (options.supplierId !== undefined) {
        result = result.filter((e) => e.supplierId === options.supplierId);
      }
      if (options.productId !== undefined) {
        result = result.filter((e) => e.productId === options.productId);
      }
      if (options.active !== undefined) {
        result = result.filter((e) => e.active === options.active);
      }
      result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve(result);
    },

    findSupplierProductById(
      supplierProductId: string,
    ): Promise<SupplierProduct | null> {
      const found = entries.find((e) => e.id === supplierProductId);
      return Promise.resolve(found ? { ...found } : null);
    },

    findSupplierProductByPair(
      supplierId: string,
      productId: string,
    ): Promise<SupplierProduct | null> {
      const found = entries.find(
        (e) => e.supplierId === supplierId && e.productId === productId && e.active,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listPricingForProduct(productId: string): Promise<SupplierProduct[]> {
      const result = entries
        .filter((e) => e.productId === productId && e.active)
        .map((e) => ({ ...e }));
      return Promise.resolve(result);
    },

    createSupplierProduct(
      input: CreateSupplierProductInput,
    ): Promise<SupplierProduct> {
      const now = new Date();
      const record: SupplierProduct = {
        id: randomUUID(),
        supplierId: input.supplierId,
        productId: input.productId,
        supplierSku: input.supplierSku ?? null,
        supplierDescription: input.supplierDescription ?? null,
        unitCostCents: input.unitCostCents,
        unitOfMeasure: input.unitOfMeasure ?? null,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      entries.push(record);
      return Promise.resolve({ ...record });
    },

    updateSupplierProduct(
      supplierProductId: string,
      input: UpdateSupplierProductInput,
    ): Promise<SupplierProduct | null> {
      const idx = entries.findIndex((e) => e.id === supplierProductId);
      if (idx === -1) return Promise.resolve(null);

      const existing = entries[idx];
      if (!existing) return Promise.resolve(null);

      const updated: SupplierProduct = {
        ...existing,
        ...(input.supplierSku !== undefined && { supplierSku: input.supplierSku }),
        ...(input.supplierDescription !== undefined && {
          supplierDescription: input.supplierDescription,
        }),
        ...(input.unitCostCents !== undefined && { unitCostCents: input.unitCostCents }),
        ...(input.unitOfMeasure !== undefined && { unitOfMeasure: input.unitOfMeasure }),
        ...(input.active !== undefined && { active: input.active }),
        updatedAt: new Date(),
      };
      entries[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    async upsertSupplierProduct(input: CreateSupplierProductInput): Promise<{
      record: SupplierProduct;
      created: boolean;
    }> {
      const existing = await this.findSupplierProductByPair(
        input.supplierId,
        input.productId,
      );
      if (existing) {
        const updated = await this.updateSupplierProduct(existing.id, {
          supplierSku: input.supplierSku,
          supplierDescription: input.supplierDescription,
          unitCostCents: input.unitCostCents,
          unitOfMeasure: input.unitOfMeasure,
        });
        if (!updated) throw new Error("Upsert update returned null unexpectedly");
        return { record: updated, created: false };
      }
      const created = await this.createSupplierProduct(input);
      return { record: created, created: true };
    },
  };
}
