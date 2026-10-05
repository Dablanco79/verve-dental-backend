/**
 * laborForecastRoutes.ts
 *
 * Authenticated, tenant-isolated Express router for the Labour Cost Analysis
 * engine.  Mounted at `/clinics/:clinicId/forecast` in routes/index.ts.
 *
 *   GET /clinics/:clinicId/forecast/labor
 *
 * Query parameters (all optional):
 *   from          (YYYY-MM-DD) — start of analysis window (clinic-local).
 *   to            (YYYY-MM-DD) — end of analysis window inclusive (clinic-local).
 *   forecastDays  (integer 1–90) — convenience shorthand: sets from=today,
 *                 to=today+forecastDays.  Ignored when from/to are present.
 *
 * When neither from/to nor forecastDays is provided the default is a 14-day
 * future-only window (forecastDays=14), matching prior behaviour.
 *
 * RBAC: owner_admin and group_practice_manager only.
 * Per-staff rate/cost fields are redacted for callers without "payroll:rates:read".
 *
 * Monetary serialisation:
 *   All cost fields from the service are INTEGER AUD CENTS.
 *   This handler divides by 100 before writing JSON (e.g. 45000 → 450.00).
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
import type {
  CostBreakdown,
  DataQuality,
  ExceptionSummary,
  FutureForecastSection,
  GroupClinicAnalysis,
  GroupLaborCostAnalysis,
  HistoricalBreakdown,
  LaborCostAnalysis,
  PlanningEstimate,
  ShiftTypeProjection,
  StaffCostBreakdown,
} from "../services/laborForecastService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ── Role gates ────────────────────────────────────────────────────────────────

const LABOR_FORECAST_ROLES = ["owner_admin", "group_practice_manager"] as const;

// ── Query parameter schema ─────────────────────────────────────────────────────

const DIGITS_ONLY = /^\d+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const laborForecastQuerySchema = z.object({
  /** Legacy shorthand: forward-only window. Ignored when from/to present. */
  forecastDays: z
    .string()
    .regex(DIGITS_ONLY, "forecastDays must contain digits only")
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(90).optional()),
  /** Start of analysis window, clinic-local YYYY-MM-DD. */
  from: z
    .string()
    .regex(DATE_REGEX, "from must be YYYY-MM-DD")
    .optional(),
  /** End of analysis window, clinic-local YYYY-MM-DD (inclusive). */
  to: z
    .string()
    .regex(DATE_REGEX, "to must be YYYY-MM-DD")
    .optional(),
});

// ── Shared helpers ────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(req: Request, paramName: string): string {
  const raw = req.params[paramName];
  const value = typeof raw === "string" ? raw : "";
  if (!UUID_REGEX.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
      { field: paramName, message: `${paramName} must be a valid UUID` },
    ]);
  }
  return value;
}

function requireUser(req: Request) {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.user;
}

/** Returns clinic-local today as YYYY-MM-DD using the clinic's IANA timezone. */
function localToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Adds N calendar days to a YYYY-MM-DD string. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ── DTO serialisation (cents → dollars) ───────────────────────────────────────

type CostBreakdownDTO = {
  hours: number;
  baseCost: number | null;
  superCost: number | null;
  totalCost: number | null;
};

type ExceptionSummaryDTO = ExceptionSummary;

type HistoricalBreakdownDTO = {
  approved: CostBreakdownDTO;
  pending: CostBreakdownDTO;
  rejected: CostBreakdownDTO;
  requiresAmendment: CostBreakdownDTO;
  incomplete: ExceptionSummaryDTO;
  missing: ExceptionSummaryDTO;
};

type ShiftTypeProjectionDTO = {
  shiftType: string;
  projectedHours: number;
  baseCost: number | null;
  superCost: number | null;
  totalCost: number | null;
  usingFallbackForSomeStaff: boolean;
};

type FutureForecastDTO = {
  totalHours: number;
  baseCost: number | null;
  superCost: number | null;
  totalCost: number | null;
  anyStaffUsingFallback: boolean;
  breakdownByShiftType: ShiftTypeProjectionDTO[];
};

type PlanningEstimateDTO = {
  approvedCost: number | null;
  pendingCost: number | null;
  futureCost: number | null;
  totalCost: number | null;
};

type StaffCostBreakdownDTO = {
  staffUserId: string;
  staffEmail: string;
  approvedHours: number;
  pendingHours: number;
  rejectedHours: number;
  requiresAmendmentHours: number;
  incompleteCount: number;
  incompleteScheduledHours: number;
  missingShiftCount: number;
  missingScheduledHours: number;
  futureProjectedHours: number;
  // null when redacted
  baseHourlyRate: number | null;
  superRatePercent: number | null;
  rateSource: "configured" | "fallback" | null;
  approvedCost: number | null;
  pendingCost: number | null;
  rejectedCost: number | null;
  requiresAmendmentCost: number | null;
  futureCost: number | null;
};

