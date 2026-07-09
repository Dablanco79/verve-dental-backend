/**
 * Product Matching Engine — HTTP handlers.
 *
 * POST /api/v1/master-products/match
 *   — Returns ranked suggested Master Products for a supplier product row.
 *   — owner_admin / group_practice_manager only (clinical_staff blocked).
 *
 * POST /api/v1/master-products/match/confirm
 *   — Persists a supplier-product mapping (supplier_catalogue upsert).
 *   — Does NOT create inventory movements or change quantityOnHand.
 *   — owner_admin / group_practice_manager only.
 */
import type { Request, Response } from "express";
import { z } from "zod";

import type { AuditService } from "../services/auditService.js";
import type { ProductMatchingService } from "../services/productMatchingService.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const suggestMatchesBodySchema = z
  .object({
    supplierId: z.string().uuid("supplierId must be a valid UUID"),
    supplierSku: z.string().trim().max(128).nullable().optional(),
    supplierDescription: z.string().trim().max(512).nullable().optional(),
    category: z.string().trim().max(128).nullable().optional(),
    brand: z.string().trim().max(255).nullable().optional(),
    unit: z.string().trim().max(64).nullable().optional(),
    packSize: z.string().trim().max(64).nullable().optional(),
  })
  .strict();

const confirmMatchBodySchema = z
  .object({
    supplierId: z.string().uuid("supplierId must be a valid UUID"),
    masterProductId: z.string().uuid("masterProductId must be a valid UUID"),
    supplierSku: z.string().trim().max(128).nullable().optional(),
    supplierDescription: z.string().trim().max(512).nullable().optional(),
    lastUnitCostCents: z.number().int().min(0).nullable().optional(),
  })
  .strict();

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createMasterProductMatchHandlers(
  productMatchingService: ProductMatchingService,
  supplierCatalogueRepository: SupplierCatalogueRepository,
  auditService: AuditService,
) {
  function requireUser(req: Request) {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    return req.user;
  }

  return {
    /**
     * POST /api/v1/master-products/match
     * Returns up to 5 ranked suggestions for the given supplier product row.
     */
    async suggestMatches(req: Request, res: Response): Promise<void> {
      requireUser(req);

      const parsed = suggestMatchesBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(parsed.error),
        );
      }

      const result = await productMatchingService.suggestMatches(parsed.data);

      res.status(200).json({ data: result });
    },

    /**
     * POST /api/v1/master-products/match/confirm
     * Saves the supplier-product mapping without creating inventory movements.
     */
    async confirmMatch(req: Request, res: Response): Promise<void> {
      const actor = requireUser(req);

      const parsed = confirmMatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(parsed.error),
        );
      }

      const { supplierId, masterProductId, supplierSku, supplierDescription, lastUnitCostCents } =
        parsed.data;

      const validation = await productMatchingService.validateMatchConfirmation({
        supplierId,
        masterProductId,
        supplierSku,
        supplierDescription,
        lastUnitCostCents,
      });

      if (!validation.valid) {
        throw new AppError(422, "MATCH_VALIDATION_FAILED", validation.reason);
      }

      const { record, created } = await supplierCatalogueRepository.upsertSupplierProduct({
        supplierId,
        productId: masterProductId,
        supplierSku: supplierSku ?? null,
        supplierDescription: supplierDescription ?? null,
        unitCostCents: lastUnitCostCents ?? 0,
      });

      auditService.logEvent(
        created
          ? "supplier_product.created"
          : "supplier_product.updated",
        {
          userId: actor.id,
          email: actor.email,
          role: actor.role,
          clinicId: actor.homeClinicId,
          resourceId: record.id,
        },
      );

      res.status(created ? 201 : 200).json({
        data: {
          id: record.id,
          supplierId: record.supplierId,
          masterProductId: record.productId,
          supplierSku: record.supplierSku,
          supplierDescription: record.supplierDescription,
          lastUnitCostCents: record.unitCostCents,
          active: record.active,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        },
      });
    },
  };
}

export type MasterProductMatchHandlers = ReturnType<
  typeof createMasterProductMatchHandlers
>;
