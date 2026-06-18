/**
 * laborForecastRoutes.ts
 *
 * Authenticated, tenant-isolated Express router for the Labor Cost Projection
 * Engine.  Mounted at `/clinics/:clinicId/forecast` in routes/index.ts,
 * exposing a single endpoint:
 *
 *   GET /clinics/:clinicId/forecast/labor
 *     Returns the full labor cost projection summary for the clinic including
 *     per-role breakdowns, base costs, overhead costs, and grand totals.
 *
 * Multi-tenant isolation is enforced at two independent layers:
 *   1. Route layer  — enforceTenantParam("clinicId") rejects any token whose
 *      homeClinicId does not match the :clinicId URL segment (owner_admin is
 *      the only role exempt).
 *   2. Service layer — LaborForecastService.assertTenantAccess() performs the
 *      same check independently, so a misconfigured router cannot bypass it.
 *
 * RBAC gate:
 *   Labor cost data is financial — only owner_admin and group_practice_manager
 *   are permitted.  clinical_staff is denied at both the route layer (requireRoles)
 *   and the service layer (assertFinancialAccess), providing defence in depth.
 *
 * Monetary serialisation:
 *   LaborForecastService returns all cost fields as INTEGER AUD CENTS to ensure
 *   deterministic ledger arithmetic.  This handler divides every cost field by
 *   100 before writing the JSON response so the client receives fractional AUD
 *   dollar amounts (e.g. 45000 cents → 450.00 dollars).  The division-by-100
 *   step must remain exclusively in this layer — never inside the service.
 *
 * Timezone calibration:
 *   The clinic's IANA timezone is fetched from clinicRepository and forwarded
 *   to the service via LaborForecastOptions.timezone so that lookback and
 *   forecast windows are anchored to clinic-local calendar-day boundaries.
 *
 * Query parameters:
 *   forecastDays  (integer, 1–90, default 14) — forward-looking window in days.
 */

import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createLaborForecastService } from "../services/laborForecastService.js";
import type { LaborForecastSummary, RoleLaborProjection } from "../services/laborForecastService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ── Role gates ────────────────────────────────────────────────────────────────

/**
 * Roles permitted to view labor cost / financial forecast data.
 * clinical_staff is intentionally excluded — it must not see raw cost figures.
 */
const LABOR_FORECAST_ROLES = ["owner_admin", "group_practice_manager"] as const;

// ── Query parameter schema ─────────────────────────────────────────────────────

/**
 * Strict digits-only pattern.  Rejects mixed strings like "14abc" that
 * parseInt would silently truncate to 14, producing a deceptive valid result.
 */
const DIGITS_ONLY = /^\d+$/;

/**
 * Validates the optional `forecastDays` query string parameter.
 * Applies a strict digits-only regex before parseInt so that values like
 * "14abc" are rejected at the perimeter rather than silently coerced to 14.
 */
const laborForecastQuerySchema = z.object({
  forecastDays: z
    .string()
    .regex(DIGITS_ONLY, "forecastDays must contain digits only")
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(90).optional()),
});

// ── Shared helpers ────────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts and validates a UUID path parameter.
 * Throws 400 INVALID_PARAM when the value is absent or malformed.
 */
function requireUuidParam(req: Request, paramName: string): string {
  const raw = req.params[paramName];
  const value = typeof raw === "string" ? raw : "";

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

/**
 * Asserts that req.user is populated (authentication middleware must run first).
 * Returns the authenticated user or throws 401 UNAUTHORIZED.
 */
function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }

  return req.user;
}

// ── Monetary serialisation ────────────────────────────────────────────────────

/**
 * API payload shape for a per-role row — cost fields expressed in AUD dollars
 * (2 decimal places) rather than the integer cents stored by the service.
 */
type RoleLaborProjectionDTO = Omit<
  RoleLaborProjection,
  "projectedBaseCost" | "projectedOverheadCost" | "totalProjectedCost"
> & {
  /** AUD dollars (e.g. 450.00). */
  projectedBaseCost: number;
  /** AUD dollars (e.g. 67.50). */
  projectedOverheadCost: number;
  /** AUD dollars (e.g. 517.50). */
  totalProjectedCost: number;
};

/**
 * API payload shape for the top-level summary — cost totals in AUD dollars.
 */
