import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type {
  BarcodeFormat,
  BarcodeMapping,
  ClinicInventoryItemView,
  MasterCatalogItem,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";

export type CreateProductInput = {
  clinicId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitOfMeasure: string;
  defaultUnitCostCents: number;
  barcodeValue: string;
  barcodeFormat: BarcodeFormat;
  initialQuantity: number;
  reorderPoint: number;
  unitCostOverrideCents: number | null;
  supplierPreference: string | null;
};

export type CreateProductResult = {
  masterItem: MasterCatalogItem;
  barcodeMapping: BarcodeMapping;
  clinicItem: ClinicInventoryItemView;
};

export function createProductService(
  catalogRepository: CatalogRepository,
  inventoryRepository: InventoryRepository,
) {
  return {
    async createProduct(input: CreateProductInput): Promise<CreateProductResult> {
      const sku = input.sku.trim().toUpperCase();
      const barcodeValue = input.barcodeValue.trim();

      if (!sku) {
        throw new AppError(400, "VALIDATION_ERROR", "SKU is required");
      }

      if (!barcodeValue) {
        throw new AppError(400, "VALIDATION_ERROR", "Barcode value is required");
      }

      if (!Number.isInteger(input.initialQuantity) || input.initialQuantity < 0) {
        throw new AppError(400, "VALIDATION_ERROR", "initialQuantity must be a non-negative integer");
      }

      if (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0) {
        throw new AppError(400, "VALIDATION_ERROR", "reorderPoint must be a non-negative integer");
      }

      if (!Number.isInteger(input.defaultUnitCostCents) || input.defaultUnitCostCents < 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "defaultUnitCostCents must be a non-negative integer",
        );
      }

      const existingSku = await catalogRepository.findMasterItemBySku(sku);

      if (existingSku) {
        throw new AppError(409, "DUPLICATE_SKU", "A product with this SKU already exists");
      }

      const existingBarcode = await catalogRepository.findBarcodeMapping(barcodeValue);

      if (existingBarcode) {
        throw new AppError(409, "DUPLICATE_BARCODE", "This barcode is already assigned to a product");
      }

      const masterItem = await catalogRepository.createMasterItem({
        sku,
        name: input.name.trim(),
        description: input.description,
        category: input.category.trim(),
        unitOfMeasure: input.unitOfMeasure.trim(),
        defaultUnitCostCents: input.defaultUnitCostCents,
      });

      const barcodeMapping = await catalogRepository.createBarcodeMapping({
        masterCatalogItemId: masterItem.id,
        barcodeValue,
        barcodeFormat: input.barcodeFormat,
        isPrimary: true,
      });

      const clinicRecord = await inventoryRepository.createClinicInventoryItem({
        clinicId: input.clinicId,
        masterCatalogItemId: masterItem.id,
        quantityOnHand: input.initialQuantity,
        reorderPoint: input.reorderPoint,
        unitCostOverrideCents: input.unitCostOverrideCents,
        supplierPreference: input.supplierPreference,
      });

      const clinicItem = await inventoryRepository.findClinicInventoryItem(
        input.clinicId,
        clinicRecord.id,
      );

      if (!clinicItem) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to load created clinic inventory item");
      }

      return {
        masterItem,
        barcodeMapping,
        clinicItem,
      };
    },
  };
}

export type ProductService = ReturnType<typeof createProductService>;
