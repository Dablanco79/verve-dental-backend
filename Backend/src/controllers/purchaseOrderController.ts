import { z } from "zod";
import type { Request, Response } from "express";

import type { PurchaseOrderService } from "../services/purchaseOrderService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Parameter validation ─────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

/**
 * Extract and validate a UUID route parameter.
 * Throws AppError(400) immediately for malformed values — the controller never
 * receives raw, un-validated route params.
 */
function parseUuidParam(raw: string | string[] | undefined, name: string): string {
  const value = typeof raw === "string" ? raw : (Array.isArray(raw) ? (raw[0] ?? "") : "");
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
      { field: name, message: `${name} must be a valid UUID` },
    ]);
  }
  return result.data;
}

// ─── Body schemas ─────────────────────────────────────────────────────────────

const submitPoBodySchema = z.object({}).strict();

const createPoBodySchema = z.object({
  // RULE 3 — Supplier is required for all new manual supplier POs.
  supplierId: z.string().uuid({ message: "supplierId must be a valid UUID" }),
  notes: z.string().max(2000).nullable().optional(),
  poReference: z.string().max(128).nullable().optional(),
});

const updatePoBodySchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  poReference: z.string().max(128).nullable().optional(),
});

const addPoLineBodySchema = z.object({
  masterCatalogItemId: z.string().uuid(),
  clinicInventoryItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(255).default("manual"),
  unitCostCents: z.number().int().min(0).nullable().optional(),
  receivingUnit: z.string().max(32).nullable().optional(),
});

const updatePoLineBodySchema = z.object({
  quantity: z.number().int().positive().optional(),
  unitCostCents: z.number().int().min(0).nullable().optional(),
  receivingUnit: z.string().max(32).nullable().optional(),
});

const receivePoBodySchema = z.object({
  lines: z.array(z.object({
    poLineId: z.string().uuid(),
    quantityDelta: z.number().int().positive(),
  })).min(1),
});

const poLineInputSchema = z.object({
  masterCatalogItemId: z.string().uuid(),
  clinicInventoryItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(255).optional(),
  unitCostCents: z.number().int().min(0).nullable().optional(),
  receivingUnit: z.string().max(32).nullable().optional(),
});

const createPoWithLinesBodySchema = z.object({
  supplierId: z.string().uuid("supplierId must be a valid UUID"),
  notes: z.string().max(2000).nullable().optional(),
  poReference: z.string().max(128).nullable().optional(),
  lines: z.array(poLineInputSchema).min(1),
});

const batchAddLinesBodySchema = z.object({
  lines: z.array(poLineInputSchema).min(1),
});

const supplierGroupSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().max(255).default("Unknown supplier"),
  lines: z.array(poLineInputSchema).min(1),
});

