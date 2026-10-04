/**
 * LaborForecastSummaryCard — legacy/compat shim.
 *
 * The primary display is now handled inline in LaborForecastPage.tsx.
 * This component is kept so any other pages/tests that import it do not break.
 */
import type { LaborCostAnalysis } from "../../types/forecast.js";

type Props = {
  summary: LaborCostAnalysis;
};

function formatAud(value: number | null): string {
  if (value === null) return "—";
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
  const { planningEstimate, futureForecast } = summary;

  return (
    <div className="lf-summary">
      <div className="lf-summary__kpi lf-summary__kpi--primary">
        <span className="lf-summary__kpi-label">Estimated Period Labour Cost</span>
        <span className="lf-summary__kpi-value">{formatAud(planningEstimate.totalCost)}</span>
        <span className="lf-summary__kpi-sub">Approved + Pending Approval + Future Forecast</span>
      </div>

      <div className="lf-summary__kpis">
        {futureForecast ? (
          <>
            <div className="lf-summary__kpi">
              <span className="lf-summary__kpi-label">Future Projected Hours</span>
              <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
                {formatHours(futureForecast.totalHours)}
              </span>
            </div>
            <div className="lf-summary__kpi">
              <span className="lf-summary__kpi-label">Future Base Cost</span>
              <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
                {formatAud(futureForecast.baseCost)}
              </span>
            </div>
            <div className="lf-summary__kpi">
              <span className="lf-summary__kpi-label">Super / Overhead</span>
              <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
                {formatAud(futureForecast.superCost)}
              </span>
              <span className="lf-summary__kpi-sub">
                {futureForecast.anyStaffUsingFallback
                  ? "Includes ~15% fallback overhead"
                  : "Configured super rates"}
              </span>
            </div>
          </>
        ) : null}

        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Approved (historical)</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {formatAud(planningEstimate.approvedCost)}
          </span>
        </div>
        <div className="lf-summary__kpi">
          <span className="lf-summary__kpi-label">Pending Approval</span>
          <span className="lf-summary__kpi-value lf-summary__kpi-value--secondary">
            {formatAud(planningEstimate.pendingCost)}
          </span>
        </div>
      </div>
    </div>
  );
}
