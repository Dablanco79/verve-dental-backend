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
 * Partial update for Master Products management (list/edit/archive/reactivate).
 * Only supplied keys are written — undefined means "leave unchanged".
 */
export type UpdateMasterCatalogItemInput = Partial<
  Pick<
    MasterCatalogItem,
    | "sku"
    | "name"
    | "description"
    | "category"
    | "subcategory"
    | "brand"
    | "variantAttributes"
    | "stockUnit"
    | "receivingUnit"
    | "notes"
    | "status"
  >
>;

export type MasterProductStatusFilter = "active" | "archived" | "all";

export type ListMasterItemsOptions = {
  search?: string;
  category?: string;
  status?: MasterProductStatusFilter;
  limit?: number;
  offset?: number;
};

export type MasterItemsPage = {
  items: MasterCatalogItem[];
  total: number;
  limit: number;
  offset: number;
};

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
  /**
   * Paginated, searchable, filterable listing for the Master Products
   * management UI. Defaults to status "active" when not supplied.
   */
  listMasterItemsPage(options?: ListMasterItemsOptions): Promise<MasterItemsPage>;
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
  /**
   * Partial update for Master Products management. Returns null if no row
   * matches `id`. Never touches quantity/stock columns (there are none on
   * this table — quantities live on clinic_inventory_items).
   */
  updateMasterItem(
    id: string,
    input: UpdateMasterCatalogItemInput,
  ): Promise<MasterCatalogItem | null>;
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

    listMasterItemsPage(options: ListMasterItemsOptions = {}): Promise<MasterItemsPage> {
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
      const offset = Math.max(options.offset ?? 0, 0);
      const statusFilter = options.status ?? "active";

      let filtered = masterItems.slice();

      if (statusFilter !== "all") {
        filtered = filtered.filter((item) => item.status === statusFilter);
      }

      if (options.category) {
        const normalizedCategory = normaliseMasterProductText(options.category);
        filtered = filtered.filter(
          (item) => normaliseMasterProductText(item.category) === normalizedCategory,
        );
      }

      if (options.search) {
        const term = options.search.trim().toLowerCase();
        filtered = filtered.filter(
          (item) =>
            item.name.toLowerCase().includes(term) ||
            item.sku.toLowerCase().includes(term) ||
            item.category.toLowerCase().includes(term) ||
            (item.brand?.toLowerCase().includes(term) ?? false) ||
            (item.subcategory?.toLowerCase().includes(term) ?? false),
        );
      }

      filtered.sort((a, b) => a.name.localeCompare(b.name));

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit).map((item) => ({ ...item }));

      return Promise.resolve({ items: page, total, limit, offset });
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

    updateMasterItem(
      id: string,
      input: UpdateMasterCatalogItemInput,
    ): Promise<MasterCatalogItem | null> {
      const item = masterItems.find((entry) => entry.id === id);
      if (!item) return Promise.resolve(null);

      if (input.sku !== undefined) item.sku = input.sku;
      if (input.name !== undefined) item.name = input.name;
      if (input.description !== undefined) item.description = input.description;
      if (input.category !== undefined) item.category = input.category;
      if (input.subcategory !== undefined) item.subcategory = input.subcategory;
      if (input.brand !== undefined) item.brand = input.brand;
      if (input.variantAttributes !== undefined) item.variantAttributes = input.variantAttributes;
      if (input.stockUnit !== undefined) {
        item.stockUnit = input.stockUnit;
        item.unitOfMeasure = input.stockUnit;
      }
      if (input.receivingUnit !== undefined) item.receivingUnit = input.receivingUnit;
      if (input.notes !== undefined) item.notes = input.notes;
      if (input.status !== undefined) {
        item.status = input.status;
        item.isActive = input.status === "active";
      }
      item.updatedAt = new Date();

      return Promise.resolve({ ...item });
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