const createPurchasingDraftBodySchema = z.object({
  supplierGroups: z.array(supplierGroupSchema).min(1),
  notes: z.string().max(2000).nullable().optional(),
});

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createPurchaseOrderHandlers(service: PurchaseOrderService) {
  return {
    async listPurchaseOrders(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const lines = await service.listPurchaseOrders(clinicId);
      res.status(200).json({ data: lines });
    },

    async getPurchaseOrders(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const pos = await service.getPurchaseOrders(clinicId);
      res.status(200).json({ data: pos });
    },

    async getPurchaseOrderDetail(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const detail = await service.getPurchaseOrderDetail(clinicId, poId);
      res.status(200).json({ data: detail });
    },

    async createPurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const parseResult = createPoBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const po = await service.createManualPurchaseOrder(
        clinicId,
        req.user.id,
        req.user.email,
        {
          supplierId: parseResult.data.supplierId,
          notes: parseResult.data.notes ?? null,
          poReference: parseResult.data.poReference ?? null,
        },
      );
      res.status(201).json({ data: po });
    },

    async updatePurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const parseResult = updatePoBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const updated = await service.updatePurchaseOrder(
        clinicId,
        poId,
        req.user.id,
        req.user.email,
        parseResult.data,
      );
      res.status(200).json({ data: updated });
    },

    async submitPurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const parseResult = submitPoBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }

      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");

      const { purchaseOrder, lines } = await service.submitPurchaseOrder(
        clinicId,
        poId,
        req.user.id,
        req.user.email,
      );

      res.status(200).json({
        data: {
          purchaseOrder: {
            id: purchaseOrder.id,
            clinicId: purchaseOrder.clinicId,
            status: purchaseOrder.status,
            supplierId: purchaseOrder.supplierId,
            notes: purchaseOrder.notes,
            poReference: purchaseOrder.poReference,
            createdByUserId: purchaseOrder.createdByUserId,
            createdAt: purchaseOrder.createdAt.toISOString(),
            updatedAt: purchaseOrder.updatedAt.toISOString(),
          },
          lines,
        },
      });
    },

    async cancelPurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const updatedPo = await service.cancelPurchaseOrder(clinicId, poId, req.user.id, req.user.email);
      res.status(200).json({
        data: {
          id: updatedPo.id,
          status: updatedPo.status,
          updatedAt: updatedPo.updatedAt.toISOString(),
        },
      });
    },

    async addPoLine(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const parseResult = addPoLineBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const line = await service.addPoLine(
        clinicId,
        poId,
        req.user.id,
        req.user.email,
        {
          masterCatalogItemId: parseResult.data.masterCatalogItemId,
          clinicInventoryItemId: parseResult.data.clinicInventoryItemId,
          quantity: parseResult.data.quantity,
          reason: parseResult.data.reason,
          unitCostCents: parseResult.data.unitCostCents ?? null,
          receivingUnit: parseResult.data.receivingUnit ?? null,
        },
      );
      res.status(201).json({ data: line });
    },

    async updatePoLine(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const parseResult = updatePoLineBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const lineId = parseUuidParam(req.params.lineId, "lineId");
      const updated = await service.updatePoLine(
        clinicId,
        poId,
        lineId,
        req.user.id,
        req.user.email,
        parseResult.data,
      );
      res.status(200).json({ data: updated });
    },

    async removePoLine(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const lineId = parseUuidParam(req.params.lineId, "lineId");
      await service.removePoLine(clinicId, poId, lineId, req.user.id, req.user.email);
      res.status(204).send();
    },

    async receivePurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }
      const parseResult = receivePoBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const result = await service.receivePurchaseOrder(
        clinicId,
        poId,
        req.user.id,
        req.user.email,
        parseResult.data.lines,
      );
      res.status(200).json({ data: result });
    },

    async exportPurchaseOrdersCsv(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");

      const { csv, filename } = await service.exportPurchaseOrdersCsv(
        clinicId,
        req.user.id,
        req.user.email,
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    },

    async listPurchaseOrderHeaders(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const headers = await service.getPurchaseOrders(clinicId);
      res.status(200).json({ data: headers });
    },

    async createPurchaseOrderWithLines(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const parseResult = createPoWithLinesBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const detail = await service.createPurchaseOrderWithLines(
        clinicId, req.user.id, req.user.email, parseResult.data,
      );
      res.status(201).json({ data: detail });
    },

    async addLinesToPurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const parseResult = batchAddLinesBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");
      const detail = await service.addLinesToPurchaseOrder(
        clinicId, poId, req.user.id, req.user.email, parseResult.data.lines,
      );
      res.status(200).json({ data: detail });
    },

    // ── Purchasing Drafts ───────────────────────────────────────────────────

    async createPurchasingDraft(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const parseResult = createPurchasingDraftBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parseResult.error));
      }
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const result = await service.createPurchasingDraft(clinicId, req.user.id, req.user.email, {
        supplierGroups: parseResult.data.supplierGroups.map((g) => ({
          supplierId: g.supplierId ?? null,
          supplierName: g.supplierName,
          lines: g.lines,
        })),
        notes: parseResult.data.notes ?? null,
      });
      res.status(201).json({ data: result });
    },

    async listPurchasingDrafts(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const drafts = await service.listPurchasingDrafts(clinicId);
      res.status(200).json({ data: drafts });
    },

    async getPurchasingDraftDetail(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const pdId = parseUuidParam(req.params.pdId, "pdId");
      const detail = await service.getPurchasingDraftDetail(clinicId, pdId);
      res.status(200).json({ data: detail });
    },
  };
}

export type PurchaseOrderHandlers = ReturnType<typeof createPurchaseOrderHandlers>;
