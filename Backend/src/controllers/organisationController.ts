import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { OrganisationService } from "../services/organisationService.js";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createOrganisationSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(255),
    status: z.enum(["active", "inactive"] as const).optional(),
  })
  .strict();

const updateOrganisationSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    status: z.enum(["active", "inactive"] as const).optional(),
  })
  .strict();

// ─── Handlers ─────────────────────────────────────────────────────────────────

export function createOrganisationHandlers(
  organisationService: OrganisationService,
) {
  return {
    /**
     * GET /organisations
     * Returns all organisations ordered by name.
     * Restricted to owner_admin at both the route and service layers.
     */
    async listOrganisations(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const organisations = await organisationService.listOrganisations(
        req.user,
      );
      res.status(200).json({ data: organisations });
    },

    /**
     * GET /organisations/:organisationId
     * Returns a single organisation by UUID.
     * Restricted to owner_admin.
     */
    async getOrganisation(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { organisationId } = req.params as { organisationId: string };
      const org = await organisationService.getOrganisation(
        req.user,
        organisationId,
      );
      res.status(200).json({ data: org });
    },

    /**
     * POST /organisations
     * Creates a new organisation.
     * Restricted to owner_admin.
     */
    async createOrganisation(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const input = parseBody(createOrganisationSchema, req.body);
      const org = await organisationService.createOrganisation(
        req.user,
        input,
      );
      res.status(201).json({ data: org });
    },

    /**
     * PATCH /organisations/:organisationId
     * Partial update — only supplied fields are written.
     * Restricted to owner_admin.
     */
    async updateOrganisation(req: Request, res: Response): Promise<void> {
      if (!req.user) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { organisationId } = req.params as { organisationId: string };
      const input = parseBody(updateOrganisationSchema, req.body);
      const org = await organisationService.updateOrganisation(
        req.user,
        organisationId,
        input,
      );
      res.status(200).json({ data: org });
    },
  };
}
