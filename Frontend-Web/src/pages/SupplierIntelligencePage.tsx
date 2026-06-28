/**
 * Supplier Intelligence Page — Sprint 3.
 *
 * Shows per-product supplier saving opportunities derived from:
 *   - Confirmed supplier invoice prices (current supplier/price)
 *   - Active supplier catalogue entries (best available price)
 *   - Inventory adjustment records (annual usage)
 *
 * Data quality warning section shows products where comparison is not possible
 * and explains why (no catalogue entries, only one supplier, no confirmed invoices, etc.)
 */

import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type {
  IntelligenceConfidence,
  SupplierIntelligenceResult,
  SupplierIntelligenceRow,
  SupplierIntelligenceSummary,
} from "../types/supplier.js";

const apiClient = createApiClient(loadConfig());

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAnnual(cents: number | null): string {
  if (cents === null) return "—";
  const dollars = cents / 100;
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(2)}`;
}

function formatUsage(units: number | null): string {
  if (units === null) return "—";
  return units.toLocaleString();
}

// ── Confidence badge ──────────────────────────────────────────────────────────

const CONFIDENCE_LABELS: Record<IntelligenceConfidence, string> = {
  high: "High",
  medium: "Medium",
  catalogue_only: "Catalogue Only",
  insufficient_data: "No Data",
};

function ConfidenceBadge({ confidence }: { confidence: IntelligenceConfidence }) {
  return (
    <span className={`intel-badge intel-badge--${confidence.replace("_", "-")}`}>
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

function KpiCards({ summary }: { summary: SupplierIntelligenceSummary }) {
  return (
    <dl className="intel-kpi-bar">
      <div className="intel-kpi-bar__stat">
        <dt>Potential Annual Savings</dt>
        <dd className="intel-kpi-bar__dd--savings">
          {formatAnnual(summary.totalPotentialAnnualSavingCents)}
        </dd>
      </div>
      <div className="intel-kpi-bar__stat">
        <dt>Products With Savings</dt>
        <dd className={summary.productsWithSaving > 0 ? "intel-kpi-bar__dd--active" : undefined}>
          {summary.productsWithSaving}
        </dd>
      </div>
      <div className="intel-kpi-bar__stat">
        <dt>Avg Price Variance</dt>
        <dd>
          {summary.averagePriceVariancePct !== null
            ? `${summary.averagePriceVariancePct.toFixed(1)}%`
            : "—"}
        </dd>
      </div>
      <div className="intel-kpi-bar__stat">
        <dt>Products Needing Attention</dt>
        <dd className={summary.productsNeedingAttention > 0 ? "intel-kpi-bar__dd--pending" : undefined}>
          {summary.productsNeedingAttention}
        </dd>
      </div>
    </dl>
  );
}

// ── Opportunities table ────────────────────────────────────────────────────────

function OpportunitiesTable({ rows }: { rows: SupplierIntelligenceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="intel-empty">
        <p className="intel-empty__title">No saving opportunities found</p>
        <p className="intel-empty__hint">
          This could mean current suppliers already offer the best prices, or there
          is not enough confirmed invoice data yet. Upload and confirm supplier invoices
          to build the price history.
        </p>
      </div>
    );
  }

  return (
    <div className="intel-table-wrap">
      <table className="intel-table">
        <thead>
          <tr>
            <th className="intel-table__th">Product</th>
            <th className="intel-table__th">Current Supplier</th>
            <th className="intel-table__th intel-table__th--num">Current Price</th>
            <th className="intel-table__th">Best Supplier</th>
            <th className="intel-table__th intel-table__th--num">Best Price</th>
            <th className="intel-table__th intel-table__th--num">Saving / Unit</th>
            <th className="intel-table__th intel-table__th--num">Annual Usage</th>
            <th className="intel-table__th intel-table__th--num">Est. Annual Saving</th>
            <th className="intel-table__th">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productId} className="intel-table__row">
              <td className="intel-table__td">
                <span className="intel-table__product-name">{row.productName}</span>
                <span className="intel-table__product-sku">{row.productSku}</span>
              </td>
              <td className="intel-table__td">
                {row.currentSupplierName ?? (
                  <span className="intel-table__muted">—</span>
                )}
              </td>
              <td className="intel-table__td intel-table__td--num">
                {formatCents(row.currentUnitPriceCents)}
              </td>
              <td className="intel-table__td">
                {row.bestSupplierName ?? (
                  <span className="intel-table__muted">—</span>
                )}
              </td>
              <td className="intel-table__td intel-table__td--num">
                {formatCents(row.bestUnitPriceCents)}
              </td>
              <td className="intel-table__td intel-table__td--num intel-table__td--saving">
                {row.savingPerUnit !== null ? formatCents(row.savingPerUnit) : "—"}
              </td>
              <td className="intel-table__td intel-table__td--num">
                {formatUsage(row.estimatedAnnualUsage)}
              </td>
              <td className="intel-table__td intel-table__td--num intel-table__td--annual">
                {formatAnnual(row.estimatedAnnualSaving)}
              </td>
              <td className="intel-table__td">
                <ConfidenceBadge confidence={row.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Needs attention section ────────────────────────────────────────────────────

const ATTENTION_REASON_GROUPS: {
  label: string;
  filter: (r: SupplierIntelligenceRow) => boolean;
}[] = [
  {
    label: "No supplier catalogue entries",
    filter: (r) => r.supplierCatalogueCount === 0,
  },
  {
    label: "Only one supplier — no comparison possible",
    filter: (r) =>
      r.supplierCatalogueCount === 1 && r.currentSupplierId === null,
  },
  {
    label: "No confirmed invoices yet",
    filter: (r) =>
      r.currentUnitPriceCents === null && r.supplierCatalogueCount >= 2,
  },
  {
    label: "Insufficient data for comparison",
    filter: (r) =>
      r.confidence === "insufficient_data" && r.supplierCatalogueCount > 0,
  },
];

function NeedsAttentionSection({ rows }: { rows: SupplierIntelligenceRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="intel-attention">
      <h3 className="intel-attention__title">Data Quality / Matching Warnings</h3>
      <p className="intel-attention__desc">
        The following products cannot be fully analysed. Possible reasons:
        no matched supplier catalogue entries, only one supplier price on record,
        no confirmed invoices, or no usage history.
      </p>

      {ATTENTION_REASON_GROUPS.map(({ label, filter }) => {
        const group = rows.filter(filter);
        if (group.length === 0) return null;

        return (
          <div key={label} className="intel-attention__group">
            <p className="intel-attention__group-label">{label}</p>
            <ul className="intel-attention__list">
              {group.map((r) => (
                <li key={r.productId} className="intel-attention__item">
                  <span className="intel-attention__product-name">
                    {r.productName}
                  </span>
                  <span className="intel-attention__product-sku">{r.productSku}</span>
                  <span className="intel-attention__reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* Catch-all for rows not covered by specific groups */}
      {(() => {
        const grouped = ATTENTION_REASON_GROUPS.flatMap(({ filter }) =>
          rows.filter(filter),
        );
        const covered = new Set(grouped.map((r) => r.productId));
        const uncovered = rows.filter((r) => !covered.has(r.productId));

        if (uncovered.length === 0) return null;

        return (
          <div className="intel-attention__group">
            <p className="intel-attention__group-label">Other</p>
            <ul className="intel-attention__list">
              {uncovered.map((r) => (
                <li key={r.productId} className="intel-attention__item">
                  <span className="intel-attention__product-name">
                    {r.productName}
                  </span>
                  <span className="intel-attention__product-sku">{r.productSku}</span>
                  <span className="intel-attention__reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function SupplierIntelligencePage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();
  const [data, setData] = useState<SupplierIntelligenceResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !clinicId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getSupplierIntelligence(clinicId);
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load supplier intelligence data.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [user, clinicId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!user) return null;

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view supplier intelligence</h2>
          <p>
            Supplier intelligence is clinic-specific. Choose a clinic from the clinic selector
            to view pricing comparisons and saving opportunities.
          </p>
        </section>
      </AppShell>
    );
  }

  const generatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Supplier Intelligence</h2>
            <p className="inventory-page__subtitle">
              {clinicName ?? user.homeClinicName} — pricing comparison and saving opportunities
              based on confirmed invoice data and supplier catalogue pricing
            </p>
            {generatedAt ? (
              <p className="intel-generated-at">
                Generated: {generatedAt}
              </p>
            ) : null}
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={() => {
                void loadData();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Analysing supplier data…</p>
        ) : data === null ? (
          <p className="intel-empty__hint">No data available.</p>
        ) : (
          <>
            <KpiCards summary={data.summary} />

            <div className="intel-section">
              <h3 className="intel-section__title">Savings Opportunities</h3>
              <p className="intel-section__desc">
                Products where a lower price is available from a different
                confirmed supplier, based on most recent invoice data vs active
                catalogue pricing.
              </p>
              <OpportunitiesTable rows={data.opportunities} />
            </div>

            <NeedsAttentionSection rows={data.needsAttention} />
          </>
        )}
      </section>
    </AppShell>
  );
}
