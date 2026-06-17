import { z } from "zod";
import type { Request, Response } from "express";

import type { PurchaseOrderService } from "../services/purchaseOrderService.js";
import { AppError } from "../types/errors.js";

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
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${name}: must be a valid UUID`);
  }
  return result.data;
}

// ─── Body schema ──────────────────────────────────────────────────────────────

/**
 * The submit body accepts no fields.  .strict() ensures unrecognised keys
 * (including the now-removed supplierNote) are rejected with 400.
 */
const submitPoBodySchema = z.object({}).strict();

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

    async submitPurchaseOrder(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const parseResult = submitPoBodySchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", parseResult.error.message);
      }

      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");
      const poId = parseUuidParam(req.params.poId, "poId");

      const { purchaseOrder, lines } = await service.submitPurchaseOrder(
        clinicId,
        poId,
        req.user.id,
      );

      res.status(200).json({
        data: {
          purchaseOrder: {
            id: purchaseOrder.id,
            clinicId: purchaseOrder.clinicId,
            status: purchaseOrder.status,
            createdByUserId: purchaseOrder.createdByUserId,
            createdAt: purchaseOrder.createdAt.toISOString(),
            updatedAt: purchaseOrder.updatedAt.toISOString(),
          },
          lines,
        },
      });
    },

    async exportPurchaseOrdersCsv(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = parseUuidParam(req.params.clinicId, "clinicId");

      const { csv, filename } = await service.exportPurchaseOrdersCsv(
        clinicId,
        req.user.id,
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    },
  };
}

export type PurchaseOrderHandlers = ReturnType<typeof createPurchaseOrderHandlers>;
