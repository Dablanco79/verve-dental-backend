import { randomUUID } from "node:crypto";

import type {
  ClinicInventoryItem,
  ClinicInventoryItemView,
  DraftPoLine,
  DraftPurchaseOrder,
  InventoryAdjustment,
} from "../types/inventory.js";
import type { CatalogRepository } from "./catalogRepository.js";
import { buildClinicInventorySeed } from "./seed/inventorySeed.js";

export interface InventoryRepository {
  listClinicInventory(clinicId: string): Promise<ClinicInventoryItemView[]>;
  findClinicInventoryItem(
    clinicId: string,
    itemId: string,
  ): Promise<ClinicInventoryItemView | null>;
  findClinicInventoryByMasterItemId(
    clinicId: string,
    masterCatalogItemId: string,
  ): Promise<ClinicInventoryItem | null>;
  updateQuantity(
    clinicId: string,
    itemId: string,
    newQuantity: number,
  ): Promise<ClinicInventoryItem>;
  recordAdjustment(
    adjustment: Omit<InventoryAdjustment, "id" | "createdAt">,
  ): Promise<InventoryAdjustment>;
  listAdjustments(
    clinicId: string,
    options?: { limit?: number },
  ): Promise<InventoryAdjustment[]>;
  findOrCreateDraftPo(
    clinicId: string,
    createdByUserId: string,
  ): Promise<DraftPurchaseOrder>;
  addDraftPoLine(
    line: Omit<DraftPoLine, "id" | "createdAt">,
  ): Promise<DraftPoLine>;
  listDraftPoLines(clinicId: string): Promise<DraftPoLine[]>;
  createClinicInventoryItem(
    item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<ClinicInventoryItem>;
}

export function createInMemoryInventoryRepository(
  catalogRepository: CatalogRepository,
): InventoryRepository {
  const clinicInventory = buildClinicInventorySeed().map((item) => ({ ...item }));
  const adjustments: InventoryAdjustment[] = [];
  const draftOrders: DraftPurchaseOrder[] = [];
  const draftPoLines: DraftPoLine[] = [];

  async function toInventoryView(
    item: ClinicInventoryItem,
  ): Promise<ClinicInventoryItemView | null> {
    const master = await catalogRepository.findMasterItemById(item.masterCatalogItemId);

    if (!master) {
      return null;
    }

    const unitCostCents = item.unitCostOverrideCents ?? master.defaultUnitCostCents;

    return {
      ...item,
      masterSku: master.sku,
      name: master.name,
      category: master.category,
      unitOfMeasure: master.unitOfMeasure,
      unitCostCents,
      isBelowReorderPoint: item.quantityOnHand < item.reorderPoint,
    };
  }

  return {
    async listClinicInventory(clinicId: string): Promise<ClinicInventoryItemView[]> {
      const items = clinicInventory.filter((entry) => entry.clinicId === clinicId);
      const views = await Promise.all(items.map((item) => toInventoryView(item)));

      return views.filter((view): view is ClinicInventoryItemView => view !== null);
    },

    async findClinicInventoryItem(
      clinicId: string,
      itemId: string,
    ): Promise<ClinicInventoryItemView | null> {
      const item = clinicInventory.find(
        (entry) => entry.clinicId === clinicId && entry.id === itemId,
      );

      if (!item) {
        return null;
      }

      return toInventoryView(item);
    },

    async findClinicInventoryByMasterItemId(
      clinicId: string,
      masterCatalogItemId: string,
    ): Promise<ClinicInventoryItem | null> {
      const item = clinicInventory.find(
        (entry) =>
          entry.clinicId === clinicId &&
          entry.masterCatalogItemId === masterCatalogItemId,
      );

      return item ? { ...item } : null;
    },

    async updateQuantity(
      clinicId: string,
      itemId: string,
      newQuantity: number,
    ): Promise<ClinicInventoryItem> {
      const index = clinicInventory.findIndex(
        (entry) => entry.clinicId === clinicId && entry.id === itemId,
      );

      if (index === -1) {
        throw new Error(`Clinic inventory item not found: ${itemId}`);
      }

      const existing = clinicInventory[index];

      if (!existing) {
        throw new Error(`Clinic inventory item not found: ${itemId}`);
      }

      const updated: ClinicInventoryItem = {
        ...existing,
        quantityOnHand: newQuantity,
        updatedAt: new Date(),
      };

      clinicInventory[index] = updated;
      return { ...updated };
    },

    recordAdjustment(
      adjustment: Omit<InventoryAdjustment, "id" | "createdAt">,
    ): Promise<InventoryAdjustment> {
      const record: InventoryAdjustment = {
        ...adjustment,
        id: randomUUID(),
        createdAt: new Date(),
      };

      adjustments.push(record);
      return Promise.resolve({ ...record });
    },

    listAdjustments(
      clinicId: string,
      options?: { limit?: number },
    ): Promise<InventoryAdjustment[]> {
      const limit = options?.limit ?? 50;
      const clinicAdjustments = adjustments
        .filter((entry) => entry.clinicId === clinicId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((entry) => ({ ...entry }));

      return Promise.resolve(clinicAdjustments);
    },

    findOrCreateDraftPo(
      clinicId: string,
      createdByUserId: string,
    ): Promise<DraftPurchaseOrder> {
      const existing = draftOrders.find(
        (order) => order.clinicId === clinicId && order.status === "draft",
      );

      if (existing) {
        return Promise.resolve({ ...existing });
      }

      const now = new Date();
      const order: DraftPurchaseOrder = {
        id: randomUUID(),
        clinicId,
        status: "draft",
        createdByUserId,
        createdAt: now,
        updatedAt: now,
      };

      draftOrders.push(order);
      return Promise.resolve({ ...order });
    },

    addDraftPoLine(
      line: Omit<DraftPoLine, "id" | "createdAt">,
    ): Promise<DraftPoLine> {
      const record: DraftPoLine = {
        ...line,
        id: randomUUID(),
        createdAt: new Date(),
      };

      draftPoLines.push(record);
      return Promise.resolve({ ...record });
    },

    listDraftPoLines(clinicId: string): Promise<DraftPoLine[]> {
      const orderIds = new Set(
        draftOrders
          .filter((order) => order.clinicId === clinicId)
          .map((order) => order.id),
      );

      return Promise.resolve(
        draftPoLines
          .filter((line) => orderIds.has(line.draftPurchaseOrderId))
          .map((line) => ({ ...line })),
      );
    },

    async createClinicInventoryItem(
      item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">,
    ): Promise<ClinicInventoryItem> {
      const now = new Date();
      const record: ClinicInventoryItem = {
        ...item,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      clinicInventory.push(record);
      return { ...record };
    },
  };
}
