import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { ProcurementPolicyService } from "../services/procurementPolicyService.js";

// ─── Zod schemas ───────────────────────────────────────────────────────────────

const reorderStrategyEnum = z.enum([
  "standard",
  "economic_order_quantity",
  "just_in_time",
  "custom",
]);

const createPolicySchema = z
  .object({
    supplierRelationshipId: z
      .string()
      .uuid("supplierRelationshipId must be a valid UUID"),
    masterCatalogItemId: z.string().uuid().nullable().optional(),
    policyName: z.string().trim().min(1).max(255),
    policyStatus: z.enum(["active", "inactive"]).optional(),
    priority: z.number().int().min(1),
    preferredSupplier: z.boolean().optional(),
    allowFallback: z.boolean().optional(),
    fallbackPriority: z.number().int().min(1).nullable().optional(),
    minimumOrderQuantity: z.number().int().min(1).nullable().optional(),
    preferredOrderDay: z.string().trim().max(20).nullable().optional(),
    preferredDeliveryDay: z.string().trim().max(20).nullable().optional(),
    priceDifferenceThresholdPercent: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    approvalRequired: z.boolean().optional(),
    reorderStrategy: reorderStrategyEnum.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const updatePolicySchema = z
  .object({
    policyName: z.string().trim().min(1).max(255).optional(),
    policyStatus: z.enum(["active", "inactive"]).optional(),
    priority: z.number().int().min(1).optional(),
    preferredSupplier: z.boolean().optional(),
    allowFallback: z.boolean().optional(),
    fallbackPriority: z.number().int().min(1).nullable().optional(),
    minimumOrderQuantity: z.number().int().min(1).nullable().optional(),
    preferredOrderDay: z.string().trim().max(20).nullable().optional(),
    preferredDeliveryDay: z.string().trim().max(20).nullable().optional(),
    priceDifferenceThresholdPercent: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    approvalRequired: z.boolean().optional(),
    reorderStrategy: reorderStrategyEnum.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
});

// ─── Serializer ────────────────────────────────────────────────────────────────

function serializePolicy(p: {
  id: string;
  clinicId: string;
  supplierRelationshipId: string;
  masterCatalogItemId: string | null;
  policyName: string;
  policyStatus: string;
  priority: number;
  preferredSupplier: boolean;
  allowFallback: boolean;
  fallbackPriority: number | null;
  minimumOrderQuantity: number | null;
  preferredOrderDay: string | null;
  preferredDeliveryDay: string | null;
  priceDifferenceThresholdPercent: number | null;
  approvalRequired: boolean;
  reorderStrategy: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    clinicId: p.clinicId,
    supplierRelationshipId: p.supplierRelationshipId,
    masterCatalogItemId: p.masterCatalogItemId,
    policyName: p.policyName,
    policyStatus: p.policyStatus,
    priority: p.priority,
    preferredSupplier: p.preferredSupplier,
    allowFallback: p.allowFallback,
    fallbackPriority: p.fallbackPriority,
    minimumOrderQuantity: p.minimumOrderQuantity,
    preferredOrderDay: p.preferredOrderDay,
    preferredDeliveryDay: p.preferredDeliveryDay,
    priceDifferenceThresholdPercent: p.priceDifferenceThresholdPercent,
    approvalRequired: p.approvalRequired,
    reorderStrategy: p.reorderStrategy,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── Handler factory ───────────────────────────────────────────────────────────

export function createProcurementPolicyHandlers(
  service: ProcurementPolicyService,
) {
  return {
    /**
     * GET /clinics/:clinicId/procurement-policies
     * Query: ?status=active|inactive
     */
    async listByClinic(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { clinicId } = req.params as { clinicId: string };
      const parsed = listQuerySchema.safeParse(req.query);
      const status = parsed.success ? parsed.data.status : undefined;

      const policies = await service.listByClinic(req.user, clinicId, {
        status,
      });
      res.status(200).json({ data: policies.map(serializePolicy) });
    },

    /**
     * GET /procurement-policies/:id
     */
    async getById(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const policy = await service.getById(req.user, id);
      res.status(200).json({ data: serializePolicy(policy) });
    },

    /**
     * POST /clinics/:clinicId/procurement-policies
     */
    async create(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { clinicId } = req.params as { clinicId: string };
      const input = parseBody(createPolicySchema, req.body);
      const policy = await service.create(req.user, clinicId, input);
      res.status(201).json({ data: serializePolicy(policy) });
    },

    /**
     * PATCH /procurement-policies/:id
     */
    async update(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const input = parseBody(updatePolicySchema, req.body);
      const policy = await service.update(req.user, id, input);
      res.status(200).json({ data: serializePolicy(policy) });
    },

    /**
     * POST /procurement-policies/:id/deactivate
     * Soft-deactivates the policy. No DELETE endpoint.
     */
    async deactivate(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const policy = await service.deactivate(req.user, id);
      res.status(200).json({ data: serializePolicy(policy) });
    },
  };
}
