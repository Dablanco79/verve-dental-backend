import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { PurchaseOrderLine } from "../types/inventory.js";
import { canManageUsers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const REASON_LABELS: Record<string, string> = {
  below_reorder_point: "Below reorder point",
};

function formatReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { selectedClinic } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    if (!user || !selectedClinicId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.listPurchaseOrders(selectedClinicId);
      setLines(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load purchase orders");
    } finally {
      setIsLoading(false);
    }
  }, [selectedClinicId, user]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  /** Collect unique draft PO IDs so we can render a submit button per PO group. */
  const draftPoIds = useMemo(
    () => [
      ...new Set(
        lines
          .filter((l) => l.orderStatus === "draft")
          .map((l) => l.draftPurchaseOrderId),
      ),
    ],
    [lines],
  );

  async function handleSubmit(poId: string) {
    if (!user || !selectedClinicId) return;
    setSubmittingPoId(poId);
    setSubmitError(null);
    try {
      await apiClient.submitPurchaseOrder(selectedClinicId, poId);
      await loadLines();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to submit purchase order",
      );
    } finally {
      setSubmittingPoId(null);
    }
  }

  async function handleExport() {
    if (!user || !selectedClinicId) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await apiClient.exportPurchaseOrdersCsv(selectedClinicId);
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export purchase orders",
      );
    } finally {
      setIsExporting(false);
    }
  }

  if (!user) return null;

  if (!canManageUsers(user.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Purchase orders</h2>
            <p className="inventory-page__subtitle">
              {(selectedClinic?.name ?? user.homeClinicName)} — auto-generated lines when stock falls below
              reorder point
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={() => void handleExport()}
              disabled={isExporting || isLoading || lines.length === 0}
            >
              {isExporting ? "Exporting…" : "Export CSV"}
            </button>
            <button
              type="button"
              className="button-link"
              onClick={() => void loadLines()}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {exportError && (
          <p className="status-card__error" role="alert">
            {exportError}
          </p>
        )}

        {submitError && (
          <p className="status-card__error" role="alert">
            {submitError}
          </p>
        )}

        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading purchase orders…</p>
        ) : lines.length === 0 ? (
          <div className="po-empty">
            <p className="po-empty__title">No purchase order lines yet.</p>
            <p className="po-empty__hint">
              Lines are created automatically when a barcode scan causes stock
              to drop below the reorder point.
            </p>
          </div>
        ) : (
          <div className="inventory-table-wrapper">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="inventory-table__numeric">Qty needed</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <span className="inventory-table__name">{line.itemName}</span>
                      <span className="inventory-table__meta">{line.masterSku}</span>
                    </td>
                    <td className="inventory-table__numeric">{line.quantity}</td>
                    <td>{formatReason(line.reason)}</td>
                    <td>
                      <span
                        className={
                          line.orderStatus === "submitted"
                            ? "po-badge po-badge--submitted"
                            : "po-badge po-badge--draft"
                        }
                      >
                        {line.orderStatus === "submitted" ? "Submitted" : "Draft"}
                      </span>
                    </td>
                    <td className="inventory-table__meta">
                      {formatDate(line.createdAt)}
                    </td>
                    <td>
                      {line.orderStatus === "draft" ? (
                        <button
                          type="button"
                          className="button-link po-submit-btn"
                          onClick={() =>
                            void handleSubmit(line.draftPurchaseOrderId)
                          }
                          disabled={
                            submittingPoId === line.draftPurchaseOrderId
                          }
                          aria-label={`Submit purchase order for ${line.itemName}`}
                        >
                          {submittingPoId === line.draftPurchaseOrderId
                            ? "Submitting…"
                            : "Submit PO"}
                        </button>
                      ) : (
                        <span className="inventory-table__meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draftPoIds.length > 0 && (
          <div className="po-batch-actions">
            {draftPoIds.map((poId) => {
              const poLineCount = lines.filter(
                (l) => l.draftPurchaseOrderId === poId && l.orderStatus === "draft",
              ).length;
              return (
                <button
                  key={poId}
                  type="button"
                  className="button-primary"
                  onClick={() => void handleSubmit(poId)}
                  disabled={submittingPoId === poId}
                >
                  {submittingPoId === poId
                    ? "Submitting…"
                    : `Submit draft PO (${String(poLineCount)} line${poLineCount !== 1 ? "s" : ""})`}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="status-card po-summary">
        <dl className="po-summary__stats">
          <div className="po-summary__stat">
            <dt>Total lines</dt>
            <dd>{lines.length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Draft lines</dt>
            <dd>{lines.filter((l) => l.orderStatus === "draft").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Submitted lines</dt>
            <dd>{lines.filter((l) => l.orderStatus === "submitted").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Total units needed</dt>
            <dd>{lines.reduce((sum, l) => sum + l.quantity, 0)}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Unique SKUs</dt>
            <dd>{new Set(lines.map((l) => l.masterSku)).size}</dd>
          </div>
        </dl>
      </section>
    </AppShell>
  );
}
