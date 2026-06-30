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

const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit cannot exceed 100")
    .optional(),
  offset: z.coerce
    .number()
    .int()
    .min(0, "offset must be at least 0")
    .optional(),
});

const adjustmentsQuerySchema = paginationQuerySchema;

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
    preferredSupplierId: item.preferredSupplierId,
    preferredSupplierName: item.preferredSupplierName,
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
      const parsed = paginationQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const page = await inventoryService.listInventoryPage(clinicId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });

      res.status(200).json({
        data: page.items.map(serializeInventoryItem),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
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

      const page = await inventoryService.listAdjustmentsPage(clinicId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });

      res.status(200).json({
        data: page.items.map(serializeAdjustment),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    },
  };
}

export type InventoryHandlers = ReturnType<typeof createInventoryHandlers>;