type LaborForecastSummaryDTO = Omit<
  LaborForecastSummary,
  | "totalProjectedBaseCost"
  | "totalProjectedOverheadCost"
  | "grandTotalProjectedCost"
  | "breakdownByRole"
> & {
  /** AUD dollars. */
  totalProjectedBaseCost: number;
  /** AUD dollars. */
  totalProjectedOverheadCost: number;
  /** AUD dollars. */
  grandTotalProjectedCost: number;
  breakdownByRole: RoleLaborProjectionDTO[];
};

/**
 * Converts a LaborForecastSummary (integer cents) to the JSON-safe DTO
 * (fractional AUD dollars) for the API response.
 *
 * Division by 100 is performed exclusively here — never inside the service.
 */
function toSummaryDTO(summary: LaborForecastSummary): LaborForecastSummaryDTO {
  return {
    clinicId: summary.clinicId,
    forecastWindowDays: summary.forecastWindowDays,
    totalProjectedHours: summary.totalProjectedHours,
    totalProjectedBaseCost: summary.totalProjectedBaseCost / 100,
    totalProjectedOverheadCost: summary.totalProjectedOverheadCost / 100,
    grandTotalProjectedCost: summary.grandTotalProjectedCost / 100,
    breakdownByRole: summary.breakdownByRole.map((row) => ({
      role: row.role,
      totalScheduledHours: row.totalScheduledHours,
      projectedBaseCost: row.projectedBaseCost / 100,
      projectedOverheadCost: row.projectedOverheadCost / 100,
      totalProjectedCost: row.totalProjectedCost / 100,
    })),
  };
}

// ── Handlers factory ──────────────────────────────────────────────────────────

/**
 * Creates the route handler(s) with the labor forecast service injected from
 * AppDependencies.  The service is instantiated once per router lifecycle,
 * not per request.
 */
function createLaborForecastHandlers(deps: AppDependencies) {
  const laborForecastService = createLaborForecastService(
    deps.rosterRepository,
    deps.timesheetRepository,
  );

  return {
    /**
     * GET /clinics/:clinicId/forecast/labor
     *
     * 1. Parses and validates the forecastDays query parameter.
     * 2. Fetches the clinic's IANA timezone from clinicRepository and passes it
     *    to the service so boundaries are computed in clinic-local time.
     * 3. Delegates to LaborForecastService.getLaborForecast (returns cents).
     * 4. Converts cents → dollars via toSummaryDTO before writing the response.
     */
    async getLaborForecast(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");

      const parsed = laborForecastQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      // Resolve clinic timezone for calendar-day boundary calibration.
      // A missing clinic is a hard 404 — the unsafe "Australia/Sydney" fallback
      // has been removed because it masks missing data and silently produces
      // mis-anchored forecast windows for non-Sydney clinics.
      const clinic = await deps.clinicRepository.findById(clinicId);
      if (!clinic) {
        throw new AppError(
          404,
          "CLINIC_NOT_FOUND",
          "The requested clinic resource does not exist.",
        );
      }
      const timezone = clinic.timezone;

      const summary = await laborForecastService.getLaborForecast(caller, clinicId, {
        forecastDays: parsed.data.forecastDays,
        timezone,
      });

      res.status(200).json({ data: toSummaryDTO(summary) });
    },
  };
}

// ── Router factory ────────────────────────────────────────────────────────────

/**
 * Builds the Express router for the Labor Cost Forecast endpoint.
 *
 * Mounting in routes/index.ts:
 *   router.use("/clinics/:clinicId/forecast", createLaborForecastRouter(deps));
 *
 * This co-mounts alongside createForecastRouter at the same prefix so that
 * both /forecast/materials and /forecast/labor are handled by their respective
 * routers — Express matches each request against registered routes in order.
 *
 * mergeParams: true is required so that :clinicId from the parent router is
 * accessible inside this child router (same convention as forecastRoutes.ts).
 */
export function createLaborForecastRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });

  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );

  const handlers = createLaborForecastHandlers(deps);

  // All labor forecast routes require a valid access token.
  router.use(authenticate);

  // Tenant isolation: the session token's homeClinicId must match :clinicId.
  // owner_admin is exempt and may query any clinic.
  router.use(enforceTenantParam("clinicId"));

  // GET /clinics/:clinicId/forecast/labor
  router.get(
    "/labor",
    requireRoles(...LABOR_FORECAST_ROLES),
    asyncHandler((req, res) => handlers.getLaborForecast(req, res)),
  );

  return router;
}
