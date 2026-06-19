import { z } from "zod";
import type { Request, Response } from "express";

import type { SupplierService } from "../services/supplierService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const supplierIdSchema = z.string().uuid("supplierId must be a valid UUID");

const createSupplierBodySchema = z.object({
  supplierName: z.string().min(1, "supplierName is required").max(200),
  supplierCode: z.string().max(50).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url("Invalid URL").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSupplierBodySchema = z.object({
  supplierName: z.string().min(1).max(200).optional(),
  supplierCode: z.string().max(50).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url("Invalid URL").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
}).strict();

const listSuppliersQuerySchema = z.object({
  active: z
    .string()
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
});

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createSupplierHandlers(service: SupplierService) {
  return {
    async listSuppliers(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const queryResult = listSuppliersQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(queryResult.error),
        );
      }

      const suppliers = await service.listSuppliers({
        active: queryResult.data.active,
      });

      res.status(200).json({ data: suppliers.map(serializeSupplier) });
    },

    async getSupplier(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const idResult = supplierIdSchema.safeParse(req.params.supplierId);
      if (!idResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const supplier = await service.getSupplier(idResult.data);
      res.status(200).json({ data: serializeSupplier(supplier) });
    },

    async createSupplier(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const bodyResult = createSupplierBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const supplier = await service.createSupplier(
        bodyResult.data,
        req.user.id,
      );
      res.status(201).json({ data: serializeSupplier(supplier) });
    },

    async updateSupplier(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const idResult = supplierIdSchema.safeParse(req.params.supplierId);
      if (!idResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const bodyResult = updateSupplierBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const supplier = await service.updateSupplier(
        idResult.data,
        bodyResult.data,
        req.user.id,
      );
      res.status(200).json({ data: serializeSupplier(supplier) });
    },
  };
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeSupplier(s: {
  id: string;
  supplierName: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    supplierName: s.supplierName,
    supplierCode: s.supplierCode,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    website: s.website,
    notes: s.notes,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type SupplierHandlers = ReturnType<typeof createSupplierHandlers>;
