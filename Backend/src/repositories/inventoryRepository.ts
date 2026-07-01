import { randomUUID } from "node:crypto";

import type {
  AdjustmentType,
  AdjustmentsPage,
  ClinicInventoryItem,
  ClinicInventoryItemView,
  DraftPoLine,
  DraftPurchaseOrder,
  InventoryAdjustment,
  InventoryPage,
  ProductSupplier,
} from "../types/inventory.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
} from "../types/purchaseOrderErrors.js";
import type { CatalogRepository } from "./catalogRepository.js";
import { buildClinicInventorySeed } from "./seed/inventorySeed.js";

export interface InventoryRepository {
  listClinicInventory(clinicId: string): Promise<ClinicInventoryItemView[]>;
  listClinicInventoryPage(
    clinicId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<InventoryPage>;
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
  listAdjustmentsPage(
    clinicId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<AdjustmentsPage>;
  /**
   * Returns a Map of masterCatalogItemId → total absolute units consumed for
   * adjustments of `options.type` recorded on or after `options.since`.
   *
   * This method pushes the type and date predicates directly to the storage
   * engine (SQL WHERE clause or in-memory filter) so the caller never needs to
   * pull an unbounded or capped adjustment list and filter it in application
   * memory.  The result type is intentionally a Map for O(1) per-SKU lookup
   * inside the forecasting algorithm.
   */
  getConsumptionVolume(
    clinicId: string,
    options: { type: AdjustmentType; since: Date },
  ): Promise<Map<string, number>>;
  findOrCreateDraftPo(
    clinicId: string,
    createdByUserId: string,
  ): Promise<DraftPurchaseOrder>;
  addDraftPoLine(
    line: Omit<DraftPoLine, "id" | "createdAt">,
  ): Promise<DraftPoLine>;
  listDraftPoLines(clinicId: string): Promise<DraftPoLine[]>;
  /** List all purchase orders for a clinic (any status). */
  listPurchaseOrders(clinicId: string): Promise<DraftPurchaseOrder[]>;
  /** Find a single PO by ID, scoped to the clinic for tenant safety. */
  findPurchaseOrderById(
    clinicId: string,
    poId: string,
  ): Promise<DraftPurchaseOrder | null>;
  /** Transition a draft PO to submitted status. Throws if not found or already submitted. */
  submitPurchaseOrder(
    clinicId: string,
    poId: string,
  ): Promise<DraftPurchaseOrder>;
  createClinicInventoryItem(
    item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<ClinicInventoryItem>;
  createProductSupplier(
    productSupplier: Omit<ProductSupplier, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProductSupplier>;
}

export function createInMemoryInventoryRepository(
  catalogRepository: CatalogRepository,
): InventoryRepository {
  const clinicInventory = buildClinicInventorySeed().map((item) => ({ ...item }));
  const productSuppliers: ProductSupplier[] = [];
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
    const preferredSupplier = productSuppliers.find(
      (supplier) =>
        supplier.clinicId === item.clinicId &&
        supplier.productId === item.masterCatalogItemId &&
        supplier.isPreferred &&
        supplier.active,
    );

    return {
      ...item,
      masterSku: master.sku,
      name: master.name,
      category: master.category,
      stockUnit: master.stockUnit,
      receivingUnit: master.receivingUnit,
      unitsPerReceivingUnit: master.unitsPerReceivingUnit,
      unitOfMeasure: master.stockUnit,
      unitCostCents,
      isBelowReorderPoint: item.quantityOnHand < item.reorderPoint,
      preferredSupplierId: preferredSupplier?.supplierId ?? null,
      preferredSupplierName: preferredSupplier?.supplierName ?? item.supplierPreference,
    };
  }

  return {
    async listClinicInventory(clinicId: string): Promise<ClinicInventoryItemView[]> {
      const items = clinicInventory.filter((entry) => entry.clinicId === clinicId);
      const views = await Promise.all(items.map((item) => toInventoryView(item)));

      return views.filter((view): view is ClinicInventoryItemView => view !== null);
    },

    async listClinicInventoryPage(
      clinicId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<InventoryPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const items = clinicInventory.filter((entry) => entry.clinicId === clinicId);
      const views = await Promise.all(items.map((item) => toInventoryView(item)));
      const filtered = views.filter((view): view is ClinicInventoryItemView => view !== null);
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      return { items: page, total, limit, offset };
    },

    findClinicInventoryItem(
      clinicId: string,
      itemId: string,
    ): Promise<ClinicInventoryItemView | null> {
      const item = clinicInventory.find(
        (entry) => entry.clinicId === clinicId && entry.id === itemId,
      );

      if (!item) {
        return Promise.resolve(null);
      }

      return toInventoryView(item);
    },

    findClinicInventoryByMasterItemId(
      clinicId: string,
      masterCatalogItemId: string,
    ): Promise<ClinicInventoryItem | null> {
      const item = clinicInventory.find(
        (entry) =>
          entry.clinicId === clinicId &&
          entry.masterCatalogItemId === masterCatalogItemId,
      );

      return Promise.resolve(item ? { ...item } : null);
    },

    updateQuantity(
      clinicId: string,
      itemId: string,
      newQuantity: number,
    ): Promise<ClinicInventoryItem> {
      const index = clinicInventory.findIndex(
        (entry) => entry.clinicId === clinicId && entry.id === itemId,
      );

      if (index === -1) {
        return Promise.reject(new Error(`Clinic inventory item not found: ${itemId}`));
      }

      const existing = clinicInventory[index];

      if (!existing) {
        return Promise.reject(new Error(`Clinic inventory item not found: ${itemId}`));
      }

      const updated: ClinicInventoryItem = {
        ...existing,
        quantityOnHand: newQuantity,
        updatedAt: new Date(),
      };

      clinicInventory[index] = updated;
      return Promise.resolve({ ...updated });
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

    listAdjustmentsPage(
      clinicId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<AdjustmentsPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const all = adjustments
        .filter((entry) => entry.clinicId === clinicId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = all.length;
      const page = all.slice(offset, offset + limit).map((entry) => ({ ...entry }));

      return Promise.resolve({ items: page, total, limit, offset });
    },

    getConsumptionVolume(
      clinicId: string,
      options: { type: AdjustmentType; since: Date },
    ): Promise<Map<string, number>> {
      const result = new Map<string, number>();

      for (const adj of adjustments) {
        if (adj.clinicId !== clinicId) continue;
        if (adj.adjustmentType !== options.type) continue;
        if (adj.createdAt < options.since) continue;

        const current = result.get(adj.masterCatalogItemId) ?? 0;
        result.set(adj.masterCatalogItemId, current + Math.abs(adj.quantityDelta));
      }

      return Promise.resolve(result);
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

    listPurchaseOrders(clinicId: string): Promise<DraftPurchaseOrder[]> {
      return Promise.resolve(
        draftOrders
          .filter((order) => order.clinicId === clinicId)
          .map((order) => ({ ...order }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
    },

    findPurchaseOrderById(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder | null> {
      const order = draftOrders.find(
        (o) => o.clinicId === clinicId && o.id === poId,
      );
      return Promise.resolve(order ? { ...order } : null);
    },

    submitPurchaseOrder(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder> {
      const index = draftOrders.findIndex(
        (o) => o.clinicId === clinicId && o.id === poId,
      );

      if (index === -1) {
        return Promise.reject(new PoNotFoundError(poId));
      }

      const existing = draftOrders[index];

      if (!existing) {
        return Promise.reject(new PoNotFoundError(poId));
      }

      if (existing.status !== "draft") {
        return Promise.reject(new PoAlreadySubmittedError());
      }

      const updated: DraftPurchaseOrder = {
        ...existing,
        status: "submitted",
        updatedAt: new Date(),
      };

      draftOrders[index] = updated;
      return Promise.resolve({ ...updated });
    },

    createClinicInventoryItem(
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
      return Promise.resolve({ ...record });
    },

    createProductSupplier(
      productSupplier: Omit<ProductSupplier, "id" | "createdAt" | "updatedAt">,
    ): Promise<ProductSupplier> {
      const now = new Date();
      if (productSupplier.isPreferred && productSupplier.active) {
        for (const existing of productSuppliers) {
          if (
            existing.clinicId === productSupplier.clinicId &&
            existing.productId === productSupplier.productId &&
            existing.active
          ) {
            existing.isPreferred = false;
            existing.updatedAt = now;
          }
        }
      }

      const record: ProductSupplier = {
        ...productSupplier,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      productSuppliers.push(record);
      return Promise.resolve({ ...record });
    },
  };
}
