import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { AllClinicsDashboardKpis, DashboardKpis } from "../types/analytics.js";
import type { InventoryItem, PurchaseOrderLine } from "../types/inventory.js";
import type { LeaveRequest, TimesheetEntry } from "../types/payroll.js";
import type { SupplierInvoice } from "../types/supplier.js";
import type { UserRole } from "../types/index.js";
import {
  ROLE_LABELS,
  canManagePayroll,
  canManageSuppliers,
  canManageUsers,
  canViewAnalytics,
} from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

type DailySummary = {
  analytics: DashboardKpis | AllClinicsDashboardKpis | null;
  inventoryItems: InventoryItem[];
  pendingSupplierInvoices: SupplierInvoice[];
  purchaseOrderLines: PurchaseOrderLine[];
  pendingTimesheets: TimesheetEntry[];
  pendingCommissionChecks: TimesheetEntry[];
  pendingLeaveRequests: LeaveRequest[];
};

type DashboardStats = {
  lowStockItems: InventoryItem[];
  draftPurchaseOrderLines: PurchaseOrderLine[];
  openTimesheet: TimesheetEntry | null;
};

type DashboardProps = {
  userName: string;
  roleLabel: string;
  selectedClinicName: string;
  availableClinicCount: number;
  summary: DailySummary;
  stats: DashboardStats;
  isAllClinicsScope: boolean;
};

type DashboardCardTone = "default" | "positive" | "warning" | "danger";

type MetricCardProps = {
  title: string;
  value: string | number;
  description: string;
  to?: string;
  tone?: DashboardCardTone;
};

type QuickAction = {
  label: string;
  to: string;
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

function isAllClinicsAnalytics(
  analytics: DailySummary["analytics"],
): analytics is AllClinicsDashboardKpis {
  return analytics !== null && "scope" in analytics;
}

function formatUserName(user: NonNullable<ReturnType<typeof useAuth>["user"]>): string {
  return user.displayName ?? user.firstName ?? user.email;
}

function valueClassName(tone: DashboardCardTone): string {
  if (tone === "danger") return "analytics-card__value analytics-card__value--danger";
  if (tone === "warning") return "analytics-card__value analytics-card__value--warning";
  if (tone === "positive") return "analytics-card__value analytics-card__value--positive";
  return "analytics-card__value analytics-card__value--primary";
}

function MetricCard({
  title,
  value,
  description,
  to,
  tone = "default",
}: MetricCardProps) {
  const content = (
    <>
      <h3 className="analytics-card__title">{title}</h3>
      <p className={valueClassName(tone)}>{value}</p>
      <p className="inventory-page__subtitle">{description}</p>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="analytics-card daily-hub__priority-card">
        {content}
      </Link>
    );
  }

  return <section className="analytics-card">{content}</section>;
}

function DashboardIntro({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions: QuickAction[];
}) {
  return (
    <section className="status-card">
      <div className="status-card__header">
        <div>
          <h2>{title}</h2>
          <p className="inventory-page__subtitle">{subtitle}</p>
        </div>
        <QuickActions actions={actions} />
      </div>
    </section>
  );
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="inventory-page__actions">
      {actions.map((action) => (
        <Link key={`${action.label}:${action.to}`} to={action.to} className="button-link">
          {action.label}
        </Link>
      ))}
    </div>
  );
}

function DashboardSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="status-card">
      <div className="status-card__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="inventory-page__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function OwnerAdminDashboard({
  userName,
  roleLabel,
  selectedClinicName,
  availableClinicCount,
  summary,
  stats,
  isAllClinicsScope,
}: DashboardProps) {
  const analytics = summary.analytics;
  const clinicScope =
    isAllClinicsScope
      ? `${String(availableClinicCount)} clinics included`
      : availableClinicCount > 1
      ? `${String(availableClinicCount)} clinics available`
      : "Single clinic scope";
  const allClinicsAnalytics = isAllClinicsAnalytics(analytics) ? analytics : null;

  return (
    <>
      <DashboardIntro
        title={`Executive overview for ${selectedClinicName}`}
        subtitle={`Welcome, ${userName}. ${roleLabel} view focused on operational risk and clinic performance. ${clinicScope}.`}
        actions={[
          { label: "Inventory", to: "/inventory" },
          { label: "Receive Stock", to: "/inventory?mode=receive" },
          { label: "Suppliers", to: "/suppliers" },
          { label: "Purchase Orders", to: "/purchase-orders" },
          { label: "OCR Queue", to: "/suppliers" },
          { label: "Analytics", to: "/analytics" },
          { label: "Workforce", to: "/timesheets" },
        ]}
      />

      <DashboardSection
        title="Executive KPIs"
        subtitle={
          isAllClinicsScope
            ? "Organisation-wide operational data across all active clinics."
            : "Existing operational data for the selected clinic."
        }
      >
        <div className="analytics-cards-grid">
          <MetricCard
            title="Clinic Scope"
            value={availableClinicCount}
            description={isAllClinicsScope ? "clinics included in this view" : "clinics available to review"}
          />
          <MetricCard
            title="Inventory Health"
            value={stats.lowStockItems.length}
            description="items below reorder point"
            to="/inventory?focus=low-stock"
            tone={stats.lowStockItems.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Pending OCR"
            value={summary.pendingSupplierInvoices.length}
            description="supplier invoices awaiting review"
            to="/suppliers"
            tone={summary.pendingSupplierInvoices.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Purchase Orders"
            value={stats.draftPurchaseOrderLines.length}
            description="draft lines awaiting action"
            to="/purchase-orders"
            tone={stats.draftPurchaseOrderLines.length > 0 ? "warning" : "positive"}
          />
          {analytics ? (
            <>
              <MetricCard
                title="Roster Coverage"
                value={analytics.roster.shiftsScheduled}
                description={isAllClinicsScope ? "scheduled shifts across clinics" : "scheduled shifts in this clinic"}
                to="/analytics"
              />
              <MetricCard
                title="Stock Adjustments"
                value={analytics.inventory.adjustmentsCount}
                description="inventory movements in the reporting window"
                to="/analytics"
                tone={analytics.inventory.adjustmentsCount > 0 ? "warning" : "positive"}
              />
            </>
          ) : null}
        </div>
      </DashboardSection>

      <DashboardSection
        title="Recent Operational Activity"
        subtitle={
          isAllClinicsScope
            ? "Aggregated signals from inventory, purchasing, OCR, and workforce queues."
            : "Signals already available from inventory, purchasing, OCR, and workforce queues."
        }
      >
        <div className="analytics-cards-grid">
          <MetricCard
            title="Stock Adjustments"
            value={analytics?.inventory.adjustmentsCount ?? "—"}
            description="adjustments in the reporting window"
            to="/analytics"
          />
          <MetricCard
            title="Top Consumed SKUs"
            value={analytics?.inventory.topConsumedSkus.length ?? "—"}
            description="materials consumption signals"
            to="/analytics"
          />
          <MetricCard
            title="Timesheets"
            value={summary.pendingTimesheets.length}
            description="items awaiting approval"
            to="/timesheets"
            tone={summary.pendingTimesheets.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Leave"
            value={summary.pendingLeaveRequests.length}
            description="requests awaiting review"
            to="/leave"
            tone={summary.pendingLeaveRequests.length > 0 ? "warning" : "positive"}
          />
        </div>
      </DashboardSection>

      {allClinicsAnalytics ? (
        <DashboardSection
          title="Clinic Breakdown"
          subtitle="Per-clinic analytics rollup for executive drill-down."
        >
          <div className="analytics-cards-grid">
            {allClinicsAnalytics.clinics.map((clinic) => (
              <MetricCard
                key={clinic.clinicId}
                title={clinic.clinicName}
                value={clinic.kpis.inventory.lowStockCount}
                description={`${String(clinic.kpis.roster.shiftsScheduled)} scheduled shifts`}
                tone={clinic.kpis.inventory.lowStockCount > 0 ? "warning" : "positive"}
              />
            ))}
          </div>
        </DashboardSection>
      ) : null}
    </>
  );
}

function PracticeManagerDashboard({
  userName,
  roleLabel,
  selectedClinicName,
  summary,
  stats,
}: DashboardProps) {
  return (
    <>
      <DashboardIntro
        title={`What ${selectedClinicName} needs today`}
        subtitle={`Welcome, ${userName}. ${roleLabel} view focused on today's operational work.`}
        actions={[
          { label: "Inventory", to: "/inventory" },
          { label: "Receive Stock", to: "/inventory?mode=receive" },
          { label: "OCR Queue", to: "/suppliers" },
          { label: "Purchase Orders", to: "/purchase-orders" },
          { label: "Staff Rosters", to: "/roster" },
          { label: "Timesheets", to: "/timesheets" },
        ]}
      />

      <DashboardSection
        title="Today’s Operational Summary"
        subtitle="Prioritised work queues for the selected clinic."
      >
        <div className="analytics-cards-grid">
          <MetricCard
            title="Low Stock"
            value={stats.lowStockItems.length}
            description="items requiring stock review"
            to="/inventory?focus=low-stock"
            tone={stats.lowStockItems.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Pending OCR"
            value={summary.pendingSupplierInvoices.length}
            description="invoices waiting for review"
            to="/suppliers"
            tone={summary.pendingSupplierInvoices.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Purchase Orders"
            value={stats.draftPurchaseOrderLines.length}
            description="draft PO lines ready to action"
            to="/purchase-orders"
            tone={stats.draftPurchaseOrderLines.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Timesheets"
            value={summary.pendingTimesheets.length}
            description="approvals waiting"
            to="/timesheets"
            tone={summary.pendingTimesheets.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Leave"
            value={summary.pendingLeaveRequests.length}
            description="leave requests waiting"
            to="/leave"
            tone={summary.pendingLeaveRequests.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Receiving"
            value="Ready"
            description="scan deliveries as stock arrives"
            to="/inventory?mode=receive"
          />
        </div>
      </DashboardSection>

      <DashboardSection title="Clinic Alerts" subtitle="Operational reminders for the day.">
        <div className="analytics-cards-grid">
          <MetricCard
            title="Inventory Attention"
            value={stats.lowStockItems.length > 0 ? "Review" : "Clear"}
            description={
              stats.lowStockItems.length > 0
                ? "low stock items may need ordering"
                : "no low stock items in the current list"
            }
            to="/inventory?focus=low-stock"
            tone={stats.lowStockItems.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Attendance Checks"
            value={summary.pendingCommissionChecks.length}
            description="commission attendance records to verify"
            to="/timesheets"
            tone={summary.pendingCommissionChecks.length > 0 ? "warning" : "positive"}
          />
          <MetricCard
            title="Roster"
            value={summary.analytics?.roster.shiftsScheduled ?? "Open"}
            description="scheduled shifts in the reporting window"
            to="/roster"
          />
        </div>
      </DashboardSection>
    </>
  );
}

function ClinicalStaffDashboard({
  userName,
  selectedClinicName,
  summary,
  stats,
}: DashboardProps) {
  return (
    <>
      <DashboardIntro
        title={`Your day at ${selectedClinicName}`}
        subtitle={`Welcome, ${userName}. Here are the essentials for your shift.`}
        actions={[
          { label: "Clock In / Out", to: "/timesheets" },
          { label: "My Roster", to: "/my-shifts" },
          { label: "Scan Inventory", to: "/inventory" },
          { label: "Leave", to: "/leave" },
        ]}
      />

      <DashboardSection
        title="Today’s Work"
        subtitle="Simple actions for clinical staff without executive or procurement detail."
      >
        <div className="analytics-cards-grid">
          <MetricCard
            title="Today’s Shift"
            value={stats.openTimesheet ? "Clocked in" : "Ready"}
            description={
              stats.openTimesheet
                ? "clock out when your shift ends"
                : "check your roster or clock in"
            }
            to="/timesheets"
            tone={stats.openTimesheet ? "warning" : "default"}
          />
          <MetricCard
            title="Timesheets"
            value={summary.pendingTimesheets.length}
            description="your timesheet entries today"
            to="/timesheets"
          />
          <MetricCard
            title="Leave"
            value={summary.pendingLeaveRequests.length}
            description="your pending leave requests"
            to="/leave"
          />
          <MetricCard
            title="Stock Tasks"
            value="Scan"
            description="scan stock usage as directed"
            to="/inventory"
          />
        </div>
      </DashboardSection>
    </>
  );
}

function RoleDashboard({
  role,
  props,
}: {
  role: UserRole;
  props: DashboardProps;
}) {
  if (role === "owner_admin") {
    return <OwnerAdminDashboard {...props} />;
  }

  if (role === "group_practice_manager") {
    return <PracticeManagerDashboard {...props} />;
  }

  return <ClinicalStaffDashboard {...props} />;
}

export function HomePage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope, availableClinics } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user || (!selectedClinicId && selectedDashboardScope?.type !== "all_clinics")) {
      return;
    }

    let cancelled = false;
    const activeUser = user;
    const activeClinicId =
      selectedDashboardScope?.type === "clinic"
        ? selectedDashboardScope.clinic.id
        : selectedClinicId;
    const activeDashboardScope = selectedDashboardScope;
    const activeClinics = availableClinics;
    const today = todayLocalDate();

    setIsLoading(true);
    setErrors([]);

    async function loadDailySummary(): Promise<void> {
      if (activeDashboardScope?.type === "all_clinics" && activeUser.role === "owner_admin") {
        const [
          analyticsResult,
          inventoryResults,
          supplierInvoiceResults,
          purchaseOrderResults,
          timesheetResults,
          commissionResults,
          leaveResults,
        ] = await Promise.all([
          Promise.allSettled([
            apiClient.getAllClinicsAnalyticsDashboard({ periodDays: 7 }),
          ]),
          Promise.allSettled(activeClinics.map((clinic) => apiClient.listInventory(clinic.id))),
          Promise.allSettled(
            activeClinics.map((clinic) =>
              apiClient.listClinicSupplierInvoices(clinic.id, {
                status: "pending_review",
                limit: 50,
              }),
            ),
          ),
          Promise.allSettled(activeClinics.map((clinic) => apiClient.listPurchaseOrders(clinic.id))),
          Promise.allSettled(
            activeClinics.map((clinic) =>
              apiClient.listTimesheets(clinic.id, { pendingApprovalOnly: true }),
            ),
          ),
          Promise.allSettled(
            activeClinics.map((clinic) =>
              apiClient.listTimesheets(clinic.id, {
                attendanceStatus: "pending_verification",
                payrollType: "commission_log",
              }),
            ),
          ),
          Promise.allSettled(
            activeClinics.map((clinic) => apiClient.listLeave(clinic.id, { status: "pending" })),
          ),
        ]);

        if (cancelled) {
          return;
        }

        const nextErrors: string[] = [];

        function flattenResults<T>(
          results: PromiseSettledResult<T[]>[],
          label: string,
        ): T[] {
          const values: T[] = [];
          for (const result of results) {
            if (result.status === "fulfilled") {
              values.push(...result.value);
            } else {
              nextErrors.push(label);
            }
          }
          return values;
        }

        const analytics = analyticsResult[0];
        setSummary({
          analytics: analytics.status === "fulfilled" ? analytics.value : null,
          inventoryItems: flattenResults(inventoryResults, "Inventory"),
          pendingSupplierInvoices: flattenResults(
            supplierInvoiceResults,
            "Pending invoice review",
          ),
          purchaseOrderLines: flattenResults(purchaseOrderResults, "Purchase orders"),
          pendingTimesheets: flattenResults(timesheetResults, "Timesheets"),
          pendingCommissionChecks: flattenResults(
            commissionResults,
            "Commission attendance",
          ),
          pendingLeaveRequests: flattenResults(leaveResults, "Leave requests"),
        });
        if (analytics.status === "rejected") {
          nextErrors.push("Operational KPIs");
        }
        setErrors(nextErrors);
        setIsLoading(false);
        return;
      }

      if (!activeClinicId) {
        return;
      }

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
          ? apiClient.getAnalyticsDashboard(activeClinicId, { periodDays: 7 })
          : Promise.resolve(null),
        apiClient.listInventory(activeClinicId),
        canManageSuppliers(activeUser.role)
          ? apiClient.listClinicSupplierInvoices(activeClinicId, {
              status: "pending_review",
              limit: 50,
            })
          : Promise.resolve([]),
        canManageUsers(activeUser.role)
          ? apiClient.listPurchaseOrders(activeClinicId)
          : Promise.resolve([]),
        canManagePayroll(activeUser.role)
          ? apiClient.listTimesheets(activeClinicId, { pendingApprovalOnly: true })
          : apiClient.listMyTimesheets(activeClinicId, { shiftDate: today }),
        canManagePayroll(activeUser.role)
          ? apiClient.listTimesheets(activeClinicId, {
              attendanceStatus: "pending_verification",
              payrollType: "commission_log",
            })
          : Promise.resolve([]),
        canManagePayroll(activeUser.role)
          ? apiClient.listLeave(activeClinicId, { status: "pending" })
          : apiClient.listMyLeave(activeClinicId, { status: "pending" }),
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
  }, [availableClinics, selectedClinicId, selectedDashboardScope, user]);

  const stats = useMemo<DashboardStats>(
    () => ({
      lowStockItems: summary.inventoryItems.filter((item) => item.isBelowReorderPoint),
      draftPurchaseOrderLines: summary.purchaseOrderLines.filter(
        (line) => line.orderStatus === "draft",
      ),
      openTimesheet: summary.pendingTimesheets.find((entry) => !entry.clockOutAt) ?? null,
    }),
    [summary.inventoryItems, summary.pendingTimesheets, summary.purchaseOrderLines],
  );
  const isAllClinicsScope =
    user?.role === "owner_admin" && selectedDashboardScope?.type === "all_clinics";
  const dashboardClinicName = isAllClinicsScope
    ? "All Clinics"
    : selectedDashboardScope?.type === "clinic"
    ? selectedDashboardScope.clinic.name
    : selectedClinic?.name ?? "";

  if (!user) {
    return null;
  }

  if (!selectedClinic) {
    return (
      <AppShell>
        <section className="status-card">
          <p className="loading-message">Loading clinic context…</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {isLoading ? (
        <section className="status-card">
          <p className="loading-message">Loading role dashboard…</p>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section className="status-card">
          <p className="status-card__error" role="alert">
            Some dashboard data could not be loaded: {errors.join(", ")}. Available actions remain
            below.
          </p>
        </section>
      ) : null}

      <RoleDashboard
        role={user.role}
        props={{
          userName: formatUserName(user),
          roleLabel: ROLE_LABELS[user.role],
          selectedClinicName: dashboardClinicName,
          availableClinicCount: availableClinics.length,
          summary,
          stats,
          isAllClinicsScope,
        }}
      />
    </AppShell>
  );
}
