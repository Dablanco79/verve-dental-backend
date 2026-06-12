import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type {
  BarcodeFormat,
  BarcodeMapping,
  ClinicInventoryItemView,
  DraftPoLine,
  InventoryAdjustment,
  ScanMode,
} from "../types/inventory.js";
import { AppError } from "../types/errors.js";
import { parseBarcode } from "../utils/barcodeParser.js";
import type { InventoryActor } from "./inventoryService.js";

export type ScanResult = {
  mode: ScanMode;
  item: ClinicInventoryItemView;
  adjustment: InventoryAdjustment;
  barcodeMapping: BarcodeMapping;
  detectedFormat: BarcodeFormat;
  lookupKey: string;
  draftPoLineAdded: boolean;
  draftPoLine: DraftPoLine | null;
};

export function createScanService(
  catalogRepository: CatalogRepository,
  inventoryRepository: InventoryRepository,
) {
  async function resolveBarcodeMapping(
    barcodeValue: string,
    hintFormat?: BarcodeFormat,
  ): Promise<{
    mapping: BarcodeMapping;
    detectedFormat: BarcodeFormat;
    lookupKey: string;
  }> {
    const parsed = parseBarcode(barcodeValue, hintFormat);

    if (!parsed) {
      throw new AppError(400, "VALIDATION_ERROR", "barcodeValue is required");
    }

    for (const lookupKey of parsed.lookupKeys) {
      const mapping = await catalogRepository.findBarcodeMapping(lookupKey);

      if (mapping) {
        return {
          mapping,
          detectedFormat: parsed.detectedFormat,
          lookupKey,
        };
      }
    }

    const masterItem = await catalogRepository.findMasterItemBySku(parsed.rawValue);

    if (masterItem) {
      const mappings = await catalogRepository.listBarcodeMappingsForItem(masterItem.id);
      const mapping = mappings.find((entry) => entry.isPrimary) ?? mappings[0];

      if (mapping) {
        return {
          mapping,
          detectedFormat: parsed.detectedFormat,
          lookupKey: masterItem.sku,
        };
      }
    }

    throw new AppError(
      404,
      "BARCODE_NOT_FOUND",
      "No catalog item matches this barcode or SKU",
    );
  }

  return {
    async handleScan(params: {
      clinicId: string;
      barcodeValue: string;
      barcodeFormat?: BarcodeFormat;
      quantity?: number;
      mode?: ScanMode;
      reason?: string | null;
      performedBy: InventoryActor;
    }): Promise<ScanResult> {
      const { clinicId, barcodeValue, barcodeFormat, performedBy } = params;
      const quantity = params.quantity ?? 1;
      const mode = params.mode ?? "deduct";

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError(400, "VALIDATION_ERROR", "quantity must be a positive integer");
      }

      const { mapping, detectedFormat, lookupKey } = await resolveBarcodeMapping(
        barcodeValue,
        barcodeFormat,
      );

      const existing = await inventoryRepository.findClinicInventoryByMasterItemId(
        clinicId,
        mapping.masterCatalogItemId,
      );

      if (!existing) {
        throw new AppError(
          404,
          "INVENTORY_ITEM_NOT_FOUND",
          "This product is not stocked at this clinic",
        );
      }

      if (mode === "receive") {
        const quantityAfter = existing.quantityOnHand + quantity;

        await inventoryRepository.updateQuantity(clinicId, existing.id, quantityAfter);

        const adjustment = await inventoryRepository.recordAdjustment({
          clinicId,
          clinicInventoryItemId: existing.id,
          masterCatalogItemId: mapping.masterCatalogItemId,
          adjustmentType: "receive",
          quantityDelta: quantity,
          quantityBefore: existing.quantityOnHand,
          quantityAfter,
          reason: params.reason ?? null,
          performedByUserId: performedBy.id,
          performedByEmail: performedBy.email,
          referenceId: lookupKey,
        });

        const item = await inventoryRepository.findClinicInventoryItem(clinicId, existing.id);

        if (!item) {
          throw new AppError(500, "INTERNAL_ERROR", "Failed to load updated inventory item");
        }

        return {
          mode,
          item,
          adjustment,
          barcodeMapping: mapping,
          detectedFormat,
          lookupKey,
          draftPoLineAdded: false,
          draftPoLine: null,
        };
      }

      const quantityAfter = existing.quantityOnHand - quantity;

      if (quantityAfter < 0) {
        throw new AppError(
          400,
          "INSUFFICIENT_STOCK",
          "Scan would result in negative stock on hand",
        );
      }

      const wasAtOrAboveReorder = existing.quantityOnHand >= existing.reorderPoint;

      await inventoryRepository.updateQuantity(clinicId, existing.id, quantityAfter);

      const adjustment = await inventoryRepository.recordAdjustment({
        clinicId,
        clinicInventoryItemId: existing.id,
        masterCatalogItemId: mapping.masterCatalogItemId,
        adjustmentType: "scan_deduct",
        quantityDelta: -quantity,
        quantityBefore: existing.quantityOnHand,
        quantityAfter,
        reason: null,
        performedByUserId: performedBy.id,
        performedByEmail: performedBy.email,
        referenceId: lookupKey,
      });

      let draftPoLineAdded = false;
      let draftPoLine: DraftPoLine | null = null;

      const isBelowReorder = quantityAfter < existing.reorderPoint;

      if (wasAtOrAboveReorder && isBelowReorder) {
        const draftPo = await inventoryRepository.findOrCreateDraftPo(
          clinicId,
          performedBy.id,
        );

        const reorderQuantity = Math.max(existing.reorderPoint - quantityAfter, 1);

        draftPoLine = await inventoryRepository.addDraftPoLine({
          draftPurchaseOrderId: draftPo.id,
          masterCatalogItemId: mapping.masterCatalogItemId,
          clinicInventoryItemId: existing.id,
          quantity: reorderQuantity,
          reason: "below_reorder_point",
        });

        draftPoLineAdded = true;
      }

      const item = await inventoryRepository.findClinicInventoryItem(clinicId, existing.id);

      if (!item) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to load updated inventory item");
      }

      return {
        mode,
        item,
        adjustment,
        barcodeMapping: mapping,
        detectedFormat,
        lookupKey,
        draftPoLineAdded,
        draftPoLine,
      };
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
