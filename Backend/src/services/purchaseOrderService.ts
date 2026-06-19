import type { AuditService } from "./auditService.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import { AppError } from "../types/errors.js";
import {
  PoAlreadySubmittedError,
  PoNotFoundError,
} from "../types/purchaseOrderErrors.js";
import { toCsvField } from "../utils/csvUtils.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

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
  createdAt: Date;
};

async function enrichLines(
  lines: RawPoLine[],
  catalogRepository: CatalogRepository,
  poStatusMap: Map<string, "draft" | "submitted">,
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
    return {
      id: line.id,
      draftPurchaseOrderId: line.draftPurchaseOrderId,
      masterCatalogItemId: line.masterCatalogItemId,
      masterSku: catalogItem?.sku ?? "UNKNOWN",
      itemName: catalogItem?.name ?? "Unknown item",
      clinicInventoryItemId: line.clinicInventoryItemId,
      quantity: line.quantity,
      reason: line.reason,
      orderStatus: poStatusMap.get(line.draftPurchaseOrderId) ?? ("draft" as const),
      createdAt: line.createdAt.toISOString(),
    };
  });
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createPurchaseOrderService(
  inventoryRepository: InventoryRepository,
  catalogRepository: CatalogRepository,
  auditService: AuditService,
  auditWriter?: AuditWriter,
) {
  return {
    async listPurchaseOrders(clinicId: string) {
      const [pos, lines] = await Promise.all([
        inventoryRepository.listPurchaseOrders(clinicId),
        inventoryRepository.listDraftPoLines(clinicId),
      ]);

      const poStatusMap = new Map<string, "draft" | "submitted">(
        pos.map((po) => [po.id, po.status]),
      );

      return enrichLines(lines, catalogRepository, poStatusMap);
    },

    /**
     * Submit a draft purchase order.
     *
     * Race-safe: no pre-check before the UPDATE.  The repository's
     * submitPurchaseOrder performs the status transition atomically and throws
     * typed domain errors (PoNotFoundError / PoAlreadySubmittedError) so the
     * service can map them to the correct HTTP status without relying on
     * string-matched error messages.
     */
    async submitPurchaseOrder(clinicId: string, poId: string, userId: string) {
      let updatedPo;
      try {
        updatedPo = await inventoryRepository.submitPurchaseOrder(clinicId, poId);
      } catch (err: unknown) {
        if (err instanceof PoNotFoundError) {
          throw new AppError(404, "PO_NOT_FOUND", "Purchase order not found");
        }
        if (err instanceof PoAlreadySubmittedError) {
          throw new AppError(
            409,
            "PO_ALREADY_SUBMITTED",
            "Purchase order has already been submitted",
          );
        }
        auditService.logError("Unexpected error submitting purchase order", err);
        throw new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
      }

      auditService.logEvent("purchase_order.submitted", {
        userId,
        clinicId,
        resourceId: poId,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "purchase_order",
        entityId: poId,
        action: "submitted",
        actorId: userId,
        actorEmail: "",
        metadata: { poId },
      }).catch((err: unknown) => {
        auditService.logError("PO audit_events persistence failed (non-fatal)", err);
      });

      const allLines = await inventoryRepository.listDraftPoLines(clinicId);
      const poLines = allLines.filter((l) => l.draftPurchaseOrderId === updatedPo.id);
      const poStatusMap = new Map<string, "draft" | "submitted">([
        [updatedPo.id, updatedPo.status],
      ]);
      const enriched = await enrichLines(poLines, catalogRepository, poStatusMap);

      return { purchaseOrder: updatedPo, lines: enriched };
    },

    async exportPurchaseOrdersCsv(clinicId: string, userId: string) {
      const [pos, lines] = await Promise.all([
        inventoryRepository.listPurchaseOrders(clinicId),
        inventoryRepository.listDraftPoLines(clinicId),
      ]);

      const poStatusMap = new Map<string, "draft" | "submitted">(
        pos.map((po) => [po.id, po.status]),
      );

      const enriched = await enrichLines(lines, catalogRepository, poStatusMap);

      const header = [
        "Line ID",
        "PO ID",
        "SKU",
        "Item Name",
        "Qty Needed",
        "Trigger",
        "Status",
        "Created At",
      ].join(",");

      const rows = enriched.map((line) =>
        [
          toCsvField(line.id),
          toCsvField(line.draftPurchaseOrderId),
          toCsvField(line.masterSku),
          toCsvField(line.itemName),
          toCsvField(line.quantity),
          toCsvField(line.reason),
          toCsvField(line.orderStatus),
          toCsvField(line.createdAt),
        ].join(","),
      );

      const csv = [header, ...rows].join("\r\n");
      const filename = `purchase-orders-${clinicId}-${new Date().toISOString().slice(0, 10)}.csv`;

      auditService.logEvent("purchase_order.csv_exported", {
        userId,
        clinicId,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "purchase_order",
        entityId: clinicId,
        action: "csv_exported",
        actorId: userId,
        actorEmail: "",
        metadata: { filename, lineCount: rows.length },
      }).catch((err: unknown) => {
        auditService.logError("PO CSV audit_events persistence failed (non-fatal)", err);
      });

      return { csv, filename };
    },
  };
}

export type PurchaseOrderService = ReturnType<typeof createPurchaseOrderService>;
