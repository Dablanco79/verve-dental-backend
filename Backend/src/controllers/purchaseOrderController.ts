import type { Request, Response } from "express";

import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import { AppError } from "../types/errors.js";

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

export function createPurchaseOrderHandlers(
  inventoryRepository: InventoryRepository,
  catalogRepository: CatalogRepository,
) {
  return {
    async listPurchaseOrders(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const lines = await inventoryRepository.listDraftPoLines(clinicId);

      // Resolve unique catalog items in a single parallel batch.
      const uniqueItemIds = [...new Set(lines.map((l) => l.masterCatalogItemId))];
      const catalogItems = await Promise.all(
        uniqueItemIds.map((id) => catalogRepository.findMasterItemById(id)),
      );
      const itemMap = new Map(
        catalogItems
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map((item) => [item.id, item]),
      );

      const enriched = lines.map((line) => {
        const catalogItem = itemMap.get(line.masterCatalogItemId);
        return {
          id: line.id,
          draftPurchaseOrderId: line.draftPurchaseOrderId,
          masterCatalogItemId: line.masterCatalogItemId,
          masterSku: catalogItem?.sku ?? "UNKNOWN",
          itemName: catalogItem?.name ?? "Unknown item",
          clinicInventoryItemId: line.clinicInventoryItemId,
          quantity: line.quantity,
          reason: line.reason,
          // All POs are "draft" until a submit endpoint is added in a future module.
          orderStatus: "draft" as const,
          createdAt: line.createdAt.toISOString(),
        };
      });

      res.status(200).json({ data: enriched });
    },
  };
}

export type PurchaseOrderHandlers = ReturnType<typeof createPurchaseOrderHandlers>;
