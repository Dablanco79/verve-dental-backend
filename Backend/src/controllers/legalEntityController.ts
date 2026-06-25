import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { LegalEntityService } from "../services/legalEntityService.js";

const createLegalEntitySchema = z
  .object({
    legalName: z.string().trim().min(1, "legalName is required").max(500),
    tradingName: z.string().trim().max(500).nullable().optional(),
    abn: z.string().trim().max(50).nullable().optional(),
    taxId: z.string().trim().max(50).nullable().optional(),
    countryCode: z.string().trim().length(2).optional(),
    currencyCode: z.string().trim().length(3).optional(),
    registeredAddress: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["active", "inactive"] as const).optional(),
  })
  .strict();

const updateLegalEntitySchema = z
  .object({
    legalName: z.string().trim().min(1).max(500).optional(),
    tradingName: z.string().trim().max(500).nullable().optional(),
    abn: z.string().trim().max(50).nullable().optional(),
    taxId: z.string().trim().max(50).nullable().optional(),
    countryCode: z.string().trim().length(2).optional(),
    currencyCode: z.string().trim().length(3).optional(),
    registeredAddress: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["active", "inactive"] as const).optional(),
  })
  .strict();

export function createLegalEntityHandlers(
  legalEntityService: LegalEntityService,
) {
  return {
    async listByOrganisation(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { organisationId } = req.params as { organisationId: string };
      const entities = await legalEntityService.listByOrganisation(
        req.user,
        organisationId,
      );
      res.status(200).json({ data: entities });
    },

    async getLegalEntity(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const entity = await legalEntityService.getLegalEntity(req.user, id);
      res.status(200).json({ data: entity });
    },

    async createLegalEntity(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { organisationId } = req.params as { organisationId: string };
      const input = parseBody(createLegalEntitySchema, req.body);
      const entity = await legalEntityService.createLegalEntity(
        req.user,
        organisationId,
        input,
      );
      res.status(201).json({ data: entity });
    },

    async updateLegalEntity(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { id } = req.params as { id: string };
      const input = parseBody(updateLegalEntitySchema, req.body);
      const entity = await legalEntityService.updateLegalEntity(
        req.user,
        id,
        input,
      );
      res.status(200).json({ data: entity });
    },
  };
}
