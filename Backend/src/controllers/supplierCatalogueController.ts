import { z } from "zod";
import type { Request, Response } from "express";

import type { SupplierCatalogueService } from "../services/supplierCatalogueService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const createSupplierProductBodySchema = z.object({
  productId: z.string().uuid("productId must be a valid UUID"),
  supplierSku: z.string().max(100).nullable().optional(),
  supplierDescription: z.string().max(500).nullable().optional(),
  unitCostCents: z
    .number()
    .int("unitCostCents must be an integer")
    .min(0, "unitCostCents must be non-negative"),
  unitOfMeasure: z.string().max(50).nullable().optional(),
});

const updateSupplierProductBodySchema = z.object({
  supplierSku: z.string().max(100).nullable().optional(),
  supplierDescription: z.string().max(500).nullable().optional(),
  unitCostCents: z
    .number()
    .int("unitCostCents must be an integer")
    .min(0, "unitCostCents must be non-negative")
    .optional(),
  unitOfMeasure: z.string().max(50).nullable().optional(),
  active: z.boolean().optional(),
}).strict();

const listQuerySchema = z.object({
  active: z
    .string()
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
  productId: z.string().uuid().optional(),
});

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createSupplierCatalogueHandlers(
  service: SupplierCatalogueService,
) {
  return {
    async listSupplierProducts(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const idResult = uuidSchema.safeParse(req.params.supplierId);
      if (!idResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const queryResult = listQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(queryResult.error),
        );
      }

      const products = await service.listSupplierProducts({
        supplierId: idResult.data,
        productId: queryResult.data.productId,
        active: queryResult.data.active,
      });

      res.status(200).json({ data: products.map(serializeSupplierProduct) });
    },

    async getSupplierProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const entryIdResult = uuidSchema.safeParse(req.params.supplierProductId);
      if (!entryIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          {
            field: "supplierProductId",
            message: "supplierProductId must be a valid UUID",
          },
        ]);
      }

      const product = await service.getSupplierProduct(entryIdResult.data);
      res.status(200).json({ data: serializeSupplierProduct(product) });
    },

    async createSupplierProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const supplierIdResult = uuidSchema.safeParse(req.params.supplierId);
      if (!supplierIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "supplierId", message: "supplierId must be a valid UUID" },
        ]);
      }

      const bodyResult = createSupplierProductBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const product = await service.createSupplierProduct(
        {
          supplierId: supplierIdResult.data,
          ...bodyResult.data,
        },
        req.user.id,
      );
      res.status(201).json({ data: serializeSupplierProduct(product) });
    },

    async updateSupplierProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const entryIdResult = uuidSchema.safeParse(req.params.supplierProductId);
      if (!entryIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          {
            field: "supplierProductId",
            message: "supplierProductId must be a valid UUID",
          },
        ]);
      }

      const bodyResult = updateSupplierProductBodySchema.safeParse(
        req.body ?? {},
      );
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const product = await service.updateSupplierProduct(
        entryIdResult.data,
        bodyResult.data,
        req.user.id,
      );
      res.status(200).json({ data: serializeSupplierProduct(product) });
    },

    async listPricingForProduct(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const productIdResult = uuidSchema.safeParse(req.params.productId);
      if (!productIdResult.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
          { field: "productId", message: "productId must be a valid UUID" },
        ]);
      }

      const products = await service.listPricingForProduct(productIdResult.data);
      res.status(200).json({ data: products.map(serializeSupplierProduct) });
    },
  };
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeSupplierProduct(p: {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  unitCostCents: number;
  unitOfMeasure: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    supplierId: p.supplierId,
    productId: p.productId,
    supplierSku: p.supplierSku,
    supplierDescription: p.supplierDescription,
    unitCostCents: p.unitCostCents,
    unitOfMeasure: p.unitOfMeasure,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export type SupplierCatalogueHandlers = ReturnType<
  typeof createSupplierCatalogueHandlers
>;
