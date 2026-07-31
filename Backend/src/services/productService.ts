import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
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
  stockUnit: string;
  receivingUnit: string;
  unitsPerReceivingUnit: number;
  defaultUnitCostCents: number;
  barcodeValue: string;
  barcodeFormat: BarcodeFormat;
  initialQuantity: number;
  reorderPoint: number;
  unitCostOverrideCents: number | null;
  supplierId: string;
};

export type CreateProductResult = {
  masterItem: MasterCatalogItem;
  barcodeMapping: BarcodeMapping;
  clinicItem: ClinicInventoryItemView;
};

export type UpdateClinicProductInput = {
  clinicId: string;
  inventoryItemId: string;
  reorderPoint?: number;
  unitCostOverrideCents?: number | null;
  supplierId?: string | null;
};

export type UpdateClinicProductResult = {
  clinicItem: ClinicInventoryItemView;
};

export function createProductService(
  catalogRepository: CatalogRepository,
  inventoryRepository: InventoryRepository,
  supplierRepository: SupplierRepository,
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

      if (!input.stockUnit.trim()) {
        throw new AppError(400, "VALIDATION_ERROR", "stockUnit is required");
      }

      if (!input.receivingUnit.trim()) {
        throw new AppError(400, "VALIDATION_ERROR", "receivingUnit is required");
      }

      if (!Number.isInteger(input.unitsPerReceivingUnit) || input.unitsPerReceivingUnit <= 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "unitsPerReceivingUnit must be a positive integer",
        );
      }

      if (!Number.isInteger(input.defaultUnitCostCents) || input.defaultUnitCostCents < 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "defaultUnitCostCents must be a non-negative integer",
        );
      }

      const supplier = await supplierRepository.findSupplierById(input.supplierId);
      if (!supplier || !supplier.active) {
        throw new AppError(400, "INVALID_SUPPLIER", "Select an active supplier");
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
        stockUnit: input.stockUnit.trim(),
        receivingUnit: input.receivingUnit.trim(),
        unitsPerReceivingUnit: input.unitsPerReceivingUnit,
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
        supplierPreference: null,
      });

      await inventoryRepository.createProductSupplier({
        clinicId: input.clinicId,
        productId: masterItem.id,
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        supplierSku: null,
        supplierBarcode: barcodeValue,
        unitCostCents: input.defaultUnitCostCents,
        packSize: null,
        isPreferred: true,
        active: true,
      });

      let clinicItem = await inventoryRepository.findClinicInventoryItem(
        input.clinicId,
        clinicRecord.id,
      );

      if (!clinicItem) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to load created clinic inventory item");
      }

      clinicItem = {
        ...clinicItem,
        preferredSupplierId: supplier.id,
        preferredSupplierName: supplier.supplierName,
        supplierPreference: supplier.supplierName,
      };

      return {
        masterItem,
        barcodeMapping,
        clinicItem,
      };
    },

    async updateClinicProduct(input: UpdateClinicProductInput): Promise<UpdateClinicProductResult> {
      const inventoryItem = await inventoryRepository.findClinicInventoryItem(
        input.clinicId,
        input.inventoryItemId,
      );

      if (!inventoryItem) {
        throw new AppError(404, "NOT_FOUND", "Clinic inventory item not found");
      }

      if (
        input.reorderPoint !== undefined &&
        (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0)
      ) {
        throw new AppError(400, "VALIDATION_ERROR", "reorderPoint must be a non-negative integer");
      }

      if (
        input.unitCostOverrideCents !== undefined &&
        input.unitCostOverrideCents !== null &&
        (!Number.isInteger(input.unitCostOverrideCents) || input.unitCostOverrideCents < 0)
      ) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "unitCostOverrideCents must be a non-negative integer",
        );
      }

      // Apply clinic inventory patch
      const patch: import("../types/inventory.js").UpdateClinicInventoryItemInput = {};
      if (input.reorderPoint !== undefined) patch.reorderPoint = input.reorderPoint;
      if (input.unitCostOverrideCents !== undefined)
        patch.unitCostOverrideCents = input.unitCostOverrideCents;

      if (Object.keys(patch).length > 0) {
        await inventoryRepository.updateClinicInventoryItem(
          input.clinicId,
          input.inventoryItemId,
          patch,
        );
      }

      // Update preferred supplier when requested
      if (input.supplierId !== undefined && input.supplierId !== null) {
        const supplier = await supplierRepository.findSupplierById(input.supplierId);
        if (!supplier || !supplier.active) {
          throw new AppError(400, "INVALID_SUPPLIER", "Select an active supplier");
        }
        await inventoryRepository.setPreferredProductSupplier(
          input.clinicId,
          inventoryItem.masterCatalogItemId,
          supplier.id,
          supplier.supplierName,
        );
      } else if (input.supplierId === null) {
        // null means "clear preferred supplier" — not yet exposed in UI but safe to handle
        await inventoryRepository.updateClinicInventoryItem(
          input.clinicId,
          input.inventoryItemId,
          { supplierPreference: null },
        );
      }

      const updated = await inventoryRepository.findClinicInventoryItem(
        input.clinicId,
        input.inventoryItemId,
      );

      if (!updated) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to reload updated inventory item");
      }

      return { clinicItem: updated };
    },
  };
}

export type ProductService = ReturnType<typeof createProductService>;
