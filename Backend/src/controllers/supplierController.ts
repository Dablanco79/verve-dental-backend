import { z } from "zod";
import type { Request, Response } from "express";

import type { SupplierService } from "../services/supplierService.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";
import type { Supplier } from "../types/supplier.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const supplierIdSchema = z.string().uuid("supplierId must be a valid UUID");

// Shared Sprint 4C metadata fields (reused in both create and update schemas)
const supplierMetadataFields = {
  legalName: z.string().trim().max(500).nullable().optional(),
  tradingName: z.string().trim().max(500).nullable().optional(),
  countryCode: z.string().trim().length(2).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  industryCategory: z.string().trim().max(200).nullable().optional(),
  healthcareSubcategory: z.string().trim().max(200).nullable().optional(),
  supplierCategory: z.string().trim().max(200).nullable().optional(),
  verified: z.boolean().optional(),
  apiAvailable: z.boolean().optional(),
  catalogueAvailable: z.boolean().optional(),
  livePricing: z.boolean().optional(),
  onlineOrdering: z.boolean().optional(),
  preferredCommMethod: z.string().trim().max(100).nullable().optional(),
  logoStorageKey: z.string().trim().max(500).nullable().optional(),
  createdByClinicId: z.string().uuid().nullable().optional(),
  isPublic: z.boolean().optional(),
};

const createSupplierBodySchema = z.object({
  supplierName: z.string().min(1, "supplierName is required").max(200),
  supplierCode: z.string().max(50).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url("Invalid URL").nullable().optional(),
  abn: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ...supplierMetadataFields,
});

const updateSupplierBodySchema = z.object({
  supplierName: z.string().min(1).max(200).optional(),
  supplierCode: z.string().max(50).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url("Invalid URL").nullable().optional(),
  abn: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  ...supplierMetadataFields,
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

function serializeSupplier(s: Supplier) {
  return {
    // ── Core ─────────────────────────────────────────────────────────────────
    id: s.id,
    supplierName: s.supplierName,
    supplierCode: s.supplierCode,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    website: s.website,
    abn: s.abn,
    address: s.address,
    notes: s.notes,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    // ── Sprint 4C metadata ────────────────────────────────────────────────────
    legalName: s.legalName,
    tradingName: s.tradingName,
    countryCode: s.countryCode,
    currencyCode: s.currencyCode,
    industryCategory: s.industryCategory,
    healthcareSubcategory: s.healthcareSubcategory,
    supplierCategory: s.supplierCategory,
    verified: s.verified,
    apiAvailable: s.apiAvailable,
    catalogueAvailable: s.catalogueAvailable,
    livePricing: s.livePricing,
    onlineOrdering: s.onlineOrdering,
    preferredCommMethod: s.preferredCommMethod,
    logoStorageKey: s.logoStorageKey,
    createdByClinicId: s.createdByClinicId,
    isPublic: s.isPublic,
  };
}

export type SupplierHandlers = ReturnType<typeof createSupplierHandlers>;
