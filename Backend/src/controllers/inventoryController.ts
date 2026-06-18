import type { Request, Response } from "express";
import { z } from "zod";

import type { InventoryService } from "../services/inventoryService.js";
import type {
  ClinicInventoryItemView,
  InventoryAdjustment,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import { parseBody, zodToDetails } from "../utils/validation.js";

const adjustSchema = z.object({
  itemId: z.string().uuid(),
  quantityDelta: z.number().int().refine((value) => value !== 0, {
    message: "quantityDelta must be non-zero",
  }),
  reason: z.string().trim().min(1).max(255).optional(),
});

const adjustmentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

function serializeInventoryItem(item: ClinicInventoryItemView) {
  return {
    id: item.id,
    clinicId: item.clinicId,
    masterCatalogItemId: item.masterCatalogItemId,
    masterSku: item.masterSku,
    name: item.name,
    category: item.category,
    unitOfMeasure: item.unitOfMeasure,
    quantityOnHand: item.quantityOnHand,
    reorderPoint: item.reorderPoint,
    unitCostCents: item.unitCostCents,
    unitCostOverrideCents: item.unitCostOverrideCents,
    supplierPreference: item.supplierPreference,
    isBelowReorderPoint: item.isBelowReorderPoint,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeAdjustment(adjustment: InventoryAdjustment) {
  return {
    id: adjustment.id,
    clinicId: adjustment.clinicId,
    clinicInventoryItemId: adjustment.clinicInventoryItemId,
    masterCatalogItemId: adjustment.masterCatalogItemId,
    adjustmentType: adjustment.adjustmentType,
    quantityDelta: adjustment.quantityDelta,
    quantityBefore: adjustment.quantityBefore,
    quantityAfter: adjustment.quantityAfter,
    reason: adjustment.reason,
    performedByUserId: adjustment.performedByUserId,
    performedByEmail: adjustment.performedByEmail,
    referenceId: adjustment.referenceId,
    createdAt: adjustment.createdAt.toISOString(),
  };
}

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }

  return req.user;
}

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value[0]) {
    return value[0];
  }

  return "";
}

export function createInventoryHandlers(inventoryService: InventoryService) {
  return {
    async listInventory(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const items = await inventoryService.listInventory(clinicId);

      res.status(200).json({
        data: items.map(serializeInventoryItem),
      });
    },

    async getInventoryItem(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const itemId = routeParam(req.params.itemId);
      const item = await inventoryService.getInventoryItem(clinicId, itemId);

      res.status(200).json({
        data: serializeInventoryItem(item),
      });
    },

    async adjustInventory(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(adjustSchema, req.body);

      const result = await inventoryService.adjustStock({
        clinicId,
        itemId: body.itemId,
        quantityDelta: body.quantityDelta,
        reason: body.reason ?? null,
        performedBy: {
          id: user.id,
          email: user.email,
        },
      });

      res.status(200).json({
        data: {
          item: serializeInventoryItem(result.item),
          adjustment: serializeAdjustment(result.adjustment),
        },
      });
    },

    async listAdjustments(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const parsed = adjustmentsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(parsed.error),
        );
      }
      const adjustments = await inventoryService.listAdjustments(clinicId, parsed.data.limit);

      res.status(200).json({
        data: adjustments.map(serializeAdjustment),
      });
    },
  };
}

export type InventoryHandlers = ReturnType<typeof createInventoryHandlers>;
