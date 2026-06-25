import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { SupplierContractPriceService } from "../services/supplierContractPriceService.js";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createPriceSchema = z
  .object({
    masterCatalogItemId: z.string().uuid(),
    priceType: z.enum(["contract", "promotional"]).optional(),
    unitPriceCents: z.number().int().positive(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable().optional(),
    minimumQuantity: z.number().int().min(1).nullable().optional(),
    maximumQuantity: z.number().int().min(1).nullable().optional(),
    currencyCode: z.string().trim().length(3).toUpperCase().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

const updatePriceSchema = z
  .object({
    priceType: z.enum(["contract", "promotional"]).optional(),
    unitPriceCents: z.number().int().positive().optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().nullable().optional(),
    minimumQuantity: z.number().int().min(1).nullable().optional(),
    maximumQuantity: z.number().int().min(1).nullable().optional(),
    currencyCode: z.string().trim().length(3).toUpperCase().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializePrice(p: {
  id: string;
  supplierContractId: string;
  masterCatalogItemId: string;
  priceType: string;
  unitPriceCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  currencyCode: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    supplierContractId: p.supplierContractId,
    masterCatalogItemId: p.masterCatalogItemId,
    priceType: p.priceType,
    unitPriceCents: p.unitPriceCents,
    effectiveFrom: p.effectiveFrom.toISOString(),
    effectiveTo: p.effectiveTo?.toISOString() ?? null,
    minimumQuantity: p.minimumQuantity,
    maximumQuantity: p.maximumQuantity,
    currencyCode: p.currencyCode,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createSupplierContractPriceHandlers(
  service: SupplierContractPriceService,
) {
  return {
    /**
     * GET /supplier-contracts/:contractId/prices
     */
    async listByContract(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { contractId } = req.params as { contractId: string };
      const prices = await service.listByContract(req.user, contractId);
      res.status(200).json({ data: prices.map(serializePrice) });
    },

    /**
     * GET /supplier-contract-prices/:id
     */
    async getById(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const price = await service.getById(req.user, id);
      res.status(200).json({ data: serializePrice(price) });
    },

    /**
     * POST /supplier-contracts/:contractId/prices
     */
    async create(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { contractId } = req.params as { contractId: string };
      const input = parseBody(createPriceSchema, req.body);
      const price = await service.create(req.user, contractId, input);
      res.status(201).json({ data: serializePrice(price) });
    },

    /**
     * PATCH /supplier-contract-prices/:id
     */
    async update(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const input = parseBody(updatePriceSchema, req.body);
      const price = await service.update(req.user, id, input);
      res.status(200).json({ data: serializePrice(price) });
    },

    /**
     * POST /supplier-contract-prices/:id/expire
     * Soft-expires the price by setting effective_to to today.
     */
    async expire(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const price = await service.expire(req.user, id);
      res.status(200).json({ data: serializePrice(price) });
    },
  };
}
