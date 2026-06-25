import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { SupplierContractService } from "../services/supplierContractService.js";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createContractSchema = z
  .object({
    contractName: z.string().trim().min(1).max(255),
    contractNumber: z.string().trim().max(100).nullable().optional(),
    status: z.enum(["active", "expired", "draft", "terminated"]).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    renewalNoticeDays: z.number().int().min(0).optional(),
    paymentTerms: z.string().trim().min(1).max(255),
    freightTerms: z.string().trim().max(500).nullable().optional(),
    minimumOrderValueCents: z.number().int().min(0).nullable().optional(),
    rebateDescription: z.string().trim().max(2000).nullable().optional(),
    estimatedAnnualCommitmentCents: z.number().int().min(0).nullable().optional(),
    annualSpendTargetCents: z.number().int().min(0).nullable().optional(),
    contractDocumentStorageKey: z.string().trim().max(1000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

const updateContractSchema = z
  .object({
    contractName: z.string().trim().min(1).max(255).optional(),
    contractNumber: z.string().trim().max(100).nullable().optional(),
    status: z.enum(["active", "expired", "draft", "terminated"]).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    renewalNoticeDays: z.number().int().min(0).optional(),
    paymentTerms: z.string().trim().min(1).max(255).optional(),
    freightTerms: z.string().trim().max(500).nullable().optional(),
    minimumOrderValueCents: z.number().int().min(0).nullable().optional(),
    rebateDescription: z.string().trim().max(2000).nullable().optional(),
    estimatedAnnualCommitmentCents: z.number().int().min(0).nullable().optional(),
    annualSpendTargetCents: z.number().int().min(0).nullable().optional(),
    contractDocumentStorageKey: z.string().trim().max(1000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(["active", "expired", "draft", "terminated"]).optional(),
});

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeContract(c: {
  id: string;
  supplierRelationshipId: string;
  contractName: string;
  contractNumber: string | null;
  status: string;
  startDate: Date;
  endDate: Date;
  renewalNoticeDays: number;
  paymentTerms: string;
  freightTerms: string | null;
  minimumOrderValueCents: number | null;
  rebateDescription: string | null;
  estimatedAnnualCommitmentCents: number | null;
  annualSpendTargetCents: number | null;
  contractDocumentStorageKey: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    supplierRelationshipId: c.supplierRelationshipId,
    contractName: c.contractName,
    contractNumber: c.contractNumber,
    status: c.status,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate.toISOString(),
    renewalNoticeDays: c.renewalNoticeDays,
    paymentTerms: c.paymentTerms,
    freightTerms: c.freightTerms,
    minimumOrderValueCents: c.minimumOrderValueCents,
    rebateDescription: c.rebateDescription,
    estimatedAnnualCommitmentCents: c.estimatedAnnualCommitmentCents,
    annualSpendTargetCents: c.annualSpendTargetCents,
    contractDocumentStorageKey: c.contractDocumentStorageKey,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createSupplierContractHandlers(
  service: SupplierContractService,
) {
  return {
    /**
     * GET /supplier-relationships/:relationshipId/contracts
     * Query: ?status=active|expired|draft|terminated
     */
    async listByRelationship(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { relationshipId } = req.params as { relationshipId: string };
      const parsed = listQuerySchema.safeParse(req.query);
      const status = parsed.success ? parsed.data.status : undefined;

      const contracts = await service.listByRelationship(
        req.user,
        relationshipId,
        { status },
      );
      res.status(200).json({ data: contracts.map(serializeContract) });
    },

    /**
     * GET /supplier-contracts/:id
     */
    async getById(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const contract = await service.getById(req.user, id);
      res.status(200).json({ data: serializeContract(contract) });
    },

    /**
     * POST /supplier-relationships/:relationshipId/contracts
     */
    async create(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { relationshipId } = req.params as { relationshipId: string };
      const input = parseBody(createContractSchema, req.body);
      const contract = await service.create(req.user, relationshipId, input);
      res.status(201).json({ data: serializeContract(contract) });
    },

    /**
     * PATCH /supplier-contracts/:id
     */
    async update(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const input = parseBody(updateContractSchema, req.body);
      const contract = await service.update(req.user, id, input);
      res.status(200).json({ data: serializeContract(contract) });
    },

    /**
     * POST /supplier-contracts/:id/expire
     * Soft-expires the contract.
     */
    async expire(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const contract = await service.expire(req.user, id);
      res.status(200).json({ data: serializeContract(contract) });
    },

    /**
     * POST /supplier-contracts/:id/terminate
     * Soft-terminates the contract.
     */
    async terminate(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const contract = await service.terminate(req.user, id);
      res.status(200).json({ data: serializeContract(contract) });
    },
  };
}
