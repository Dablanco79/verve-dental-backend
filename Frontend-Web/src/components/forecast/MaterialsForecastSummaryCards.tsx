import type { MaterialsForecastSummary } from "../../types/materialsForecast.js";

type Props = {
  summary: MaterialsForecastSummary;
  forecastDays: number;
};

function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function MaterialsForecastSummaryCards({ summary, forecastDays }: Props) {
  return (
    <div className="mf-summary-cards">

      <div className="mf-summary-card">
        <span className="mf-summary-card__label">Projected Consumption</span>
        <span className="mf-summary-card__value">{summary.productsWithConsumption}</span>
        <span className="mf-summary-card__sub">
          {summary.productsWithConsumption === 1 ? "product" : "products"} with scheduled
          usage in {forecastDays} days
        </span>
      </div>

      <div className="mf-summary-card">
        <span className="mf-summary-card__label">Projected Stock OK</span>
        <span className="mf-summary-card__value">{summary.productsAtSafeLevel}</span>
        <span className="mf-summary-card__sub">
          of {summary.totalProducts}{" "}
          {summary.totalProducts === 1 ? "product" : "products"} forecast safe
        </span>
      </div>

      <div className={`mf-summary-card${summary.productsAtRisk > 0 ? " mf-summary-card--risk" : ""}`}>
        <span className="mf-summary-card__label">Products At Risk</span>
        <span className="mf-summary-card__value">{summary.productsAtRisk}</span>
        <span className="mf-summary-card__sub">
          {summary.productsAtRisk === 0
            ? "No stock shortfalls forecast"
            : `${summary.productsAtRisk === 1 ? "product" : "products"} will breach safety threshold`}
        </span>
      </div>

      <div className={`mf-summary-card${summary.recommendedReorderCount > 0 ? " mf-summary-card--warning" : ""}`}>
        <span className="mf-summary-card__label">Recommended Reorders</span>
        <span className="mf-summary-card__value">{summary.recommendedReorderCount}</span>
        <span className="mf-summary-card__sub">
          {summary.recommendedReorderCount === 0
            ? "No reorders needed in this window"
            : `${summary.recommendedReorderCount === 1 ? "product" : "products"} need restocking`}
        </span>
      </div>

      <div className="mf-summary-card">
        <span className="mf-summary-card__label">Estimated Reorder Cost</span>
        <span className="mf-summary-card__value">
          {summary.estimatedReorderCostCents !== null
            ? formatAud(summary.estimatedReorderCostCents)
            : summary.recommendedReorderCount === 0
              ? "—"
              : "Pricing unavailable"}
        </span>
        <span className="mf-summary-card__sub">
          {summary.hasPartialPricing
            ? "Partial estimate — some products have no pricing"
            : summary.estimatedReorderCostCents !== null
              ? "Based on current unit costs · AUD"
              : summary.recommendedReorderCount === 0
                ? "No reorders required"
                : "Configure unit costs in inventory settings"}
        </span>
      </div>

    </div>
  );
}
