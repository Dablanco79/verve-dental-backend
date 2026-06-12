import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
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
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.listPurchaseOrders(user.homeClinicId);
      setLines(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load purchase orders");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

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
              {user.homeClinicName} — auto-generated lines when stock falls below reorder
              point
            </p>
          </div>
          <div className="inventory-page__actions">
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

        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading purchase orders…</p>
        ) : lines.length === 0 ? (
          <div className="po-empty">
            <p className="po-empty__title">No purchase order lines yet.</p>
            <p className="po-empty__hint">
              Lines are created automatically when a barcode scan causes stock to drop
              below the reorder point.
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
                      <span className="po-badge po-badge--draft">
                        {line.orderStatus === "draft" ? "Draft" : "Submitted"}
                      </span>
                    </td>
                    <td className="inventory-table__meta">{formatDate(line.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <dt>Total units needed</dt>
            <dd>{lines.reduce((sum, l) => sum + l.quantity, 0)}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Unique SKUs</dt>
            <dd>{new Set(lines.map((l) => l.masterSku)).size}</dd>
          </div>
        </dl>
        <p className="po-summary__hint">
          Submit functionality coming in a future module. Export and ordering workflows will be added with Module 04.
        </p>
      </section>
    </AppShell>
  );
}
