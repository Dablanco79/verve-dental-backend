import { useState } from "react";
import { Navigate, Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useAuditEvents } from "../hooks/useAuditEvents.js";
import { AUDIT_ENTITY_TYPES } from "../types/analytics.js";
import type { AuditEntityType, AuditEventsFilters } from "../types/analytics.js";
import { canViewAnalytics } from "../utils/roles.js";

// ── Utility helpers ────────────────────────────────────────────────────────────

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

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

const ENTITY_TYPE_LABELS: Record<AuditEntityType, string> = {
  invoice: "Invoice",
  payment: "Payment",
  line_item: "Line Item",
  inventory_adjustment: "Inventory Adj.",
  roster_entry: "Roster Entry",
  timesheet_entry: "Timesheet",
  leave_request: "Leave Request",
  user: "User",
  clinic: "Clinic",
  product: "Product",
  scan: "Scan",
};

// ── Filters bar ────────────────────────────────────────────────────────────────

type AuditFiltersBarProps = {
  filters: AuditEventsFilters;
  onApply: (partial: Omit<AuditEventsFilters, "offset">) => void;
};

function AuditFiltersBar({ filters, onApply }: AuditFiltersBarProps) {
  const [localEntityType, setLocalEntityType] = useState<AuditEntityType | "">(
    filters.entityType ?? "",
  );
  const [localActorId, setLocalActorId] = useState(filters.actorId ?? "");
  const [localFrom, setLocalFrom] = useState(filters.from ?? "");
  const [localTo, setLocalTo] = useState(filters.to ?? "");

  function handleApply() {
    onApply({
      entityType: localEntityType !== "" ? localEntityType : undefined,
      actorId: localActorId.trim() || undefined,
      from: localFrom || undefined,
      to: localTo || undefined,
      limit: filters.limit,
    });
  }

  function handleClear() {
    setLocalEntityType("");
    setLocalActorId("");
    setLocalFrom("");
    setLocalTo("");
    onApply({ limit: filters.limit });
  }

  return (
    <div className="billing-filters">
      <label className="billing-filters__field">
        <span className="billing-filters__label">Entity type</span>
        <select
          className="billing-filters__control"
          value={localEntityType}
          onChange={(e) => { setLocalEntityType(e.target.value as AuditEntityType | ""); }}
        >
          <option value="">All types</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENTITY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">Actor ID</span>
        <input
          type="text"
          className="billing-filters__control"
          value={localActorId}
          onChange={(e) => { setLocalActorId(e.target.value); }}
          placeholder="User ID"
          maxLength={64}
        />
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">From</span>
        <input
          type="date"
          className="billing-filters__control"
          value={localFrom}
          onChange={(e) => { setLocalFrom(e.target.value); }}
        />
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">To</span>
        <input
          type="date"
          className="billing-filters__control"
          value={localTo}
          onChange={(e) => { setLocalTo(e.target.value); }}
        />
      </label>

      <button
        type="button"
        className="billing-filters__clear"
        onClick={handleApply}
      >
        Apply
      </button>

      <button
        type="button"
        className="billing-filters__clear"
        onClick={handleClear}
      >
        Clear
      </button>
    </div>
  );
}

// ── Audit events table ─────────────────────────────────────────────────────────

type AuditTableProps = {
  events: NonNullable<ReturnType<typeof useAuditEvents>["data"]>["events"];
};

function AuditTable({ events }: AuditTableProps) {
  if (events.length === 0) {
    return (
      <div className="billing-empty">
        <p className="billing-empty__title">No audit events found</p>
        <p className="billing-empty__hint">Try adjusting the filters or broadening the date range.</p>
      </div>
    );
  }

  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead>
          <tr>
            <th className="billing-table__th">Timestamp</th>
            <th className="billing-table__th">Entity type</th>
            <th className="billing-table__th">Action</th>
            <th className="billing-table__th">Entity ID</th>
            <th className="billing-table__th">Actor</th>
            <th className="billing-table__th">Metadata</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => (
            <tr key={evt.id} className="billing-table__row">
              <td className="billing-table__td billing-table__td--mono">
                {formatDateTime(evt.createdAt)}
              </td>
              <td className="billing-table__td">
                <span className="analytics-entity-badge">
                  {ENTITY_TYPE_LABELS[evt.entityType]}
                </span>
              </td>
              <td className="billing-table__td billing-table__td--mono">
                {evt.action}
              </td>
              <td className="billing-table__td billing-table__td--mono" title={evt.entityId}>
                {truncateId(evt.entityId)}
              </td>
              <td className="billing-table__td">{evt.actorEmail}</td>
              <td className="billing-table__td billing-table__td--mono">
                {Object.keys(evt.metadata).length > 0 ? (
                  <span title={JSON.stringify(evt.metadata, null, 2)}>
                    {truncateId(JSON.stringify(evt.metadata))}
                  </span>
                ) : (
                  <span className="billing-table__draft-tag">—</span>
                )}
              </td>
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
  offset: number;
  limit: number;
  onPrev: () => void;
  onNext: () => void;
  isLoading: boolean;
};

function PaginationBar({ total, offset, limit, onPrev, onNext, isLoading }: PaginationBarProps) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const isFirstPage = offset === 0;
  const isLastPage = offset + limit >= total;

  return (
    <div className="analytics-pagination">
      <span className="analytics-pagination__summary">
        {total === 0 ? "0 events" : `${start.toString()}–${end.toString()} of ${total.toString()} events`}
      </span>
      <div className="analytics-pagination__controls">
        <button
          type="button"
          className="button-link"
          onClick={onPrev}
          disabled={isFirstPage || isLoading}
          aria-label="Previous page"
        >
          ← Previous
        </button>
        <button
          type="button"
          className="button-link"
          onClick={onNext}
          disabled={isLastPage || isLoading}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function AuditTrailPage() {
  const { user } = useAuth();

  const { data, isLoading, error, filters, setFilters, nextPage, prevPage } =
    useAuditEvents(user?.homeClinicId, { limit: 25, offset: 0 });

  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;

  if (!user) return null;

  if (!canViewAnalytics(user.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Audit Trail</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} — full immutable event log
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/analytics" className="button-link">
              ← Back to Analytics
            </Link>
          </div>
        </div>

        <AuditFiltersBar filters={filters} onApply={setFilters} />

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading audit events…</p>
        ) : data ? (
          <>
            <AuditTable events={data.events} />
            <PaginationBar
              total={data.total}
              offset={offset}
              limit={limit}
              onPrev={prevPage}
              onNext={nextPage}
              isLoading={isLoading}
            />
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
