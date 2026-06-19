import { useState } from "react";

import type { AlertSeverity, MaterialShortfallAlert } from "../../types/materialsForecast.js";

type SeverityFilter = AlertSeverity | "all";

type Props = {
  alerts: MaterialShortfallAlert[];
};

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
};

const SEVERITY_DESCRIPTIONS: Record<AlertSeverity, string> = {
  critical: "Stock will run out completely during the forecast window.",
  warning: "Stock will fall below the safety reorder threshold.",
};

function AlertBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span className={`mf-alert__badge mf-alert__badge--${severity}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

function AlertCard({ alert }: { alert: MaterialShortfallAlert }) {
  return (
    <div className={`mf-alert mf-alert--${alert.severity}`}>
      <div className="mf-alert__header">
        <AlertBadge severity={alert.severity} />
        <span className="mf-alert__sku">{alert.sku}</span>
      </div>

      <p className="mf-alert__title">{alert.name}</p>
      <p className="mf-alert__description">{SEVERITY_DESCRIPTIONS[alert.severity]}</p>

      <dl className="mf-alert__meta">
        <div className="mf-alert__meta-row">
          <dt>Category</dt>
          <dd>{alert.category}</dd>
        </div>
        <div className="mf-alert__meta-row">
          <dt>Current Stock</dt>
          <dd>
            {alert.currentStock} {alert.unitOfMeasure}
          </dd>
        </div>
        <div className="mf-alert__meta-row">
          <dt>Projected Usage</dt>
          <dd>
            {alert.projectedUsage} {alert.unitOfMeasure}
          </dd>
        </div>
        <div className="mf-alert__meta-row">
          <dt>Forecast Remaining</dt>
          <dd className={alert.projectedStockRemaining <= 0 ? "mf-alert__meta-value--critical" : ""}>
            {alert.projectedStockRemaining} {alert.unitOfMeasure}
          </dd>
        </div>
        <div className="mf-alert__meta-row">
          <dt>Safety Reorder Level</dt>
          <dd>
            {alert.reorderPoint} {alert.unitOfMeasure}
          </dd>
        </div>
        <div className="mf-alert__meta-row">
          <dt>Shortfall</dt>
          <dd>
            {alert.shortfallUnits} {alert.unitOfMeasure} below threshold
          </dd>
        </div>
        {alert.daysUntilStockout !== null ? (
          <div className="mf-alert__meta-row">
            <dt>Estimated Stockout</dt>
            <dd>
              ~{alert.daysUntilStockout}{" "}
              {alert.daysUntilStockout === 1 ? "day" : "days"} at current usage rate
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function MaterialsForecastAlerts({ alerts }: Props) {
  const [filter, setFilter] = useState<SeverityFilter>("all");

  if (alerts.length === 0) {
    return (
      <div className="mf-alerts-empty">
        <p className="mf-alerts-empty__title">No stock alerts for this forecast window.</p>
        <p className="mf-alerts-empty__hint">
          All products are forecast to remain above their safety reorder levels.
        </p>
      </div>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  const filtered =
    filter === "all" ? alerts : alerts.filter((a) => a.severity === filter);

  return (
    <div className="mf-alerts">
      <div className="mf-alerts__filter-bar">
        <button
          type="button"
          className={`mf-alerts__filter-btn${filter === "all" ? " mf-alerts__filter-btn--active" : ""}`}
          onClick={() => { setFilter("all"); }}
        >
          All ({alerts.length})
        </button>
        {criticalCount > 0 ? (
          <button
            type="button"
            className={`mf-alerts__filter-btn mf-alerts__filter-btn--critical${filter === "critical" ? " mf-alerts__filter-btn--active" : ""}`}
            onClick={() => { setFilter("critical"); }}
          >
            Critical ({criticalCount})
          </button>
        ) : null}
        {warningCount > 0 ? (
          <button
            type="button"
            className={`mf-alerts__filter-btn mf-alerts__filter-btn--warning${filter === "warning" ? " mf-alerts__filter-btn--active" : ""}`}
            onClick={() => { setFilter("warning"); }}
          >
            Warning ({warningCount})
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="mf-alerts__no-match">No {filter} alerts.</p>
      ) : (
        <div className="mf-alerts__grid">
          {filtered.map((alert) => (
            <AlertCard key={alert.masterCatalogItemId} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
