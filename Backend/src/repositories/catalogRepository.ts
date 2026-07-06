import { randomUUID } from "node:crypto";

import type { BarcodeMapping, MasterCatalogItem } from "../types/inventory.js";
import {
  buildBarcodeMappingSeed,
  buildMasterCatalogSeed,
} from "./seed/inventorySeed.js";

type CreateMasterCatalogItemBase = Pick<
  MasterCatalogItem,
  "sku" | "name" | "description" | "category" | "defaultUnitCostCents"
> &
  Partial<
    Pick<MasterCatalogItem, "subcategory" | "brand" | "variantAttributes" | "notes" | "status">
  >;

export type CreateMasterCatalogItemInput = CreateMasterCatalogItemBase & (
  | Pick<MasterCatalogItem, "stockUnit" | "receivingUnit" | "unitsPerReceivingUnit">
  | Pick<MasterCatalogItem, "unitOfMeasure">
);

/**
 * Collapses internal whitespace, trims, and lowercases a value so that
 * display_name/category comparisons are stable across casing and stray
 * whitespace differences in curated library spreadsheets.
 */
export function normaliseMasterProductText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface CatalogRepository {
  listMasterItems(): Promise<MasterCatalogItem[]>;
  findMasterItemById(id: string): Promise<MasterCatalogItem | null>;
  findMasterItemBySku(sku: string): Promise<MasterCatalogItem | null>;
  /**
   * Finds an existing master product whose normalised name + category match
   * (case-insensitive, whitespace-collapsed). Used by the Master Product
   * Library import to avoid creating duplicate catalogue entries.
   */
  findMasterItemByNormalisedNameAndCategory(
    name: string,
    category: string,
  ): Promise<MasterCatalogItem | null>;
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

    findMasterItemByNormalisedNameAndCategory(
      name: string,
      category: string,
    ): Promise<MasterCatalogItem | null> {
      const normalizedName = normaliseMasterProductText(name);
      const normalizedCategory = normaliseMasterProductText(category);
      const item = masterItems.find(
        (entry) =>
          normaliseMasterProductText(entry.name) === normalizedName &&
          normaliseMasterProductText(entry.category) === normalizedCategory,
      );
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
      const status = item.status ?? "active";
      const record: MasterCatalogItem = {
        ...item,
        stockUnit,
        receivingUnit,
        unitsPerReceivingUnit,
        unitOfMeasure: stockUnit,
        id: randomUUID(),
        subcategory: item.subcategory ?? null,
        brand: item.brand ?? null,
        variantAttributes: item.variantAttributes ?? null,
        notes: item.notes ?? null,
        status,
        isActive: status === "active",
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
