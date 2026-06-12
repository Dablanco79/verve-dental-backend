import type { Request, Response } from "express";
import { z } from "zod";

import type { ScanService } from "../services/scanService.js";
import { BARCODE_FORMATS, SCAN_MODES } from "../types/inventory.js";
import type {
  BarcodeMapping,
  ClinicInventoryItemView,
  DraftPoLine,
  InventoryAdjustment,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";

const scanSchema = z.object({
  barcodeValue: z.string().trim().min(1).max(255),
  barcodeFormat: z.enum(BARCODE_FORMATS).optional(),
  quantity: z.number().int().positive().optional(),
  mode: z.enum(SCAN_MODES).optional(),
  reason: z.string().trim().min(1).max(255).optional(),
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

function serializeBarcodeMapping(mapping: BarcodeMapping) {
  return {
    id: mapping.id,
    masterCatalogItemId: mapping.masterCatalogItemId,
    barcodeValue: mapping.barcodeValue,
    barcodeFormat: mapping.barcodeFormat,
    isPrimary: mapping.isPrimary,
  };
}

function serializeDraftPoLine(line: DraftPoLine) {
  return {
    id: line.id,
    draftPurchaseOrderId: line.draftPurchaseOrderId,
    masterCatalogItemId: line.masterCatalogItemId,
    clinicInventoryItemId: line.clinicInventoryItemId,
    quantity: line.quantity,
    reason: line.reason,
    createdAt: line.createdAt.toISOString(),
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

export function createScanHandlers(scanService: ScanService) {
  return {
    async handleScan(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(scanSchema, req.body);

      const result = await scanService.handleScan({
        clinicId,
        barcodeValue: body.barcodeValue,
        barcodeFormat: body.barcodeFormat,
        quantity: body.quantity,
        mode: body.mode,
        reason: body.reason ?? null,
        performedBy: {
          id: user.id,
          email: user.email,
        },
      });

      res.status(200).json({
        data: {
          mode: result.mode,
          item: serializeInventoryItem(result.item),
          adjustment: serializeAdjustment(result.adjustment),
          barcode: {
            detectedFormat: result.detectedFormat,
            lookupKey: result.lookupKey,
            mapping: serializeBarcodeMapping(result.barcodeMapping),
          },
          draftPoLineAdded: result.draftPoLineAdded,
          draftPoLine: result.draftPoLine
            ? serializeDraftPoLine(result.draftPoLine)
            : null,
        },
      });
    },
  };
}

export type ScanHandlers = ReturnType<typeof createScanHandlers>;
