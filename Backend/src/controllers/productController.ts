import type { Request, Response } from "express";
import { z } from "zod";

import type { ProductService } from "../services/productService.js";
import { BARCODE_FORMATS, VALID_CREATION_CATEGORY_SET } from "../types/inventory.js";
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
  category: z
    .string()
    .trim()
    .min(1, "category is required")
    .max(128)
    .refine(
      (val) => VALID_CREATION_CATEGORY_SET.has(val),
      { message: `Category must be one of the canonical categories. "Uncategorised" and "Imported Catalogue" are not accepted for new products.` },
    ),
  stockUnit: z.string().trim().min(1).max(32),
  receivingUnit: z.string().trim().min(1).max(32),
  unitsPerReceivingUnit: z.number().int().positive(),
  unitOfMeasure: z.string().trim().min(1).max(32).optional(),
  defaultUnitCostCents: z.number().int().nonnegative(),
  barcodeValue: z.string().trim().min(1).max(255),
  barcodeFormat: z.enum(BARCODE_FORMATS),
  initialQuantity: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative(),
  unitCostOverrideCents: z.number().int().nonnegative().optional(),
  supplierId: z.string().uuid(),
});

const updateClinicProductSchema = z
  .object({
    reorderPoint: z.number().int().nonnegative().optional(),
    unitCostOverrideCents: z.number().int().nonnegative().nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.reorderPoint !== undefined ||
      data.unitCostOverrideCents !== undefined ||
      data.supplierId !== undefined,
    { message: "At least one field must be provided for update" },
  );

function serializeMasterItem(item: MasterCatalogItem) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    category: item.category,
    stockUnit: item.stockUnit,
    receivingUnit: item.receivingUnit,
    unitsPerReceivingUnit: item.unitsPerReceivingUnit,
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
    stockUnit: item.stockUnit,
    receivingUnit: item.receivingUnit,
    unitsPerReceivingUnit: item.unitsPerReceivingUnit,
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
        stockUnit: body.stockUnit,
        receivingUnit: body.receivingUnit,
        unitsPerReceivingUnit: body.unitsPerReceivingUnit,
        defaultUnitCostCents: body.defaultUnitCostCents,
        barcodeValue: body.barcodeValue,
        barcodeFormat: body.barcodeFormat,
        initialQuantity: body.initialQuantity,
        reorderPoint: body.reorderPoint,
        unitCostOverrideCents: body.unitCostOverrideCents ?? null,
        supplierId: body.supplierId,
      });

      res.status(201).json({
        data: {
          masterItem: serializeMasterItem(result.masterItem),
          barcodeMapping: serializeBarcodeMapping(result.barcodeMapping),
          clinicItem: serializeInventoryItem(result.clinicItem),
        },
      });
    },

    async updateClinicProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const inventoryItemId = routeParam(req.params.inventoryItemId);

      if (!inventoryItemId) {
        throw new AppError(400, "VALIDATION_ERROR", "inventoryItemId is required");
      }

      const body = parseBody(updateClinicProductSchema, req.body);

      const result = await productService.updateClinicProduct({
        clinicId,
        inventoryItemId,
        reorderPoint: body.reorderPoint,
        unitCostOverrideCents: body.unitCostOverrideCents,
        supplierId: body.supplierId,
      });

      res.status(200).json({ data: { clinicItem: serializeInventoryItem(result.clinicItem) } });
    },
  };
}

export type ProductHandlers = ReturnType<typeof createProductHandlers>;
