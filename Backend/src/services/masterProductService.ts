/**
 * Master Product Management Foundation.
 *
 * CRUD/list service for master_catalog_items, layered on top of the existing
 * CatalogRepository (shared with the Master Product Library import flow and
 * clinic Products/Inventory surfaces).
 *
 * Safety invariants (never violated by this service):
 *   - Never touches clinic_inventory_items, inventory_adjustments, or any
 *     stock quantity.
 *   - Never calls inventoryRepository, scan, or receiving APIs.
 *   - Archive/reactivate are soft status toggles on master_catalog_items only.
 *
 * Duplicate protection: creating or updating a product into an "active"
 * status is rejected if another ACTIVE product already exists with the same
 * normalised (trim + collapse whitespace + case-insensitive) displayName +
 * category. Archived products never block new active products from reusing
 * the same name + category.
 */

import { randomUUID } from "node:crypto";

import type {
  CatalogRepository,
  ListMasterItemsOptions,
  MasterItemsPage,
  MasterProductStatusFilter,
} from "../repositories/catalogRepository.js";
import type { AuditService } from "./auditService.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type { MasterCatalogItem } from "../types/inventory.js";

export type MasterProductStatus = "active" | "archived";

export type CreateMasterProductInput = {
  displayName: string;
  sku?: string | null;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  variantAttributes?: string | null;
  stockUnit?: string | null;
  receivingUnit?: string | null;
  status?: MasterProductStatus;
  notes?: string | null;
};

export type UpdateMasterProductInput = {
  displayName?: string;
  sku?: string;
  category?: string;
  subcategory?: string | null;
  brand?: string | null;
  variantAttributes?: string | null;
  stockUnit?: string;
  receivingUnit?: string;
  status?: MasterProductStatus;
  notes?: string | null;
};

export type ListMasterProductsOptions = {
  search?: string;
  category?: string;
  status?: MasterProductStatusFilter;
  limit?: number;
  offset?: number;
};

// ─── SKU generation (independent of the library-import SKU builder) ──────────

function slugSku(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "MP";
}

