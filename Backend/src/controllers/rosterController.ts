import type { Request, Response } from "express";
import { z } from "zod";

import type { RosterService } from "../services/rosterService.js";
import type { RosterEntry } from "../types/roster.js";
import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";

// Inline literals mirror SHIFT_TYPES / ROSTER_STATUSES from types/roster.ts
const createEntrySchema = z.object({
  staffUserId: z.string().uuid(),
  rosteredClinicName: z.string().trim().min(1).max(255),
  shiftStartAt: z.string().datetime(),
  shiftEndAt: z.string().datetime(),
  shiftType: z
    .enum(["standard", "overtime", "on_call", "training"])
    .default("standard"),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const updateEntrySchema = z.object({
  shiftStartAt: z.string().datetime().optional(),
  shiftEndAt: z.string().datetime().optional(),
  shiftType: z.enum(["standard", "overtime", "on_call", "training"]).optional(),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z
    .enum(["scheduled", "confirmed", "completed", "cancelled"])
    .optional(),
});

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
      const clinicId = routeParam(req.params.clinicId);
      const parsed = listQuerySchema.safeParse(req.query);
      const options = parsed.success
        ? {
            from: parsed.data.from ? new Date(parsed.data.from) : undefined,
            to: parsed.data.to ? new Date(parsed.data.to) : undefined,
            status: parsed.data.status,
          }
        : undefined;

      const entries = await rosterService.listByClinic(caller, clinicId, options);
      res.status(200).json({ data: entries.map(serializeEntry) });
    },

    async getMyShifts(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const parsed = listQuerySchema.safeParse(req.query);
      const options = parsed.success
        ? {
            from: parsed.data.from ? new Date(parsed.data.from) : undefined,
            to: parsed.data.to ? new Date(parsed.data.to) : undefined,
          }
        : undefined;

      const entries = await rosterService.getMyShifts(caller, clinicId, options);
      res.status(200).json({ data: entries.map(serializeEntry) });
    },

    async getEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const entryId = routeParam(req.params.entryId);
      const entry = await rosterService.getEntry(caller, clinicId, entryId);
      res.status(200).json({ data: serializeEntry(entry) });
    },

    async createEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(createEntrySchema, req.body);

      const entry = await rosterService.createEntry(caller, clinicId, {
        staffUserId: body.staffUserId,
        rosteredClinicId: clinicId,
        rosteredClinicName: body.rosteredClinicName,
        shiftStartAt: new Date(body.shiftStartAt),
        shiftEndAt: new Date(body.shiftEndAt),
        shiftType: body.shiftType ?? "standard",
        notes: body.notes ?? null,
      });

      res.status(201).json({ data: serializeEntry(entry) });
    },

    async updateEntry(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = routeParam(req.params.clinicId);
      const entryId = routeParam(req.params.entryId);
      const body = parseBody(updateEntrySchema, req.body);

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
      const clinicId = routeParam(req.params.clinicId);
      const entryId = routeParam(req.params.entryId);
      const entry = await rosterService.cancelEntry(caller, clinicId, entryId);
      res.status(200).json({ data: serializeEntry(entry) });
    },
  };
}

export type RosterHandlers = ReturnType<typeof createRosterHandlers>;
