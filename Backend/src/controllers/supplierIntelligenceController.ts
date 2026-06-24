/**
 * Supplier Intelligence Controller — Sprint 3.
 *
 * Handles GET /api/v1/clinics/:clinicId/supplier-intelligence
 *
 * Read-only endpoint — requires authenticated user scoped to the clinic.
 * Returns saving opportunities and data quality warnings per product.
 */

import { z } from "zod";
import type { Request, Response } from "express";
import type { SupplierIntelligenceService } from "../services/supplierIntelligenceService.js";

const paramsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
});

export function createSupplierIntelligenceHandlers(
  service: SupplierIntelligenceService,
) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.errors[0]?.message ?? "Invalid parameters",
          },
        });
        return;
      }

      const { clinicId } = parsed.data;
      const result = await service.getIntelligence(clinicId);

      res.status(200).json({ data: result });
    },
  };
}
