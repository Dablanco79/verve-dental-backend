import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { DashboardKpis } from "../types/analytics.js";
import type { InventoryItem, PurchaseOrderLine } from "../types/inventory.js";
import type { LeaveRequest, TimesheetEntry } from "../types/payroll.js";
import type { SupplierInvoice } from "../types/supplier.js";
import {
  ROLE_LABELS,
  canManagePayroll,
  canManageSuppliers,
  canManageUsers,
  canViewAnalytics,
} from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

type DailySummary = {
  analytics: DashboardKpis | null;
  inventoryItems: InventoryItem[];
  pendingSupplierInvoices: SupplierInvoice[];
  purchaseOrderLines: PurchaseOrderLine[];
  pendingTimesheets: TimesheetEntry[];
  pendingCommissionChecks: TimesheetEntry[];
  pendingLeaveRequests: LeaveRequest[];
};

type SummaryCardProps = {
  title: string;
  value: string | number;
  description: string;
  to: string;
  tone?: "default" | "warning" | "danger";
};

const EMPTY_SUMMARY: DailySummary = {
  analytics: null,
  inventoryItems: [],
  pendingSupplierInvoices: [],
  purchaseOrderLines: [],
  pendingTimesheets: [],
  pendingCommissionChecks: [],
  pendingLeaveRequests: [],
};

function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function centsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatUserName(user: NonNullable<ReturnType<typeof useAuth>["user"]>): string {
  return user.displayName ?? user.firstName ?? user.email;
}

