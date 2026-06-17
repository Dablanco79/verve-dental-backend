import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type {
  ClinicInventoryItemView,
  InventoryAdjustment,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

// Narrow write-only audit dependency.
type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

export type InventoryActor = {
  id: string;
  email: string;
};

export function createInventoryService(
  inventoryRepository: InventoryRepository,
  auditWriter?: AuditWriter,
) {
  return {
    listInventory(clinicId: string): Promise<ClinicInventoryItemView[]> {
      return inventoryRepository.listClinicInventory(clinicId);
    },

    async getInventoryItem(
      clinicId: string,
      itemId: string,
    ): Promise<ClinicInventoryItemView> {
      const item = await inventoryRepository.findClinicInventoryItem(clinicId, itemId);

      if (!item) {
        throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
      }

      return item;
    },

    async adjustStock(params: {
      clinicId: string;
      itemId: string;
      quantityDelta: number;
      reason: string | null;
      performedBy: InventoryActor;
    }): Promise<{ item: ClinicInventoryItemView; adjustment: InventoryAdjustment }> {
      const { clinicId, itemId, quantityDelta, reason, performedBy } = params;

      if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "quantityDelta must be a non-zero integer",
        );
      }

      const existing = await inventoryRepository.findClinicInventoryItem(clinicId, itemId);

      if (!existing) {
        throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
      }

      const quantityAfter = existing.quantityOnHand + quantityDelta;

      if (quantityAfter < 0) {
        throw new AppError(
          400,
          "INSUFFICIENT_STOCK",
          "Adjustment would result in negative stock on hand",
        );
      }

      await inventoryRepository.updateQuantity(clinicId, itemId, quantityAfter);

      const adjustment = await inventoryRepository.recordAdjustment({
        clinicId,
        clinicInventoryItemId: itemId,
        masterCatalogItemId: existing.masterCatalogItemId,
        adjustmentType: "manual_adjust",
        quantityDelta,
        quantityBefore: existing.quantityOnHand,
        quantityAfter,
        reason,
        performedByUserId: performedBy.id,
        performedByEmail: performedBy.email,
        referenceId: null,
      });

      const item = await inventoryRepository.findClinicInventoryItem(clinicId, itemId);

      if (!item) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to load updated inventory item");
      }

      auditWriter?.recordEvent({
        clinicId,
        entityType: "inventory_adjustment",
        entityId: adjustment.id,
        action: "manual_adjust",
        actorId: performedBy.id,
        actorEmail: performedBy.email,
        metadata: {
          itemId,
          sku: item.masterSku,
          quantityDelta,
          quantityBefore: adjustment.quantityBefore,
          quantityAfter: adjustment.quantityAfter,
          reason,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return { item, adjustment };
    },

    listAdjustments(
      clinicId: string,
      limit?: number,
    ): Promise<InventoryAdjustment[]> {
      return inventoryRepository.listAdjustments(clinicId, { limit });
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
