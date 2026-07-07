/**
 * Master Product Management Foundation — CRUD/list HTTP handlers.
 *
 * Mounted at /api/v1/master-products alongside the existing library-import
 * endpoint (masterProductImportController.ts). Global scope (not clinic
 * scoped) — mirrors the master_catalog_items design used elsewhere.
 */
import type { Request, Response } from "express";
import { z } from "zod";

import type { MasterProductService } from "../services/masterProductService.js";
import { AppError } from "../types/errors.js";
import type { MasterCatalogItem } from "../types/inventory.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const masterProductIdSchema = z.string().uuid("id must be a valid UUID");

const nullableTrimmedString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const createMasterProductBodySchema = z
  .object({
    displayName: z.string().trim().min(1, "displayName is required").max(255),
    sku: z.string().trim().min(1).max(64).optional(),
    category: z.string().trim().min(1, "category is required").max(128),
    subcategory: nullableTrimmedString(128),
    brand: nullableTrimmedString(255),
    variantAttributes: nullableTrimmedString(2000),
    stockUnit: z.string().trim().min(1).max(32).optional(),
    receivingUnit: z.string().trim().min(1).max(32).optional(),
    status: z.enum(["active", "archived"]).optional(),
    notes: nullableTrimmedString(2000),
  })
  .strict();

const updateMasterProductBodySchema = z
  .object({
    displayName: z.string().trim().min(1, "displayName must not be empty").max(255).optional(),
    sku: z.string().trim().min(1).max(64).optional(),
    category: z.string().trim().min(1, "category must not be empty").max(128).optional(),
    subcategory: nullableTrimmedString(128),
    brand: nullableTrimmedString(255),
    variantAttributes: nullableTrimmedString(2000),
    stockUnit: z.string().trim().min(1).max(32).optional(),
    receivingUnit: z.string().trim().min(1).max(32).optional(),
    status: z.enum(["active", "archived"]).optional(),
    notes: nullableTrimmedString(2000),
  })
  .strict();

const listMasterProductsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(128).optional(),
  status: z.enum(["active", "archived", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createMasterProductHandlers(service: MasterProductService) {
  function requireUser(req: Request) {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    return req.user;
  }

  function parseId(req: Request): string {
    const idResult = masterProductIdSchema.safeParse(req.params.id);
    if (!idResult.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "id", message: "id must be a valid UUID" },
      ]);
    }
    return idResult.data;
  }

  return {
    async listMasterProducts(req: Request, res: Response): Promise<void> {
      requireUser(req);

      const queryResult = listMasterProductsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(queryResult.error),
        );
      }

      const page = await service.listMasterProducts(queryResult.data);
      res.status(200).json({
        data: page.items.map(serializeMasterProduct),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    },

    async getMasterProduct(req: Request, res: Response): Promise<void> {
      requireUser(req);
      const id = parseId(req);
      const item = await service.getMasterProduct(id);
      res.status(200).json({ data: serializeMasterProduct(item) });
    },

    async createMasterProduct(req: Request, res: Response): Promise<void> {
      const actor = requireUser(req);

      const bodyResult = createMasterProductBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const created = await service.createMasterProduct(bodyResult.data, actor);
      res.status(201).json({ data: serializeMasterProduct(created) });
    },

    async updateMasterProduct(req: Request, res: Response): Promise<void> {
      const actor = requireUser(req);
      const id = parseId(req);

      const bodyResult = updateMasterProductBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(bodyResult.error),
        );
      }

      const updated = await service.updateMasterProduct(id, bodyResult.data, actor);
      res.status(200).json({ data: serializeMasterProduct(updated) });
    },

    async archiveMasterProduct(req: Request, res: Response): Promise<void> {
      const actor = requireUser(req);
      const id = parseId(req);
      const archived = await service.archiveMasterProduct(id, actor);
      res.status(200).json({ data: serializeMasterProduct(archived) });
    },

    async reactivateMasterProduct(req: Request, res: Response): Promise<void> {
      const actor = requireUser(req);
      const id = parseId(req);
      const reactivated = await service.reactivateMasterProduct(id, actor);
      res.status(200).json({ data: serializeMasterProduct(reactivated) });
    },
  };
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeMasterProduct(item: MasterCatalogItem) {
  return {
    id: item.id,
    displayName: item.name,
    sku: item.sku,
    category: item.category,
    subcategory: item.subcategory,
    brand: item.brand,
    variantAttributes: item.variantAttributes,
    stockUnit: item.stockUnit,
    receivingUnit: item.receivingUnit,
    status: item.status,
    notes: item.notes,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export type MasterProductHandlers = ReturnType<typeof createMasterProductHandlers>;