function SummaryCard({ title, value, description, to, tone = "default" }: SummaryCardProps) {
  const valueClassName =
    tone === "danger"
      ? "analytics-card__value analytics-card__value--danger"
      : tone === "warning"
        ? "analytics-card__value analytics-card__value--warning"
        : "analytics-card__value analytics-card__value--primary";

  return (
    <Link to={to} className="analytics-card daily-hub__priority-card">
      <h3 className="analytics-card__title">{title}</h3>
      <p className={valueClassName}>{value}</p>
      <p className="inventory-page__subtitle">{description}</p>
    </Link>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const canSeeManagerWorkflows = user ? canViewAnalytics(user.role) : false;
  const canReviewSuppliers = user ? canManageSuppliers(user.role) : false;
  const canReviewPayroll = user ? canManagePayroll(user.role) : false;
  const canReviewPurchaseOrders = user ? canManageUsers(user.role) : false;

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    const activeUser = user;
    const clinicId = activeUser.homeClinicId;
    const today = todayLocalDate();

    setIsLoading(true);
    setErrors([]);

    async function loadDailySummary(): Promise<void> {
      const [
        analyticsResult,
        inventoryResult,
        supplierInvoiceResult,
        purchaseOrderResult,
        timesheetResult,
        commissionResult,
        leaveResult,
      ] = await Promise.allSettled([
        canViewAnalytics(activeUser.role)
          ? apiClient.getAnalyticsDashboard(clinicId, { periodDays: 7 })
          : Promise.resolve(null),
        apiClient.listInventory(clinicId),
        canManageSuppliers(activeUser.role)
          ? apiClient.listClinicSupplierInvoices(clinicId, {
              status: "pending_review",
              limit: 50,
            })
          : Promise.resolve([]),
        canManageUsers(activeUser.role) ? apiClient.listPurchaseOrders(clinicId) : Promise.resolve([]),
        canManagePayroll(activeUser.role)
          ? apiClient.listTimesheets(clinicId, { pendingApprovalOnly: true })
          : apiClient.listMyTimesheets(clinicId, { shiftDate: today }),
        canManagePayroll(activeUser.role)
          ? apiClient.listTimesheets(clinicId, {
              attendanceStatus: "pending_verification",
              payrollType: "commission_log",
            })
          : Promise.resolve([]),
        canManagePayroll(activeUser.role)
          ? apiClient.listLeave(clinicId, { status: "pending" })
          : apiClient.listMyLeave(clinicId, { status: "pending" }),
      ]);

      if (cancelled) {
        return;
      }

      const nextErrors: string[] = [];

      function readResult<T>(
        result: PromiseSettledResult<T>,
        fallback: T,
        label: string,
      ): T {
        if (result.status === "fulfilled") {
          return result.value;
        }
        nextErrors.push(label);
        return fallback;
      }

      setSummary({
        analytics: readResult(analyticsResult, null, "Operational KPIs"),
        inventoryItems: readResult(inventoryResult, [], "Inventory"),
        pendingSupplierInvoices: readResult(
          supplierInvoiceResult,
          [],
          "Pending invoice review",
        ),
        purchaseOrderLines: readResult(purchaseOrderResult, [], "Purchase orders"),
        pendingTimesheets: readResult(timesheetResult, [], "Timesheets"),
        pendingCommissionChecks: readResult(commissionResult, [], "Commission attendance"),
        pendingLeaveRequests: readResult(leaveResult, [], "Leave requests"),
      });
      setErrors(nextErrors);
      setIsLoading(false);
    }

    void loadDailySummary().catch(() => {
      if (!cancelled) {
        setErrors(["Daily priorities"]);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const priorityCards = useMemo(() => {
    const lowStockCount = summary.inventoryItems.filter((item) => item.isBelowReorderPoint).length;
    const draftPoLines = summary.purchaseOrderLines.filter(
      (line) => line.orderStatus === "draft",
    ).length;
    const cards: SummaryCardProps[] = [
      {
        title: "Inventory",
        value: lowStockCount,
        description:
          lowStockCount > 0
            ? "items below reorder point need review"
            : "review stock and receive deliveries",
        to: "/inventory",
        tone: lowStockCount > 0 ? "warning" : "default",
      },
    ];

    if (canReviewSuppliers) {
      cards.push({
        title: "Invoice OCR",
        value: summary.pendingSupplierInvoices.length,
        description:
          summary.pendingSupplierInvoices.length > 0
            ? "supplier invoices waiting for review"
            : "upload and review supplier invoices",
        to: "/suppliers",
        tone: summary.pendingSupplierInvoices.length > 0 ? "warning" : "default",
      });
    }

    if (canReviewPurchaseOrders) {
      cards.push({
        title: "Purchase Orders",
        value: draftPoLines,
        description:
          draftPoLines > 0
            ? "draft lines ready for supplier ordering"
            : "review reorder-generated purchase orders",
        to: "/purchase-orders",
        tone: draftPoLines > 0 ? "warning" : "default",
      });
    }

    if (canReviewPayroll) {
      cards.push(
        {
          title: "Timesheets",
          value: summary.pendingTimesheets.length,
          description:
            summary.pendingTimesheets.length > 0
              ? "timesheets waiting for approval"
              : "approve hours and review staff entries",
          to: "/timesheets",
          tone: summary.pendingTimesheets.length > 0 ? "warning" : "default",
        },
        {
          title: "Leave",
          value: summary.pendingLeaveRequests.length,
          description:
            summary.pendingLeaveRequests.length > 0
              ? "leave requests awaiting review"
              : "review leave and staff availability",
          to: "/leave",
          tone: summary.pendingLeaveRequests.length > 0 ? "warning" : "default",
        },
      );
    } else {
      const openTimesheet = summary.pendingTimesheets.find((entry) => !entry.clockOutAt);
      cards.push(
        {
          title: "My Shift",
          value: openTimesheet ? "Clocked in" : "Ready",
          description: openTimesheet ? "clock out when your shift ends" : "clock in or view today",
          to: "/timesheets",
          tone: openTimesheet ? "warning" : "default",
        },
        {
          title: "My Leave",
          value: summary.pendingLeaveRequests.length,
          description:
            summary.pendingLeaveRequests.length > 0
              ? "pending leave requests"
              : "request or review leave",
          to: "/leave",
        },
      );
    }

    if (summary.pendingCommissionChecks.length > 0) {
      cards.push({
        title: "Attendance Checks",
        value: summary.pendingCommissionChecks.length,
        description: "commission attendance records need verification",
        to: "/timesheets",
        tone: "warning",
      });
    }

    return cards;
  }, [
    canReviewPayroll,
    canReviewPurchaseOrders,
    canReviewSuppliers,
    summary.inventoryItems,
    summary.pendingCommissionChecks.length,
    summary.pendingLeaveRequests.length,
    summary.pendingSupplierInvoices.length,
    summary.pendingTimesheets,
    summary.purchaseOrderLines,
  ]);

  if (!user) {
    return null;
  }

  const analytics = summary.analytics;
  const roleLabel = ROLE_LABELS[user.role];
  const lowStockCount = summary.inventoryItems.filter((item) => item.isBelowReorderPoint).length;

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Today at {user.homeClinicName}</h2>
            <p className="inventory-page__subtitle">
              Welcome, {formatUserName(user)}. {roleLabel} daily priorities are ready below.
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/inventory" className="button-link">
              Receive stock
            </Link>
            {canSeeManagerWorkflows ? (
              <Link to="/analytics" className="link-button">
                Full analytics
              </Link>
            ) : (
              <Link to="/my-shifts" className="link-button">
                My shifts
              </Link>
            )}
          </div>
        </div>

        {isLoading ? <p className="loading-message">Loading today&apos;s priorities…</p> : null}
        {errors.length > 0 ? (
          <p className="status-card__error" role="alert">
            Some daily data could not be loaded: {errors.join(", ")}. You can still use the
            workflow links below.
          </p>
        ) : null}
      </section>

      {analytics && canSeeManagerWorkflows ? (
        <section className="status-card">
          <h2>Operational KPIs</h2>
          <dl className="supplier-kpi-bar">
            <div className="supplier-kpi-bar__stat">
              <dt>7-day revenue</dt>
              <dd>{centsToDollars(analytics.revenue.totalRevenueCents)}</dd>
            </div>
            <div className="supplier-kpi-bar__stat">
              <dt>Outstanding</dt>
              <dd
                className={
                  analytics.revenue.outstandingCents > 0
                    ? "supplier-kpi-bar__dd--pending"
                    : undefined
                }
              >
                {centsToDollars(analytics.revenue.outstandingCents)}
              </dd>
            </div>
            <div className="supplier-kpi-bar__stat">
              <dt>Low stock</dt>
              <dd className={lowStockCount > 0 ? "supplier-kpi-bar__dd--pending" : undefined}>
                {lowStockCount}
              </dd>
            </div>
            <div className="supplier-kpi-bar__stat">
              <dt>Rostered shifts</dt>
              <dd>{analytics.roster.shiftsScheduled}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="status-card">
        <h2>Today&apos;s Priorities</h2>
        <div className="analytics-cards-grid">
          {priorityCards.map((card) => (
            <SummaryCard key={card.title} {...card} />
          ))}
        </div>
      </section>

      <section className="status-card">
        <h2>Common Workflows</h2>
        <div className="inventory-page__actions">
          <Link to="/inventory" className="button-link">
            Review inventory
          </Link>
          <Link to="/inventory" className="button-link">
            Receive deliveries
          </Link>
          {canReviewSuppliers ? (
            <>
              <Link to="/suppliers" className="button-link">
                Upload invoices
              </Link>
              <Link to="/supplier-intelligence" className="button-link">
                Review supplier pricing
              </Link>
            </>
          ) : null}
          {canReviewPurchaseOrders ? (
            <Link to="/purchase-orders" className="button-link">
              Create purchase orders
            </Link>
          ) : null}
          <Link to="/roster" className="button-link">
            Review roster
          </Link>
          <Link to="/timesheets" className="button-link">
            {canReviewPayroll ? "Approve timesheets" : "My timesheet"}
          </Link>
          <Link to="/leave" className="button-link">
            {canReviewPayroll ? "Review leave" : "My leave"}
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