async function generateUniqueSku(
  catalogRepository: CatalogRepository,
  displayName: string,
): Promise<string> {
  const base = slugSku(displayName);
  const candidates = [base, `${base}-${String(Date.now()).slice(-6)}`];

  for (const candidate of candidates) {
    const existing = await catalogRepository.findMasterItemBySku(candidate);
    if (!existing) return candidate;
  }

  return `${base.slice(0, 40)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createMasterProductService(
  catalogRepository: CatalogRepository,
  auditService: AuditService,
) {
  async function assertNoActiveDuplicate(
    displayName: string,
    category: string,
    opts: { excludeId?: string; targetStatus: MasterProductStatus },
  ): Promise<void> {
    if (opts.targetStatus !== "active") return;

    const existing = await catalogRepository.findMasterItemByNormalisedNameAndCategory(
      displayName,
      category,
    );

    if (existing && existing.id !== opts.excludeId && existing.status === "active") {
      throw new AppError(
        409,
        "MASTER_PRODUCT_DUPLICATE",
        `An active master product named "${displayName}" already exists in category "${category}"`,
      );
    }
  }

  function auditContext(actor: AuthenticatedUser, resourceId: string) {
    return {
      userId: actor.id,
      email: actor.email,
      role: actor.role,
      clinicId: actor.homeClinicId,
      resourceId,
    };
  }

  return {
    async listMasterProducts(options: ListMasterProductsOptions = {}): Promise<MasterItemsPage> {
      const repoOptions: ListMasterItemsOptions = {
        search: options.search,
        category: options.category,
        status: options.status ?? "active",
        limit: options.limit,
        offset: options.offset,
      };
      return catalogRepository.listMasterItemsPage(repoOptions);
    },

    async getMasterProduct(id: string): Promise<MasterCatalogItem> {
      const item = await catalogRepository.findMasterItemById(id);
      if (!item) {
        throw new AppError(404, "NOT_FOUND", "Master product not found");
      }
      return item;
    },

    async createMasterProduct(
      input: CreateMasterProductInput,
      actor: AuthenticatedUser,
    ): Promise<MasterCatalogItem> {
      const displayName = input.displayName.trim();
      const category = input.category.trim();
      const status: MasterProductStatus = input.status ?? "active";

      await assertNoActiveDuplicate(displayName, category, { targetStatus: status });

      let sku = input.sku?.trim() || undefined;
      if (sku) {
        const existingSku = await catalogRepository.findMasterItemBySku(sku);
        if (existingSku) {
          throw new AppError(
            409,
            "MASTER_PRODUCT_SKU_CONFLICT",
            `SKU "${sku}" is already in use`,
          );
        }
      } else {
        sku = await generateUniqueSku(catalogRepository, displayName);
      }

      const stockUnit = (input.stockUnit?.trim() || "Unit").slice(0, 32);
      const receivingUnit = (input.receivingUnit?.trim() || stockUnit).slice(0, 32);

      const created = await catalogRepository.createMasterItem({
        sku,
        name: displayName,
        description: null,
        category,
        stockUnit,
        receivingUnit,
        unitsPerReceivingUnit: 1,
        defaultUnitCostCents: 0,
        subcategory: input.subcategory?.trim() || null,
        brand: input.brand?.trim() || null,
        variantAttributes: input.variantAttributes?.trim() || null,
        notes: input.notes?.trim() || null,
        status,
      });

      auditService.logEvent("master_product.created", auditContext(actor, created.id));

      return created;
    },

    async updateMasterProduct(
      id: string,
      input: UpdateMasterProductInput,
      actor: AuthenticatedUser,
    ): Promise<MasterCatalogItem> {
      const existing = await catalogRepository.findMasterItemById(id);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Master product not found");
      }

      const nextDisplayName =
        input.displayName !== undefined ? input.displayName.trim() : existing.name;
      const nextCategory = input.category !== undefined ? input.category.trim() : existing.category;
      const nextStatus: MasterProductStatus =
        input.status ?? (existing.status === "archived" ? "archived" : "active");

      await assertNoActiveDuplicate(nextDisplayName, nextCategory, {
        excludeId: id,
        targetStatus: nextStatus,
      });

      if (input.sku !== undefined) {
        const trimmedSku = input.sku.trim();
        if (trimmedSku !== existing.sku) {
          const existingSku = await catalogRepository.findMasterItemBySku(trimmedSku);
          if (existingSku && existingSku.id !== id) {
            throw new AppError(
              409,
              "MASTER_PRODUCT_SKU_CONFLICT",
              `SKU "${trimmedSku}" is already in use`,
            );
          }
        }
      }

      const updated = await catalogRepository.updateMasterItem(id, {
        sku: input.sku !== undefined ? input.sku.trim() : undefined,
        name: input.displayName !== undefined ? nextDisplayName : undefined,
        category: input.category !== undefined ? nextCategory : undefined,
        subcategory:
          input.subcategory !== undefined ? input.subcategory?.trim() || null : undefined,
        brand: input.brand !== undefined ? input.brand?.trim() || null : undefined,
        variantAttributes:
          input.variantAttributes !== undefined
            ? input.variantAttributes?.trim() || null
            : undefined,
        stockUnit: input.stockUnit !== undefined ? input.stockUnit.trim().slice(0, 32) : undefined,
        receivingUnit:
          input.receivingUnit !== undefined ? input.receivingUnit.trim().slice(0, 32) : undefined,
        notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
        status: input.status,
      });

      if (!updated) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to update master product");
      }

      auditService.logEvent("master_product.updated", auditContext(actor, id));

      return updated;
    },

    async archiveMasterProduct(id: string, actor: AuthenticatedUser): Promise<MasterCatalogItem> {
      const existing = await catalogRepository.findMasterItemById(id);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Master product not found");
      }
      if (existing.status === "archived") {
        throw new AppError(
          409,
          "MASTER_PRODUCT_ALREADY_ARCHIVED",
          "Master product is already archived",
        );
      }

      const updated = await catalogRepository.updateMasterItem(id, { status: "archived" });
      if (!updated) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to archive master product");
      }

      auditService.logEvent("master_product.archived", auditContext(actor, id));

      return updated;
    },

    async reactivateMasterProduct(
      id: string,
      actor: AuthenticatedUser,
    ): Promise<MasterCatalogItem> {
      const existing = await catalogRepository.findMasterItemById(id);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Master product not found");
      }
      if (existing.status === "active") {
        throw new AppError(
          409,
          "MASTER_PRODUCT_ALREADY_ACTIVE",
          "Master product is already active",
        );
      }

      await assertNoActiveDuplicate(existing.name, existing.category, {
        excludeId: id,
        targetStatus: "active",
      });

      const updated = await catalogRepository.updateMasterItem(id, { status: "active" });
      if (!updated) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to reactivate master product");
      }

      auditService.logEvent("master_product.reactivated", auditContext(actor, id));

      return updated;
    },
  };
}

export type MasterProductService = ReturnType<typeof createMasterProductService>;
