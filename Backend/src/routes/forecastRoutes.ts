/**
 * forecastRoutes.ts
 *
 * Authenticated, tenant-isolated Express router for the Materials Forecasting
 * Engine.  Mounted at `/clinics/:clinicId/forecast` in routes/index.ts.
 *
 * Multi-tenant isolation is enforced at two independent layers:
 *   1. Route layer  — enforceTenantParam("clinicId") rejects any token whose
 *      homeClinicId does not match the :clinicId URL segment (owner_admin is
 *      the only role exempt — it may query any clinic).
 *   2. Service layer — ForecastService.assertTenantAccess() performs the same
 *      check independently, so a misconfigured router cannot bypass it.
 *
 * Endpoints:
 *   GET /clinics/:clinicId/forecast/materials
 *     Returns the full SKU demand projection table for the clinic.
 *     Query params:
 *       forecastDays  (number, default 14) — window for upcoming shifts.
 *       lookbackDays  (number, default 30) — historical sampling window.
 *
 *   GET /clinics/:clinicId/forecast/alerts
 *     Returns only actionable shortage alerts (items whose projected stock
 *     remaining falls below their reorder point during the forecast window).
 *     Sorted: critical first, then by shortfall units descending.
 *     Accepts the same query params as /materials.
 *
 * Role access:
 *   All three roles (owner_admin, group_practice_manager, clinical_staff) may
 *   read forecast data for their own clinic.  owner_admin may query any clinic.
 *   No write endpoints exist — forecasting is a read-only derived view.
 *
 * Timezone calibration:
 *   The clinic's IANA timezone is fetched from clinicRepository and forwarded
 *   to the service via ForecastOptions.timezone so that lookback and forecast
 *   windows are anchored to clinic-local calendar-day boundaries, preventing
 *   midnight-crossing drift on UTC servers.
 */

import { Router } from "express";
import { z } from "zod";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createForecastService } from "../services/forecastService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../types/errors.js";
import type { Request, Response } from "express";
import type { ForecastOptions } from "../services/forecastService.js";

// ── Role gates ────────────────────────────────────────────────────────────────

const FORECAST_READ_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

// ── Query parameter schema ────────────────────────────────────────────────────

/**
 * Strict digits-only pattern.  Rejects mixed strings like "14abc" that
 * parseInt would silently truncate to 14, producing a deceptive valid result.
 */
const DIGITS_ONLY = /^\d+$/;

const forecastQuerySchema = z.object({
  forecastDays: z
    .string()
    .regex(DIGITS_ONLY, "forecastDays must contain digits only")
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(90).optional()),
  lookbackDays: z
    .string()
    .regex(DIGITS_ONLY, "lookbackDays must contain digits only")
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(365).optional()),
});

// ── Shared helpers ────────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(req: Request, paramName: string): string {
  const raw = req.params[paramName];
  const value = typeof raw === "string" ? raw : "";

  if (!UUID_REGEX.test(value)) {
    throw new AppError(
      400,
      "INVALID_PARAM",
      `Path parameter '${paramName}' must be a valid UUID`,
    );
  }

  return value;
}

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }

  return req.user;
}

function parseForecastQuery(req: Request): Omit<ForecastOptions, "timezone"> {
  const parsed = forecastQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  return {
    forecastDays: parsed.data.forecastDays,
    lookbackDays: parsed.data.lookbackDays,
  };
}

// ── Handlers factory ──────────────────────────────────────────────────────────

function createForecastHandlers(deps: AppDependencies) {
  const forecastService = createForecastService(
    deps.inventoryRepository,
    deps.catalogRepository,
    deps.rosterRepository,
    deps.timesheetRepository,
  );

  /**
   * Resolves the IANA timezone for the queried clinic.
   * Throws 404 CLINIC_NOT_FOUND if the clinic record does not exist — the
   * unsafe fallback to "Australia/Sydney" has been eliminated because silently
   * proceeding with a wrong timezone produces subtly incorrect forecast windows
   * and masks the underlying data integrity issue.
   */
  async function resolveTimezone(clinicId: string): Promise<string> {
    const clinic = await deps.clinicRepository.findById(clinicId);
    if (!clinic) {
      throw new AppError(
        404,
        "CLINIC_NOT_FOUND",
        "The requested clinic resource does not exist.",
      );
    }
    return clinic.timezone;
  }

  return {
    async getMaterials(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const queryOptions = parseForecastQuery(req);
      const timezone = await resolveTimezone(clinicId);

      const projections = await forecastService.getMaterialForecast(
        caller,
        clinicId,
        { ...queryOptions, timezone },
      );

      res.status(200).json({ data: projections });
    },

    async getAlerts(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");
      const queryOptions = parseForecastQuery(req);
      const timezone = await resolveTimezone(clinicId);

      const alerts = await forecastService.getMaterialAlerts(
        caller,
        clinicId,
        { ...queryOptions, timezone },
      );

      res.status(200).json({ data: alerts });
    },
  };
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createForecastRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const handlers = createForecastHandlers(deps);

  // All forecast routes require authentication.
  router.use(authenticate);

  // enforceTenantParam ensures the session token's homeClinicId matches the
  // :clinicId URL segment (owner_admin is exempt — they can query any clinic).
  router.use(enforceTenantParam("clinicId"));

  // GET /clinics/:clinicId/forecast/materials
  router.get(
    "/materials",
    requireRoles(...FORECAST_READ_ROLES),
    asyncHandler((req, res) => handlers.getMaterials(req, res)),
  );

  // GET /clinics/:clinicId/forecast/alerts
  router.get(
    "/alerts",
    requireRoles(...FORECAST_READ_ROLES),
    asyncHandler((req, res) => handlers.getAlerts(req, res)),
  );

  return router;
}
