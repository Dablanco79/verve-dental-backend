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
  PurchasingDraft,
  PurchasingDraftWithStatus,
} from "../types/inventory.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
  PoLineNotFoundError,
  PoInvalidTransitionError,
} from "../types/purchaseOrderErrors.js";
import { PO_VALID_TRANSITIONS } from "../types/inventory.js";
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
    options?: { limit?: number; itemId?: string },
  ): Promise<InventoryAdjustment[]>;
  listAdjustmentsPage(
    clinicId: string,
    options?: { limit?: number; offset?: number; itemId?: string },
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
  /** Create a manual purchase order draft with explicit header fields. */
  createManualPurchaseOrder(input: {
    clinicId: string;
    createdByUserId: string;
    supplierId: string | null;
    notes: string | null;
    poReference: string | null;
  }): Promise<DraftPurchaseOrder>;
  /** Update editable header fields on a draft PO. */
  updatePurchaseOrder(
    clinicId: string,
    poId: string,
    patch: {
      supplierId?: string | null;
      notes?: string | null;
      poReference?: string | null;
    },
  ): Promise<DraftPurchaseOrder>;
  addDraftPoLine(
    line: Omit<DraftPoLine, "id" | "createdAt" | "receivedQuantity">,
  ): Promise<DraftPoLine>;
  /** Update quantity and/or price on a single PO line. */
  updatePoLine(
    lineId: string,
    patch: {
      quantity?: number;
      unitCostCents?: number | null;
      receivingUnit?: string | null;
    },
  ): Promise<DraftPoLine>;
  /** Remove a line from a PO. */
  removePoLine(lineId: string): Promise<void>;
  /** Find a single PO line by its ID. */
  findPoLineById(lineId: string): Promise<DraftPoLine | null>;
  listDraftPoLines(clinicId: string): Promise<DraftPoLine[]>;
  /** List lines for a specific PO. */
  listPoLinesByPoId(poId: string): Promise<DraftPoLine[]>;
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
  /** Transition an eligible PO to cancelled status. */
  cancelPurchaseOrder(
    clinicId: string,
    poId: string,
  ): Promise<DraftPurchaseOrder>;
  /** Transition a submitted/partially-received PO to received or partially_received. */
  transitionPoStatus(
    clinicId: string,
    poId: string,
    toStatus: import("../types/inventory.js").DraftPoStatus,
  ): Promise<DraftPurchaseOrder>;
  /** Increment a PO line's cumulative received_quantity (for in-memory receiving path). */
  incrementPoLineReceivedQty(
    clinicId: string,
    lineId: string,
    delta: number,
  ): Promise<DraftPoLine>;
  createClinicInventoryItem(
    item: Omit<ClinicInventoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<ClinicInventoryItem>;
  createProductSupplier(
    productSupplier: Omit<ProductSupplier, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProductSupplier>;
  /**
   * List all ACTIVE product-supplier relationships for a given (clinic, master
   * catalog item) pair.  Used by checkSupplierCompatibility to apply the
   * product_suppliers decision layer before falling back to the supplier
   * catalogue (BLOCKER 1 resolution).
   */
  findActiveProductSuppliers(
    clinicId: string,
    masterCatalogItemId: string,
  ): Promise<ProductSupplier[]>;

  // ── Purchasing Drafts ─────────────────────────────────────────────────────

  /** Create a new Purchasing Draft and return it. */
  createPurchasingDraft(input: {
    clinicId: string;
    draftReference: string;
    createdByUserId: string;
  }): Promise<PurchasingDraft>;

  /** List all Purchasing Drafts for a clinic, with derived status + child POs. */
  listPurchasingDrafts(clinicId: string): Promise<PurchasingDraftWithStatus[]>;

  /** Find a single Purchasing Draft by ID, scoped to clinic. */
  findPurchasingDraftById(clinicId: string, pdId: string): Promise<PurchasingDraftWithStatus | null>;

  /** Create a manual draft PO linked to a parent Purchasing Draft. */
  createManualPurchaseOrderForDraft(input: {
    clinicId: string;
    createdByUserId: string;
    supplierId: string | null;
    notes: string | null;
    poReference: string | null;
    purchasingDraftId: string;
  }): Promise<DraftPurchaseOrder>;
}

export function createInMemoryInventoryRepository(
  catalogRepository: CatalogRepository,
): InventoryRepository {
  const clinicInventory = buildClinicInventorySeed().map((item) => ({ ...item }));
  const productSuppliers: ProductSupplier[] = [];
  const adjustments: InventoryAdjustment[] = [];
  const draftOrders: DraftPurchaseOrder[] = [];
  const draftPoLines: DraftPoLine[] = [];
  const purchasingDrafts: PurchasingDraft[] = [];

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

    // Compute in-draft and on-order quantities from active PO lines
    const conversionFactor = master.unitsPerReceivingUnit;
    const clinicOrderIds = new Set(
      draftOrders.filter((o) => o.clinicId === item.clinicId).map((o) => o.id),
    );
    const activeLines = draftPoLines.filter(
      (l) =>
        clinicOrderIds.has(l.draftPurchaseOrderId) &&
        l.clinicInventoryItemId === item.id,
    );

    let inDraftQuantity = 0;
    let onOrderQuantity = 0;
    const activePurchasingDocuments: ClinicInventoryItemView["activePurchasingDocuments"] = [];

    for (const line of activeLines) {
      const po = draftOrders.find((o) => o.id === line.draftPurchaseOrderId);
      if (!po) continue;
      const pd = po.purchasingDraftId
        ? purchasingDrafts.find((d) => d.id === po.purchasingDraftId) ?? null
        : null;
      const lineQtyInStockUnits = line.quantity * conversionFactor;
      const receivedQtyInStockUnits = line.receivedQuantity * conversionFactor;

      if (po.status === "draft") {
        inDraftQuantity += lineQtyInStockUnits;
      } else if (po.status === "submitted" || po.status === "partially_received") {
        onOrderQuantity += Math.max(0, lineQtyInStockUnits - receivedQtyInStockUnits);
      }

      if (po.status !== "received" && po.status !== "cancelled") {
        activePurchasingDocuments.push({
          poId: po.id,
          poReference: po.poReference,
          purchasingDraftId: po.purchasingDraftId,
          draftReference: pd?.draftReference ?? null,
          status: po.status,
          quantity: line.quantity,
          receivedQuantity: line.receivedQuantity,
        });
      }
    }

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
      inDraftQuantity,
      onOrderQuantity,
      activePurchasingDocuments,
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
      options?: { limit?: number; itemId?: string },
    ): Promise<InventoryAdjustment[]> {
      const limit = options?.limit ?? 50;
      const clinicAdjustments = adjustments
        .filter(
          (entry) =>
            entry.clinicId === clinicId &&
            (!options?.itemId || entry.clinicInventoryItemId === options.itemId),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((entry) => ({ ...entry }));

      return Promise.resolve(clinicAdjustments);
    },

    listAdjustmentsPage(
      clinicId: string,
      options?: { limit?: number; offset?: number; itemId?: string },
    ): Promise<AdjustmentsPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const all = adjustments
        .filter(
          (entry) =>
            entry.clinicId === clinicId &&
            (!options?.itemId || entry.clinicInventoryItemId === options.itemId),
        )
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
        supplierId: null,
        notes: null,
        poReference: null,
        purchasingDraftId: null,
        createdByUserId,
        createdAt: now,
        updatedAt: now,
      };

      draftOrders.push(order);
      return Promise.resolve({ ...order });
    },

    createManualPurchaseOrder(input: {
      clinicId: string;
      createdByUserId: string;
      supplierId: string | null;
      notes: string | null;
      poReference: string | null;
    }): Promise<DraftPurchaseOrder> {
      const now = new Date();
      const order: DraftPurchaseOrder = {
        id: randomUUID(),
        clinicId: input.clinicId,
        status: "draft",
        supplierId: input.supplierId,
        notes: input.notes,
        poReference: input.poReference,
        purchasingDraftId: null,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      };
      draftOrders.push(order);
      return Promise.resolve({ ...order });
    },

    createManualPurchaseOrderForDraft(input: {
      clinicId: string;
      createdByUserId: string;
      supplierId: string | null;
      notes: string | null;
      poReference: string | null;
      purchasingDraftId: string;
    }): Promise<DraftPurchaseOrder> {
      const now = new Date();
      const order: DraftPurchaseOrder = {
        id: randomUUID(),
        clinicId: input.clinicId,
        status: "draft",
        supplierId: input.supplierId,
        notes: input.notes,
        poReference: input.poReference,
        purchasingDraftId: input.purchasingDraftId,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      };
      draftOrders.push(order);
      return Promise.resolve({ ...order });
    },

    updatePurchaseOrder(
      clinicId: string,
      poId: string,
      patch: { supplierId?: string | null; notes?: string | null; poReference?: string | null },
    ): Promise<DraftPurchaseOrder> {
      const index = draftOrders.findIndex((o) => o.clinicId === clinicId && o.id === poId);
      if (index === -1) return Promise.reject(new PoNotFoundError(poId));
      const existing = draftOrders[index];
      if (!existing) return Promise.reject(new PoNotFoundError(poId));
      const updated: DraftPurchaseOrder = {
        ...existing,
        ...(patch.supplierId !== undefined && { supplierId: patch.supplierId }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.poReference !== undefined && { poReference: patch.poReference }),
        updatedAt: new Date(),
      };
      draftOrders[index] = updated;
      return Promise.resolve({ ...updated });
    },

    addDraftPoLine(
      line: Omit<DraftPoLine, "id" | "createdAt" | "receivedQuantity">,
    ): Promise<DraftPoLine> {
      const record: DraftPoLine = {
        receivedQuantity: 0,
        ...line,
        id: randomUUID(),
        createdAt: new Date(),
      };

      draftPoLines.push(record);
      return Promise.resolve({ ...record });
    },

    updatePoLine(
      lineId: string,
      patch: { quantity?: number; unitCostCents?: number | null; receivingUnit?: string | null },
    ): Promise<DraftPoLine> {
      const index = draftPoLines.findIndex((l) => l.id === lineId);
      if (index === -1) return Promise.reject(new PoLineNotFoundError(lineId));
      const existing = draftPoLines[index];
      if (!existing) return Promise.reject(new PoLineNotFoundError(lineId));
      const updated: DraftPoLine = {
        ...existing,
        ...(patch.quantity !== undefined && { quantity: patch.quantity }),
        ...(patch.unitCostCents !== undefined && { unitCostCents: patch.unitCostCents }),
        ...(patch.receivingUnit !== undefined && { receivingUnit: patch.receivingUnit }),
      };
      draftPoLines[index] = updated;
      return Promise.resolve({ ...updated });
    },

    removePoLine(lineId: string): Promise<void> {
      const index = draftPoLines.findIndex((l) => l.id === lineId);
      if (index === -1) return Promise.reject(new PoLineNotFoundError(lineId));
      draftPoLines.splice(index, 1);
      return Promise.resolve();
    },

    findPoLineById(lineId: string): Promise<DraftPoLine | null> {
      const line = draftPoLines.find((l) => l.id === lineId);
      return Promise.resolve(line ? { ...line } : null);
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

    listPoLinesByPoId(poId: string): Promise<DraftPoLine[]> {
      return Promise.resolve(
        draftPoLines
          .filter((line) => line.draftPurchaseOrderId === poId)
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

    cancelPurchaseOrder(
      clinicId: string,
      poId: string,
    ): Promise<DraftPurchaseOrder> {
      const index = draftOrders.findIndex((o) => o.clinicId === clinicId && o.id === poId);
      if (index === -1) return Promise.reject(new PoNotFoundError(poId));
      const existing = draftOrders[index];
      if (!existing) return Promise.reject(new PoNotFoundError(poId));
      const allowed = PO_VALID_TRANSITIONS[existing.status];
      if (!allowed.includes("cancelled")) {
        return Promise.reject(new PoInvalidTransitionError(existing.status, "cancelled"));
      }
      const updated: DraftPurchaseOrder = { ...existing, status: "cancelled", updatedAt: new Date() };
      draftOrders[index] = updated;
      return Promise.resolve({ ...updated });
    },

    transitionPoStatus(
      clinicId: string,
      poId: string,
      toStatus: import("../types/inventory.js").DraftPoStatus,
    ): Promise<DraftPurchaseOrder> {
      const index = draftOrders.findIndex((o) => o.clinicId === clinicId && o.id === poId);
      if (index === -1) return Promise.reject(new PoNotFoundError(poId));
      const existing = draftOrders[index];
      if (!existing) return Promise.reject(new PoNotFoundError(poId));
      const allowed = PO_VALID_TRANSITIONS[existing.status];
      if (!allowed.includes(toStatus)) {
        return Promise.reject(new PoInvalidTransitionError(existing.status, toStatus));
      }
      const updated: DraftPurchaseOrder = { ...existing, status: toStatus, updatedAt: new Date() };
      draftOrders[index] = updated;
      return Promise.resolve({ ...updated });
    },

    incrementPoLineReceivedQty(
      _clinicId: string,
      lineId: string,
      delta: number,
    ): Promise<DraftPoLine> {
      const index = draftPoLines.findIndex((l) => l.id === lineId);
      if (index === -1) return Promise.reject(new PoLineNotFoundError(lineId));
      const existing = draftPoLines[index];
      if (!existing) return Promise.reject(new PoLineNotFoundError(lineId));
      const updated: DraftPoLine = { ...existing, receivedQuantity: existing.receivedQuantity + delta };
      draftPoLines[index] = updated;
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

    findActiveProductSuppliers(
      clinicId: string,
      masterCatalogItemId: string,
    ): Promise<ProductSupplier[]> {
      const result = productSuppliers
        .filter(
          (ps) =>
            ps.clinicId === clinicId &&
            ps.productId === masterCatalogItemId &&
            ps.active,
        )
        .map((ps) => ({ ...ps }));
      return Promise.resolve(result);
    },

    createPurchasingDraft(input: {
      clinicId: string;
      draftReference: string;
      createdByUserId: string;
    }): Promise<PurchasingDraft> {
      const now = new Date();
      const pd: PurchasingDraft = {
        id: randomUUID(),
        clinicId: input.clinicId,
        draftReference: input.draftReference,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      };
      purchasingDrafts.push(pd);
      return Promise.resolve({ ...pd });
    },

    listPurchasingDrafts(clinicId: string): Promise<PurchasingDraftWithStatus[]> {
      const clinicDrafts = purchasingDrafts
        .filter((pd) => pd.clinicId === clinicId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const result: PurchasingDraftWithStatus[] = clinicDrafts.map((pd) => {
        const children = draftOrders.filter(
          (po) => po.clinicId === clinicId && po.purchasingDraftId === pd.id,
        );
        const derivedStatus = derivePurchasingDraftStatus(children.map((c) => c.status));
        const totalItems = children.reduce((sum, po) => {
          return sum + draftPoLines.filter((l) => l.draftPurchaseOrderId === po.id).length;
        }, 0);
        return {
          ...pd,
          derivedStatus,
          childPos: children.map((c) => ({ ...c })),
          totalItems,
          supplierCount: children.filter((c) => c.supplierId !== null).length,
        };
      });

      return Promise.resolve(result);
    },

    findPurchasingDraftById(clinicId: string, pdId: string): Promise<PurchasingDraftWithStatus | null> {
      const pd = purchasingDrafts.find((d) => d.clinicId === clinicId && d.id === pdId);
      if (!pd) return Promise.resolve(null);

      const children = draftOrders.filter(
        (po) => po.clinicId === clinicId && po.purchasingDraftId === pdId,
      );
      const derivedStatus = derivePurchasingDraftStatus(children.map((c) => c.status));
      const totalItems = children.reduce((sum, po) => {
        return sum + draftPoLines.filter((l) => l.draftPurchaseOrderId === po.id).length;
      }, 0);

      return Promise.resolve({
        ...pd,
        derivedStatus,
        childPos: children.map((c) => ({ ...c })),
        totalItems,
        supplierCount: children.filter((c) => c.supplierId !== null).length,
      });
    },
  };
}

/**
 * Derives a Purchasing Draft status from its child PO statuses.
 * Called by both in-memory and Postgres implementations.
 */
export function derivePurchasingDraftStatus(
  childStatuses: import("../types/inventory.js").DraftPoStatus[],
): import("../types/inventory.js").PurchasingDraftStatus {
  if (childStatuses.length === 0) return "draft";

  const nonCancelled = childStatuses.filter((s) => s !== "cancelled");
  if (nonCancelled.length === 0) return "cancelled";

  if (nonCancelled.every((s) => s === "received")) return "complete";
  if (nonCancelled.some((s) => s === "partially_received" || s === "received")) return "partially_received";
  if (nonCancelled.every((s) => s === "submitted")) return "ordered";
  if (nonCancelled.some((s) => s === "submitted")) return "partially_submitted";
  return "draft";
}
