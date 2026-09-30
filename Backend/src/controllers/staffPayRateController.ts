import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../types/errors.js";
import type { StaffPayRateService } from "../services/staffPayRateService.js";
import { zodToDetails } from "../utils/validation.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Express types req.params values as string | string[]; normalise to string.
function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

function requireUser(req: Request) {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.user;
}

function requireUuidParam(req: Request, name: string): string {
  const v = routeParam(req.params[name]);
  if (!v || !UUID_REGEX.test(v))
    throw new AppError(400, "VALIDATION_ERROR", `${name} must be a valid UUID`);
  return v;
}

const createPayRateSchema = z
  .object({
    baseHourlyRateCents: z.number().int().positive(),
    employmentType: z.enum(["full_time", "part_time", "casual"]),
    contractedWeeklyHours: z.number().positive().max(168).nullable().optional(),
    superRatePercent: z
      .number()
      .min(0)
      .max(100)
      .multipleOf(0.01),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD"),
  })
  .strict();

export function createStaffPayRateHandlers(service: StaffPayRateService) {
  return {
    async listRates(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const userId = requireUuidParam(req, "userId");
      const rates = await service.listRates(caller, userId);
      // Serialise cents → keep as-is for the API response (frontend divides by 100)
      res.status(200).json({
        data: rates.map(serializeRate),
      });
    },

    async createRate(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const userId = requireUuidParam(req, "userId");

      const parsed = createPayRateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          zodToDetails(parsed.error),
        );
      }

      const rate = await service.createRate(caller, {
        staffUserId: userId,
        ...parsed.data,
      });
      res.status(201).json({ data: serializeRate(rate) });
    },
  };
}

/** Converts internal cents to dollar display values for the API response. */
function serializeRate(rate: import("../types/payRate.js").StaffPayRate) {
  return {
    ...rate,
    // Keep cents as-is; let the frontend convert. Matches the laborForecastService ledger safety rule.
  };
}
