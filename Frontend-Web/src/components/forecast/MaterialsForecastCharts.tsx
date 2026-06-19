import type { EnrichedProjection, ForecastStatus } from "../../types/materialsForecast.js";

type Props = {
  projections: EnrichedProjection[];
  forecastDays: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ForecastStatus, string> = {
  critical: "#c0392b",
  reorder_required: "#e67e22",
  low_soon: "#f39c12",
  healthy: "#27ae60",
};

const STATUS_LABELS: Record<ForecastStatus, string> = {
  critical: "Critical",
  reorder_required: "Reorder Required",
  low_soon: "Low Soon",
  healthy: "Healthy",
};

// ── Chart 1: Products at risk by category ─────────────────────────────────────

function RiskByCategoryChart({ projections }: { projections: EnrichedProjection[] }) {
  const atRisk = projections.filter((p) => p.willBreachSafetyThreshold);

  if (atRisk.length === 0) {
    return (
      <div className="mf-chart__empty">
        <p>No at-risk products to display.</p>
      </div>
    );
  }

  const categoryCounts = new Map<string, number>();
  for (const p of atRisk) {
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  }

  const entries = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="mf-chart__bars">
      {entries.map(([category, count]) => (
        <div key={category} className="mf-chart__bar-row">
          <span className="mf-chart__bar-label" title={category}>
            {category}
          </span>
          <div className="mf-chart__bar-track">
            <div
              className="mf-chart__bar-fill mf-chart__bar-fill--risk"
              style={{ width: `${String((count / maxCount) * 100)}%` }}
              role="presentation"
            />
          </div>
          <span className="mf-chart__bar-value">
            {count} {count === 1 ? "product" : "products"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Chart 2: Top products by depletion risk ───────────────────────────────────

function DepletionRiskChart({
  projections,
  forecastDays,
}: {
  projections: EnrichedProjection[];
  forecastDays: number;
}) {
  const atRisk = projections
    .filter((p) => p.willBreachSafetyThreshold)
    .sort((a, b) => a.projectedStockRemaining - b.projectedStockRemaining)
    .slice(0, 8);

  if (atRisk.length === 0) {
    return (
      <div className="mf-chart__empty">
        <p>No depletion risk detected in {forecastDays}-day window.</p>
      </div>
    );
  }

  const absMax = Math.max(...atRisk.map((p) => Math.abs(p.projectedStockRemaining)), 1);

  return (
    <div className="mf-chart__bars">
      {atRisk.map((p) => {
        const isNegative = p.projectedStockRemaining <= 0;
        const barPct = (Math.abs(p.projectedStockRemaining) / absMax) * 100;

        return (
          <div key={p.masterCatalogItemId} className="mf-chart__bar-row">
            <span className="mf-chart__bar-label" title={p.name}>
              {p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name}
            </span>
            <div className="mf-chart__bar-track">
              <div
                className={`mf-chart__bar-fill${isNegative ? " mf-chart__bar-fill--critical" : " mf-chart__bar-fill--warning"}`}
                style={{ width: `${String(barPct)}%` }}
                role="presentation"
              />
            </div>
            <span className={`mf-chart__bar-value${isNegative ? " mf-chart__bar-value--critical" : ""}`}>
              {p.projectedStockRemaining} {p.unitOfMeasure}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Chart 3: Status distribution ─────────────────────────────────────────────

function StatusDistributionChart({ projections }: { projections: EnrichedProjection[] }) {
  const counts: Record<ForecastStatus, number> = {
    critical: 0,
    reorder_required: 0,
    low_soon: 0,
    healthy: 0,
  };
  for (const p of projections) {
    counts[p.forecastStatus]++;
  }

  const total = projections.length;
  if (total === 0) return null;

  const statusOrder: ForecastStatus[] = ["critical", "reorder_required", "low_soon", "healthy"];
  const nonZero = statusOrder.filter((s) => counts[s] > 0);

  return (
    <div className="mf-chart__distribution">
      <div className="mf-chart__dist-bar">
        {nonZero.map((status) => (
          <div
            key={status}
            className="mf-chart__dist-segment"
            style={{
              width: `${String((counts[status] / total) * 100)}%`,
              backgroundColor: STATUS_COLORS[status],
            }}
            title={`${STATUS_LABELS[status]}: ${String(counts[status])}`}
            role="presentation"
          />
        ))}
      </div>
      <div className="mf-chart__dist-legend">
        {nonZero.map((status) => (
          <div key={status} className="mf-chart__dist-legend-item">
            <span
              className="mf-chart__dist-legend-dot"
              style={{ backgroundColor: STATUS_COLORS[status] }}
            />
            <span className="mf-chart__dist-legend-label">
              {STATUS_LABELS[status]} ({counts[status]})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MaterialsForecastCharts({ projections, forecastDays }: Props) {
  if (projections.length === 0) return null;

  return (
    <div className="mf-charts">

      <div className="mf-chart">
        <h4 className="mf-chart__title">Stock Status Overview</h4>
        <p className="mf-chart__sub">
          Distribution of all {projections.length} products across forecast status
          categories for the {forecastDays}-day window.
        </p>
        <StatusDistributionChart projections={projections} />
      </div>

      <div className="mf-chart">
        <h4 className="mf-chart__title">At-Risk Products by Category</h4>
        <p className="mf-chart__sub">
          Number of products projected to breach their safety reorder level, grouped by
          category.
        </p>
        <RiskByCategoryChart projections={projections} />
      </div>

      <div className="mf-chart">
        <h4 className="mf-chart__title">Top Depletion Risks</h4>
        <p className="mf-chart__sub">
          At-risk products sorted by lowest projected stock remaining after the{" "}
          {forecastDays}-day window. Negative values indicate a projected stockout.
        </p>
        <DepletionRiskChart projections={projections} forecastDays={forecastDays} />
      </div>

    </div>
  );
}
