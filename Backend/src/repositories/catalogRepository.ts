import { randomUUID } from "node:crypto";

import type { BarcodeMapping, MasterCatalogItem } from "../types/inventory.js";
import {
  buildBarcodeMappingSeed,
  buildMasterCatalogSeed,
} from "./seed/inventorySeed.js";

type CreateMasterCatalogItemBase = Pick<
  MasterCatalogItem,
  "sku" | "name" | "description" | "category" | "defaultUnitCostCents"
>;

export type CreateMasterCatalogItemInput = CreateMasterCatalogItemBase & (
  | Pick<MasterCatalogItem, "stockUnit" | "receivingUnit" | "unitsPerReceivingUnit">
  | Pick<MasterCatalogItem, "unitOfMeasure">
);

export interface CatalogRepository {
  listMasterItems(): Promise<MasterCatalogItem[]>;
  findMasterItemById(id: string): Promise<MasterCatalogItem | null>;
  findMasterItemBySku(sku: string): Promise<MasterCatalogItem | null>;
  findBarcodeMapping(barcodeValue: string): Promise<BarcodeMapping | null>;
  listBarcodeMappingsForItem(masterCatalogItemId: string): Promise<BarcodeMapping[]>;
  createMasterItem(item: CreateMasterCatalogItemInput): Promise<MasterCatalogItem>;
  createBarcodeMapping(
    mapping: Omit<BarcodeMapping, "id" | "createdAt">,
  ): Promise<BarcodeMapping>;
}

export function createInMemoryCatalogRepository(): CatalogRepository {
  const masterItems = buildMasterCatalogSeed();
  const barcodeMappings = buildBarcodeMappingSeed();

  return {
    listMasterItems(): Promise<MasterCatalogItem[]> {
      return Promise.resolve(
        masterItems.filter((item) => item.isActive).map((item) => ({ ...item })),
      );
    },

    findMasterItemById(id: string): Promise<MasterCatalogItem | null> {
      const item = masterItems.find((entry) => entry.id === id);
      return Promise.resolve(item ? { ...item } : null);
    },

    findMasterItemBySku(sku: string): Promise<MasterCatalogItem | null> {
      const normalized = sku.trim().toUpperCase();
      const item = masterItems.find((entry) => entry.sku.toUpperCase() === normalized);
      return Promise.resolve(item ? { ...item } : null);
    },

    findBarcodeMapping(barcodeValue: string): Promise<BarcodeMapping | null> {
      const normalized = barcodeValue.trim();
      const mapping = barcodeMappings.find((entry) => entry.barcodeValue === normalized);
      return Promise.resolve(mapping ? { ...mapping } : null);
    },

    listBarcodeMappingsForItem(masterCatalogItemId: string): Promise<BarcodeMapping[]> {
      return Promise.resolve(
        barcodeMappings
          .filter((entry) => entry.masterCatalogItemId === masterCatalogItemId)
          .map((entry) => ({ ...entry })),
      );
    },

    createMasterItem(item: CreateMasterCatalogItemInput): Promise<MasterCatalogItem> {
      const now = new Date();
      const stockUnit = "stockUnit" in item ? item.stockUnit : item.unitOfMeasure;
      const receivingUnit = "receivingUnit" in item ? item.receivingUnit : stockUnit;
      const unitsPerReceivingUnit =
        "unitsPerReceivingUnit" in item ? item.unitsPerReceivingUnit : 1;
      const record: MasterCatalogItem = {
        ...item,
        stockUnit,
        receivingUnit,
        unitsPerReceivingUnit,
        unitOfMeasure: stockUnit,
        id: randomUUID(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      masterItems.push(record);
      return Promise.resolve({ ...record });
    },

    createBarcodeMapping(
      mapping: Omit<BarcodeMapping, "id" | "createdAt">,
    ): Promise<BarcodeMapping> {
      const record: BarcodeMapping = {
        ...mapping,
        id: randomUUID(),
        createdAt: new Date(),
      };

      barcodeMappings.push(record);
      return Promise.resolve({ ...record });
    },
  };
}
