/**
 * PurchasingDraftPage
 *
 * Detail view for a Purchasing Draft — the parent concept for one purchasing
 * exercise that may span multiple suppliers.
 *
 * Hierarchy displayed:
 *   Purchasing Draft (PD-YYYYMMDD-NNNN)
 *   └─ Supplier PO 1 (PO-YYYYMMDD-NNNN-01)  [Dentavision]
 *       └─ Product lines with qty, unit cost, estimated line total
 *   └─ Supplier PO 2 (PO-YYYYMMDD-NNNN-02)  [Adam Dental]
 *       └─ Product lines ...
 *
 * All amounts are labelled "Estimated" — actual invoice pricing is authoritative
 * in the procurement lifecycle.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { PurchasingDraftDetail, PurchasingDraftStatus } from "../types/inventory.js";
import type { Supplier } from "../types/supplier.js";
import { canManageUsers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrencyOrDash(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Price unavailable";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
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

const PD_STATUS_LABELS: Record<PurchasingDraftStatus, string> = {
  draft: "Draft",
  partially_submitted: "Partially submitted",
  ordered: "Ordered",
  partially_received: "Partially received",
  complete: "Complete",
  cancelled: "Cancelled",
};

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const PO_STATUS_BADGE: Record<string, string> = {
  draft: "po-badge po-badge--draft",
  submitted: "po-badge po-badge--submitted",
  partially_received: "po-badge po-badge--partial",
  received: "po-badge po-badge--received",
  cancelled: "po-badge po-badge--cancelled",
};

/** Sum estimated line totals across PO children. Returns null if all prices unavailable. */
function calcSupplierSubtotal(lines: PurchasingDraftDetail["childPos"][number]["lines"]): number | null {
  let total = 0;
  let hasAny = false;
  for (const l of lines) {
    if (l.estimatedLineCostCents !== null && l.estimatedLineCostCents !== undefined) {
      total += l.estimatedLineCostCents;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PurchasingDraftPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const { pdId } = useParams<{ pdId: string }>();

  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";

  const [detail, setDetail] = useState<PurchasingDraftDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cancelConfirmPoId, setCancelConfirmPoId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!pdId || !selectedClinicId || isAllClinicsScope) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [detailResult, suppliersResult] = await Promise.all([
        apiClient.getPurchasingDraftDetail(selectedClinicId, pdId),
        apiClient.listSuppliers({ active: true }),
      ]);
      setDetail(detailResult);
      setSuppliers(suppliersResult);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load purchasing draft");
    } finally {
      setIsLoading(false);
    }
  }, [isAllClinicsScope, pdId, selectedClinicId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!user) return null;
  if (!canManageUsers(user.role)) return <Navigate to="/" replace />;

  if (!pdId) return <Navigate to="/purchase-orders" replace />;

  const supplierMap = new Map(suppliers.map((s) => [s.id, s.supplierName]));

  function resolveSupplierName(supplierId: string | null): string {
    if (!supplierId) return "No supplier assigned";
    return supplierMap.get(supplierId) ?? "Unknown supplier";
  }

  async function handleSubmitPo(poId: string) {
    if (!selectedClinicId) return;
    setSubmittingPoId(poId);
    setSubmitError(null);
    try {
      await apiClient.submitPurchaseOrder(selectedClinicId, poId);
      await loadDetail();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit purchase order");
    } finally {
      setSubmittingPoId(null);
    }
  }

  async function handleCancelPo() {
    if (!selectedClinicId || !cancelConfirmPoId) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await apiClient.cancelPurchaseOrder(selectedClinicId, cancelConfirmPoId);
      setCancelConfirmPoId(null);
      await loadDetail();
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel purchase order");
      setIsCancelling(false);
    }
  }

  // Calculate overall draft estimated total
  let overallTotal: number | null = null;
  if (detail) {
    for (const child of detail.childPos) {
      const sub = calcSupplierSubtotal(child.lines);
      if (sub !== null) {
        overallTotal = (overallTotal ?? 0) + sub;
      }
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>
              {detail
                ? `Purchasing Draft ${detail.purchasingDraft.draftReference}`
                : "Purchasing Draft"}
            </h2>
            <p className="inventory-page__subtitle">
              {selectedClinic?.name ?? user.homeClinicName}
              {detail
                ? ` — ${String(detail.childPos.length)} supplier PO${detail.childPos.length !== 1 ? "s" : ""} · ${String(detail.purchasingDraft.totalItems)} item${detail.purchasingDraft.totalItems !== 1 ? "s" : ""}`
                : ""}
              {detail ? ` · Created ${formatDate(detail.purchasingDraft.createdAt)}` : ""}
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/purchase-orders" className="link-button">
              All purchase orders
            </Link>
            <Link to="/inventory?focus=low-stock" className="link-button">
              Low stock
            </Link>
            <button
              type="button"
              className="link-button"
              onClick={() => void loadDetail()}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Overall estimated total */}
        {detail && (
          <div className="po-summary po-summary--draft-total">
            <dl className="po-summary__stats">
              <div className="po-summary__stat">
                <dt>Status</dt>
                <dd>{PD_STATUS_LABELS[detail.purchasingDraft.derivedStatus]}</dd>
              </div>
              <div className="po-summary__stat">
                <dt>Supplier POs</dt>
                <dd>{detail.childPos.length}</dd>
              </div>
              <div className="po-summary__stat">
                <dt>Total items</dt>
                <dd>{detail.purchasingDraft.totalItems}</dd>
              </div>
              <div className="po-summary__stat">
                <dt>Overall estimated total</dt>
                <dd>
                  <em>{formatCurrencyOrDash(overallTotal)}</em>
                  {overallTotal !== null && (
                    <span className="inventory-table__meta"> (estimated)</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {submitError && (
          <p className="status-card__error" role="alert">{submitError}</p>
        )}

        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading purchasing draft…</p>
        ) : !detail ? null : (
          <div className="pd-child-pos">
            {detail.childPos.map((child) => {
              const supplierName = resolveSupplierName(child.purchaseOrder.supplierId);
              const subtotal = calcSupplierSubtotal(child.lines);
              const po = child.purchaseOrder;

              return (
                <div key={po.id} className="pd-child-po">
                  <div className="pd-child-po__header">
                    <div>
                      <h3>
                        {po.poReference ?? po.id.slice(0, 8)}
                        {" — "}
                        <span className="inventory-table__name">{supplierName}</span>
                      </h3>
                      <p className="inventory-page__subtitle">
                        {String(child.lines.length)} item{child.lines.length !== 1 ? "s" : ""}
                        {subtotal !== null && (
                          <> · <em>Estimated: {formatCurrencyOrDash(subtotal)}</em></>
                        )}
                      </p>
                    </div>
                    <div className="pd-child-po__meta">
                      <span className={PO_STATUS_BADGE[po.status] ?? "po-badge"}>
                        {PO_STATUS_LABELS[po.status] ?? po.status}
                      </span>
                      <div className="po-row-actions">
                        <Link
                          to={`/purchase-orders/${encodeURIComponent(po.id)}`}
                          className="link-button"
                        >
                          View / Edit
                        </Link>
                        {po.status === "draft" && (
                          <>
                            <button
                              type="button"
                              className="button-link po-submit-btn"
                              onClick={() => void handleSubmitPo(po.id)}
                              disabled={submittingPoId === po.id}
                            >
                              {submittingPoId === po.id ? "Submitting…" : "Submit PO"}
                            </button>
                            <button
                              type="button"
                              className="link-button link-button--danger"
                              onClick={() => { setCancelConfirmPoId(po.id); }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {(po.status === "submitted" || po.status === "partially_received") && (
                          <>
                            <Link
                              to={`/inventory/receiving?poId=${encodeURIComponent(po.id)}`}
                              className="button-link"
                            >
                              Receive stock
                            </Link>
                            <button
                              type="button"
                              className="link-button link-button--danger"
                              onClick={() => { setCancelConfirmPoId(po.id); }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Confirm cancel inline dialog */}
                  {cancelConfirmPoId === po.id && (
                    <div className="po-confirm-dialog" role="dialog" aria-modal="true">
                      <p>Cancel supplier PO {po.poReference ?? po.id.slice(0, 8)}? This cannot be undone.</p>
                      {cancelError ? <p className="status-card__error" role="alert">{cancelError}</p> : null}
                      <div className="inventory-page__actions">
                        <button
                          type="button"
                          className="button-link button-link--danger"
                          onClick={() => void handleCancelPo()}
                          disabled={isCancelling}
                        >
                          {isCancelling ? "Cancelling…" : "Yes, cancel"}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => { setCancelConfirmPoId(null); setCancelError(null); }}
                          disabled={isCancelling}
                        >
                          Go back
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Product lines table */}
                  <div className="inventory-table-wrapper">
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th className="inventory-table__numeric">Qty</th>
                          <th>Unit</th>
                          <th className="inventory-table__numeric">Est. unit cost</th>
                          <th className="inventory-table__numeric">Est. line total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {child.lines.map((line) => (
                          <tr key={line.id}>
                            <td>
                              <span className="inventory-table__name">{line.itemName}</span>
                              <span className="inventory-table__meta">{line.masterSku}</span>
                            </td>
                            <td className="inventory-table__numeric">{line.quantity}</td>
                            <td className="inventory-table__meta">
                              {line.receivingUnit ?? line.stockUnit ?? "—"}
                            </td>
                            <td className="inventory-table__numeric">
                              <em>{formatCurrencyOrDash(line.estimatedUnitCostCents)}</em>
                            </td>
                            <td className="inventory-table__numeric">
                              <em>{formatCurrencyOrDash(line.estimatedLineCostCents)}</em>
                            </td>
                            <td>
                              <span className={PO_STATUS_BADGE[po.status] ?? "po-badge"}>
                                {PO_STATUS_LABELS[po.status] ?? po.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {subtotal !== null && (
                        <tfoot>
                          <tr>
                            <td colSpan={4} className="inventory-table__numeric">
                              <strong>Estimated subtotal</strong>
                            </td>
                            <td className="inventory-table__numeric">
                              <strong><em>{formatCurrencyOrDash(subtotal)}</em></strong>
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Overall estimated total footer */}
        {detail && overallTotal !== null && (
          <div className="po-batch-actions">
            <span className="inventory-table__name">
              Overall Purchasing Draft estimated total:{" "}
              <strong><em>{formatCurrencyOrDash(overallTotal)}</em></strong>
              <span className="inventory-table__meta"> — amounts are estimated; actual invoice pricing is authoritative</span>
            </span>
          </div>
        )}
      </section>
    </AppShell>
  );
}
