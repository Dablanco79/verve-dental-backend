import type { AuditService } from "./auditService.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import { AppError } from "../types/errors.js";
import type { DraftPoStatus } from "../types/inventory.js";
import { PO_VALID_TRANSITIONS } from "../types/inventory.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
  PoInvalidTransitionError,
} from "../types/purchaseOrderErrors.js";
import { toCsvField } from "../utils/csvUtils.js";
import type { CreateAuditEventInput } from "../types/analytics.js";
import type { SupplierPricingEntry } from "../types/supplier.js";
import { withTenantContext } from "../db/tenantContext.js";
import type { DatabasePool } from "../db/pool.js";
import {
  lookupConversionFactor,
  receiveInventoryLine,
  resolveConversionFactorFromCatalogItem,
} from "./receivingEngine.js";

type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

// ─── Enrichment helper ────────────────────────────────────────────────────────

type RawPoLine = {
  id: string;
  draftPurchaseOrderId: string;
  masterCatalogItemId: string;
  clinicInventoryItemId: string;
  quantity: number;
  reason: string;
  unitCostCents?: number | null;
  receivingUnit?: string | null;
  receivedQuantity: number;
  createdAt: Date;
};

async function enrichLines(
  lines: RawPoLine[],
  catalogRepository: CatalogRepository,
  poStatusMap: Map<string, DraftPoStatus>,
) {
  const uniqueItemIds = [...new Set(lines.map((l) => l.masterCatalogItemId))];
  const catalogItems = await Promise.all(
    uniqueItemIds.map((id) => catalogRepository.findMasterItemById(id)),
  );
  const itemMap = new Map(
    catalogItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => [item.id, item]),
  );

  return lines.map((line) => {
    const catalogItem = itemMap.get(line.masterCatalogItemId);
    const receivedQty = line.receivedQuantity;
    return {
      id: line.id,
      draftPurchaseOrderId: line.draftPurchaseOrderId,
      masterCatalogItemId: line.masterCatalogItemId,
      masterSku: catalogItem?.sku ?? "UNKNOWN",
      itemName: catalogItem?.name ?? "Unknown item",
      clinicInventoryItemId: line.clinicInventoryItemId,
      quantity: line.quantity,
      receivedQuantity: receivedQty,
      outstandingQuantity: Math.max(0, line.quantity - receivedQty),
      reason: line.reason,
      unitCostCents: line.unitCostCents,
      receivingUnit: line.receivingUnit ?? catalogItem?.receivingUnit ?? null,
      stockUnit: catalogItem?.stockUnit ?? null,
      unitsPerReceivingUnit: catalogItem?.unitsPerReceivingUnit ?? null,
      orderStatus: poStatusMap.get(line.draftPurchaseOrderId) ?? ("draft" as const),
      createdAt: line.createdAt.toISOString(),
    };
  });
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

