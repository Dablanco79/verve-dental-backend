import type { Request, Response } from "express";
import { z } from "zod";

import type { StocktakeService } from "../services/stocktakeService.js";
import type {
  StocktakeLine,
  StocktakeLineView,
  StocktakeSession,
  StocktakeSessionView,
} from "../types/stocktake.js";
import { AppError } from "../types/errors.js";
import { parseBody, zodToDetails } from "../utils/validation.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
});

const updateSessionSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
});

const updateLineSchema = z.object({
  countedQuantity: z
    .number()
    .int("countedQuantity must be an integer")
    .min(0, "countedQuantity must be non-negative")
    .nullable(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z
    .enum(["draft", "in_progress", "completed", "cancelled"])
    .optional(),
});

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeSession(s: StocktakeSession | StocktakeSessionView) {
  return {
    id: s.id,
    clinicId: s.clinicId,
    name: s.name,
    status: s.status,
    createdByUserId: s.createdByUserId,
    createdByEmail: s.createdByEmail,
    startedByUserId: s.startedByUserId,
    startedByEmail: s.startedByEmail,
    completedByUserId: s.completedByUserId,
    completedByEmail: s.completedByEmail,
    cancelledByUserId: s.cancelledByUserId,
    cancelledByEmail: s.cancelledByEmail,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    totalLines: "totalLines" in s ? s.totalLines : undefined,
    countedLines: "countedLines" in s ? s.countedLines : undefined,
  };
}

function serializeLine(l: StocktakeLine | StocktakeLineView) {
  const base = {
    id: l.id,
    sessionId: l.sessionId,
    clinicId: l.clinicId,
    clinicInventoryItemId: l.clinicInventoryItemId,
    masterCatalogItemId: l.masterCatalogItemId,
    expectedQuantity: l.expectedQuantity,
    countedQuantity: l.countedQuantity,
    variance: l.variance,
    unitCostCents: l.unitCostCents,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };

  if ("masterSku" in l) {
    return {
      ...base,
      masterSku: l.masterSku,
      productName: l.productName,
      category: l.category,
      stockUnit: l.stockUnit,
      primaryBarcode: l.primaryBarcode,
      varianceValueCents: l.varianceValueCents,
    };
  }

  return base;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.user;
}

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

// ── Handler factory ───────────────────────────────────────────────────────────

export function createStocktakeHandlers(stocktakeService: StocktakeService) {
  return {
    // GET /clinics/:clinicId/stocktakes
    async listSessions(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const parsed = paginationQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const page = await stocktakeService.listSessions(clinicId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        status: parsed.data.status,
      });

      res.status(200).json({
        data: page.items.map(serializeSession),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    },

    // GET /clinics/:clinicId/stocktakes/:sessionId
    async getSession(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);

      const session = await stocktakeService.getSession(clinicId, sessionId);
      res.status(200).json({ data: serializeSession(session) });
    },

    // POST /clinics/:clinicId/stocktakes
    async createSession(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(createSessionSchema, req.body);

      const session = await stocktakeService.createSession(
        {
          clinicId,
          name: body.name,
          createdByUserId: user.id,
          createdByEmail: user.email,
        },
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(201).json({ data: serializeSession(session) });
    },

    // PATCH /clinics/:clinicId/stocktakes/:sessionId
    async updateSession(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);
      const body = parseBody(updateSessionSchema, req.body);

      const session = await stocktakeService.updateSession(
        clinicId,
        sessionId,
        { name: body.name },
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(200).json({ data: serializeSession(session) });
    },

    // POST /clinics/:clinicId/stocktakes/:sessionId/start
    async startSession(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);

      const session = await stocktakeService.startSession(
        clinicId,
        sessionId,
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(200).json({ data: serializeSession(session) });
    },

    // POST /clinics/:clinicId/stocktakes/:sessionId/cancel
    async cancelSession(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);

      const session = await stocktakeService.cancelSession(
        clinicId,
        sessionId,
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(200).json({ data: serializeSession(session) });
    },

    // POST /clinics/:clinicId/stocktakes/:sessionId/complete
    async completeSession(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);

      const result = await stocktakeService.completeSession(
        clinicId,
        sessionId,
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(200).json({
        data: {
          session: serializeSession(result.session),
          adjustmentsApplied: result.adjustmentsApplied,
        },
      });
    },

    // GET /clinics/:clinicId/stocktakes/:sessionId/lines
    async listLines(req: Request, res: Response): Promise<void> {
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);

      const lines = await stocktakeService.listLines(clinicId, sessionId);
      res.status(200).json({ data: lines.map(serializeLine) });
    },

    // PATCH /clinics/:clinicId/stocktakes/:sessionId/lines/:lineId
    async updateLine(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const sessionId = routeParam(req.params.sessionId);
      const lineId = routeParam(req.params.lineId);
      const body = parseBody(updateLineSchema, req.body);

      const line = await stocktakeService.updateLine(
        clinicId,
        sessionId,
        lineId,
        { countedQuantity: body.countedQuantity, notes: body.notes },
        { id: user.id, email: user.email, role: user.role },
      );

      res.status(200).json({ data: serializeLine(line) });
    },
  };
}

export type StocktakeHandlers = ReturnType<typeof createStocktakeHandlers>;
