import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  AuditEvent,
  AuditEventsPage,
  AllClinicsDashboardKpis,
  CreateAuditEventInput,
  DashboardKpis,
  InventoryReport,
  InventoryReportRow,
  ListAuditEventsOptions,
  RevenueReport,
  RevenueReportRow,
  StaffReport,
  StaffReportRow,
} from "../types/analytics.js";
import type { AnalyticsRepository } from "../repositories/analyticsRepository.js";
import type { BillingRepository } from "../repositories/billingRepository.js";
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// RBAC guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analytics data is management-only. `clinical_staff` cannot access any report
 * or the audit trail — they have no need for aggregate business data.
 */
function assertAnalyticsAccess(
  caller: AuthenticatedUser,
  clinicId: string,
): void {
  if (caller.role !== "owner_admin" && caller.role !== "group_practice_manager") {
    throw new AppError(
      403,
      "ANALYTICS_FORBIDDEN",
      "Only managers and administrators can access analytics and audit reports",
    );
  }
  if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
    throw new AppError(
      403,
      "ANALYTICS_TENANT_VIOLATION",
      "Your token is not authorised to access analytics for this clinic",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (no external date libraries)
// ─────────────────────────────────────────────────────────────────────────────

function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodStartDate(periodDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - periodDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Extracts YYYY-MM from a Date for monthly bucketing. */
function toYearMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Returns the first Date of `monthsBack` months ago, UTC midnight. */
function monthsAgoStart(monthsBack: number): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;

export function createAnalyticsService(
  analyticsRepository: AnalyticsRepository,
  billingRepository: BillingRepository,
  inventoryRepository: InventoryRepository,
  rosterRepository: RosterRepository,
  userRepository: UserRepository,
  clinicRepository: ClinicRepository,
) {
  // ── Audit trail ────────────────────────────────────────────────────────────

  /**
   * Persist a structured audit event. Called internally by other services.
   * No RBAC check — callers must have already validated the user.
   */
  async function recordAuditEvent(
    input: CreateAuditEventInput,
  ): Promise<AuditEvent> {
    return analyticsRepository.recordEvent(input);
  }

  async function listAuditEvents(
    caller: AuthenticatedUser,
    clinicId: string,
    options?: ListAuditEventsOptions,
  ): Promise<AuditEventsPage> {
    assertAnalyticsAccess(caller, clinicId);
    return analyticsRepository.listEvents(clinicId, options);
  }

  async function getAuditEvent(
    caller: AuthenticatedUser,
    clinicId: string,
    eventId: string,
  ): Promise<AuditEvent> {
    assertAnalyticsAccess(caller, clinicId);
    const event = await analyticsRepository.getEvent(eventId, clinicId);
    if (!event) {
      throw new AppError(
        404,
        "AUDIT_EVENT_NOT_FOUND",
        `Audit event ${eventId} not found`,
      );
    }
    return event;
  }

  // ── Dashboard KPIs ─────────────────────────────────────────────────────────

  async function getDashboardKpis(
    caller: AuthenticatedUser,
    clinicId: string,
    periodDays = 30,
  ): Promise<DashboardKpis> {
    assertAnalyticsAccess(caller, clinicId);

    const clampedDays = Math.min(Math.max(periodDays, 1), 365);
    const since = periodStartDate(clampedDays);

    // ── Revenue summary ────────────────────────────────────────────────────
    const invoices = await billingRepository.listInvoices(clinicId);
    const periodInvoices = invoices.filter(
      (inv) =>
        inv.createdAt >= since &&
        inv.status !== "void" &&
        inv.status !== "cancelled",
    );

    const revenueSummary = {
      totalRevenueCents: periodInvoices.reduce(
        (sum, inv) => sum + inv.totalCents,
        0,
      ),
      paidCents: periodInvoices.reduce((sum, inv) => sum + inv.paidCents, 0),
      outstandingCents: periodInvoices.reduce(
        (sum, inv) => sum + Math.max(0, inv.outstandingCents),
        0,
      ),
      overdueCount: periodInvoices.filter((inv) => inv.status === "overdue")
        .length,
      invoiceCount: periodInvoices.length,
    };

    // ── Inventory summary ──────────────────────────────────────────────────
    const stockItems = await inventoryRepository.listClinicInventory(clinicId);
    const adjustments = await inventoryRepository.listAdjustments(clinicId);
    const periodAdjustments = adjustments.filter(
      (adj) => adj.createdAt >= since,
    );

    const consumptionMap = await inventoryRepository.getConsumptionVolume(
      clinicId,
      { type: "scan_deduct", since },
    );

    const sortedByConsumption = Array.from(consumptionMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topConsumedSkus = sortedByConsumption.map(([masterItemId, unitsConsumed]) => {
      const item = stockItems.find(
        (s) => s.masterCatalogItemId === masterItemId,
      );
      return {
        sku: item?.masterSku ?? masterItemId,
        name: item?.name ?? "Unknown",
        unitsConsumed,
      };
    });

    const inventorySummary = {
      totalItems: stockItems.length,
      lowStockCount: stockItems.filter((s) => s.isBelowReorderPoint).length,
      adjustmentsCount: periodAdjustments.length,
      topConsumedSkus,
    };

    // ── Roster summary ─────────────────────────────────────────────────────
    const rosterEntries = await rosterRepository.listByClinic(clinicId, {
      from: since,
    });

    const uniqueStaff = new Set(
      rosterEntries
        .filter((e) => e.status !== "cancelled")
        .map((e) => e.staffUserId),
    );

    const rosterSummary = {
      shiftsScheduled: rosterEntries.filter((e) => e.status === "scheduled")
        .length,
      shiftsCompleted: rosterEntries.filter((e) => e.status === "completed")
        .length,
      shiftsCancelled: rosterEntries.filter((e) => e.status === "cancelled")
        .length,
      uniqueStaffCount: uniqueStaff.size,
    };

    return {
      clinicId,
      periodDays: clampedDays,
      periodFrom: toISODateString(since),
      periodTo: toISODateString(new Date()),
      revenue: revenueSummary,
      inventory: inventorySummary,
      roster: rosterSummary,
    };
  }

  async function getAllClinicsDashboardKpis(
    caller: AuthenticatedUser,
    periodDays = 30,
  ): Promise<AllClinicsDashboardKpis> {
    if (caller.role !== "owner_admin") {
      throw new AppError(
        403,
        "ANALYTICS_FORBIDDEN",
        "Only owner administrators can access all-clinics analytics",
      );
    }

    const clampedDays = Math.min(Math.max(periodDays, 1), 365);
    const since = periodStartDate(clampedDays);
    const clinics = await clinicRepository.findAll();
    const breakdowns = await Promise.all(
      clinics.map(async (clinic) => ({
        clinicId: clinic.id,
        clinicName: clinic.name,
        kpis: await getDashboardKpis(caller, clinic.id, clampedDays),
      })),
    );

    const topConsumedBySku = new Map<
      string,
      { sku: string; name: string; unitsConsumed: number }
    >();

    for (const breakdown of breakdowns) {
      for (const item of breakdown.kpis.inventory.topConsumedSkus) {
        const key = item.sku;
        const existing = topConsumedBySku.get(key);
        topConsumedBySku.set(key, {
          sku: item.sku,
          name: existing?.name ?? item.name,
          unitsConsumed: (existing?.unitsConsumed ?? 0) + item.unitsConsumed,
        });
      }
    }

    return {
      scope: "all_clinics",
      periodDays: clampedDays,
      periodFrom: breakdowns[0]?.kpis.periodFrom ?? toISODateString(since),
      periodTo: breakdowns[0]?.kpis.periodTo ?? toISODateString(new Date()),
      clinicCount: breakdowns.length,
      revenue: {
        totalRevenueCents: breakdowns.reduce(
          (sum, item) => sum + item.kpis.revenue.totalRevenueCents,
          0,
        ),
        paidCents: breakdowns.reduce((sum, item) => sum + item.kpis.revenue.paidCents, 0),
        outstandingCents: breakdowns.reduce(
          (sum, item) => sum + item.kpis.revenue.outstandingCents,
          0,
        ),
        overdueCount: breakdowns.reduce((sum, item) => sum + item.kpis.revenue.overdueCount, 0),
        invoiceCount: breakdowns.reduce((sum, item) => sum + item.kpis.revenue.invoiceCount, 0),
      },
      inventory: {
        totalItems: breakdowns.reduce((sum, item) => sum + item.kpis.inventory.totalItems, 0),
        lowStockCount: breakdowns.reduce(
          (sum, item) => sum + item.kpis.inventory.lowStockCount,
          0,
        ),
        adjustmentsCount: breakdowns.reduce(
          (sum, item) => sum + item.kpis.inventory.adjustmentsCount,
          0,
        ),
        topConsumedSkus: Array.from(topConsumedBySku.values())
          .sort((a, b) => b.unitsConsumed - a.unitsConsumed)
          .slice(0, 5),
      },
      roster: {
        shiftsScheduled: breakdowns.reduce(
          (sum, item) => sum + item.kpis.roster.shiftsScheduled,
          0,
        ),
        shiftsCompleted: breakdowns.reduce(
          (sum, item) => sum + item.kpis.roster.shiftsCompleted,
          0,
        ),
        shiftsCancelled: breakdowns.reduce(
          (sum, item) => sum + item.kpis.roster.shiftsCancelled,
          0,
        ),
        uniqueStaffCount: breakdowns.reduce(
          (sum, item) => sum + item.kpis.roster.uniqueStaffCount,
          0,
        ),
      },
      clinics: breakdowns,
    };
  }

  // ── Revenue report ─────────────────────────────────────────────────────────

  async function getRevenueReport(
    caller: AuthenticatedUser,
    clinicId: string,
    months = 12,
  ): Promise<RevenueReport> {
    assertAnalyticsAccess(caller, clinicId);

    const clampedMonths = Math.min(Math.max(months, 1), 24);
    const since = monthsAgoStart(clampedMonths);

    const invoices = await billingRepository.listInvoices(clinicId);
    const eligible = invoices.filter(
      (inv) =>
        inv.createdAt >= since &&
        inv.status !== "void" &&
        inv.status !== "cancelled",
    );

    // Bucket by YYYY-MM
    const buckets = new Map<string, RevenueReportRow>();

    for (const inv of eligible) {
      const period = toYearMonth(inv.createdAt);
      if (!buckets.has(period)) {
        buckets.set(period, {
          period,
          invoiceCount: 0,
          paidCount: 0,
          overdueCount: 0,
          totalRevenueCents: 0,
          paidCents: 0,
          outstandingCents: 0,
        });
      }
      const row = buckets.get(period);
      if (!row) continue;
      row.invoiceCount++;
      row.totalRevenueCents += inv.totalCents;
      row.paidCents += inv.paidCents;
      row.outstandingCents += Math.max(0, inv.outstandingCents);
      if (inv.status === "paid") row.paidCount++;
      if (inv.status === "overdue") row.overdueCount++;
    }

    const rows = Array.from(buckets.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    return {
      clinicId,
      months: clampedMonths,
      rows,
      grandTotalRevenueCents: rows.reduce(
        (sum, r) => sum + r.totalRevenueCents,
        0,
      ),
      grandTotalPaidCents: rows.reduce((sum, r) => sum + r.paidCents, 0),
      grandTotalOutstandingCents: rows.reduce(
        (sum, r) => sum + r.outstandingCents,
        0,
      ),
    };
  }

  // ── Inventory report ───────────────────────────────────────────────────────

  async function getInventoryReport(
    caller: AuthenticatedUser,
    clinicId: string,
    periodDays = 30,
  ): Promise<InventoryReport> {
    assertAnalyticsAccess(caller, clinicId);

    const clampedDays = Math.min(Math.max(periodDays, 1), 365);
    const since = periodStartDate(clampedDays);

    const [stockItems, consumptionMap] = await Promise.all([
      inventoryRepository.listClinicInventory(clinicId),
      inventoryRepository.getConsumptionVolume(clinicId, {
        type: "scan_deduct",
        since,
      }),
    ]);

    const rows: InventoryReportRow[] = stockItems.map((item) => ({
      masterItemId: item.masterCatalogItemId,
      sku: item.masterSku,
      name: item.name,
      currentStock: item.quantityOnHand,
      reorderThreshold: item.reorderPoint,
      isLowStock: item.isBelowReorderPoint,
      totalConsumedPeriod: consumptionMap.get(item.masterCatalogItemId) ?? 0,
    }));

    rows.sort((a, b) => b.totalConsumedPeriod - a.totalConsumedPeriod);

    return {
      clinicId,
      rows,
      totalItems: rows.length,
      totalLowStockItems: rows.filter((r) => r.isLowStock).length,
    };
  }

  // ── Staff report ───────────────────────────────────────────────────────────

  async function getStaffReport(
    caller: AuthenticatedUser,
    clinicId: string,
    periodDays = 30,
  ): Promise<StaffReport> {
    assertAnalyticsAccess(caller, clinicId);

    const clampedDays = Math.min(Math.max(periodDays, 1), 365);
    const since = periodStartDate(clampedDays);

    const [users, rosterEntries] = await Promise.all([
      userRepository.listByClinic(clinicId),
      rosterRepository.listByClinic(clinicId, { from: since }),
    ]);

    // Group roster entries by staffUserId
    const shiftsByUser = new Map<string, typeof rosterEntries>();
    for (const entry of rosterEntries) {
      const existing = shiftsByUser.get(entry.staffUserId) ?? [];
      existing.push(entry);
      shiftsByUser.set(entry.staffUserId, existing);
    }

    const rows: StaffReportRow[] = users.map((user) => {
      const shifts = shiftsByUser.get(user.id) ?? [];
      const total = shifts.length;
      const completed = shifts.filter((s) => s.status === "completed").length;
      const cancelled = shifts.filter((s) => s.status === "cancelled").length;
      const scheduled = shifts.filter((s) => s.status === "scheduled").length;
      const eligible = total - cancelled;
      const attendanceRatePct =
        eligible > 0 ? Math.round((completed / eligible) * 100) : 0;

      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        totalShifts: total,
        completedShifts: completed,
        cancelledShifts: cancelled,
        scheduledShifts: scheduled,
        attendanceRatePct,
      };
    });

    // Sort by most shifts descending (active staff first)
    rows.sort((a, b) => b.totalShifts - a.totalShifts);

    return {
      clinicId,
      periodDays: clampedDays,
      rows,
    };
  }

  return {
    recordAuditEvent,
    listAuditEvents,
    getAuditEvent,
    getDashboardKpis,
    getAllClinicsDashboardKpis,
    getRevenueReport,
    getInventoryReport,
    getStaffReport,
  };
}