type LaborCostAnalysisDTO = {
  clinicId: string;
  dateRange: { from: string; to: string; timezone: string };
  historical: HistoricalBreakdownDTO | null;
  futureForecast: FutureForecastDTO | null;
  planningEstimate: PlanningEstimateDTO;
  staffBreakdown: StaffCostBreakdownDTO[];
  dataQuality: DataQuality;
};

type GroupLaborTotalsDTO = {
  totalHours: number;
  approvedCost: number | null;
  pendingCost: number | null;
  futureCost: number | null;
  totalCost: number | null;
  missingCount: number;
};

type GroupClinicAnalysisDTO = {
  clinicId: string;
  clinicName: string;
  timezone: string;
  analysis: LaborCostAnalysisDTO;
};

type GroupLaborCostAnalysisDTO = {
  scope: "all_clinics";
  dateRange: { from: string; to: string };
  totals: GroupLaborTotalsDTO;
  clinics: GroupClinicAnalysisDTO[];
};

function c2d(cents: number): number { return cents / 100; }
function c2dN(cents: number | null): number | null { return cents !== null ? cents / 100 : null; }

function toCostBreakdownDTO(b: CostBreakdown): CostBreakdownDTO {
  return {
    hours: b.hours,
    baseCost:  c2dN(b.baseCostCents),
    superCost: c2dN(b.superCostCents),
    totalCost: c2dN(b.totalCostCents),
  };
}

function toShiftTypeProjectionDTO(p: ShiftTypeProjection): ShiftTypeProjectionDTO {
  return {
    shiftType: p.shiftType,
    projectedHours: p.projectedHours,
    baseCost:  c2dN(p.baseCostCents),
    superCost: c2dN(p.superCostCents),
    totalCost: c2dN(p.totalCostCents),
    usingFallbackForSomeStaff: p.usingFallbackForSomeStaff,
  };
}

function toHistoricalDTO(h: HistoricalBreakdown): HistoricalBreakdownDTO {
  return {
    approved:          toCostBreakdownDTO(h.approved),
    pending:           toCostBreakdownDTO(h.pending),
    rejected:          toCostBreakdownDTO(h.rejected),
    requiresAmendment: toCostBreakdownDTO(h.requiresAmendment),
    incomplete:        h.incomplete,
    missing:           h.missing,
  };
}

function toFutureForecastDTO(f: FutureForecastSection): FutureForecastDTO {
  return {
    totalHours: f.totalHours,
    baseCost:  c2dN(f.baseCostCents),
    superCost: c2dN(f.superCostCents),
    totalCost: c2dN(f.totalCostCents),
    anyStaffUsingFallback: f.anyStaffUsingFallback,
    breakdownByShiftType: f.breakdownByShiftType.map(toShiftTypeProjectionDTO),
  };
}

function toPlanningEstimateDTO(p: PlanningEstimate): PlanningEstimateDTO {
  return {
    approvedCost: c2dN(p.approvedCostCents),
    pendingCost:  c2dN(p.pendingCostCents),
    futureCost:   c2dN(p.futureCostCents),
    totalCost:    c2dN(p.totalCostCents),
  };
}

function toStaffBreakdownDTO(s: StaffCostBreakdown): StaffCostBreakdownDTO {
  return {
    staffUserId: s.staffUserId,
    staffEmail: s.staffEmail,
    approvedHours: s.approvedHours,
    pendingHours: s.pendingHours,
    rejectedHours: s.rejectedHours,
    requiresAmendmentHours: s.requiresAmendmentHours,
    incompleteCount: s.incompleteCount,
    incompleteScheduledHours: s.incompleteScheduledHours,
    missingShiftCount: s.missingShiftCount,
    missingScheduledHours: s.missingScheduledHours,
    futureProjectedHours: s.futureProjectedHours,
    baseHourlyRate: s.baseHourlyRateCents !== null ? c2d(s.baseHourlyRateCents) : null,
    superRatePercent: s.superRatePercent,
    rateSource: s.rateSource,
    approvedCost: s.approvedCostCents !== null ? c2d(s.approvedCostCents) : null,
    pendingCost: s.pendingCostCents !== null ? c2d(s.pendingCostCents) : null,
    rejectedCost: s.rejectedCostCents !== null ? c2d(s.rejectedCostCents) : null,
    requiresAmendmentCost: s.requiresAmendmentCostCents !== null ? c2d(s.requiresAmendmentCostCents) : null,
    futureCost: s.futureCostCents !== null ? c2d(s.futureCostCents) : null,
  };
}

