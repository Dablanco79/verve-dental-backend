import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useAdjustments } from "../hooks/useAdjustments.js";
import { ADJUSTMENT_REASONS, type AdjustmentReason, type InventoryAdjustment } from "../types/inventory.js";
import { canViewAdjustmentHistory } from "../utils/roles.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDelta(delta: number, unit: string): string {
  const abs = String(Math.abs(delta));
  return delta > 0 ? `+${abs} ${unit}` : `-${abs} ${unit}`;
}

function adjustmentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    scan_deduct: "Scan deduct",
    manual_adjust: "Manual adjust",
    receive: "Receive",
    transfer_in: "Transfer in",
    transfer_out: "Transfer out",
  };
  return labels[type] ?? type;
}

// ── Filters bar ───────────────────────────────────────────────────────────────

type HistoryFilters = {
  search: string;
  reason: AdjustmentReason | "";
  from: string;
  to: string;
};

const EMPTY_FILTERS: HistoryFilters = { search: "", reason: "", from: "", to: "" };

type FiltersBarProps = {
  filters: HistoryFilters;
  onChange: (f: HistoryFilters) => void;
  onClear: () => void;
};

function FiltersBar({ filters, onChange, onClear }: FiltersBarProps) {
  return (
    <div className="billing-filters">
      <label className="billing-filters__field">
        <span className="billing-filters__label">Search</span>
        <input
          type="search"
          className="billing-filters__control"
          placeholder="Product name or notes…"
          value={filters.search}
          onChange={(e) => { onChange({ ...filters, search: e.target.value }); }}
          maxLength={100}
        />
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">Reason</span>
        <select
          className="billing-filters__control"
          value={filters.reason}
          onChange={(e) => { onChange({ ...filters, reason: e.target.value as AdjustmentReason | "" }); }}
        >
          <option value="">All reasons</option>
          {ADJUSTMENT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">From</span>
        <input
          type="date"
          className="billing-filters__control"
          value={filters.from}
          onChange={(e) => { onChange({ ...filters, from: e.target.value }); }}
        />
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">To</span>
        <input
          type="date"
          className="billing-filters__control"
          value={filters.to}
          onChange={(e) => { onChange({ ...filters, to: e.target.value }); }}
        />
      </label>

      <button type="button" className="billing-filters__clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

// ── Adjustments table ─────────────────────────────────────────────────────────

type AdjTableProps = {
  adjustments: InventoryAdjustment[];
};

function AdjTable({ adjustments }: AdjTableProps) {
  if (adjustments.length === 0) {
    return (
      <div className="billing-empty">
        <p className="billing-empty__title">No adjustments found</p>
        <p className="billing-empty__hint">
          Try adjusting the filters or broadening the date range.
        </p>
      </div>
    );
  }

  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead>
          <tr>
            <th className="billing-table__th">Date</th>
            <th className="billing-table__th">Type</th>
            <th className="billing-table__th">Adjustment</th>
            <th className="billing-table__th">Before</th>
            <th className="billing-table__th">After</th>
            <th className="billing-table__th">Reason</th>
            <th className="billing-table__th">Performed by</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((adj) => (
            <tr key={adj.id} className="billing-table__row">
              <td className="billing-table__td billing-table__td--mono">
                {formatDateTime(adj.createdAt)}
              </td>
              <td className="billing-table__td">
                <span className="analytics-entity-badge">
                  {adjustmentTypeLabel(adj.adjustmentType)}
                </span>
              </td>
              <td
                className={`billing-table__td billing-table__td--mono${adj.quantityDelta > 0 ? " adj-history__delta--positive" : " adj-history__delta--negative"}`}
              >
                {formatDelta(adj.quantityDelta, "")}
              </td>
              <td className="billing-table__td billing-table__td--mono">
                {adj.quantityBefore}
              </td>
              <td className="billing-table__td billing-table__td--mono">
                {adj.quantityAfter}
              </td>
              <td className="billing-table__td" title={adj.reason ?? ""}>
                {adj.reason ? (
                  <span className="adj-history__reason">{adj.reason}</span>
                ) : (
                  <span className="billing-table__draft-tag">—</span>
                )}
              </td>
              <td className="billing-table__td">{adj.performedByEmail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagination bar ─────────────────────────────────────────────────────────────

type PaginationBarProps = {
  total: number;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
};

function PaginationBar({ total, page, pageSize, onPrev, onNext }: PaginationBarProps) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const isFirstPage = page === 0;
  const isLastPage = (page + 1) * pageSize >= total;

  return (
    <div className="analytics-pagination">
      <span className="analytics-pagination__summary">
        {total === 0
          ? "0 adjustments"
          : `${start.toString()}–${end.toString()} of ${total.toString()} adjustments`}
      </span>
      <div className="analytics-pagination__controls">
        <button
          type="button"
          className="button-link"
          onClick={onPrev}
          disabled={isFirstPage}
          aria-label="Previous page"
        >
          ← Previous
        </button>
        <button
          type="button"
          className="button-link"
          onClick={onNext}
          disabled={isLastPage}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdjustmentHistoryPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";

  const { data, isLoading, error, refetch } = useAdjustments(
    user && !isAllClinicsScope ? selectedClinicId : undefined,
    {
      limit: 200,
      offset: 0,
    },
  );

  const [localFilters, setLocalFilters] = useState<HistoryFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);

  const filteredAdjustments = useMemo(() => {
    if (!data) return [];
    const { search, reason, from, to } = localFilters;
    const lowerSearch = search.toLowerCase();
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59`).getTime() : null;

    return data.items.filter((adj) => {
      if (search) {
        const haystack =
          `${adj.reason ?? ""} ${adj.performedByEmail} ${adj.adjustmentType}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      if (reason) {
        if (!adj.reason?.startsWith(reason)) return false;
      }
      if (fromMs !== null) {
        if (new Date(adj.createdAt).getTime() < fromMs) return false;
      }
      if (toMs !== null) {
        if (new Date(adj.createdAt).getTime() > toMs) return false;
      }
      return true;
    });
  }, [data, localFilters]);

  const paginatedAdjustments = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredAdjustments.slice(start, start + PAGE_SIZE);
  }, [filteredAdjustments, page]);

  function handleFiltersChange(f: HistoryFilters) {
    setLocalFilters(f);
    setPage(0);
  }

  function handleClearFilters() {
    setLocalFilters(EMPTY_FILTERS);
    setPage(0);
  }

  if (!user) return null;

  if (!canViewAdjustmentHistory(user.role)) {
    return <Navigate to="/inventory" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view adjustment history</h2>
          <p>
            Inventory adjustment history is clinic-specific. Choose a real clinic
            from Clinic scope before reviewing stock movements.
          </p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Adjustment History</h2>
            <p className="inventory-page__subtitle">
              {(selectedClinic?.name ?? user.homeClinicName)} — all inventory adjustments
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/inventory/adjust" className="button-link">
              New adjustment
            </Link>
            <Link to="/inventory" className="link-button">
              ← Back to inventory
            </Link>
          </div>
        </div>

        <FiltersBar
          filters={localFilters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
        />

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
            {" "}
            <button
              type="button"
              className="link-button"
              onClick={refetch}
            >
              Retry
            </button>
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading adjustment history…</p>
        ) : data ? (
          <>
            <AdjTable adjustments={paginatedAdjustments} />
            <PaginationBar
              total={filteredAdjustments.length}
              page={page}
              pageSize={PAGE_SIZE}
              onPrev={() => { setPage((p) => Math.max(0, p - 1)); }}
              onNext={() => { setPage((p) => p + 1); }}
            />
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