async function enrichWithCostEstimation(
  line: {
    id: string;
    masterCatalogItemId: string;
    quantity: number;
    [key: string]: unknown;
  },
  supplierCatalogueRepo: SupplierCatalogueRepository,
  supplierRepo: SupplierRepository,
): Promise<{
  supplierPricing: SupplierPricingEntry[];
  estimatedUnitCostCents: number | null;
  estimatedLineCostCents: number | null;
}> {
  const pricing = await supplierCatalogueRepo.listPricingForProduct(
    line.masterCatalogItemId,
  );

  if (pricing.length === 0) {
    return {
      supplierPricing: [],
      estimatedUnitCostCents: null,
      estimatedLineCostCents: null,
    };
  }

  // Resolve supplier names for all priced entries
  const supplierPricing: SupplierPricingEntry[] = await Promise.all(
    pricing.map(async (p) => {
      const supplier = await supplierRepo.findSupplierById(p.supplierId);
      return {
        supplierProductId: p.id,
        supplierId: p.supplierId,
        supplierName: supplier?.supplierName ?? "Unknown supplier",
        supplierCode: supplier?.supplierCode ?? null,
        unitCostCents: p.unitCostCents,
        supplierSku: p.supplierSku,
      };
    }),
  );

  // Only estimate when exactly one supplier has pricing — do not guess when
  // multiple options exist without a preferred-supplier selection in place.
  const singlePrice = pricing.length === 1 ? pricing[0] : null;
  const estimatedUnitCostCents = singlePrice?.unitCostCents ?? null;
  const estimatedLineCostCents =
    estimatedUnitCostCents !== null
      ? estimatedUnitCostCents * line.quantity
      : null;

  return { supplierPricing, estimatedUnitCostCents, estimatedLineCostCents };
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

function fireAudit(
  auditWriter: AuditWriter | undefined,
  auditService: AuditService,
  event: CreateAuditEventInput,
): void {
  auditWriter?.recordEvent(event).catch((err: unknown) => {
    auditService.logError("PO audit_events persistence failed (non-fatal)", err);
  });
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createPurchaseOrderService(
  inventoryRepository: InventoryRepository,
  catalogRepository: CatalogRepository,
  auditService: AuditService,
  auditWriter?: AuditWriter,
  supplierCatalogueRepository?: SupplierCatalogueRepository,
  supplierRepository?: SupplierRepository,
  pool?: DatabasePool,
) {
  // ─── Shared line enrichment ──────────────────────────────────────────────────

  async function enrichedLines(
    rawLines: RawPoLine[],
    poStatusMap: Map<string, DraftPoStatus>,
  ) {
    const enriched = await enrichLines(rawLines, catalogRepository, poStatusMap);
    if (!supplierCatalogueRepository || !supplierRepository) {
      return enriched.map((line) => ({
        ...line,
        supplierPricing: [],
        estimatedUnitCostCents: null,
        estimatedLineCostCents: null,
      }));
    }
    return Promise.all(
      enriched.map(async (line) => {
        const costData = await enrichWithCostEstimation(
          line,
          supplierCatalogueRepository,
          supplierRepository,
        );
        return { ...line, ...costData };
      }),
    );
  }

  return {
    async listPurchaseOrders(clinicId: string) {
      const [pos, lines] = await Promise.all([
        inventoryRepository.listPurchaseOrders(clinicId),
        inventoryRepository.listDraftPoLines(clinicId),
      ]);

      const poStatusMap = new Map<string, DraftPoStatus>(
        pos.map((po) => [po.id, po.status]),
      );

      // Also build a supplier map for each PO
      const poHeaderMap = new Map(pos.map((po) => [po.id, po]));

      const enriched = await enrichedLines(lines, poStatusMap);

      // Attach PO-level header fields (supplierId, notes, poReference) to each line
      return enriched.map((line) => {
        const header = poHeaderMap.get(line.draftPurchaseOrderId);
        return {
          ...line,
          poSupplierId: header?.supplierId ?? null,
          poNotes: header?.notes ?? null,
          poReference: header?.poReference ?? null,
        };
      });
    },

    async getPurchaseOrders(clinicId: string) {
      return inventoryRepository.listPurchaseOrders(clinicId);
    },

    async getPurchaseOrderDetail(clinicId: string, poId: string) {
      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");

      const rawLines = await inventoryRepository.listPoLinesByPoId(poId);
      const poStatusMap = new Map<string, DraftPoStatus>([[po.id, po.status]]);
      const lines = await enrichedLines(rawLines, poStatusMap);

      return { purchaseOrder: po, lines };
    },

    async createManualPurchaseOrder(
      clinicId: string,
      userId: string,
      actorEmail: string,
      input: {
        supplierId?: string | null;
        notes?: string | null;
        poReference?: string | null;
      },
    ) {
      const po = await inventoryRepository.createManualPurchaseOrder({
        clinicId,
        createdByUserId: userId,
        supplierId: input.supplierId ?? null,
        notes: input.notes ?? null,
        poReference: input.poReference ?? null,
      });

      auditService.logEvent("purchase_order.created", { userId, clinicId, resourceId: po.id });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: po.id,
        action: "created",
        actorId: userId,
        actorEmail,
        metadata: { supplierId: po.supplierId, poReference: po.poReference },
      });

      return po;
    },

    async updatePurchaseOrder(
      clinicId: string,
      poId: string,
      userId: string,
      actorEmail: string,
      patch: {
        supplierId?: string | null;
        notes?: string | null;
        poReference?: string | null;
      },
    ) {
      const existing = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!existing) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (existing.status !== "draft") {
        throw new AppError(
          409,
          "PO_NOT_EDITABLE",
          `Purchase order in '${existing.status}' status cannot be edited`,
        );
      }

      const updated = await inventoryRepository.updatePurchaseOrder(clinicId, poId, patch);

      auditService.logEvent("purchase_order.updated", { userId, clinicId, resourceId: poId });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "updated",
        actorId: userId,
        actorEmail,
        metadata: patch,
      });

      return updated;
    },

    async addPoLine(
      clinicId: string,
      poId: string,
      userId: string,
      actorEmail: string,
      input: {
        masterCatalogItemId: string;
        clinicInventoryItemId: string;
        quantity: number;
        reason?: string;
        unitCostCents?: number | null;
        receivingUnit?: string | null;
      },
    ) {
      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (po.status !== "draft") {
        throw new AppError(
          409,
          "PO_NOT_EDITABLE",
          `Purchase order in '${po.status}' status cannot be edited`,
        );
      }

      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new AppError(400, "VALIDATION_ERROR", "Quantity must be a positive whole number");
      }

      // Prevent duplicate product lines — consolidate with existing line if present
      const existingLines = await inventoryRepository.listPoLinesByPoId(poId);
      const duplicate = existingLines.find(
        (l) => l.masterCatalogItemId === input.masterCatalogItemId,
      );
      if (duplicate) {
        const merged = await inventoryRepository.updatePoLine(duplicate.id, {
          quantity: duplicate.quantity + input.quantity,
          unitCostCents: input.unitCostCents ?? duplicate.unitCostCents,
          receivingUnit: input.receivingUnit ?? duplicate.receivingUnit,
        });

        auditService.logEvent("purchase_order.line_updated", { userId, clinicId, resourceId: poId });
        fireAudit(auditWriter, auditService, {
          clinicId,
          entityType: "purchase_order",
          entityId: poId,
          action: "line_updated",
          actorId: userId,
          actorEmail,
          metadata: { lineId: duplicate.id, mergedQuantity: merged.quantity },
        });

        return merged;
      }

      const line = await inventoryRepository.addDraftPoLine({
        draftPurchaseOrderId: poId,
        masterCatalogItemId: input.masterCatalogItemId,
        clinicInventoryItemId: input.clinicInventoryItemId,
        quantity: input.quantity,
        reason: input.reason ?? "manual",
        unitCostCents: input.unitCostCents ?? null,
        receivingUnit: input.receivingUnit ?? null,
      });

      auditService.logEvent("purchase_order.line_added", { userId, clinicId, resourceId: poId });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "line_added",
        actorId: userId,
        actorEmail,
        metadata: { lineId: line.id },
      });

      return line;
    },

    async updatePoLine(
      clinicId: string,
      poId: string,
      lineId: string,
      userId: string,
      actorEmail: string,
      patch: {
        quantity?: number;
        unitCostCents?: number | null;
        receivingUnit?: string | null;
      },
    ) {
      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (po.status !== "draft") {
        throw new AppError(
          409,
          "PO_NOT_EDITABLE",
          `Purchase order in '${po.status}' status cannot be edited`,
        );
      }

      if (patch.quantity !== undefined && (!Number.isInteger(patch.quantity) || patch.quantity <= 0)) {
        throw new AppError(400, "VALIDATION_ERROR", "Quantity must be a positive whole number");
      }

      const line = await inventoryRepository.findPoLineById(lineId);
      if (!line || line.draftPurchaseOrderId !== poId) {
        throw new AppError(404, "PO_LINE_NOT_FOUND", "Purchase order line not found");
      }

      const updated = await inventoryRepository.updatePoLine(lineId, patch);

      auditService.logEvent("purchase_order.line_updated", { userId, clinicId, resourceId: poId });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "line_updated",
        actorId: userId,
        actorEmail,
        metadata: { lineId, ...patch },
      });

      return updated;
    },

    async removePoLine(
      clinicId: string,
      poId: string,
      lineId: string,
      userId: string,
      actorEmail: string,
    ) {
      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (po.status !== "draft") {
        throw new AppError(
          409,
          "PO_NOT_EDITABLE",
          `Purchase order in '${po.status}' status cannot be edited`,
        );
      }

      const line = await inventoryRepository.findPoLineById(lineId);
      if (!line || line.draftPurchaseOrderId !== poId) {
        throw new AppError(404, "PO_LINE_NOT_FOUND", "Purchase order line not found");
      }

      await inventoryRepository.removePoLine(lineId);

      auditService.logEvent("purchase_order.line_removed", { userId, clinicId, resourceId: poId });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "line_removed",
        actorId: userId,
        actorEmail,
        metadata: { lineId },
      });
    },

    /**
     * Submit a draft purchase order.
     *
     * Race-safe: no pre-check before the UPDATE.  The repository's
     * submitPurchaseOrder performs the status transition atomically and throws
     * typed domain errors (PoNotFoundError / PoAlreadySubmittedError) so the
     * service can map them to the correct HTTP status without relying on
     * string-matched error messages.
     *
     * Now also validates supplier and lines before transitioning.
     */
    async submitPurchaseOrder(clinicId: string, poId: string, userId: string, actorEmail: string) {
      // Validate: PO must have a supplier and at least one line
      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (po.status !== "draft") {
        if (po.status === "submitted") {
          throw new AppError(409, "PO_ALREADY_SUBMITTED", "Purchase order has already been submitted");
        }
        throw new AppError(409, "PO_INVALID_TRANSITION", `Cannot submit a purchase order in '${po.status}' status`);
      }

      if (!po.supplierId) {
        throw new AppError(400, "PO_NO_SUPPLIER", "A supplier must be selected before submitting");
      }

      const lines = await inventoryRepository.listPoLinesByPoId(poId);
      if (lines.length === 0) {
        throw new AppError(400, "PO_NO_LINES", "At least one line must be added before submitting");
      }

      let updatedPo;
      try {
        updatedPo = await inventoryRepository.submitPurchaseOrder(clinicId, poId);
      } catch (err: unknown) {
        if (err instanceof PoNotFoundError) {
          throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
        }
        if (err instanceof PoAlreadySubmittedError) {
          throw new AppError(409, "PO_ALREADY_SUBMITTED", "Purchase order has already been submitted");
        }
        auditService.logError("Unexpected error submitting purchase order", err);
        throw new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
      }

      auditService.logEvent("purchase_order.submitted", {
        userId,
        clinicId,
        resourceId: poId,
      });

      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "submitted",
        actorId: userId,
        actorEmail,
        metadata: { poId },
      });

      const allLines = await inventoryRepository.listPoLinesByPoId(poId);
      const poStatusMap = new Map<string, DraftPoStatus>([[updatedPo.id, updatedPo.status]]);
      const enrichedPoLines = await enrichedLines(allLines, poStatusMap);

      return { purchaseOrder: updatedPo, lines: enrichedPoLines };
    },

    async cancelPurchaseOrder(
      clinicId: string,
      poId: string,
      userId: string,
      actorEmail: string,
    ) {
      let updatedPo;
      try {
        updatedPo = await inventoryRepository.cancelPurchaseOrder(clinicId, poId);
      } catch (err: unknown) {
        if (err instanceof PoNotFoundError) {
          throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
        }
        if (err instanceof PoInvalidTransitionError) {
          throw new AppError(
            409,
            "PO_INVALID_TRANSITION",
            `Cannot cancel a purchase order in '${err.fromStatus}' status`,
          );
        }
        auditService.logError("Unexpected error cancelling purchase order", err);
        throw new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
      }

      auditService.logEvent("purchase_order.cancelled", { userId, clinicId, resourceId: poId });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "cancelled",
        actorId: userId,
        actorEmail,
        metadata: { poId },
      });

      return updatedPo;
    },

    /**
     * Receive items against a submitted or partially-received purchase order.
     *
     * PostgreSQL path: executes atomically inside withTenantContext with row
     * locking (FOR UPDATE) to prevent concurrent over-receipt.
     *
     * In-memory path: pre-validates all quantities before any mutation.
     *
     * Request lines identify PO lines by poLineId. The backend resolves the
     * linked clinicInventoryItemId — the frontend never supplies ordered or
     * outstanding quantities.
     */
    async receivePurchaseOrder(
      clinicId: string,
      poId: string,
      userId: string,
      actorEmail: string,
      receivingLines: Array<{
        poLineId: string;
        quantityDelta: number;
      }>,
    ) {
      // ── Input validation (before any DB access) ──────────────────────────────
      if (receivingLines.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one receiving line is required");
      }
      for (const rl of receivingLines) {
        if (!Number.isInteger(rl.quantityDelta) || rl.quantityDelta <= 0) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            `quantityDelta must be a positive integer (poLineId: ${rl.poLineId})`,
          );
        }
      }

      if (pool) {
        return executeAtomicPoReceivingPg(clinicId, poId, userId, actorEmail, receivingLines);
      }
      return executeInMemoryPoReceiving(clinicId, poId, userId, actorEmail, receivingLines);
    },

    async exportPurchaseOrdersCsv(clinicId: string, userId: string, actorEmail: string) {
      const [pos, lines] = await Promise.all([
        inventoryRepository.listPurchaseOrders(clinicId),
        inventoryRepository.listDraftPoLines(clinicId),
      ]);

      const poStatusMap = new Map<string, DraftPoStatus>(
        pos.map((po) => [po.id, po.status]),
      );

      const enriched = await enrichLines(lines, catalogRepository, poStatusMap);

      const header = [
        "Line ID",
        "PO ID",
        "PO Reference",
        "SKU",
        "Item Name",
        "Qty Needed",
        "Trigger",
        "Status",
        "Created At",
      ].join(",");

      const poHeaderMap = new Map(pos.map((po) => [po.id, po]));

      const rows = enriched.map((line) => {
        const poHeader = poHeaderMap.get(line.draftPurchaseOrderId);
        return [
          toCsvField(line.id),
          toCsvField(line.draftPurchaseOrderId),
          toCsvField(poHeader?.poReference ?? ""),
          toCsvField(line.masterSku),
          toCsvField(line.itemName),
          toCsvField(line.quantity),
          toCsvField(line.reason),
          toCsvField(line.orderStatus),
          toCsvField(line.createdAt),
        ].join(",");
      });

      const csv = [header, ...rows].join("\r\n");
      const filename = `purchase-orders-${clinicId}-${new Date().toISOString().slice(0, 10)}.csv`;

      auditService.logEvent("purchase_order.csv_exported", {
        userId,
        clinicId,
      });

      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchase_order",
        entityId: clinicId,
        action: "csv_exported",
        actorId: userId,
        actorEmail,
        metadata: { filename, lineCount: rows.length },
      });

      return { csv, filename };
    },

    // ── Batch-create: PO header + lines in one request ────────────────────────
    async createPurchaseOrderWithLines(
      clinicId: string,
      userId: string,
      actorEmail: string,
      input: {
        supplierId?: string | null;
        notes?: string | null;
        poReference?: string | null;
        lines: Array<{
          masterCatalogItemId: string;
          clinicInventoryItemId: string;
          quantity: number;
          reason?: string;
          unitCostCents?: number | null;
          receivingUnit?: string | null;
        }>;
      },
    ) {
      if (input.lines.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one line is required");
      }
      for (const l of input.lines) {
        if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
          throw new AppError(400, "VALIDATION_ERROR", "All line quantities must be positive whole numbers");
        }
      }

      if (pool) {
        return executeAtomicCreatePoWithLinesPg(clinicId, userId, actorEmail, input);
      }

      // In-memory path (non-atomic; used for tests).
      const po = await inventoryRepository.createManualPurchaseOrder({
        clinicId,
        createdByUserId: userId,
        supplierId: input.supplierId ?? null,
        notes: input.notes ?? null,
        poReference: input.poReference ?? null,
      });
      auditService.logEvent("purchase_order.created", { userId, clinicId, resourceId: po.id });
      fireAudit(auditWriter, auditService, {
        clinicId, entityType: "purchase_order", entityId: po.id,
        action: "created", actorId: userId, actorEmail,
        metadata: { supplierId: po.supplierId, poReference: po.poReference },
      });

      const rawLines: RawPoLine[] = [];
      for (const l of input.lines) {
        const line = await inventoryRepository.addDraftPoLine({
          draftPurchaseOrderId: po.id,
          masterCatalogItemId: l.masterCatalogItemId,
          clinicInventoryItemId: l.clinicInventoryItemId,
          quantity: l.quantity,
          reason: l.reason ?? "low_stock",
          unitCostCents: l.unitCostCents ?? null,
          receivingUnit: l.receivingUnit ?? null,
        });
        rawLines.push(line);
        auditService.logEvent("purchase_order.line_added", { userId, clinicId, resourceId: po.id });
      }

      const poStatusMap = new Map<string, DraftPoStatus>([[po.id, po.status]]);
      const enriched = await enrichedLines(rawLines, poStatusMap);
      return { purchaseOrder: po, lines: enriched };
    },

    // ── Purchasing Draft: parent concept containing multiple supplier POs ────────

    /**
     * Generate a shared numeric suffix for a Purchasing Draft and its child POs.
     * Format: PD-YYYYMMDD-NNNN (parent) / PO-YYYYMMDD-NNNN-01 (first child)
     */

    async createPurchasingDraft(
      clinicId: string,
      userId: string,
      actorEmail: string,
      input: {
        supplierGroups: Array<{
          supplierId: string | null;
          supplierName: string;
          lines: Array<{
            masterCatalogItemId: string;
            clinicInventoryItemId: string;
            quantity: number;
            reason?: string;
            unitCostCents?: number | null;
            receivingUnit?: string | null;
          }>;
        }>;
        notes?: string | null;
      },
    ) {
      if (input.supplierGroups.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one supplier group with lines is required");
      }
      for (const group of input.supplierGroups) {
        if (group.lines.length === 0) {
          throw new AppError(400, "VALIDATION_ERROR", "Each supplier group must have at least one line");
        }
        for (const l of group.lines) {
          if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
            throw new AppError(400, "VALIDATION_ERROR", "All line quantities must be positive whole numbers");
          }
        }
      }

      // Generate shared numeric suffix for reference linking
      const d = new Date();
      const datePart = `${String(d.getFullYear())}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const numericSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      const draftReference = `PD-${datePart}-${numericSuffix}`;

      // Create the parent Purchasing Draft
      const pd = await inventoryRepository.createPurchasingDraft({
        clinicId,
        draftReference,
        createdByUserId: userId,
      });

      auditService.logEvent("purchasing_draft.created", { userId, clinicId, resourceId: pd.id });
      fireAudit(auditWriter, auditService, {
        clinicId,
        entityType: "purchasing_draft",
        entityId: pd.id,
        action: "created",
        actorId: userId,
        actorEmail,
        metadata: { draftReference, supplierGroupCount: input.supplierGroups.length },
      });

      // Create one child supplier PO per group
      const childPoDetails: Array<{ purchaseOrder: { id: string; poReference: string | null }; lines: unknown[] }> = [];

      for (let i = 0; i < input.supplierGroups.length; i++) {
        const group = input.supplierGroups[i];
        if (!group) continue;
        const childIndex = String(i + 1).padStart(2, "0");
        const childPoReference = `PO-${datePart}-${numericSuffix}-${childIndex}`;

        const childPo = await inventoryRepository.createManualPurchaseOrderForDraft({
          clinicId,
          createdByUserId: userId,
          supplierId: group.supplierId,
          notes: input.notes ?? null,
          poReference: childPoReference,
          purchasingDraftId: pd.id,
        });

        auditService.logEvent("purchase_order.created", { userId, clinicId, resourceId: childPo.id });
        fireAudit(auditWriter, auditService, {
          clinicId,
          entityType: "purchase_order",
          entityId: childPo.id,
          action: "created",
          actorId: userId,
          actorEmail,
          metadata: {
            purchasingDraftId: pd.id,
            draftReference,
            poReference: childPoReference,
            supplierId: group.supplierId,
          },
        });

        const rawLines: RawPoLine[] = [];
        for (const l of group.lines) {
          const line = await inventoryRepository.addDraftPoLine({
            draftPurchaseOrderId: childPo.id,
            masterCatalogItemId: l.masterCatalogItemId,
            clinicInventoryItemId: l.clinicInventoryItemId,
            quantity: l.quantity,
            reason: l.reason ?? "low_stock",
            unitCostCents: l.unitCostCents ?? null,
            receivingUnit: l.receivingUnit ?? null,
          });
          rawLines.push(line);
          auditService.logEvent("purchase_order.line_added", { userId, clinicId, resourceId: childPo.id });
        }

        const poStatusMap = new Map<string, DraftPoStatus>([[childPo.id, childPo.status]]);
        const enrichedPoLines = await enrichedLines(rawLines, poStatusMap);
        childPoDetails.push({ purchaseOrder: { id: childPo.id, poReference: childPoReference }, lines: enrichedPoLines });
      }

      return { purchasingDraft: pd, childPos: childPoDetails };
    },

    async listPurchasingDrafts(clinicId: string) {
      return inventoryRepository.listPurchasingDrafts(clinicId);
    },

    async getPurchasingDraftDetail(clinicId: string, pdId: string) {
      const pd = await inventoryRepository.findPurchasingDraftById(clinicId, pdId);
      if (!pd) throw new AppError(404, "PD_NOT_FOUND", "Purchasing draft not found");

      // Load full line detail for each child PO
      const childPoDetails = await Promise.all(
        pd.childPos.map(async (po) => {
          const rawLines = await inventoryRepository.listPoLinesByPoId(po.id);
          const poStatusMap = new Map<string, DraftPoStatus>([[po.id, po.status]]);
          const lines = await enrichedLines(rawLines, poStatusMap);
          return { purchaseOrder: po, lines };
        }),
      );

      return { purchasingDraft: pd, childPos: childPoDetails };
    },

    // ── Batch-add lines to an existing draft PO ───────────────────────────────
    async addLinesToPurchaseOrder(
      clinicId: string,
      poId: string,
      userId: string,
      actorEmail: string,
      lines: Array<{
        masterCatalogItemId: string;
        clinicInventoryItemId: string;
        quantity: number;
        reason?: string;
        unitCostCents?: number | null;
        receivingUnit?: string | null;
      }>,
    ) {
      if (lines.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one line is required");
      }
      for (const l of lines) {
        if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
          throw new AppError(400, "VALIDATION_ERROR", "All line quantities must be positive whole numbers");
        }
      }

      const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (po.status !== "draft") {
        throw new AppError(
          409, "PO_NOT_EDITABLE",
          `Purchase order in '${po.status}' status cannot be edited`,
        );
      }

      if (pool) {
        return executeAtomicAddLinesPg(clinicId, poId, userId, actorEmail, lines);
      }

      // In-memory path: add each line with duplicate consolidation.
      const existingLines = await inventoryRepository.listPoLinesByPoId(poId);

      for (const l of lines) {
        const duplicate = existingLines.find(
          (el) => el.masterCatalogItemId === l.masterCatalogItemId,
        );
        if (duplicate) {
          const merged = await inventoryRepository.updatePoLine(duplicate.id, {
            quantity: duplicate.quantity + l.quantity,
            unitCostCents: l.unitCostCents ?? duplicate.unitCostCents,
            receivingUnit: l.receivingUnit ?? duplicate.receivingUnit,
          });
          const idx = existingLines.findIndex((el) => el.id === duplicate.id);
          if (idx >= 0) existingLines[idx] = merged;
        } else {
          const line = await inventoryRepository.addDraftPoLine({
            draftPurchaseOrderId: poId,
            masterCatalogItemId: l.masterCatalogItemId,
            clinicInventoryItemId: l.clinicInventoryItemId,
            quantity: l.quantity,
            reason: l.reason ?? "low_stock",
            unitCostCents: l.unitCostCents ?? null,
            receivingUnit: l.receivingUnit ?? null,
          });
          existingLines.push(line);
          auditService.logEvent("purchase_order.line_added", { userId, clinicId, resourceId: poId });
          fireAudit(auditWriter, auditService, {
            clinicId, entityType: "purchase_order", entityId: poId,
            action: "line_added", actorId: userId, actorEmail,
            metadata: { masterCatalogItemId: l.masterCatalogItemId },
          });
        }
      }

      const updatedPo = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
      const allLines = await inventoryRepository.listPoLinesByPoId(poId);
      const poStatusMap = new Map<string, DraftPoStatus>([[poId, updatedPo?.status ?? "draft"]]);
      const enriched = await enrichedLines(allLines, poStatusMap);
      return { purchaseOrder: updatedPo ?? po, lines: enriched };
    },
  };

  // ── Internal: PostgreSQL atomic PO receiving ──────────────────────────────────

  /**
   * Executes PO receiving atomically inside a single PostgreSQL transaction.
   *
   * Transaction boundary (via withTenantContext):
   *   BEGIN
   *   SET LOCAL app.current_clinic_id + app.owner_admin_mode
   *   SELECT … FROM draft_purchase_orders FOR UPDATE       (lock PO row)
   *   SELECT … FROM draft_po_lines WHERE … FOR UPDATE      (lock all PO lines)
   *   For each requested line:
   *     validate poLineId belongs to this PO
   *     compute outstanding = quantity - received_quantity
   *     reject if quantityDelta > outstanding
   *     SELECT … FROM clinic_inventory_items FOR UPDATE    (lock inventory row)
   *     UPDATE clinic_inventory_items SET quantity_on_hand
   *     INSERT INTO inventory_adjustments
   *     UPDATE draft_po_lines SET received_quantity = received_quantity + delta
   *   Derive new PO status from updated line quantities
   *   UPDATE draft_purchase_orders SET status
   *   INSERT INTO audit_events
   *   COMMIT
   *
   * Any error → ROLLBACK: inventory, PO, and receipt state remain consistent.
   * The FOR UPDATE on the PO row serialises concurrent receive requests:
   *   - first request locks the PO, validates and proceeds
   *   - concurrent request blocks until first COMMITs or ROLLBACKs
   *   - after commit: second request sees updated received_quantity and is
   *     correctly rejected if over-receipt would result
   */
  async function executeAtomicPoReceivingPg(
    clinicId: string,
    poId: string,
    userId: string,
    actorEmail: string,
    receivingLines: Array<{ poLineId: string; quantityDelta: number }>,
  ) {
    if (!pool) {
      throw new AppError(500, "INTERNAL_ERROR", "Database pool is required for transactional PO receiving");
    }

    type PoRow = {
      id: string; clinic_id: string; status: string;
      supplier_id: string | null; po_reference: string | null;
      notes: string | null; created_by_user_id: string;
      created_at: Date; updated_at: Date;
    };
    type PoLineRow = {
      id: string; draft_purchase_order_id: string;
      master_catalog_item_id: string; clinic_inventory_item_id: string;
      quantity: number; reason: string;
      unit_cost_cents: number | null; receiving_unit: string | null;
      received_quantity: number; created_at: Date;
    };

    const isOwnerAdmin = true;

    return withTenantContext(pool, clinicId, async (client) => {
      // ── 1. Lock PO row and validate lifecycle ─────────────────────────────
      const { rows: poRows } = await client.query<PoRow>(
        `SELECT id, clinic_id, status, supplier_id, po_reference,
                notes, created_by_user_id, created_at, updated_at
         FROM draft_purchase_orders
         WHERE id = $1 AND clinic_id = $2
         FOR UPDATE`,
        [poId, clinicId],
      );
      if (!poRows[0]) {
        throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      }
      const poRow = poRows[0];
      if (poRow.status !== "submitted" && poRow.status !== "partially_received") {
        throw new AppError(
          409,
          "PO_INVALID_TRANSITION",
          `Cannot receive against a purchase order in '${poRow.status}' status`,
        );
      }

      // ── 2. Lock all PO lines for this PO ─────────────────────────────────
      const { rows: lineRows } = await client.query<PoLineRow>(
        `SELECT id, draft_purchase_order_id, master_catalog_item_id,
                clinic_inventory_item_id, quantity, reason,
                unit_cost_cents, receiving_unit, received_quantity, created_at
         FROM draft_po_lines
         WHERE draft_purchase_order_id = $1
         FOR UPDATE`,
        [poId],
      );
      const lineMap = new Map(lineRows.map((l) => [l.id, l]));

      // ── 3. Validate each requested line ───────────────────────────────────
      for (const rl of receivingLines) {
        const line = lineMap.get(rl.poLineId);
        if (!line) {
          throw new AppError(
            422,
            "PO_LINE_NOT_FOUND",
            `PO line not found or does not belong to this purchase order: ${rl.poLineId}`,
          );
        }
        const outstanding = line.quantity - line.received_quantity;
        if (rl.quantityDelta > outstanding) {
          throw new AppError(
            422,
            "OVER_RECEIPT",
            `Cannot receive ${String(rl.quantityDelta)} for line ${rl.poLineId}: only ${String(outstanding)} outstanding`,
          );
        }
      }

      // ── 4. Process each line: resolve unit conversion, adjust inventory, update received_qty ─
      const reason = `Stock received | PO: ${poRow.po_reference ?? poId}`;
      const adjustments = [];

      for (const rl of receivingLines) {
        const poLine = lineMap.get(rl.poLineId);
        if (!poLine) continue;

        // Resolve conversion factor from master_catalog_items.
        // Uses the PO line's receiving_unit if set; falls back to catalog default.
        const { conversionFactor } = await lookupConversionFactor(
          client,
          poLine.master_catalog_item_id,
          poLine.receiving_unit,
        );

        // Delegate inventory locking, mutation, and adjustment recording to the
        // shared receiving engine (with unit conversion applied).
        const adjustment = await receiveInventoryLine(client, clinicId, {
          clinicInventoryItemId: poLine.clinic_inventory_item_id,
          quantityDeltaInReceivingUnits: rl.quantityDelta,
          conversionFactor,
          reason,
          performedByUserId: userId,
          performedByEmail: actorEmail,
          referenceId: poId,
        });
        adjustments.push(adjustment);

        // Update cumulative received_quantity on the PO line (in receiving/ordering units).
        await client.query(
          `UPDATE draft_po_lines
           SET received_quantity = received_quantity + $1
           WHERE id = $2`,
          [rl.quantityDelta, rl.poLineId],
        );
        poLine.received_quantity += rl.quantityDelta;
      }

      // ── 5. Derive new PO status from durable line data ────────────────────
      // Re-read updated values from lineMap (already updated in step 4).
      const allLinesFullyReceived = lineRows.every(
        (l) => l.received_quantity >= l.quantity,
      );
      const anyLineReceived = lineRows.some((l) => l.received_quantity > 0);

      let newStatus: DraftPoStatus;
      if (allLinesFullyReceived) {
        newStatus = "received";
      } else if (anyLineReceived) {
        newStatus = "partially_received";
      } else {
        newStatus = "partially_received";
      }

      // Validate transition is allowed.
      const allowed = PO_VALID_TRANSITIONS[poRow.status as DraftPoStatus];
      if (!allowed.includes(newStatus)) {
        throw new AppError(409, "PO_INVALID_TRANSITION",
          `Status transition from ${poRow.status} to ${newStatus} is not permitted`);
      }

      // Update PO status.
      const { rows: updatedPoRows } = await client.query<PoRow>(
        `UPDATE draft_purchase_orders
         SET status = $1, updated_at = now()
         WHERE id = $2 AND clinic_id = $3
         RETURNING *`,
        [newStatus, poId, clinicId],
      );
      const updatedPoRow = updatedPoRows[0];
      if (!updatedPoRow) throw new AppError(500, "INTERNAL_ERROR", "Failed to update PO status");

      // ── 6. Insert audit event inside the transaction ───────────────────────
      const auditAction = newStatus === "received"
        ? "purchase_order.received"
        : "purchase_order.partially_received";
      await client.query(
        `INSERT INTO audit_events
           (clinic_id, entity_type, entity_id, action, actor_id, actor_email, metadata)
         VALUES ($1, 'purchase_order', $2, $3, $4, $5, $6)`,
        [
          clinicId,
          poId,
          auditAction,
          userId,
          actorEmail,
          JSON.stringify({ newStatus, linesReceived: receivingLines.length }),
        ],
      );

      const updatedPo = {
        id: updatedPoRow.id,
        clinicId: updatedPoRow.clinic_id,
        status: updatedPoRow.status as DraftPoStatus,
        supplierId: updatedPoRow.supplier_id,
        notes: updatedPoRow.notes,
        poReference: updatedPoRow.po_reference,
        createdByUserId: updatedPoRow.created_by_user_id,
        createdAt: updatedPoRow.created_at,
        updatedAt: updatedPoRow.updated_at,
      };

      return { purchaseOrder: updatedPo, adjustments };
    }, isOwnerAdmin);
  }

  // ── Internal: in-memory PO receiving (test path) ─────────────────────────────

  /**
   * In-memory receiving for the test environment (no pool).
   *
   * Pre-validates ALL lines before any mutation. Mutations are sequential
   * and effectively atomic in the single-threaded JS model.
   */
  async function executeInMemoryPoReceiving(
    clinicId: string,
    poId: string,
    userId: string,
    actorEmail: string,
    receivingLines: Array<{ poLineId: string; quantityDelta: number }>,
  ) {
    const po = await inventoryRepository.findPurchaseOrderById(clinicId, poId);
    if (!po) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");

    if (po.status !== "submitted" && po.status !== "partially_received") {
      throw new AppError(409, "PO_INVALID_TRANSITION",
        `Cannot receive against a purchase order in '${po.status}' status`);
    }

    const allPoLines = await inventoryRepository.listPoLinesByPoId(poId);
    const lineMap = new Map(allPoLines.map((l) => [l.id, l]));

    // Pre-validate all lines before any mutation.
    for (const rl of receivingLines) {
      const line = lineMap.get(rl.poLineId);
      if (!line) {
        throw new AppError(422, "PO_LINE_NOT_FOUND",
          `PO line not found: ${rl.poLineId}`);
      }
      const outstanding = line.quantity - line.receivedQuantity;
      if (rl.quantityDelta > outstanding) {
        throw new AppError(422, "OVER_RECEIPT",
          `Cannot receive ${String(rl.quantityDelta)} for line ${rl.poLineId}: only ${String(outstanding)} outstanding`);
      }
      const item = await inventoryRepository.findClinicInventoryItem(clinicId, line.clinicInventoryItemId);
      if (!item) {
        throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND",
          `Inventory item not found: ${line.clinicInventoryItemId}`);
      }
    }

    const reason = `Stock received | PO: ${po.poReference ?? poId}`;
    const adjustments = [];

    // Apply mutations with unit conversion.
    for (const rl of receivingLines) {
      const line = lineMap.get(rl.poLineId);
      if (!line) continue;

      const item = await inventoryRepository.findClinicInventoryItem(clinicId, line.clinicInventoryItemId);
      if (!item) continue;

      // Resolve conversion factor from the master catalog item.
      const masterItem = await catalogRepository.findMasterItemById(line.masterCatalogItemId);
      if (!masterItem) {
        throw new AppError(404, "CATALOG_ITEM_NOT_FOUND",
          `Master catalog item not found: ${line.masterCatalogItemId}`);
      }
      const { conversionFactor } = resolveConversionFactorFromCatalogItem(
        masterItem,
        line.receivingUnit ?? null,
      );

      const quantityBefore = item.quantityOnHand;
      const stockQtyDelta = rl.quantityDelta * conversionFactor;
      const quantityAfter = quantityBefore + stockQtyDelta;

      await inventoryRepository.updateQuantity(clinicId, line.clinicInventoryItemId, quantityAfter);
      const adjustment = await inventoryRepository.recordAdjustment({
        clinicId,
        clinicInventoryItemId: line.clinicInventoryItemId,
        masterCatalogItemId: line.masterCatalogItemId,
        adjustmentType: "receive",
        quantityDelta: stockQtyDelta,
        quantityBefore,
        quantityAfter,
        reason,
        performedByUserId: userId,
        performedByEmail: actorEmail,
        referenceId: poId,
      });
      adjustments.push(adjustment);

      // Update cumulative received_quantity (in receiving/ordering units).
      await inventoryRepository.incrementPoLineReceivedQty(clinicId, rl.poLineId, rl.quantityDelta);
      line.receivedQuantity += rl.quantityDelta;
    }

    // Derive PO status from updated line data.
    const updatedLines = await inventoryRepository.listPoLinesByPoId(poId);
    const allFullyReceived = updatedLines.every((l) => l.receivedQuantity >= l.quantity);
    const newStatus: DraftPoStatus = allFullyReceived ? "received" : "partially_received";
    const updatedPo = await inventoryRepository.transitionPoStatus(clinicId, poId, newStatus);

    const inMemAuditAction = newStatus === "received"
      ? "purchase_order.received"
      : "purchase_order.partially_received";
    auditService.logEvent(inMemAuditAction, { userId, clinicId, resourceId: poId });
    fireAudit(auditWriter, auditService, {
      clinicId,
      entityType: "purchase_order",
      entityId: poId,
      action: newStatus === "received" ? "received" : "partially_received",
      actorId: userId,
      actorEmail,
      metadata: { newStatus, linesReceived: receivingLines.length },
    });

    return { purchaseOrder: updatedPo, adjustments };
  }

  // ── Internal: PostgreSQL atomic create PO with lines ─────────────────────────

  type BatchLineInput = {
    masterCatalogItemId: string;
    clinicInventoryItemId: string;
    quantity: number;
    reason?: string;
    unitCostCents?: number | null;
    receivingUnit?: string | null;
  };

  async function executeAtomicCreatePoWithLinesPg(
    clinicId: string,
    userId: string,
    actorEmail: string,
    input: {
      supplierId?: string | null;
      notes?: string | null;
      poReference?: string | null;
      lines: BatchLineInput[];
    },
  ) {
    if (!pool) {
      throw new AppError(500, "INTERNAL_ERROR", "Database pool is required for transactional PO creation");
    }
    return withTenantContext(pool, clinicId, async (client) => {
      type PoRow = {
        id: string; clinic_id: string; status: string; supplier_id: string | null;
        po_reference: string | null; notes: string | null; created_by_user_id: string;
        created_at: Date; updated_at: Date;
      };
      type LineRow = {
        id: string; draft_purchase_order_id: string; master_catalog_item_id: string;
        clinic_inventory_item_id: string; quantity: number; received_quantity: number;
        reason: string; unit_cost_cents: number | null; receiving_unit: string | null;
        created_at: Date;
      };

      const poResult = await client.query<PoRow>(
        `INSERT INTO draft_purchase_orders
           (clinic_id, status, supplier_id, po_reference, notes, created_by_user_id)
         VALUES ($1, 'draft', $2, $3, $4, $5)
         RETURNING *`,
        [clinicId, input.supplierId ?? null, input.poReference ?? null, input.notes ?? null, userId],
      );
      const pr = poResult.rows[0];
      if (!pr) throw new AppError(500, "INTERNAL_ERROR", "Failed to create purchase order");
      const poId = pr.id;

      const rawLines: RawPoLine[] = [];
      for (const l of input.lines) {
        const lineResult = await client.query<LineRow>(
          `INSERT INTO draft_po_lines
             (draft_purchase_order_id, master_catalog_item_id, clinic_inventory_item_id,
              quantity, received_quantity, reason, unit_cost_cents, receiving_unit)
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
           RETURNING *`,
          [poId, l.masterCatalogItemId, l.clinicInventoryItemId,
           l.quantity, l.reason ?? "low_stock", l.unitCostCents ?? null, l.receivingUnit ?? null],
        );
        const lr = lineResult.rows[0];
        if (!lr) throw new AppError(500, "INTERNAL_ERROR", "Failed to insert PO line");
        rawLines.push({
          id: lr.id,
          draftPurchaseOrderId: lr.draft_purchase_order_id,
          masterCatalogItemId: lr.master_catalog_item_id,
          clinicInventoryItemId: lr.clinic_inventory_item_id,
          quantity: lr.quantity,
          reason: lr.reason,
          unitCostCents: lr.unit_cost_cents,
          receivingUnit: lr.receiving_unit,
          receivedQuantity: lr.received_quantity,
          createdAt: lr.created_at,
        });
      }

      const po = {
        id: pr.id, clinicId: pr.clinic_id,
        status: pr.status as DraftPoStatus,
        supplierId: pr.supplier_id, poReference: pr.po_reference,
        notes: pr.notes, createdByUserId: pr.created_by_user_id,
        createdAt: pr.created_at, updatedAt: pr.updated_at,
      };

      await client.query(
        `INSERT INTO audit_events
           (clinic_id, entity_type, entity_id, action, actor_id, actor_email, metadata)
         VALUES ($1, 'purchase_order', $2, 'created', $3, $4, $5)`,
        [clinicId, poId, userId, actorEmail,
         JSON.stringify({ supplierId: input.supplierId, poReference: input.poReference })],
      );

      auditService.logEvent("purchase_order.created", { userId, clinicId, resourceId: poId });
      const poStatusMap = new Map<string, DraftPoStatus>([[po.id, po.status]]);
      const enriched = await enrichedLines(rawLines, poStatusMap);
      return { purchaseOrder: po, lines: enriched };
    });
  }

  // ── Internal: PostgreSQL atomic batch-add lines to existing PO ───────────────

  async function executeAtomicAddLinesPg(
    clinicId: string,
    poId: string,
    userId: string,
    actorEmail: string,
    lines: BatchLineInput[],
  ) {
    if (!pool) {
      throw new AppError(500, "INTERNAL_ERROR", "Database pool is required for transactional line addition");
    }
    return withTenantContext(pool, clinicId, async (client) => {
      type ExistingLineRow = {
        id: string; master_catalog_item_id: string; quantity: number;
        unit_cost_cents: number | null; receiving_unit: string | null;
      };
      type PoRow = {
        id: string; clinic_id: string; status: string; supplier_id: string | null;
        po_reference: string | null; notes: string | null; created_by_user_id: string;
        created_at: Date; updated_at: Date;
      };

      // Lock PO and verify status.
      const lockedResult = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM draft_purchase_orders WHERE id = $1 AND clinic_id = $2 FOR UPDATE`,
        [poId, clinicId],
      );
      const lockedPo = lockedResult.rows[0];
      if (!lockedPo) throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
      if (lockedPo.status !== "draft") {
        throw new AppError(409, "PO_NOT_EDITABLE",
          `Purchase order in '${lockedPo.status}' status cannot be edited`);
      }

      // Load existing lines to handle duplicates.
      const existingResult = await client.query<ExistingLineRow>(
        `SELECT id, master_catalog_item_id, quantity, unit_cost_cents, receiving_unit
         FROM draft_po_lines WHERE draft_purchase_order_id = $1`,
        [poId],
      );
      const existingRows = existingResult.rows;

      for (const l of lines) {
        const dup = existingRows.find((r) => r.master_catalog_item_id === l.masterCatalogItemId);
        if (dup) {
          await client.query(
            `UPDATE draft_po_lines
               SET quantity = quantity + $1,
                   unit_cost_cents = COALESCE($2, unit_cost_cents),
                   receiving_unit  = COALESCE($3, receiving_unit)
             WHERE id = $4`,
            [l.quantity, l.unitCostCents ?? null, l.receivingUnit ?? null, dup.id],
          );
          dup.quantity += l.quantity;
        } else {
          const insertResult = await client.query<{ id: string }>(
            `INSERT INTO draft_po_lines
               (draft_purchase_order_id, master_catalog_item_id, clinic_inventory_item_id,
                quantity, received_quantity, reason, unit_cost_cents, receiving_unit)
             VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
             RETURNING id`,
            [poId, l.masterCatalogItemId, l.clinicInventoryItemId,
             l.quantity, l.reason ?? "low_stock", l.unitCostCents ?? null, l.receivingUnit ?? null],
          );
          const insertedLine = insertResult.rows[0];
          if (!insertedLine) throw new AppError(500, "INTERNAL_ERROR", "Failed to insert PO line");
          existingRows.push({
            id: insertedLine.id,
            master_catalog_item_id: l.masterCatalogItemId,
            quantity: l.quantity,
            unit_cost_cents: l.unitCostCents ?? null,
            receiving_unit: l.receivingUnit ?? null,
          });
          await client.query(
            `INSERT INTO audit_events
               (clinic_id, entity_type, entity_id, action, actor_id, actor_email, metadata)
             VALUES ($1, 'purchase_order', $2, 'line_added', $3, $4, $5)`,
            [clinicId, poId, userId, actorEmail,
             JSON.stringify({ masterCatalogItemId: l.masterCatalogItemId })],
          );
          auditService.logEvent("purchase_order.line_added", { userId, clinicId, resourceId: poId });
        }
      }

      // Reload final state.
      const updatedPoResult = await client.query<PoRow>(
        `SELECT id, clinic_id, status, supplier_id, po_reference, notes, created_by_user_id, created_at, updated_at
         FROM draft_purchase_orders WHERE id = $1`,
        [poId],
      );
      const updatedPoRow = updatedPoResult.rows[0];
      if (!updatedPoRow) throw new AppError(500, "INTERNAL_ERROR", "Failed to reload purchase order");
      const updatedPo = {
        id: updatedPoRow.id, clinicId: updatedPoRow.clinic_id,
        status: updatedPoRow.status as DraftPoStatus,
        supplierId: updatedPoRow.supplier_id, poReference: updatedPoRow.po_reference,
        notes: updatedPoRow.notes, createdByUserId: updatedPoRow.created_by_user_id,
        createdAt: updatedPoRow.created_at, updatedAt: updatedPoRow.updated_at,
      };

      const { rows: finalLineRows } = await client.query<{
        id: string; draft_purchase_order_id: string; master_catalog_item_id: string;
        clinic_inventory_item_id: string; quantity: number; received_quantity: number;
        reason: string; unit_cost_cents: number | null; receiving_unit: string | null;
        created_at: Date;
      }>(
        `SELECT id, draft_purchase_order_id, master_catalog_item_id, clinic_inventory_item_id,
                quantity, received_quantity, reason, unit_cost_cents, receiving_unit, created_at
         FROM draft_po_lines WHERE draft_purchase_order_id = $1`,
        [poId],
      );
      const rawLines: RawPoLine[] = finalLineRows.map((r) => ({
        id: r.id,
        draftPurchaseOrderId: r.draft_purchase_order_id,
        masterCatalogItemId: r.master_catalog_item_id,
        clinicInventoryItemId: r.clinic_inventory_item_id,
        quantity: r.quantity,
        reason: r.reason,
        unitCostCents: r.unit_cost_cents,
        receivingUnit: r.receiving_unit,
        receivedQuantity: r.received_quantity,
        createdAt: r.created_at,
      }));

      const poStatusMap = new Map<string, DraftPoStatus>([[poId, updatedPo.status]]);
      const enriched = await enrichedLines(rawLines, poStatusMap);
      return { purchaseOrder: updatedPo, lines: enriched };
    });
  }
}


export type PurchaseOrderService = ReturnType<typeof createPurchaseOrderService>;