function toAnalysisDTO(analysis: LaborCostAnalysis): LaborCostAnalysisDTO {
  return {
    clinicId: analysis.clinicId,
    dateRange: analysis.dateRange,
    historical: analysis.historical ? toHistoricalDTO(analysis.historical) : null,
    futureForecast: analysis.futureForecast ? toFutureForecastDTO(analysis.futureForecast) : null,
    planningEstimate: toPlanningEstimateDTO(analysis.planningEstimate),
    staffBreakdown: analysis.staffBreakdown.map(toStaffBreakdownDTO),
    dataQuality: analysis.dataQuality,
  };
}

function toGroupAnalysisDTO(group: GroupLaborCostAnalysis): GroupLaborCostAnalysisDTO {
  return {
    scope: group.scope,
    dateRange: group.dateRange,
    totals: {
      totalHours: group.totals.totalHours,
      approvedCost: c2dN(group.totals.approvedCostCents),
      pendingCost:  c2dN(group.totals.pendingCostCents),
      futureCost:   c2dN(group.totals.futureCostCents),
      totalCost:    c2dN(group.totals.totalCostCents),
      missingCount: group.totals.missingCount,
    },
    clinics: group.clinics.map((entry: GroupClinicAnalysis) => ({
      clinicId: entry.clinicId,
      clinicName: entry.clinicName,
      timezone: entry.timezone,
      analysis: toAnalysisDTO(entry.analysis),
    })),
  };
}

// ── Handlers factory ──────────────────────────────────────────────────────────

function createLaborForecastHandlers(deps: AppDependencies) {
  const laborForecastService = createLaborForecastService(
    deps.rosterRepository,
    deps.timesheetRepository,
    deps.staffPayRateRepository,
    deps.userRepository,
    deps.clinicRepository,
  );

  return {
    async getLaborForecast(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);
      const clinicId = requireUuidParam(req, "clinicId");

      const parsed = laborForecastQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      const clinic = await deps.clinicRepository.findById(clinicId);
      if (!clinic) {
        throw new AppError(404, "CLINIC_NOT_FOUND", "The requested clinic resource does not exist.");
      }
      const timezone = clinic.timezone;

      const today = localToday(timezone);

      // Resolve from/to: explicit dates take precedence over forecastDays.
      let fromDate: string;
      let toDate: string;

      if (parsed.data.from !== undefined && parsed.data.to !== undefined) {
        fromDate = parsed.data.from;
        toDate = parsed.data.to;
      } else if (parsed.data.from !== undefined || parsed.data.to !== undefined) {
        // Partial: both from and to are required when either is provided.
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Both from and to must be provided together",
          [{ field: "from", message: "from and to must both be provided" }],
        );
      } else {
        // Legacy / default: forecastDays forward from today
        const days = parsed.data.forecastDays ?? 14;
        fromDate = today;
        toDate = addDays(today, days);
      }

      const analysis = await laborForecastService.getLaborCostAnalysis(caller, clinicId, {
        from: fromDate,
        to: toDate,
        timezone,
      });

      res.status(200).json({ data: toAnalysisDTO(analysis) });
    },

    async getGroupLaborForecast(req: Request, res: Response): Promise<void> {
      const caller = requireUser(req);

      const parsed = laborForecastQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", zodToDetails(parsed.error));
      }

      // Resolve date range. For the group endpoint we use a UTC-based today
      // as a neutral reference; each clinic interprets these dates in its own
      // timezone inside getLaborCostAnalysis.
      const utcToday = new Date().toISOString().slice(0, 10);

      let fromDate: string;
      let toDate: string;

      if (parsed.data.from !== undefined && parsed.data.to !== undefined) {
        fromDate = parsed.data.from;
        toDate = parsed.data.to;
      } else if (parsed.data.from !== undefined || parsed.data.to !== undefined) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Both from and to must be provided together",
          [{ field: "from", message: "from and to must both be provided" }],
        );
      } else {
        const days = parsed.data.forecastDays ?? 14;
        fromDate = utcToday;
        toDate = addDays(utcToday, days);
      }

      const group = await laborForecastService.getGroupLaborCostAnalysis(caller, {
        from: fromDate,
        to: toDate,
      });

      res.status(200).json({ data: toGroupAnalysisDTO(group) });
    },
  };
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createLaborForecastRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });

  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createLaborForecastHandlers(deps);

  router.use(authenticate);
  router.use(enforceTenantParam("clinicId"));

  router.get(
    "/labor",
    requireRoles(...LABOR_FORECAST_ROLES),
    asyncHandler((req, res) => handlers.getLaborForecast(req, res)),
  );

  return router;
}

// ── Group router (no clinicId — global owner_admin scope) ─────────────────────

export function createGroupLaborForecastRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });

  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const handlers = createLaborForecastHandlers(deps);

  router.use(authenticate);

  router.get(
    "/labor/group",
    requireRoles("owner_admin"),
    asyncHandler((req, res) => handlers.getGroupLaborForecast(req, res)),
  );

  return router;
}
