import type { Request, Response } from "express";
import { z } from "zod";

import type { ProductService } from "../services/productService.js";
import { BARCODE_FORMATS } from "../types/inventory.js";
import type {
  BarcodeMapping,
  ClinicInventoryItemView,
  MasterCatalogItem,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";

const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().min(1).max(128),
  unitOfMeasure: z.string().trim().min(1).max(32),
  defaultUnitCostCents: z.number().int().nonnegative(),
  barcodeValue: z.string().trim().min(1).max(255),
  barcodeFormat: z.enum(BARCODE_FORMATS),
  initialQuantity: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative(),
  unitCostOverrideCents: z.number().int().nonnegative().optional(),
  supplierPreference: z.string().trim().max(128).optional(),
});

function serializeMasterItem(item: MasterCatalogItem) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    category: item.category,
    unitOfMeasure: item.unitOfMeasure,
    defaultUnitCostCents: item.defaultUnitCostCents,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
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

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value[0]) {
    return value[0];
  }

  return "";
}

export function createProductHandlers(productService: ProductService) {
  return {
    async createProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(createProductSchema, req.body);

      const result = await productService.createProduct({
        clinicId,
        sku: body.sku,
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        unitOfMeasure: body.unitOfMeasure,
        defaultUnitCostCents: body.defaultUnitCostCents,
        barcodeValue: body.barcodeValue,
        barcodeFormat: body.barcodeFormat,
        initialQuantity: body.initialQuantity,
        reorderPoint: body.reorderPoint,
        unitCostOverrideCents: body.unitCostOverrideCents ?? null,
        supplierPreference: body.supplierPreference ?? null,
      });

      res.status(201).json({
        data: {
          masterItem: serializeMasterItem(result.masterItem),
          barcodeMapping: serializeBarcodeMapping(result.barcodeMapping),
          clinicItem: serializeInventoryItem(result.clinicItem),
        },
      });
    },
  };
}

export type ProductHandlers = ReturnType<typeof createProductHandlers>;
