import { Navigate, Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useAnalyticsDashboard } from "../hooks/useAnalyticsDashboard.js";
import type {
  DashboardInventorySummary,
  DashboardRevenueSummary,
  DashboardRosterSummary,
} from "../types/analytics.js";
import { canViewAnalytics } from "../utils/roles.js";

// ── Utility helpers ────────────────────────────────────────────────────────────

function centsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// ── Period selector ────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

type PeriodSelectorProps = {
  value: number;
  onChange: (days: number) => void;
  disabled: boolean;
};

function PeriodSelector({ value, onChange, disabled }: PeriodSelectorProps) {
  return (
    <label className="analytics-period-selector">
      <span className="analytics-period-selector__label">Period</span>
      <select
        className="analytics-period-selector__control"
        value={value}
        onChange={(e) => { onChange(Number(e.target.value)); }}
        disabled={disabled}
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── KPI cards ──────────────────────────────────────────────────────────────────

function RevenueCard({ revenue }: { revenue: DashboardRevenueSummary }) {
  return (
    <section className="analytics-card">
      <h3 className="analytics-card__title">Revenue</h3>
      <dl className="analytics-card__stats">
        <div className="analytics-card__stat">
          <dt>Total Revenue</dt>
          <dd className="analytics-card__value analytics-card__value--primary">
            {centsToDollars(revenue.totalRevenueCents)}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Collected</dt>
          <dd className="analytics-card__value analytics-card__value--positive">
            {centsToDollars(revenue.paidCents)}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Outstanding</dt>
          <dd
            className={`analytics-card__value${
              revenue.outstandingCents > 0 ? " analytics-card__value--warning" : ""
            }`}
          >
            {centsToDollars(revenue.outstandingCents)}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Invoices</dt>
          <dd className="analytics-card__value">{revenue.invoiceCount}</dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Overdue</dt>
          <dd
            className={`analytics-card__value${
              revenue.overdueCount > 0 ? " analytics-card__value--danger" : ""
            }`}
          >
            {revenue.overdueCount}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function InventoryCard({ inventory }: { inventory: DashboardInventorySummary }) {
  return (
    <section className="analytics-card">
      <h3 className="analytics-card__title">Inventory</h3>
      <dl className="analytics-card__stats">
        <div className="analytics-card__stat">
          <dt>Total Items</dt>
          <dd className="analytics-card__value analytics-card__value--primary">
            {inventory.totalItems}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Low Stock</dt>
          <dd
            className={`analytics-card__value${
              inventory.lowStockCount > 0 ? " analytics-card__value--warning" : ""
            }`}
          >
            {inventory.lowStockCount}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Adjustments (period)</dt>
          <dd className="analytics-card__value">{inventory.adjustmentsCount}</dd>
        </div>
      </dl>

      {inventory.topConsumedSkus.length > 0 ? (
        <div className="analytics-card__sub-section">
          <p className="analytics-card__sub-title">Top consumed SKUs</p>
          <ol className="analytics-sku-list">
            {inventory.topConsumedSkus.map((sku) => (
              <li key={sku.sku} className="analytics-sku-list__item">
                <span className="analytics-sku-list__name">{sku.name}</span>
                <span className="analytics-sku-list__code">{sku.sku}</span>
                <span className="analytics-sku-list__units">{sku.unitsConsumed} units</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function RosterCard({ roster }: { roster: DashboardRosterSummary }) {
  const completionRate =
    roster.shiftsScheduled > 0
      ? Math.round((roster.shiftsCompleted / roster.shiftsScheduled) * 100)
      : 0;

  return (
    <section className="analytics-card">
      <h3 className="analytics-card__title">Roster</h3>
      <dl className="analytics-card__stats">
        <div className="analytics-card__stat">
          <dt>Scheduled</dt>
          <dd className="analytics-card__value analytics-card__value--primary">
            {roster.shiftsScheduled}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Completed</dt>
          <dd className="analytics-card__value analytics-card__value--positive">
            {roster.shiftsCompleted}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Cancelled</dt>
          <dd
            className={`analytics-card__value${
              roster.shiftsCancelled > 0 ? " analytics-card__value--warning" : ""
            }`}
          >
            {roster.shiftsCancelled}
          </dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Completion Rate</dt>
          <dd className="analytics-card__value">{completionRate}%</dd>
        </div>
        <div className="analytics-card__stat">
          <dt>Active Staff</dt>
          <dd className="analytics-card__value">{roster.uniqueStaffCount}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function AnalyticsDashboardPage() {
  const { user } = useAuth();

  const { data, isLoading, error, periodDays, setPeriodDays, refetch } =
    useAnalyticsDashboard(user?.homeClinicId);

  if (!user) return null;

  if (!canViewAnalytics(user.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Analytics Dashboard</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} — operational KPIs
              {data ? ` · ${data.periodFrom} to ${data.periodTo}` : ""}
            </p>
          </div>
          <div className="inventory-page__actions">
            <PeriodSelector
              value={periodDays}
              onChange={setPeriodDays}
              disabled={isLoading}
            />
            <button
              type="button"
              className="button-link"
              onClick={refetch}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
            <Link to="/analytics/audit" className="button-link">
              Audit Trail →
            </Link>
          </div>
        </div>

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading analytics…</p>
        ) : data ? (
          <div className="analytics-cards-grid">
            <RevenueCard revenue={data.revenue} />
            <InventoryCard inventory={data.inventory} />
            <RosterCard roster={data.roster} />
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
