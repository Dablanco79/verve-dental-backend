// ─────────────────────────────────────────────────────────────────────────────
// Module 08 — Analytics, Reporting, and Audit Trails (frontend wire types)
//
// Mirrors Backend/src/types/analytics.ts.
// Key difference: all Date fields are typed as string here because they arrive
// as ISO 8601 strings in JSON.  Never mutate these to Date objects in the API
// layer — let consumers parse them as needed.
//
// Monetary values are integer cents.
// Percentages are numeric 0–100.
// Period boundary strings are YYYY-MM-DD in clinic-local timezone.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Audit entity types ───────────────────────────────────────────────────────

export const AUDIT_ENTITY_TYPES = [
  "invoice",
  "payment",
  "line_item",
  "inventory_adjustment",
  "roster_entry",
  "timesheet_entry",
  "leave_request",
  "user",
  "clinic",
  "product",
  "scan",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export type AuditEvent = {
  id: string;
  clinicId: string;
  entityType: AuditEntityType;
  entityId: string;
  /** Free-form verb: "created", "updated", "deleted", "approved", etc. */
  action: string;
  actorId: string;
  actorEmail: string;
  /** Arbitrary structured metadata captured at event time. */
  metadata: Record<string, unknown>;
  /** ISO 8601 string — typed as Date in the backend, string over the wire. */
  createdAt: string;
};

export type AuditEventsPage = {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
};

/** Query parameters accepted by GET /analytics/audit-events */
export type AuditEventsFilters = {
  entityType?: AuditEntityType;
  actorId?: string;
  entityId?: string;
  /** ISO 8601 date string — lower bound of createdAt range */
  from?: string;
  /** ISO 8601 date string — upper bound of createdAt range */
  to?: string;
  limit?: number;
  offset?: number;
};

// ─── Dashboard KPI types ──────────────────────────────────────────────────────

export type DashboardRevenueSummary = {
  /** Sum of total_cents for all non-void/non-cancelled invoices in period. */
  totalRevenueCents: number;
  /** Sum of paid_cents for all non-void/non-cancelled invoices in period. */
  paidCents: number;
  /** Sum of outstanding_cents for all non-void/non-cancelled invoices. */
  outstandingCents: number;
  overdueCount: number;
  invoiceCount: number;
};

export type DashboardInventorySummary = {
  totalItems: number;
  lowStockCount: number;
  /** Number of inventory adjustments recorded in the period. */
  adjustmentsCount: number;
  topConsumedSkus: { sku: string; name: string; unitsConsumed: number }[];
};

export type DashboardRosterSummary = {
  shiftsScheduled: number;
  shiftsCompleted: number;
  shiftsCancelled: number;
  /** Count of distinct staff members with ≥1 non-cancelled shift in period. */
  uniqueStaffCount: number;
};

export type DashboardKpis = {
  clinicId: string;
  periodDays: number;
  /** YYYY-MM-DD */
  periodFrom: string;
  /** YYYY-MM-DD */
  periodTo: string;
  revenue: DashboardRevenueSummary;
  inventory: DashboardInventorySummary;
  roster: DashboardRosterSummary;
};

/** Query parameters accepted by GET /analytics/dashboard */
export type DashboardFilters = {
  /** Number of trailing days to include (default decided by backend). */
  periodDays?: number;
};

// ─── Revenue report types ─────────────────────────────────────────────────────

export type RevenueReportRow = {
  /** Calendar month in clinic-local timezone: YYYY-MM */
  period: string;
  invoiceCount: number;
  paidCount: number;
  overdueCount: number;
  totalRevenueCents: number;
  paidCents: number;
  outstandingCents: number;
};

export type RevenueReport = {
  clinicId: string;
  months: number;
  rows: RevenueReportRow[];
  grandTotalRevenueCents: number;
  grandTotalPaidCents: number;
  grandTotalOutstandingCents: number;
};

/** Query parameters accepted by GET /analytics/revenue */
export type RevenueReportFilters = {
  /** Number of calendar months to include (default decided by backend). */
  months?: number;
};

// ─── Inventory report types ───────────────────────────────────────────────────

export type InventoryReportRow = {
  masterItemId: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderThreshold: number;
  isLowStock: boolean;
  /** Total units consumed (scan_deduct adjustments) in the report period. */
  totalConsumedPeriod: number;
};

export type InventoryReport = {
  clinicId: string;
  rows: InventoryReportRow[];
  totalItems: number;
  totalLowStockItems: number;
};

// ─── Staff report types ───────────────────────────────────────────────────────

export type StaffReportRow = {
  userId: string;
  email: string;
  role: string;
  totalShifts: number;
  completedShifts: number;
  cancelledShifts: number;
  scheduledShifts: number;
  /** completedShifts / eligibleShifts * 100 (eligibleShifts excludes cancelled). */
  attendanceRatePct: number;
};

export type StaffReport = {
  clinicId: string;
  periodDays: number;
  rows: StaffReportRow[];
};

/** Query parameters accepted by GET /analytics/staff */
export type StaffReportFilters = {
  periodDays?: number;
};
