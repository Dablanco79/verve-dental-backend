import { useState } from "react";

import type { EnrichedProjection, ForecastStatus } from "../../types/materialsForecast.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey =
  | "name"
  | "category"
  | "currentStock"
  | "projectedUsage"
  | "projectedStockRemaining"
  | "recommendedReorderQty"
  | "estimatedReorderCostCents"
  | "forecastStatus";

type SortDir = "asc" | "desc";

type Props = {
  rows: EnrichedProjection[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<ForecastStatus, string> = {
  healthy: "Healthy",
  low_soon: "Low Soon",
  reorder_required: "Reorder Required",
  critical: "Critical",
};

const STATUS_ORDER: Record<ForecastStatus, number> = {
  critical: 0,
  reorder_required: 1,
  low_soon: 2,
  healthy: 3,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function sortRows(
  rows: EnrichedProjection[],
  key: SortKey,
  dir: SortDir,
): EnrichedProjection[] {
  return [...rows].sort((a, b) => {
    let av: string | number;
    let bv: string | number;

    if (key === "forecastStatus") {
      av = STATUS_ORDER[a.forecastStatus];
      bv = STATUS_ORDER[b.forecastStatus];
    } else if (key === "estimatedReorderCostCents") {
      av = a.estimatedReorderCostCents ?? -1;
      bv = b.estimatedReorderCostCents ?? -1;
    } else {
      av = a[key];
      bv = b[key];
    }

    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return 0;
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

type HeaderProps = {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
};

function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  numeric,
}: HeaderProps) {
  const isActive = currentKey === sortKey;
  const indicator = isActive ? (currentDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <th
      className={`mf-table__th${numeric ? " mf-table__th--numeric" : ""}${isActive ? " mf-table__th--active" : ""}`}
      onClick={() => { onSort(sortKey); }}
      role="columnheader"
      aria-sort={isActive ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label}{indicator}
    </th>
  );
}

function StatusBadge({ status }: { status: ForecastStatus }) {
  return (
    <span className={`mf-status-badge mf-status-badge--${status.replace("_", "-")}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MaterialsForecastTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("forecastStatus");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(0);
  }

  if (rows.length === 0) {
    return (
      <div className="mf-table-empty">
        <p className="mf-table-empty__title">No inventory items to forecast.</p>
        <p className="mf-table-empty__hint">
          Add products to clinic inventory to see demand projections here.
        </p>
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.sku.toLowerCase().includes(query) ||
          r.category.toLowerCase().includes(query),
      )
    : rows;

  const sorted = sortRows(filtered, sortKey, sortDir);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="mf-table-section">
      <div className="mf-table-controls">
        <input
          type="search"
          className="mf-table-controls__search"
          placeholder="Search products, SKUs, categories…"
          value={search}
          onChange={handleSearchChange}
          aria-label="Search forecast table"
        />
        <span className="mf-table-controls__count">
          {filtered.length} of {rows.length} products
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="mf-table-no-match">No products match "{search}".</p>
      ) : (
        <>
          <div className="mf-table-wrapper">
            <table className="mf-table">
              <thead>
                <tr>
                  <SortableHeader
                    label="Product"
                    sortKey="name"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Category"
                    sortKey="category"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Current Stock"
                    sortKey="currentStock"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    numeric
                  />
                  <SortableHeader
                    label="Projected Usage"
                    sortKey="projectedUsage"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    numeric
                  />
                  <SortableHeader
                    label="Forecast Remaining"
                    sortKey="projectedStockRemaining"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    numeric
                  />
                  <SortableHeader
                    label="Recommended Reorder Qty"
                    sortKey="recommendedReorderQty"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    numeric
                  />
                  <SortableHeader
                    label="Estimated Cost"
                    sortKey="estimatedReorderCostCents"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    numeric
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="forecastStatus"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.masterCatalogItemId} className="mf-table__row">
                    <td className="mf-table__name">
                      <span className="mf-table__product-name">{row.name}</span>
                      <span className="mf-table__sku">{row.sku}</span>
                    </td>
                    <td className="mf-table__category">{row.category}</td>
                    <td className="mf-table__numeric">
                      {row.currentStock} {row.unitOfMeasure}
                    </td>
                    <td className="mf-table__numeric">
                      {row.projectedUsage > 0 ? `${String(row.projectedUsage)} ${row.unitOfMeasure}` : "—"}
                    </td>
                    <td className={`mf-table__numeric${row.projectedStockRemaining <= 0 ? " mf-table__numeric--critical" : ""}`}>
                      {row.projectedStockRemaining} {row.unitOfMeasure}
                    </td>
                    <td className="mf-table__numeric">
                      {row.recommendedReorderQty > 0
                        ? `${String(row.recommendedReorderQty)} ${row.unitOfMeasure}`
                        : "—"}
                    </td>
                    <td className="mf-table__numeric">
                      {row.estimatedReorderCostCents !== null
                        ? formatAud(row.estimatedReorderCostCents)
                        : row.recommendedReorderQty > 0
                          ? <span className="mf-table__no-price">Pricing unavailable</span>
                          : "—"}
                    </td>
                    <td>
                      <StatusBadge status={row.forecastStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mf-table-pagination">
              <button
                type="button"
                className="mf-table-pagination__btn"
                onClick={() => { setPage((p) => Math.max(0, p - 1)); }}
                disabled={page === 0}
              >
                ← Previous
              </button>
              <span className="mf-table-pagination__info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className="mf-table-pagination__btn"
                onClick={() => { setPage((p) => Math.min(totalPages - 1, p + 1)); }}
                disabled={page >= totalPages - 1}
              >
                Next →
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
