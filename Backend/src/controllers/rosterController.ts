import type { Request, Response } from "express";
import { z } from "zod";

import type { RosterService } from "../services/rosterService.js";
import type { RosterEntry } from "../types/roster.js";
import { AppError } from "../types/errors.js";
import { parseBody, zodToDetails } from "../utils/validation.js";

// { offset: true } accepts UTC (Z) and local offsets like +10:00 for AEST.
const isoDatetime = () => z.string().datetime({ offset: true });

// Inline literals mirror SHIFT_TYPES / ROSTER_STATUSES from types/roster.ts
// Shift-time ordering (shiftEndAt > shiftStartAt) is validated as business
// logic in the service layer, which returns the stable INVALID_SHIFT_TIMES
// error code rather than a generic VALIDATION_ERROR.
const createEntrySchema = z.object({
  staffUserId: z.string().uuid(),
  // rosteredClinicName is intentionally absent — the service derives it
  // server-side from the DB to prevent client spoofing.
  shiftStartAt: isoDatetime(),
  shiftEndAt: isoDatetime(),
  shiftType: z
    .enum(["standard", "overtime", "on_call", "training"])
    .default("standard"),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// .strict() rejects payloads that contain keys not defined in the schema
// (e.g. { "foo": "bar" }), giving clients a clear 400 instead of silently
// stripping unknown fields and producing a no-op audit entry.
const updateEntrySchema = z
  .object({
    shiftStartAt: isoDatetime().optional(),
    shiftEndAt: isoDatetime().optional(),
    shiftType: z
      .enum(["standard", "overtime", "on_call", "training"])
      .optional(),
    status: z
      .enum(["scheduled", "confirmed", "completed", "cancelled"])
      .optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    from: isoDatetime().optional(),
    to: isoDatetime().optional(),
    status: z
      .enum(["scheduled", "confirmed", "completed", "cancelled"])
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, "limit must be at least 1")
      .max(100, "limit cannot exceed 100")
      .optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0, "offset must be at least 0")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && new Date(data.from) >= new Date(data.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'from' must be earlier than 'to'",
        path: ["from"],
      });
    }
  });

// UUID v4 path param — rejects malformed values before they reach Postgres.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(req: Request, paramName: string): string {
  const value = routeParam(req.params[paramName]);
  if (!UUID_REGEX.test(value)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      [{ field: paramName, message: `${paramName} must be a valid UUID` }],
    );
  }
  return value;
}

function serializeEntry(entry: RosterEntry) {
  return {
    id: entry.id,
    staffUserId: entry.staffUserId,
    staffEmail: entry.staffEmail,
    rosteredClinicId: entry.rosteredClinicId,
    rosteredClinicName: entry.rosteredClinicName,
    shiftStartAt: entry.shiftStartAt.toISOString(),
    shiftEndAt: entry.shiftEndAt.toISOString(),
    shiftType: entry.shiftType,
    status: entry.status,
    notes: entry.notes,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

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

export function createRosterHandlers(rosterService: RosterService) {
  return {
    async listEntries(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = listQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const options = {
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined,
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      };

      const page = await rosterService.listByClinicPaginated(caller, clinicId, options);
      res.status(200).json({
        data: page.items.map(serializeEntry),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    },

    async getMyShifts(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const parsed = listQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const options = {
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      };

      const entries = await rosterService.getMyShifts(caller, clinicId, options);
      res.status(200).json({ data: entries.map(serializeEntry) });
    },

    async getEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const entryId = requireUuidParam(req, "entryId");
      const entry = await rosterService.getEntry(caller, clinicId, entryId);
      res.status(200).json({ data: serializeEntry(entry) });
    },

    async createEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const body = parseBody(createEntrySchema, req.body);

      const entry = await rosterService.createEntry(caller, clinicId, {
        staffUserId: body.staffUserId,
        shiftStartAt: new Date(body.shiftStartAt),
        shiftEndAt: new Date(body.shiftEndAt),
        shiftType: body.shiftType ?? "standard",
        notes: body.notes ?? null,
      });

      res.status(201).json({ data: serializeEntry(entry) });
    },

    async updateEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const entryId = requireUuidParam(req, "entryId");

      // .strict() above already rejects unknown-only bodies (e.g. { "foo": "bar" }).
      // This post-parse check catches a fully empty body {} — Zod passes it
      // (all fields optional) but there is nothing to update.
      const body = parseBody(updateEntrySchema, req.body);

      if (Object.keys(body).length === 0) {
        throw new AppError(
          400,
          "NO_VALID_FIELDS",
          "No valid update fields provided",
        );
      }

      const entry = await rosterService.updateEntry(caller, clinicId, entryId, {
        shiftStartAt: body.shiftStartAt ? new Date(body.shiftStartAt) : undefined,
        shiftEndAt: body.shiftEndAt ? new Date(body.shiftEndAt) : undefined,
        shiftType: body.shiftType,
        status: body.status,
        notes: body.notes,
      });

      res.status(200).json({ data: serializeEntry(entry) });
    },

    async cancelEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const entryId = requireUuidParam(req, "entryId");
      const entry = await rosterService.cancelEntry(caller, clinicId, entryId);
      res.status(200).json({ data: serializeEntry(entry) });
    },
  };
}

export type RosterHandlers = ReturnType<typeof createRosterHandlers>;
