// ─────────────────────────────────────────────────────────────────────────────
// Module 08 — Analytics, Reporting, and Audit Trails
//
// All monetary values are integer cents.
// All percentages are numeric (0–100).
// Period boundary strings are YYYY-MM-DD in clinic-local timezone.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Audit entity types ───────────────────────────────────────────────────────

export const AUDIT_ENTITY_TYPES = [
  "auth",
  "invoice",
  "payment",
  "line_item",
  "inventory_adjustment",
  "roster_entry",
  "timesheet_entry",
  "leave_request",
  "purchase_order",
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
  /** Free-form verb describing the operation: "created", "updated", "deleted",
   *  "approved", "issued", "void", "scan_deduct", "password_reset", etc. */
  action: string;
  actorId: string;
  actorEmail: string;
  /** Arbitrary structured metadata captured at event time. */
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type CreateAuditEventInput = Omit<AuditEvent, "id" | "createdAt">;

export type ListAuditEventsOptions = {
  entityType?: AuditEntityType;
  actorId?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export type AuditEventsPage = {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
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
  /** Count of distinct staff_user_ids with ≥1 non-cancelled shift in period. */
  uniqueStaffCount: number;
};

export type DashboardKpis = {
  clinicId: string;
  periodDays: number;
  periodFrom: string;
  periodTo: string;
  revenue: DashboardRevenueSummary;
  inventory: DashboardInventorySummary;
  roster: DashboardRosterSummary;
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
