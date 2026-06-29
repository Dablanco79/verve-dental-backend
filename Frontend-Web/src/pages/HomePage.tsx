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

type ExecutiveKpi = {
  title: string;
  value: string;
  trend: string;
  icon: string;
  tone: "green" | "purple" | "orange" | "teal" | "red";
  to?: string;
};

type BriefItem = {
  label: string;
  tone: "green" | "orange" | "red" | "blue" | "purple";
};

type HealthRow = {
  clinicName: string;
  score: number | null;
  inventory: number | null;
  payroll: number | null;
  budget: number | null;
  compliance: number | null;
  to: string;
};

type ActionCentreItem = {
  title: string;
  subtitle: string;
  badge: string | number;
  icon: string;
  tone: "red" | "orange" | "purple" | "blue" | "teal";
  to: string;
};

type ActivityItem = {
  title: string;
  subtitle: string;
  time: string;
  tone: "green" | "purple" | "blue" | "orange" | "red";
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
  const fallbackName = user.email.split("@")[0] ?? user.email;
  return user.displayName ?? user.firstName ?? fallbackName;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreTone(score: number | null): "good" | "warn" | "risk" {
  if (score === null) return "warn";
  if (score >= 90) return "good";
  if (score >= 75) return "warn";
  return "risk";
}

function renderHealthMetric(value: number | null) {
  if (value === null) {
    return (
      <>
        —
        <span style={{ width: "0%" }} />
      </>
    );
  }

  return (
    <>
      {value}%
      <span style={{ width: `${String(value)}%` }} />
    </>
  );
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

function ExecutiveKpiCard({ item }: { item: ExecutiveKpi }) {
  const content = (
    <>
      <div className="executive-kpi__header">
        <span className={`executive-kpi__icon executive-kpi__icon--${item.tone}`} aria-hidden="true">
          {item.icon}
        </span>
        <h3>{item.title}</h3>
      </div>
      <p className="executive-kpi__value">{item.value}</p>
      <p className={`executive-kpi__trend executive-kpi__trend--${item.tone}`}>{item.trend}</p>
      <span className={`executive-kpi__indicator executive-kpi__indicator--${item.tone}`} />
    </>
  );

  if (item.to) {
    return (
      <Link to={item.to} className="executive-kpi">
        {content}
      </Link>
    );
  }

  return <section className="executive-kpi">{content}</section>;
}

function OperationalBrief({ items }: { items: BriefItem[] }) {
  return (
    <section className="executive-brief" aria-label="Today's Operational Brief">
      <div className="executive-brief__title">
        <span aria-hidden="true">✦</span>
        <h2>Today&apos;s Operational Brief</h2>
      </div>
      <div className="executive-brief__items">
        {items.map((item) => (
          <div key={item.label} className="executive-brief__item">
            <span className={`executive-brief__dot executive-brief__dot--${item.tone}`} aria-hidden="true" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClinicHealthTable({ rows }: { rows: HealthRow[] }) {
  return (
    <section className="dashboard-panel dashboard-panel--health">
      <div className="dashboard-panel__header">
        <h2>Clinic Operational Health</h2>
      </div>
      <div className="clinic-health-table" role="table" aria-label="Clinic Operational Health">
        <div className="clinic-health-table__head" role="row">
          <span>Clinic</span>
          <span>Score</span>
          <span>Inventory</span>
          <span>Payroll</span>
          <span>Budget</span>
          <span>Compliance</span>
        </div>
        {rows.map((row) => (
          <Link key={row.clinicName} to={row.to} className="clinic-health-row" role="row">
            <span className="clinic-health-row__clinic">
              <span className={`clinic-health-row__icon clinic-health-row__icon--${scoreTone(row.score)}`} aria-hidden="true">
                CL
              </span>
              <span>{row.clinicName}</span>
            </span>
            <strong className={`clinic-health-row__score clinic-health-row__score--${scoreTone(row.score)}`}>
              {row.score ?? "—"}
            </strong>
            <span className="clinic-health-row__metric">{renderHealthMetric(row.inventory)}</span>
            <span className="clinic-health-row__metric">{renderHealthMetric(row.payroll)}</span>
            <span className={`clinic-health-row__delta clinic-health-row__delta--${scoreTone(row.budget)}`}>
              {row.budget === null ? "—" : `${row.budget >= 90 ? "+" : "-"}${Math.abs(row.budget - 90).toFixed(1)}%`}
            </span>
            <span className="clinic-health-row__metric">{renderHealthMetric(row.compliance)}</span>
          </Link>
        ))}
      </div>
      <Link to="/analytics" className="dashboard-panel__footer-link">
        View all clinics →
      </Link>
    </section>
  );
}

function SpendBudgetPanel() {
  return (
    <section className="dashboard-panel dashboard-panel--spend">
      <div className="dashboard-panel__header">
        <div>
          <h2>Spend vs Budget</h2>
          <p>(This Month)</p>
        </div>
        <Link to="/analytics" className="dashboard-panel__link">View report</Link>
      </div>
      <div className="spend-summary">
        <div>
          <strong>—</strong>
          <span>Total Spend</span>
        </div>
        <div>
          <strong>—</strong>
          <span>Budget</span>
        </div>
        <div className="spend-summary__variance">
          <strong>—</strong>
          <span>Variance</span>
        </div>
      </div>
      <div className="spend-chart" aria-label="Empty spend versus budget chart">
        <div className="spend-chart__legend">
          <span><i />Actual Spend</span>
          <span><i />Budget</span>
        </div>
        <div className="spend-chart__grid" />
      </div>
      <p className="dashboard-placeholder-note">No live spend or budget data available. Budget module not configured.</p>
    </section>
  );
}

function ActionCentre({ items }: { items: ActionCentreItem[] }) {
  return (
    <section className="dashboard-panel dashboard-panel--actions">
      <div className="dashboard-panel__header">
        <h2>Action Centre</h2>
        <span className="action-centre__count">{items.length}</span>
      </div>
      <div className="action-centre__list">
        {items.map((item) => (
          <Link key={item.title} to={item.to} className="action-centre-card">
            <span className={`action-centre-card__icon action-centre-card__icon--${item.tone}`} aria-hidden="true">
              {item.icon}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
            <span className={`action-centre-card__badge action-centre-card__badge--${item.tone}`}>
              {item.badge}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section className="dashboard-panel dashboard-panel--activity">
      <div className="dashboard-panel__header">
        <h2>Recent Activity</h2>
        <Link to="/analytics/audit" className="dashboard-panel__link">View all</Link>
      </div>
      <div className="activity-list">
        {items.length > 0 ? (
          items.map((item) => (
            <Link key={item.title} to={item.to} className="activity-item">
              <span className={`activity-item__avatar activity-item__avatar--${item.tone}`} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <time>{item.time}</time>
            </Link>
          ))
        ) : (
          <p className="dashboard-placeholder-note">No recent activity available.</p>
        )}
      </div>
    </section>
  );
}

function AiInsights() {
  return (
    <section className="dashboard-panel dashboard-panel--ai">
      <div className="dashboard-panel__header">
        <h2>AI Insights <span>Beta</span></h2>
        <Link to="/supplier-intelligence" className="dashboard-panel__link">View all</Link>
      </div>
      <div className="ai-insights-list">
        <p className="dashboard-placeholder-note">No insights available yet.</p>
      </div>
    </section>
  );
}

function OperationsTimeline() {
  return (
    <section className="dashboard-panel dashboard-panel--timeline">
      <div className="dashboard-panel__header">
        <h2>Operations Timeline</h2>
        <Link to="/analytics/audit" className="dashboard-panel__link">View timeline</Link>
      </div>
      <ol className="operations-timeline">
        <li className="operations-timeline__item operations-timeline__item--purple">
          <time>—</time>
          <span>No operational events available.</span>
        </li>
      </ol>
    </section>
  );
}

function OwnerAdminDashboard({
  userName,
  selectedClinicName,
  availableClinicCount,
  summary,
  stats,
  isAllClinicsScope,
}: DashboardProps) {
  const analytics = summary.analytics;
  const allClinicsAnalytics = isAllClinicsAnalytics(analytics) ? analytics : null;
  const inventoryTotal = analytics?.inventory.totalItems ?? summary.inventoryItems.length;
  const lowStockCount = analytics?.inventory.lowStockCount ?? stats.lowStockItems.length;
  const inventoryHealth = inventoryTotal > 0
    ? clampScore(((inventoryTotal - lowStockCount) / inventoryTotal) * 100)
    : null;
  const pendingApprovals =
    summary.pendingSupplierInvoices.length +
    summary.pendingTimesheets.length +
    summary.pendingLeaveRequests.length;
  const clinicRows: HealthRow[] = allClinicsAnalytics
    ? allClinicsAnalytics.clinics.map((clinic) => {
        const totalItems = clinic.kpis.inventory.totalItems;
        const lowStock = clinic.kpis.inventory.lowStockCount;
        const inventoryScore = totalItems > 0
          ? clampScore(((totalItems - lowStock) / totalItems) * 100)
          : 96;
        const rosterScore = clinic.kpis.roster.shiftsScheduled > 0
          ? clampScore((clinic.kpis.roster.shiftsCompleted / clinic.kpis.roster.shiftsScheduled) * 100)
          : null;
        return {
          clinicName: clinic.clinicName,
          score: null,
          inventory: inventoryScore,
          payroll: rosterScore,
          budget: null,
          compliance: null,
          to: "/analytics",
        };
      })
    : [
        {
          clinicName: selectedClinicName,
          score: null,
          inventory: inventoryHealth,
          payroll: analytics?.roster.shiftsScheduled
            ? clampScore((analytics.roster.shiftsCompleted / analytics.roster.shiftsScheduled) * 100)
            : null,
          budget: null,
          compliance: null,
          to: "/analytics",
        },
      ];
  const kpis: ExecutiveKpi[] = [
    {
      title: "Inventory Health",
      value: inventoryHealth === null ? "—" : `${String(inventoryHealth)}%`,
      trend: inventoryHealth === null
        ? "No live inventory data"
        : lowStockCount > 0
          ? `${String(lowStockCount)} items need attention`
          : "Live inventory data",
      icon: "IH",
      tone: "green",
      to: "/inventory?focus=low-stock",
    },
    {
      title: "Forecast Spend",
      value: "—",
      trend: "Forecast engine coming soon",
      icon: "$",
      tone: "purple",
    },
    {
      title: "Payroll Forecast",
      value: "—",
      trend: "Awaiting payroll forecast",
      icon: "PF",
      tone: "orange",
      to: "/forecast/labor",
    },
    {
      title: "Budget Variance",
      value: "—",
      trend: "Budget module not configured",
      icon: "BV",
      tone: "teal",
      to: "/analytics",
    },
    {
      title: "Stock At Risk",
      value: String(lowStockCount),
      trend: lowStockCount > 0 ? "Items need attention" : "No urgent stock risks",
      icon: "SR",
      tone: "red",
      to: "/inventory?focus=low-stock",
    },
  ];
  const briefItems: BriefItem[] = [
    {
      label: isAllClinicsScope
        ? "Clinic opening status not connected"
        : `${selectedClinicName} opening status not connected`,
      tone: "blue",
    },
    {
      label: `${String(summary.pendingSupplierInvoices.length)} supplier invoices awaiting approval`,
      tone: summary.pendingSupplierInvoices.length > 0 ? "orange" : "green",
    },
    {
      label: lowStockCount > 0
        ? `${String(lowStockCount)} stock risk${lowStockCount === 1 ? "" : "s"} require attention`
        : "No critical stock risks",
      tone: lowStockCount > 0 ? "red" : "green",
    },
    {
      label: "Estimated purchasing savings available after supplier benchmarking",
      tone: "green",
    },
    {
      label: "Labour forecast awaiting payroll forecast",
      tone: "blue",
    },
  ];
  const actionItems: ActionCentreItem[] = [
    {
      title: "Approve Purchase Orders",
      subtitle: `${String(stats.draftPurchaseOrderLines.length)} draft lines`,
      badge: stats.draftPurchaseOrderLines.length,
      icon: "PO",
      tone: "red",
      to: "/purchase-orders",
    },
    {
      title: "Supplier Invoice Review",
      subtitle: `${String(summary.pendingSupplierInvoices.length)} invoices`,
      badge: summary.pendingSupplierInvoices.length,
      icon: "OCR",
      tone: "orange",
      to: "/suppliers",
    },
    {
      title: "Stock Adjustments",
      subtitle: analytics ? `${String(analytics.inventory.adjustmentsCount)} this period` : "No live adjustment data",
      badge: analytics ? analytics.inventory.adjustmentsCount : "—",
      icon: "ST",
      tone: "orange",
      to: "/inventory/adjustments",
    },
    {
      title: "Timesheet Approvals",
      subtitle: `${String(summary.pendingTimesheets.length)} pending`,
      badge: summary.pendingTimesheets.length,
      icon: "TS",
      tone: "purple",
      to: "/timesheets",
    },
  ];
  const activities: ActivityItem[] = [];

  return (
    <div className="executive-dashboard">
      <section className="executive-hero">
        <div>
          <h2>Good Morning, {userName} <span aria-hidden="true">👋</span></h2>
          <p>Here&apos;s what&apos;s happening across your clinics today.</p>
        </div>
        <button type="button" className="executive-hero__brief-button">
          ✧ AI Morning Brief
        </button>
      </section>

      <section className="executive-kpi-row" aria-label="Executive KPI Row">
        {kpis.map((item) => (
          <ExecutiveKpiCard key={item.title} item={item} />
        ))}
      </section>

      <OperationalBrief items={briefItems} />

      <div className="executive-main-grid">
        <ClinicHealthTable rows={clinicRows} />
        <SpendBudgetPanel />
        <ActionCentre items={actionItems} />
      </div>

      <div className="executive-bottom-grid">
        <RecentActivity items={activities} />
        <AiInsights />
        <OperationsTimeline />
      </div>

      <button type="button" className="executive-ai-fab" aria-label="Open AI assistant">
        ✦
      </button>

      <span className="executive-dashboard__meta" aria-hidden="true">
        {isAllClinicsScope ? `${String(availableClinicCount)} locations` : selectedClinicName}
        {pendingApprovals > 0 ? ` · ${String(pendingApprovals)} approvals pending` : ""}
      </span>
    </div>
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
