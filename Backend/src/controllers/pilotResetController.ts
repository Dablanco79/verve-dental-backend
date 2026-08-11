/**
 * Pilot Reset Controller
 *
 * Handles HTTP for POST /api/v1/admin/pilot-reset/preview
 *               and POST /api/v1/admin/pilot-reset/execute
 *
 * Both endpoints require:
 *   - PILOT_RESET_ENABLED = true (checked here)
 *   - Authenticated owner_admin (enforced by route-level middleware)
 */

import { z } from "zod";
import type { Request, Response } from "express";

import { AppError } from "../types/errors.js";
import type { EnvConfig } from "../config/index.js";
import type { PilotResetService } from "../services/pilotResetService.js";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const previewSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  mode: z.enum(["operational", "full_pilot"], {
    errorMap: () => ({ message: 'mode must be "operational" or "full_pilot"' }),
  }),
});

const executeSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  mode: z.enum(["operational", "full_pilot"], {
    errorMap: () => ({ message: 'mode must be "operational" or "full_pilot"' }),
  }),
  previewToken: z.string().uuid("previewToken must be a valid UUID"),
  /** TOTP code — exactly 6 digits. */
  mfaCode: z
    .string()
    .regex(/^\d{6}$/, "mfaCode must be a 6-digit TOTP code"),
  confirmationPhrase: z
    .string()
    .min(1, "confirmationPhrase is required"),
});

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPilotResetHandlers(
  pilotResetService: PilotResetService,
  config: EnvConfig,
) {
  function requireFeatureEnabled(): void {
    if (!config.PILOT_RESET_ENABLED) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "Pilot Reset is not enabled in this environment. Set PILOT_RESET_ENABLED=true to activate.",
      );
    }
  }

  function requireUser(req: Request): import("../types/auth.js").AuthenticatedUser {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    return req.user;
  }

  return {
    async preview(req: Request, res: Response): Promise<void> {
      requireFeatureEnabled();
      const user = requireUser(req);

      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) {
        const details = parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", details);
      }

      const { clinicId, mode } = parsed.data;

      const result = await pilotResetService.preview({
        clinicId,
        mode,
        actorUserId: user.id,
        actorEmail: user.email,
      });

      res.status(200).json({ data: result });
    },

    async execute(req: Request, res: Response): Promise<void> {
      requireFeatureEnabled();
      const user = requireUser(req);

      const parsed = executeSchema.safeParse(req.body);
      if (!parsed.success) {
        const details = parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", details);
      }

      const { clinicId, mode, previewToken, mfaCode, confirmationPhrase } = parsed.data;

      const result = await pilotResetService.execute({
        clinicId,
        mode,
        previewToken,
        mfaCode,
        confirmationPhrase,
        actorUserId: user.id,
        actorEmail: user.email,
      });

      res.status(200).json({ data: result });
    },
  };
}

export type PilotResetHandlers = ReturnType<typeof createPilotResetHandlers>;
