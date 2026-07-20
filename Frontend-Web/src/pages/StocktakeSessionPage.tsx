/**
 * StocktakeSessionPage — Workflow 2.1: Stocktake & Inventory Reconciliation
 *
 * The active counting workspace for a single stocktake session.
 * Supports:
 *   - Product search and category filter
 *   - Barcode scan via barcode-lookup widget
 *   - Manual quantity entry per line
 *   - Auto-calculated variance and variance value
 *   - Session lifecycle: Start → Count → Complete / Cancel
 *   - Persistent sticky progress indicator (Sprint 1.1)
 *   - Lines sorted by Category → Product Name (Sprint 1.1)
 *   - Completion blocked until every line is counted (Sprint 1.1)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { StocktakeLine, StocktakeSession } from "../types/stocktake.js";
import { STOCKTAKE_STATUS_LABELS } from "../types/stocktake.js";
import { canManageStocktake } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : cents > 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function varianceCellClass(variance: number | null): string {
  if (variance === null) return "";
  if (variance > 0) return "stocktake-variance--positive";
  if (variance < 0) return "stocktake-variance--negative";
  return "stocktake-variance--zero";
}

// ── Progress Summary (sticky) ─────────────────────────────────────────────────
//
// Displayed while counting is active (in_progress) and for completed sessions.
// Sticks to the top of the scrollable area so the user can always see progress
// without scrolling back to the top of the table.

type ProgressSummaryProps = {
  lines: StocktakeLine[];
};

function ProgressSummary({ lines }: ProgressSummaryProps) {
  const total = lines.length;
  const counted = lines.filter((l) => l.countedQuantity !== null).length;
  const remaining = total - counted;
  const pct = total > 0 ? Math.round((counted / total) * 100) : 0;

  const { positiveVariance, negativeVariance, totalVarianceValue } = useMemo(() => {
    let pos = 0;
    let neg = 0;
    let value = 0;
    for (const l of lines) {
      if (l.countedQuantity === null) continue;
      const v = l.countedQuantity - l.expectedQuantity;
      if (v > 0) pos++;
      if (v < 0) neg++;
      value += v * l.unitCostCents;
    }
    return { positiveVariance: pos, negativeVariance: neg, totalVarianceValue: value };
  }, [lines]);

  return (
    <div className="stocktake-summary stocktake-summary--sticky" aria-label="Counting progress">
      <div className="stocktake-summary__progress">
        <div className="stocktake-progress-bar">
          <div
            className="stocktake-progress-bar__fill"
            style={{ width: `${String(pct)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Counting progress"
          />
        </div>
        <span className="stocktake-progress-label" data-testid="progress-label">
          {String(counted)} of {String(total)} items counted
          {remaining > 0 && (
            <> — <strong>{String(remaining)} remaining</strong></>
          )}
          {" "}{String(pct)}% complete
        </span>
      </div>

      <div className="stocktake-summary__stats">
        <div className="stocktake-stat">
          <span className="stocktake-stat__label">Surplus items</span>
          <span className="stocktake-stat__value stocktake-variance--positive">
            {String(positiveVariance)}
          </span>
        </div>
        <div className="stocktake-stat">
          <span className="stocktake-stat__label">Short items</span>
          <span className="stocktake-stat__value stocktake-variance--negative">
            {String(negativeVariance)}
          </span>
        </div>
        <div className="stocktake-stat">
          <span className="stocktake-stat__label">Net variance value</span>
          <span className={`stocktake-stat__value ${varianceCellClass(totalVarianceValue)}`}>
            {formatCurrency(totalVarianceValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Barcode Lookup ────────────────────────────────────────────────────────────

type BarcodeLookupProps = {
  lines: StocktakeLine[];
  onFound: (lineId: string) => void;
};

function BarcodeLookup({ lines, onFound }: BarcodeLookupProps) {
  const [barcodeInput, setBarcodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSearch() {
    const query = barcodeInput.trim().toLowerCase();
    if (!query) return;

    const match = lines.find(
      (l) =>
        (l.primaryBarcode ?? "").toLowerCase() === query ||
        (l.masterSku ?? "").toLowerCase() === query ||
        l.productName.toLowerCase().includes(query),
    );

    if (match) {
      setError(null);
      setBarcodeInput("");
      onFound(match.id);
    } else {
      setError(`No product found for "${barcodeInput.trim()}"`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  return (
    <div className="stocktake-barcode-lookup">
      <div className="stocktake-barcode-lookup__row">
        <input
          ref={inputRef}
          type="text"
          className="stocktake-input"
          placeholder="Scan barcode or enter SKU…"
          value={barcodeInput}
          onChange={(e) => { setBarcodeInput(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          aria-label="Barcode or SKU lookup"
        />
        <button
          className="stocktake-btn stocktake-btn--secondary"
          onClick={handleSearch}
          type="button"
        >
          Find
        </button>
      </div>
      {error && <p className="stocktake-field-error">{error}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function StocktakeSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const { selectedClinic } = useSelectedClinic();
  const navigate = useNavigate();

  const [session, setSession] = useState<StocktakeSession | null>(null);
  const [lines, setLines] = useState<StocktakeLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [highlightLineId, setHighlightLineId] = useState<string | null>(null);

  const clinicId = selectedClinic?.id;
  const isManager = user ? canManageStocktake(user.role) : false;

  // Load session + lines
  const loadData = useCallback(async () => {
    if (!clinicId || !sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [sess, linesData] = await Promise.all([
        apiClient.getStocktakeSession(clinicId, sessionId),
        apiClient.listStocktakeLines(clinicId, sessionId),
      ]);
      setSession(sess);
      setLines(linesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session.");
    } finally {
      setIsLoading(false);
    }
  }, [clinicId, sessionId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Derived state
  const categories = useMemo(
    () => [...new Set(lines.map((l) => l.category).filter(Boolean))].sort(),
    [lines],
  );

  // Finding 1: uncounted count for button guard
  const uncountedCount = useMemo(
    () => lines.filter((l) => l.countedQuantity === null).length,
    [lines],
  );

  // Finding 3: sort by Category → Product Name, then apply search/category filter
  const filteredLines = useMemo(() => {
    const q = search.toLowerCase().trim();
    return lines
      .filter((l) => {
        const matchesSearch =
          !q ||
          l.productName.toLowerCase().includes(q) ||
          (l.masterSku ?? "").toLowerCase().includes(q) ||
          (l.primaryBarcode ?? "").toLowerCase().includes(q);
        const matchesCategory = !categoryFilter || l.category === categoryFilter;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category, "en", { sensitivity: "base" });
        if (catCmp !== 0) return catCmp;
        return a.productName.localeCompare(b.productName, "en", { sensitivity: "base" });
      });
  }, [lines, search, categoryFilter]);

  const editable = session?.status === "in_progress";

  // Update a line count
  async function handleUpdateLine(
    lineId: string,
    countedQuantity: number | null,
    notes: string | null,
  ) {
    if (!clinicId || !sessionId) return;
    try {
      const updated = await apiClient.updateStocktakeLine(clinicId, sessionId, lineId, {
        countedQuantity,
        notes,
      });
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, ...updated } : l)),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to save count.",
      );
    }
  }

  // Highlight a line from barcode lookup
  function handleLineFound(lineId: string) {
    setHighlightLineId(lineId);
    setTimeout(() => { setHighlightLineId(null); }, 3000);
    const el = document.getElementById(`stocktake-line-${lineId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Start session
  async function handleStart() {
    if (!clinicId || !sessionId || !isManager) return;
    setIsActioning(true);
    setActionError(null);
    try {
      const updated = await apiClient.startStocktakeSession(clinicId, sessionId);
      setSession(updated);
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start session.");
    } finally {
      setIsActioning(false);
    }
  }

  // Cancel session
  async function handleCancel() {
    if (!clinicId || !sessionId || !isManager) return;
    if (!window.confirm("Cancel this stocktake session? This cannot be undone.")) return;
    setIsActioning(true);
    setActionError(null);
    try {
      const updated = await apiClient.cancelStocktakeSession(clinicId, sessionId);
      setSession(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to cancel session.");
    } finally {
      setIsActioning(false);
    }
  }

  // Complete session — Finding 1: no window.confirm for uncounted items.
  // The button is disabled when uncountedCount > 0 and a clear message is shown.
  async function handleComplete() {
    if (!clinicId || !sessionId || !isManager) return;
    if (uncountedCount > 0) return; // Guard — should not be reachable when button is disabled.

    setIsActioning(true);
    setActionError(null);
    try {
      const result = await apiClient.completeStocktakeSession(clinicId, sessionId);
      setSession(result.session);
      await navigate("/inventory/stocktakes", {
        state: {
          successMessage: `Stocktake completed. ${String(result.adjustmentsApplied)} inventory adjustment${result.adjustmentsApplied === 1 ? "" : "s"} applied.`,
        },
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to complete session.",
      );
    } finally {
      setIsActioning(false);
    }
  }

  if (!clinicId) {
    return (
      <AppShell>
        <div className="stocktake-page">
          <p className="stocktake-page__empty">Select a clinic to view this session.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="stocktake-page stocktake-page--wide">
        {/* Breadcrumb + Header */}
        <div className="stocktake-page__header">
          <div className="stocktake-page__header-left">
            <nav className="stocktake-page__nav" aria-label="Breadcrumb">
              <Link to="/inventory" className="stocktake-page__nav-link">Inventory</Link>
              <span className="stocktake-page__nav-sep">/</span>
              <Link to="/inventory/stocktakes" className="stocktake-page__nav-link">Stocktake</Link>
              <span className="stocktake-page__nav-sep">/</span>
              <span className="stocktake-page__nav-current">{session?.name ?? "Session"}</span>
            </nav>
            <h1 className="stocktake-page__title">{session?.name ?? "Loading…"}</h1>
            {session && (
              <div className="stocktake-meta">
                <span className={`stocktake-status-badge stocktake-status-badge--${session.status.replace("_", "-")}`}>
                  {STOCKTAKE_STATUS_LABELS[session.status]}
                </span>
                <span className="stocktake-meta__item">
                  Created {formatDate(session.createdAt)} by {session.createdByEmail}
                </span>
                {session.startedAt && (
                  <span className="stocktake-meta__item">
                    Started {formatDate(session.startedAt)}
                  </span>
                )}
                {session.completedAt && (
                  <span className="stocktake-meta__item">
                    Completed {formatDate(session.completedAt)}
                  </span>
                )}
                {session.cancelledAt && (
                  <span className="stocktake-meta__item">
                    Cancelled {formatDate(session.cancelledAt)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          {isManager && session && (
            <div className="stocktake-page__actions">
              {session.status === "draft" && (
                <button
                  className="stocktake-btn stocktake-btn--primary"
                  onClick={() => { void handleStart(); }}
                  disabled={isActioning}
                >
                  {isActioning ? "Starting…" : "Start Stocktake"}
                </button>
              )}
              {session.status === "in_progress" && (
                <>
                  <button
                    className="stocktake-btn stocktake-btn--primary"
                    onClick={() => { void handleComplete(); }}
                    disabled={isActioning || uncountedCount > 0}
                    title={
                      uncountedCount > 0
                        ? `${String(uncountedCount)} item${uncountedCount === 1 ? "" : "s"} still need to be counted`
                        : undefined
                    }
                    data-testid="complete-button"
                  >
                    {isActioning ? "Completing…" : "Complete Stocktake"}
                  </button>
                  <button
                    className="stocktake-btn stocktake-btn--danger"
                    onClick={() => { void handleCancel(); }}
                    disabled={isActioning}
                  >
                    Cancel
                  </button>
                </>
              )}
              {session.status === "draft" && (
                <button
                  className="stocktake-btn stocktake-btn--danger"
                  onClick={() => { void handleCancel(); }}
                  disabled={isActioning}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error banners */}
        {error && (
          <div className="stocktake-alert stocktake-alert--error" role="alert">
            {error}
          </div>
        )}
        {actionError && (
          <div className="stocktake-alert stocktake-alert--error" role="alert">
            {actionError}
            <button className="stocktake-alert__dismiss" onClick={() => { setActionError(null); }}>
              Dismiss
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <p className="stocktake-page__loading" aria-live="polite">Loading session…</p>
        )}

        {!isLoading && session && (
          <>
            {/* Draft state — not yet started */}
            {session.status === "draft" && (
              <div className="stocktake-draft-notice">
                <p>
                  This session is in <strong>Draft</strong> status. When you click{" "}
                  <strong>Start Stocktake</strong>, the system will snapshot the current
                  inventory quantities and create a counting line for each product.
                </p>
              </div>
            )}

            {/* Finding 1: Uncounted items banner — shown when in_progress and items remain */}
            {session.status === "in_progress" && uncountedCount > 0 && (
              <div className="stocktake-alert stocktake-alert--warning" role="status" data-testid="uncounted-banner">
                <strong>{String(uncountedCount)} item{uncountedCount === 1 ? "" : "s"} still need to be counted.</strong>
                {" "}Every inventory item must have a count (including zero) before
                you can complete the stocktake.
              </div>
            )}

            {/* Finding 3: Persistent sticky progress + variance summary */}
            {(session.status === "in_progress" || session.status === "completed") &&
              lines.length > 0 && (
                <ProgressSummary lines={lines} />
              )}

            {/* Barcode lookup */}
            {editable && lines.length > 0 && (
              <div className="stocktake-toolbar">
                <BarcodeLookup lines={lines} onFound={handleLineFound} />
              </div>
            )}

            {/* Filters */}
            {lines.length > 0 && (
              <div className="billing-filters">
                <label className="billing-filters__field">
                  <span className="billing-filters__label">Search</span>
                  <input
                    type="search"
                    className="billing-filters__control"
                    placeholder="Product name, SKU or barcode…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); }}
                    maxLength={100}
                  />
                </label>
                <label className="billing-filters__field">
                  <span className="billing-filters__label">Category</span>
                  <select
                    className="billing-filters__control"
                    value={categoryFilter}
                    onChange={(e) => { setCategoryFilter(e.target.value); }}
                  >
                    <option value="">All categories</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {/* Lines table */}
            {lines.length === 0 && session.status !== "draft" && (
              <div className="stocktake-page__empty">
                <p>No inventory lines found for this session.</p>
              </div>
            )}

            {lines.length > 0 && (
              <div className="stocktake-page__table-wrap stocktake-page__table-wrap--scroll">
                <table className="stocktake-page__table" aria-label="Stocktake lines">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Barcode</th>
                      <th>Category</th>
                      <th className="stocktake-page__col--num">Expected</th>
                      <th>Counted</th>
                      <th className="stocktake-page__col--num">Variance</th>
                      <th className="stocktake-page__col--num">Variance Value</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines.map((line) => (
                      <tr key={line.id} id={`stocktake-line-${line.id}`}>
                        <td>
                          <div className="stocktake-product-cell">
                            <span className="stocktake-product-name">
                              {line.productName || "—"}
                            </span>
                            <span className="stocktake-product-sku">
                              {line.masterSku ?? ""}
                            </span>
                          </div>
                        </td>
                        <td className="stocktake-page__col--code">
                          {line.primaryBarcode ?? "—"}
                        </td>
                        <td>{line.category || "—"}</td>
                        <td className="stocktake-page__col--num">
                          {String(line.expectedQuantity)} {line.stockUnit}
                        </td>
                        <td>
                          {editable ? (
                            <CountInput
                              line={line}
                              isHighlighted={highlightLineId === line.id}
                              onSave={handleUpdateLine}
                            />
                          ) : (
                            <span>
                              {line.countedQuantity !== null
                                ? `${String(line.countedQuantity)} ${line.stockUnit}`
                                : "—"}
                            </span>
                          )}
                        </td>
                        <td
                          className={`stocktake-page__col--num ${varianceCellClass(line.variance)}`}
                        >
                          {line.variance !== null
                            ? line.variance >= 0
                              ? `+${String(line.variance)}`
                              : String(line.variance)
                            : "—"}
                        </td>
                        <td
                          className={`stocktake-page__col--num ${varianceCellClass(line.varianceValueCents ?? null)}`}
                        >
                          {formatCurrency(line.varianceValueCents)}
                        </td>
                        <td>
                          {editable ? (
                            <NotesInput
                              line={line}
                              onSave={handleUpdateLine}
                            />
                          ) : (
                            <span className="stocktake-notes">
                              {line.notes ?? "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredLines.length === 0 && (
                  <p className="stocktake-page__empty stocktake-page__empty--inline">
                    No items match the current filter.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ── Inline count input ────────────────────────────────────────────────────────
// Extracted to avoid re-rendering the whole table on each keystroke.

type CountInputProps = {
  line: StocktakeLine;
  isHighlighted: boolean;
  onSave: (lineId: string, counted: number | null, notes: string | null) => Promise<void>;
};

function CountInput({ line, isHighlighted, onSave }: CountInputProps) {
  const [value, setValue] = useState(
    line.countedQuantity !== null ? String(line.countedQuantity) : "",
  );
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(line.countedQuantity !== null ? String(line.countedQuantity) : "");
  }, [line.countedQuantity]);

  useEffect(() => {
    if (isHighlighted && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isHighlighted]);

  async function save() {
    const trimmed = value.trim();
    if (trimmed !== "") {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 0) return;
    }
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    setSaving(true);
    try {
      await onSave(line.id, parsed, line.notes);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step="1"
      className="stocktake-input stocktake-input--compact"
      value={value}
      onChange={(e) => { setValue(e.target.value); }}
      onBlur={() => { void save(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { void save(); } }}
      disabled={saving}
      placeholder="Enter"
      aria-label={`Counted quantity for ${line.productName || "item"}`}
    />
  );
}

// ── Inline notes input ────────────────────────────────────────────────────────

type NotesInputProps = {
  line: StocktakeLine;
  onSave: (lineId: string, counted: number | null, notes: string | null) => Promise<void>;
};

function NotesInput({ line, onSave }: NotesInputProps) {
  const [value, setValue] = useState(line.notes ?? "");

  useEffect(() => {
    setValue(line.notes ?? "");
  }, [line.notes]);

  async function save() {
    await onSave(line.id, line.countedQuantity, value.trim() || null);
  }

  return (
    <input
      type="text"
      className="stocktake-input stocktake-input--compact"
      value={value}
      onChange={(e) => { setValue(e.target.value); }}
      onBlur={() => { void save(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { void save(); } }}
      placeholder="Notes"
      maxLength={500}
      aria-label={`Notes for ${line.productName || "item"}`}
    />
  );
}
