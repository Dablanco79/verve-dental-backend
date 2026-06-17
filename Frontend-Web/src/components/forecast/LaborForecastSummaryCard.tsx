import type { LaborForecastSummary } from "../../types/forecast.js";

type Props = {
  summary: LaborForecastSummary;
};

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

export function LaborForecastSummaryCard({ summary }: Props) {
  return (
    <div className="lf-summary">
      <div className="lf-summary__kpi lf-summary__kpi--primary">
        <span className="lf-summary__kpi-label">Grand Total Projected Cost</span>
        <span className="lf-summary__kpi-value">{formatAud(summary.grandTotalProjectedCost)}</span>
        <span className="lf-summary__kpi-sub">
          {summary.forecastWindowDays}-day window · AUD incl. overhead
        </span>
      </div>

      <div className="lf-summary__kpis">
        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Total Projected Hours</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {formatHours(summary.totalProjectedHours)}
          </span>
        </div>

        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Base Labor Cost</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {formatAud(summary.totalProjectedBaseCost)}
          </span>
        </div>

        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Overhead Cost</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {formatAud(summary.totalProjectedOverheadCost)}
          </span>
          <span className="lf-summary__kpi-sub">
            Super, payroll tax &amp; WorkCover (~15%)
          </span>
        </div>

        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Roles Scheduled</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {summary.breakdownByRole.length}
          </span>
        </div>
      </div>
    </div>
  );
}
