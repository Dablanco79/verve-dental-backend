import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { useClinicTimezone } from "../hooks/useClinicTimezone.js";
import { useLaborForecast, useGroupLaborForecast } from "../hooks/useLaborForecast.js";
import { canViewLaborForecast, canAccessModule } from "../utils/roles.js";
import type { LaborCostAnalysis, CostBreakdown, ExceptionSummary, GroupClinicEntry } from "../types/forecast.js";

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatAud(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHours(value: number): string {
  return `${value.toFixed(2)} hrs`;
}

function formatRate(cents: number | null): string {
  if (cents === null) return "—";
  return formatAud(cents / 100) + "/hr";
}

function formatCost(dollars: number | null): string {
  if (dollars === null) return "—";
  return formatAud(dollars);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns today as YYYY-MM-DD in the given IANA timezone.
 *
 * The timezone MUST be the clinic's IANA timezone (e.g. "Australia/Sydney"),
 * NOT the browser's local timezone.  An owner/admin travelling overseas would
 * otherwise get a different calendar date from the clinic's actual local day.
 */
function today(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/**
 * Adds N calendar days to a YYYY-MM-DD string using pure UTC date arithmetic.
 * Avoids the midnight-boundary bug that occurs when constructing a Date via
 * `new Date("YYYY-MM-DDT00:00:00")` in a UTC+ timezone (the resulting UTC
 * timestamp is the previous day, so toISOString() returns the wrong date).
 */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ── Quick-select options ──────────────────────────────────────────────────────

type QuickOption = { label: string; from: string; to: string };

/**
 * Builds the quick-select date range options anchored to clinic-local today.
 * Must be called with the clinic's IANA timezone so the "today" boundary is
 * correct for the clinic's calendar date, regardless of the device's location.
 */
function buildQuickOptions(tz: string): QuickOption[] {
  const t = today(tz);
  return [
    { label: "Next 7 days",    from: t,                    to: addDays(t, 6) },
    { label: "Next 14 days",   from: t,                    to: addDays(t, 13) },
    { label: "Next 30 days",   from: t,                    to: addDays(t, 29) },
    { label: "Past 30 days",   from: addDays(t, -30),      to: addDays(t, -1) },
    { label: "This month",     from: t.slice(0, 8) + "01", to: t },
  ];
}

// ── Section card sub-components ───────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  variant = "secondary",
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: "primary" | "secondary" | "exception" | "success";
}) {
  return (
    <div className={`lf-summary__kpi lf-summary__kpi--${variant}`}>
      <span className="lf-summary__kpi-label">{label}</span>
      <span className="lf-summary__kpi-value">{value}</span>
      {sub ? <span className="lf-summary__kpi-sub">{sub}</span> : null}
    </div>
  );
}

function CostBucketRow({
  label,
  bucket,
  isException = false,
}: {
  label: string;
  bucket: CostBreakdown;
  isException?: boolean;
}) {
  return (
    <div className={`lf-bucket-row${isException ? " lf-bucket-row--exception" : ""}`}>
      <span className="lf-bucket-row__label">{label}</span>
      <span className="lf-bucket-row__hours">{formatHours(bucket.hours)}</span>
      <span className="lf-bucket-row__cost">{formatCost(bucket.totalCost)}</span>
    </div>
  );
}

function ExceptionRow({
  label,
  summary,
}: {
  label: string;
  summary: ExceptionSummary;
}) {
  return (
    <div className="lf-bucket-row lf-bucket-row--exception">
      <span className="lf-bucket-row__label">{label}</span>
      <span className="lf-bucket-row__hours">{formatHours(summary.scheduledHours)}</span>
      <span className="lf-bucket-row__cost">{String(summary.count)} shifts</span>
    </div>
  );
}

// ── Staff breakdown table ─────────────────────────────────────────────────────

import type { StaffCostBreakdown } from "../types/forecast.js";

function StaffBreakdownTable({
  rows,
  canSeeRates,
}: {
  rows: StaffCostBreakdown[];
  canSeeRates: boolean;
}) {
  if (rows.length === 0) {
    return <p className="lf-table-empty__title">No staff data in this period.</p>;
  }

  return (
    <div className="lf-table-wrapper" style={{ overflowX: "auto" }}>
      <table className="lf-table lf-staff-table">
        <thead>
          <tr>
            <th className="lf-table__th">Staff</th>
            <th className="lf-table__th lf-table__th--numeric">Appr. hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Pend. hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Future hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Rej. hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Amend. hrs</th>
            <th className="lf-table__th lf-table__th--numeric">Incomplete</th>
            <th className="lf-table__th lf-table__th--numeric">Missing</th>
            {canSeeRates ? (
              <>
                <th className="lf-table__th lf-table__th--numeric">Rate</th>
                <th className="lf-table__th lf-table__th--numeric">Super %</th>
                <th className="lf-table__th lf-table__th--numeric">Appr. cost</th>
                <th className="lf-table__th lf-table__th--numeric">Pend. cost</th>
                <th className="lf-table__th lf-table__th--numeric">Future cost</th>
              </>
            ) : null}
            <th className="lf-table__th">Rate source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.staffUserId} className="lf-table__row">
              <td className="lf-table__cell">{row.staffEmail}</td>
              <td className="lf-table__numeric">{row.approvedHours.toFixed(2)}</td>
              <td className="lf-table__numeric">{row.pendingHours.toFixed(2)}</td>
              <td className="lf-table__numeric">{row.futureProjectedHours.toFixed(2)}</td>
              <td className={`lf-table__numeric${row.rejectedHours > 0 ? " lf-table__numeric--warn" : ""}`}>
                {row.rejectedHours.toFixed(2)}
              </td>
              <td className={`lf-table__numeric${row.requiresAmendmentHours > 0 ? " lf-table__numeric--warn" : ""}`}>
                {row.requiresAmendmentHours.toFixed(2)}
              </td>
              <td className={`lf-table__numeric${row.incompleteCount > 0 ? " lf-table__numeric--warn" : ""}`}>
                {String(row.incompleteCount)}
              </td>
              <td className={`lf-table__numeric${row.missingShiftCount > 0 ? " lf-table__numeric--warn" : ""}`}>
                {String(row.missingShiftCount)}
              </td>
              {canSeeRates ? (
                <>
                  <td className="lf-table__numeric">{formatRate(row.baseHourlyRate !== null ? row.baseHourlyRate * 100 : null)}</td>
                  <td className="lf-table__numeric">{row.superRatePercent !== null ? `${String(row.superRatePercent)}%` : "—"}</td>
                  <td className="lf-table__numeric">{formatCost(row.approvedCost)}</td>
                  <td className="lf-table__numeric">{formatCost(row.pendingCost)}</td>
                  <td className="lf-table__numeric">{formatCost(row.futureCost)}</td>
                </>
              ) : null}
              <td>
                {row.rateSource === "configured" ? (
                  <span className="inventory-badge" title="Configured pay rate">Configured</span>
                ) : row.rateSource === "fallback" ? (
                  <span className="inventory-badge inventory-badge--warn" title="Using default estimate">Default estimate</span>
                ) : (
                  <span className="lf-table__numeric">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main analysis display ─────────────────────────────────────────────────────

function LaborAnalysisDisplay({
  data,
  canSeeRates,
}: {
  data: LaborCostAnalysis;
  canSeeRates: boolean;
}) {
  const { historical, futureForecast, planningEstimate, staffBreakdown, dataQuality } = data;

  const hasExceptions =
    dataQuality.hasIncompleteTimesheets ||
    dataQuality.hasMissingTimesheets ||
    dataQuality.hasRejectedTimesheets ||
    dataQuality.hasRequiresAmendment;

  return (
    <>
      {/* Planning estimate — primary KPI */}
      <section className="lf-summary" aria-label="Planning estimate">
        <div className="lf-summary__kpis">
          <KpiCard
            label="Estimated Period Labour Cost"
            value={formatCost(planningEstimate.totalCost)}
            sub="Approved + Pending Approval + Future Forecast"
            variant="primary"
          />
          {historical ? (
            <KpiCard
              label="Approved"
              value={formatCost(planningEstimate.approvedCost)}
              sub={formatHours(historical.approved.hours)}
              variant="success"
            />
          ) : null}
          {historical ? (
            <KpiCard
              label="Pending Approval"
              value={formatCost(planningEstimate.pendingCost)}
              sub={formatHours(historical.pending.hours)}
              variant="secondary"
            />
          ) : null}
          {futureForecast ? (
            <KpiCard
              label="Future Forecast"
              value={formatCost(planningEstimate.futureCost)}
              sub={formatHours(futureForecast.totalHours)}
              variant="secondary"
            />
          ) : null}
        </div>
        <p className="lf-summary__note">
          Estimated Period Labour Cost = Approved + Pending Approval + Future Forecast.
          Rejected, Requires Amendment, Incomplete and Missing items are excluded.
        </p>
      </section>

      {/* Historical breakdown */}
      {historical ? (
        <section className="lf-section" aria-label="Historical breakdown">
          <h3 className="lf-section__heading">Historical Labour Cost</h3>
          <div className="lf-bucket-list">
            <div className="lf-bucket-list__header">
              <span>Status</span>
              <span>Hours</span>
              <span>Cost</span>
            </div>
            <CostBucketRow label="✓ Approved" bucket={historical.approved} />
            <CostBucketRow label="⏳ Pending Approval" bucket={historical.pending} />
          </div>
        </section>
      ) : null}

      {/* Future forecast breakdown by shift type */}
      {futureForecast && futureForecast.breakdownByShiftType.length > 0 ? (
        <section className="lf-section" aria-label="Future forecast by shift type">
          <h3 className="lf-section__heading">Future Forecast</h3>
          {futureForecast.anyStaffUsingFallback ? (
            <div className="status-card inventory-receiving-callout" role="status" style={{ marginBottom: "0.75rem" }}>
              <p>
                <strong>Some staff are using a default rate estimate.</strong>{" "}
                Configure pay rates in <strong>Manage Users</strong> for a more accurate forecast.
              </p>
            </div>
          ) : null}
          <div className="lf-table-wrapper">
            <table className="lf-table">
              <thead>
                <tr>
                  <th className="lf-table__th">Shift type</th>
                  <th className="lf-table__th lf-table__th--numeric">Projected hrs</th>
                  <th className="lf-table__th lf-table__th--numeric">Base cost</th>
                  <th className="lf-table__th lf-table__th--numeric">Super / overhead</th>
                  <th className="lf-table__th lf-table__th--numeric">Total cost</th>
                  <th className="lf-table__th">Rate source</th>
                </tr>
              </thead>
              <tbody>
                {futureForecast.breakdownByShiftType.map((row) => (
                  <tr key={row.shiftType} className="lf-table__row">
                    <td className="lf-table__cell">
                      <span className={`lf-role-badge lf-role-badge--${row.shiftType}`}>
                        {row.shiftType.replace("_", "-")}
                      </span>
                    </td>
                    <td className="lf-table__numeric">{row.projectedHours.toFixed(2)}</td>
                    <td className="lf-table__numeric">{formatCost(row.baseCost)}</td>
                    <td className="lf-table__numeric">{formatCost(row.superCost)}</td>
                    <td className="lf-table__numeric lf-table__numeric--total">{formatCost(row.totalCost)}</td>
                    <td>
                      {row.usingFallbackForSomeStaff ? (
                        <span className="inventory-badge inventory-badge--warn">Default estimate</span>
                      ) : (
                        <span className="inventory-badge">Configured</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Exception indicators */}
      {hasExceptions && historical ? (
        <section className="lf-section" aria-label="Exception indicators">
          <h3 className="lf-section__heading">Exceptions &amp; Data Quality</h3>
          <p className="lf-section__sub">
            These items are excluded from the Estimated Period Labour Cost and require attention.
          </p>
          <div className="lf-bucket-list lf-bucket-list--exceptions">
            <div className="lf-bucket-list__header">
              <span>Category</span>
              <span>Hours / Shifts</span>
              <span>Shifts / Count</span>
            </div>
            {dataQuality.hasRejectedTimesheets ? (
              <CostBucketRow
                label="✗ Rejected (excluded)"
                bucket={historical.rejected}
                isException
              />
            ) : null}
            {dataQuality.hasRequiresAmendment ? (
              <CostBucketRow
                label="✎ Requires Amendment (excluded)"
                bucket={historical.requiresAmendment}
                isException
              />
            ) : null}
            {dataQuality.hasIncompleteTimesheets ? (
              <ExceptionRow
                label="⚠ Incomplete (no cost)"
                summary={historical.incomplete}
              />
            ) : null}
            {dataQuality.hasMissingTimesheets ? (
              <ExceptionRow
                label="! Missing timesheets"
                summary={historical.missing}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Breakdown by Staff */}
      <section className="lf-section" aria-label="Breakdown by staff">
        <h3 className="lf-section__heading">Breakdown by Staff</h3>
        {!canSeeRates ? (
          <p className="lf-section__sub">
            Rate and cost columns are visible to owner / admin only (payroll:rates:read permission required).
          </p>
        ) : null}
        <StaffBreakdownTable rows={staffBreakdown} canSeeRates={canSeeRates} />
      </section>
    </>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export function LaborForecastPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();

  // Authoritative clinic-local timezone — fetched from the clinic record so that
  // date calculations are correct even when the device is in a different timezone.
  const clinicTimezone = useClinicTimezone(clinicId);

  const [fromDate, setFromDate] = useState(() => today(clinicTimezone));
  const [toDate, setToDate] = useState(() => addDays(today(clinicTimezone), 13)); // default: next 14 days
  const [dateError, setDateError] = useState<string | null>(null);

  // Sync the default date range to the clinic's calendar date when the timezone
  // resolves (async, may arrive slightly after first render).
  useEffect(() => {
    setFromDate(today(clinicTimezone));
    setToDate(addDays(today(clinicTimezone), 13));
  }, [clinicTimezone]);

  const quickOptions = buildQuickOptions(clinicTimezone);

  const canSeeRates = user ? canAccessModule(user, "payroll:rates:read") : false;

  const { data, isLoading, error, refetch } = useLaborForecast(
    clinicId,
    { mode: "range", from: fromDate, to: toDate },
  );

  const { data: groupData, isLoading: groupLoading, error: groupError, refetch: groupRefetch } = useGroupLaborForecast(
    { mode: "range", from: fromDate, to: toDate },
    isAllClinicsScope,
  );

  if (!user) return null;

  if (!canViewLaborForecast(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <div className="lf-page">
          <header className="lf-page__header">
            <h1 className="lf-page__title">Labour Cost Analysis — All Clinics</h1>
          </header>

          {/* Date range controls (reused from clinic view) */}
          <section className="lf-date-controls" aria-label="Date range">
            <div className="lf-date-controls__quick">
              {quickOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  className="lf-quick-btn"
                  onClick={() => { applyQuickOption(opt); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="lf-date-controls__range">
              <label htmlFor="group-lf-from">From</label>
              <input
                id="group-lf-from"
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setDateError(null); }}
              />
              <label htmlFor="group-lf-to">To</label>
              <input
                id="group-lf-to"
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setDateError(null); }}
              />
              <button type="button" className="lf-apply-btn" onClick={groupRefetch}>
                Apply
              </button>
            </div>
            {dateError ? <p className="lf-date-error" role="alert">{dateError}</p> : null}
          </section>

          {groupLoading ? (
            <p className="lf-loading">Loading group labour cost analysis…</p>
          ) : groupError ? (
            <p className="lf-error" role="alert">{groupError}</p>
          ) : groupData ? (
            <>
              {/* Group summary KPIs */}
              <section className="lf-summary" aria-label="Group Labour Cost Summary">
                <div className="lf-summary__kpis">
                  <div className="lf-summary__kpi lf-summary__kpi--primary">
                    <span className="lf-summary__kpi-label">Estimated Period Labour Cost</span>
                    <span className="lf-summary__kpi-value">
                      {groupData.totals.totalCost !== null
                        ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(groupData.totals.totalCost)
                        : "—"}
                    </span>
                    <span className="lf-summary__kpi-sub">
                      {groupData.totals.totalHours.toFixed(1)} h across {String(groupData.clinics.length)} clinic{groupData.clinics.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="lf-summary__kpi">
                    <span className="lf-summary__kpi-label">Approved</span>
                    <span className="lf-summary__kpi-value">
                      {groupData.totals.approvedCost !== null
                        ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(groupData.totals.approvedCost)
                        : "—"}
                    </span>
                  </div>
                  <div className="lf-summary__kpi">
                    <span className="lf-summary__kpi-label">Pending Approval</span>
                    <span className="lf-summary__kpi-value">
                      {groupData.totals.pendingCost !== null
                        ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(groupData.totals.pendingCost)
                        : "—"}
                    </span>
                  </div>
                  <div className="lf-summary__kpi">
                    <span className="lf-summary__kpi-label">Future Forecast</span>
                    <span className="lf-summary__kpi-value">
                      {groupData.totals.futureCost !== null
                        ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(groupData.totals.futureCost)
                        : "—"}
                    </span>
                  </div>
                  {groupData.totals.missingCount > 0 ? (
                    <div className="lf-summary__kpi lf-summary__kpi--warning">
                      <span className="lf-summary__kpi-label">Missing Timesheets</span>
                      <span className="lf-summary__kpi-value">{String(groupData.totals.missingCount)}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* Per-clinic breakdown table */}
              <section className="lf-group-breakdown" aria-label="Per-Clinic Breakdown">
                <h2 className="lf-group-breakdown__title">Clinic Breakdown</h2>
                <div className="lf-group-table" role="table" aria-label="Per-clinic labour cost breakdown">
                  <div className="lf-group-table__head" role="row">
                    <span>Clinic</span>
                    <span>Approved</span>
                    <span>Pending</span>
                    <span>Future</span>
                    <span>Total</span>
                    <span>Hours</span>
                  </div>
                  {groupData.clinics.map((entry: GroupClinicEntry) => {
                    const p = entry.analysis.planningEstimate;
                    const h = entry.analysis.historical;
                    const f = entry.analysis.futureForecast;
                    const clinicHours =
                      (h?.approved.hours ?? 0) +
                      (h?.pending.hours ?? 0) +
                      (f?.totalHours ?? 0);
                    const fmt = (v: number | null) =>
                      v !== null
                        ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(v)
                        : "—";
                    return (
                      <div key={entry.clinicId} className="lf-group-table__row" role="row">
                        <span className="lf-group-table__clinic">{entry.clinicName}</span>
                        <span>{fmt(p.approvedCost)}</span>
                        <span>{fmt(p.pendingCost)}</span>
                        <span>{fmt(p.futureCost)}</span>
                        <strong>{fmt(p.totalCost)}</strong>
                        <span>{clinicHours.toFixed(1)} h</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <p className="lf-empty">No labour data available for the selected date range.</p>
          )}
        </div>
      </AppShell>
    );
  }

  function applyQuickOption(opt: QuickOption) {
    setFromDate(opt.from);
    setToDate(opt.to);
    setDateError(null);
  }

  function handleFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFromDate(e.target.value);
    if (e.target.value > toDate) {
      setDateError("From date must be on or before To date.");
    } else {
      setDateError(null);
    }
  }

  function handleToChange(e: React.ChangeEvent<HTMLInputElement>) {
    setToDate(e.target.value);
    if (fromDate > e.target.value) {
      setDateError("From date must be on or before To date.");
    } else {
      setDateError(null);
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Labour Cost Analysis</h2>
            <p className="inventory-page__subtitle">
              {clinicName ?? user.homeClinicName} — historical timesheet costs and future roster forecast
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={refetch}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Date range controls */}
        <div className="lf-controls" aria-label="Date range">
          <div className="lf-controls__date-row">
            <div className="lf-controls__date-field">
              <label htmlFor="lf-from-date" className="lf-controls__label">From</label>
              <input
                id="lf-from-date"
                type="date"
                value={fromDate}
                onChange={handleFromChange}
                className="lf-controls__date-input"
                aria-label="From date"
              />
            </div>
            <div className="lf-controls__date-field">
              <label htmlFor="lf-to-date" className="lf-controls__label">To</label>
              <input
                id="lf-to-date"
                type="date"
                value={toDate}
                onChange={handleToChange}
                className="lf-controls__date-input"
                aria-label="To date"
              />
            </div>
          </div>

          {dateError ? (
            <p className="status-card__error" role="alert">{dateError}</p>
          ) : null}

          {/* Quick options */}
          <div className="lf-quick-options" role="group" aria-label="Quick date options">
            {quickOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                className="lf-quick-options__btn"
                onClick={() => { applyQuickOption(opt); }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <p className="lf-controls__hint">
            {fromDate} → {toDate}
            {fromDate < today(clinicTimezone) && toDate >= today(clinicTimezone)
              ? " (mixed: historical + future)"
              : toDate < today(clinicTimezone)
              ? " (historical only)"
              : " (future only)"}
          </p>
        </div>

        {/* Data display */}
        {dateError ? null : error ? (
          <p className="status-card__error">{error}</p>
        ) : isLoading ? (
          <p className="loading-message">Calculating labour cost analysis…</p>
        ) : data ? (
          <LaborAnalysisDisplay data={data} canSeeRates={canSeeRates} />
        ) : null}
      </section>

      {/* Methodology */}
      <section className="status-card lf-disclaimer">
        <h3 className="lf-disclaimer__heading">Projection methodology</h3>
        <ul className="lf-disclaimer__list">
          <li>
            <strong>Configured rates:</strong> where a staff member has a configured pay rate,
            that rate (and their configured super %) is used for all cost calculations — historical
            and future. Costs reflect the rate effective on each shift's date, not today's rate.
          </li>
          <li>
            <strong>Fallback estimates:</strong> when no configured rate exists for a staff member,
            Award-approximate default rates are used ($50/hr standard, $75/hr overtime, $62.50/hr
            on-call) with a flat 15% overhead for super and statutory costs.
          </li>
          <li>
            <strong>Historical costs:</strong> Approved and Pending Approval costs use actual
            approved timesheet hours. Rejected and Requires Amendment items are shown separately
            and are excluded from the Estimated Period Labour Cost.
          </li>
          <li>
            <strong>Future forecast hours:</strong> calibrated against approved timesheets from
            the past 30 days. Staff with no history fall back to clinic-wide average, then
            scheduled shift duration.
          </li>
          <li>
            <strong>Excluded from planning estimate:</strong> Rejected, Requires Amendment,
            Incomplete (draft timesheets), and Missing (no timesheet filed for a roster entry).
          </li>
          <li>
            Cancelled shifts are excluded from all calculations.
            Commission-log entries are not included in hourly cost analysis.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
