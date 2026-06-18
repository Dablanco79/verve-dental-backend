import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { AUDIT_ENTITY_TYPES } from "../types/analytics.js";
import type { AnalyticsService } from "../services/analyticsService.js";
import { zodToDetails } from "../utils/validation.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared query helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts the first scalar string from an Express query param value. */
function firstString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first: unknown = v[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

// Reusable UUID route-param validator — returns a 400 before the value ever
// reaches the repository layer, preventing raw Postgres type-cast 500 errors.
const uuidParamSchema = z.string().uuid();

const periodDaysSchema = z
  .string()
  .optional()
  .transform((v) => (v !== undefined ? parseInt(v, 10) : 30))
  .pipe(z.number().int().min(1).max(365));

const monthsSchema = z
  .string()
  .optional()
  .transform((v) => (v !== undefined ? parseInt(v, 10) : 12))
  .pipe(z.number().int().min(1).max(24));

const auditEventsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 0))
    // Cap at 100,000 — protects Postgres from walking massive row-skips on
    // the audit_events table during paginated queries.
    .pipe(z.number().int().min(0).max(100_000)),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  actorId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Controller factory
// ─────────────────────────────────────────────────────────────────────────────

export function createAnalyticsHandlers(service: AnalyticsService) {
  // ── GET /analytics/dashboard ──────────────────────────────────────────────

  async function getDashboard(req: Request, res: Response): Promise<void> {
    const { clinicId } = req.params as { clinicId: string };

    const parsedDays = periodDaysSchema.safeParse(
      firstString(req.query["periodDays"]),
    );
    if (!parsedDays.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "periodDays", message: "periodDays must be an integer between 1 and 365" },
      ]);
    }

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const kpis = await service.getDashboardKpis(
      req.user,
      clinicId,
      parsedDays.data,
    );
    res.status(200).json({ data: kpis });
  }

  // ── GET /analytics/revenue ────────────────────────────────────────────────

  async function getRevenue(req: Request, res: Response): Promise<void> {
    const { clinicId } = req.params as { clinicId: string };

    const parsedMonths = monthsSchema.safeParse(firstString(req.query["months"]));
    if (!parsedMonths.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "months", message: "months must be an integer between 1 and 24" },
      ]);
    }

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const report = await service.getRevenueReport(
      req.user,
      clinicId,
      parsedMonths.data,
    );
    res.status(200).json({ data: report });
  }

  // ── GET /analytics/inventory ──────────────────────────────────────────────

  async function getInventory(req: Request, res: Response): Promise<void> {
    const { clinicId } = req.params as { clinicId: string };

    const parsedDays = periodDaysSchema.safeParse(firstString(req.query["periodDays"]));
    if (!parsedDays.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "periodDays", message: "periodDays must be an integer between 1 and 365" },
      ]);
    }

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const report = await service.getInventoryReport(
      req.user,
      clinicId,
      parsedDays.data,
    );
    res.status(200).json({ data: report });
  }

  // ── GET /analytics/staff ──────────────────────────────────────────────────

  async function getStaff(req: Request, res: Response): Promise<void> {
    const { clinicId } = req.params as { clinicId: string };

    const parsedDays = periodDaysSchema.safeParse(firstString(req.query["periodDays"]));
    if (!parsedDays.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "periodDays", message: "periodDays must be an integer between 1 and 365" },
      ]);
    }

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const report = await service.getStaffReport(
      req.user,
      clinicId,
      parsedDays.data,
    );
    res.status(200).json({ data: report });
  }

  // ── GET /analytics/audit-events ───────────────────────────────────────────

  async function listAuditEvents(req: Request, res: Response): Promise<void> {
    const { clinicId } = req.params as { clinicId: string };

    // Normalize req.query values to scalar strings before validation.
    const normalizedQuery = {
      limit: firstString(req.query["limit"]),
      offset: firstString(req.query["offset"]),
      entityType: firstString(req.query["entityType"]),
      actorId: firstString(req.query["actorId"]),
      entityId: firstString(req.query["entityId"]),
      from: firstString(req.query["from"]),
      to: firstString(req.query["to"]),
    };

    const parsed = auditEventsQuerySchema.safeParse(normalizedQuery);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
    }

    const { limit, offset, entityType, actorId, entityId, from, to } =
      parsed.data;

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const page = await service.listAuditEvents(req.user, clinicId, {
      entityType,
      actorId,
      entityId,
      from: from !== undefined ? new Date(from) : undefined,
      to: to !== undefined ? new Date(to) : undefined,
      limit,
      offset,
    });

    res.status(200).json({ data: page });
  }

  // ── GET /analytics/audit-events/:eventId ──────────────────────────────────

  async function getAuditEvent(req: Request, res: Response): Promise<void> {
    const { clinicId, eventId } = req.params as {
      clinicId: string;
      eventId: string;
    };

    const parsedEventId = uuidParamSchema.safeParse(eventId);
    if (!parsedEventId.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "eventId", message: "eventId must be a valid UUID" },
      ]);
    }

    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    const event = await service.getAuditEvent(req.user, clinicId, parsedEventId.data);
    res.status(200).json({ data: event });
  }

  return {
    getDashboard,
    getRevenue,
    getInventory,
    getStaff,
    listAuditEvents,
    getAuditEvent,
  };
}
