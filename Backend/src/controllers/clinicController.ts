import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { ClinicService } from "../services/clinicService.js";

// ─── Validation constants ─────────────────────────────────────────────────────

// All eight Australian states and territories.
const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

/**
 * Canonical list of valid IANA timezone strings for Australian jurisdictions.
 * Checked against the IANA Time Zone Database (tzdata 2024a).
 * Rejects any freeform string that is not in this allowlist — prevents invalid
 * timezone injection that would silently corrupt calendar-day boundary maths.
 */
const AU_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Hobart",
  "Australia/Lord_Howe",
] as const;

// ─── Validation schemas ───────────────────────────────────────────────────────

/**
 * PATCH /clinics/:clinicId — partial update schema.
 *
 * Security invariants enforced here:
 *
 * 1. ABN — Normalised and validated as exactly 11 digits.
 *    Incoming values may contain spaces or hyphens (e.g. "51 824 753 556"
 *    or "51-824-753-556") — these are stripped before the regex check so the
 *    stored value is always a clean 11-digit string.
 *
 * 2. Timezone — Validated against AU_TIMEZONES allowlist.
 *    Freeform strings are rejected at the perimeter; callers cannot inject an
 *    invalid or unexpected timezone that would silently corrupt midnight-boundary
 *    calculations in the forecasting engine.
 *
 * 3. subscriptionTier INTENTIONALLY OMITTED.
 *    Removing the field from the schema means `.strict()` will reject any
 *    request body that contains it, closing the client-side tier escalation
 *    vector at the perimeter.  Tier changes must go through a billing workflow
 *    (future module) — never through a self-serve PATCH.
 *
 * 4. .strict() rejects unknown keys so clients cannot smuggle extra fields
 *    (e.g. { "id": "..." }) that would silently become no-ops after Zod strips them.
 */
const updateClinicSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),

    abn: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .pipe(
        z
          .string()
          .regex(
            /^\d{11}$/,
            "ABN must be exactly 11 digits (spaces and hyphens are stripped automatically)",
          ),
      )
      .nullable()
      .optional(),

    addressLine1: z.string().trim().min(1).max(255).nullable().optional(),
    suburb: z.string().trim().min(1).max(128).nullable().optional(),
    state: z.enum(AU_STATES).nullable().optional(),

    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Postcode must be exactly 4 digits")
      .nullable()
      .optional(),

    timezone: z
      .enum(AU_TIMEZONES, {
        errorMap: () => ({
          message: `Timezone must be one of: ${AU_TIMEZONES.join(", ")}`,
        }),
      })
      .optional(),

    isActive: z.boolean().optional(),

    // subscriptionTier intentionally omitted — client-side tier escalation vector.
    // Any request body that includes this key will be rejected by .strict() below.
  })
  .strict();

// ─── Handlers ─────────────────────────────────────────────────────────────────

export function createClinicHandlers(clinicService: ClinicService) {
  return {
    /**
     * GET /clinics/:clinicId
     * Returns the full clinic record.
     * owner_admin may fetch any clinic; all other roles are restricted to their
     * home clinic (enforced by enforceTenantParam middleware + service layer).
     */
    async getClinic(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      const caller = req.user;
      const { clinicId } = req.params as { clinicId: string };

      const clinic = await clinicService.getClinic(caller, clinicId);
      res.status(200).json({ data: clinic });
    },

    /**
     * GET /clinics
     * owner_admin → all active clinics.
     * All other roles → single-element array containing their home clinic.
     */
    async listClinics(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      const caller = req.user;

      const clinics = await clinicService.listClinics(caller);
      res.status(200).json({ data: clinics });
    },

    /**
     * PATCH /clinics/:clinicId
     * Partial update — only supplied fields are written.
     * Restricted to owner_admin at the route and service layers.
     * subscriptionTier is stripped at the Zod schema boundary (see above).
     */
    async updateClinic(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      const caller = req.user;
      const { clinicId } = req.params as { clinicId: string };

      const input = parseBody(updateClinicSchema, req.body);
      const clinic = await clinicService.updateClinic(caller, clinicId, input);
      res.status(200).json({ data: clinic });
    },
  };
}
