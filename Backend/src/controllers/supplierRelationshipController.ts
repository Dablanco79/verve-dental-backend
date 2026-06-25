import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { SupplierRelationshipService } from "../services/supplierRelationshipService.js";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createRelationshipSchema = z
  .object({
    supplierId: z.string().uuid("supplierId must be a valid UUID"),
    relationshipStatus: z.enum(["active", "inactive"]).optional(),
    preferredSupplier: z.boolean().optional(),
    accountNumber: z.string().trim().max(100).nullable().optional(),
    customerNumber: z.string().trim().max(100).nullable().optional(),
    creditTerms: z.string().trim().max(200).nullable().optional(),
    creditLimitCents: z.number().int().min(0).nullable().optional(),
    orderingEmail: z.string().trim().email().max(255).nullable().optional(),
    deliveryAddress: z.string().trim().max(1000).nullable().optional(),
    invoiceAddress: z.string().trim().max(1000).nullable().optional(),
    representativeName: z.string().trim().max(255).nullable().optional(),
    representativeEmail: z.string().trim().email().max(255).nullable().optional(),
    representativePhone: z.string().trim().max(50).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const updateRelationshipSchema = z
  .object({
    relationshipStatus: z.enum(["active", "inactive"]).optional(),
    preferredSupplier: z.boolean().optional(),
    accountNumber: z.string().trim().max(100).nullable().optional(),
    customerNumber: z.string().trim().max(100).nullable().optional(),
    creditTerms: z.string().trim().max(200).nullable().optional(),
    creditLimitCents: z.number().int().min(0).nullable().optional(),
    orderingEmail: z.string().trim().email().max(255).nullable().optional(),
    deliveryAddress: z.string().trim().max(1000).nullable().optional(),
    invoiceAddress: z.string().trim().max(1000).nullable().optional(),
    representativeName: z.string().trim().max(255).nullable().optional(),
    representativeEmail: z.string().trim().email().max(255).nullable().optional(),
    representativePhone: z.string().trim().max(50).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
});

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeRelationship(r: {
  id: string;
  supplierId: string;
  clinicId: string;
  relationshipStatus: string;
  preferredSupplier: boolean;
  accountNumber: string | null;
  customerNumber: string | null;
  creditTerms: string | null;
  creditLimitCents: number | null;
  orderingEmail: string | null;
  deliveryAddress: string | null;
  invoiceAddress: string | null;
  representativeName: string | null;
  representativeEmail: string | null;
  representativePhone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    supplierId: r.supplierId,
    clinicId: r.clinicId,
    relationshipStatus: r.relationshipStatus,
    preferredSupplier: r.preferredSupplier,
    accountNumber: r.accountNumber,
    customerNumber: r.customerNumber,
    creditTerms: r.creditTerms,
    creditLimitCents: r.creditLimitCents,
    orderingEmail: r.orderingEmail,
    deliveryAddress: r.deliveryAddress,
    invoiceAddress: r.invoiceAddress,
    representativeName: r.representativeName,
    representativeEmail: r.representativeEmail,
    representativePhone: r.representativePhone,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createSupplierRelationshipHandlers(
  service: SupplierRelationshipService,
) {
  return {
    /**
     * GET /clinics/:clinicId/supplier-relationships
     * Query: ?status=active|inactive
     */
    async listByClinic(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { clinicId } = req.params as { clinicId: string };
      const parsed = listQuerySchema.safeParse(req.query);
      const status = parsed.success ? parsed.data.status : undefined;

      const relationships = await service.listByClinic(req.user, clinicId, {
        status,
      });
      res.status(200).json({ data: relationships.map(serializeRelationship) });
    },

    /**
     * GET /supplier-relationships/:relationshipId
     */
    async getById(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { relationshipId } = req.params as { relationshipId: string };
      const relationship = await service.getById(req.user, relationshipId);
      res.status(200).json({ data: serializeRelationship(relationship) });
    },

    /**
     * POST /clinics/:clinicId/supplier-relationships
     */
    async create(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { clinicId } = req.params as { clinicId: string };
      const input = parseBody(createRelationshipSchema, req.body);
      const relationship = await service.create(req.user, clinicId, input);
      res.status(201).json({ data: serializeRelationship(relationship) });
    },

    /**
     * PATCH /supplier-relationships/:relationshipId
     */
    async update(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { relationshipId } = req.params as { relationshipId: string };
      const input = parseBody(updateRelationshipSchema, req.body);
      const relationship = await service.update(req.user, relationshipId, input);
      res.status(200).json({ data: serializeRelationship(relationship) });
    },

    /**
     * POST /supplier-relationships/:relationshipId/deactivate
     * Soft-deactivates the relationship. No DELETE endpoint.
     */
    async deactivate(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { relationshipId } = req.params as { relationshipId: string };
      const relationship = await service.deactivate(req.user, relationshipId);
      res.status(200).json({ data: serializeRelationship(relationship) });
    },
  };
}
