import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchasingDraft,
  PurchasingDraftStatus,
} from "../types/inventory.js";
import type { Supplier } from "../types/supplier.js";
import { canManageUsers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrencyOrDash(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function generatePoReference(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `PO-${String(year)}${month}${day}-${rand}`;
}

type PoStatus = PurchaseOrder["status"];

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const STATUS_BADGE_CLASS: Record<PoStatus, string> = {
  draft: "po-badge po-badge--draft",
  submitted: "po-badge po-badge--submitted",
  partially_received: "po-badge po-badge--partial",
  received: "po-badge po-badge--received",
  cancelled: "po-badge po-badge--cancelled",
};

const PD_STATUS_LABELS: Record<PurchasingDraftStatus, string> = {
  draft: "Draft",
  partially_submitted: "Partially submitted",
  ordered: "Ordered",
  partially_received: "Partially received",
  complete: "Complete",
  cancelled: "Cancelled",
};

// ─── Document-oriented PO summary type ───────────────────────────────────────

/**
 * One entry per Purchase Order document (not per line).
 * Built by grouping PurchaseOrderLine[] by draftPurchaseOrderId.
 */
type PoSummary = {
  poId: string;
  poReference: string | null;
  status: PoStatus;
  supplierId: string | null;
  supplierName: string | null;
  lineCount: number;
  estimatedSubtotalCents: number | null;
  hasAnyPricedLine: boolean;
  parentPd: PurchasingDraft | null;
  createdAt: string;
  masterCatalogItemIds: string[];
};

const STATUS_ORDER: Record<PoStatus, number> = {
  draft: 0,
  submitted: 1,
  partially_received: 2,
  received: 3,
  cancelled: 4,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PoStatusBadge({ status }: { status: PoStatus }) {
  return (
    <span className={STATUS_BADGE_CLASS[status]}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Create PO Form ───────────────────────────────────────────────────────────

type CreatePoFormProps = {
  suppliers: Supplier[];
  clinicId: string;
  onCreated: (po: PurchaseOrder) => void;
  onCancel: () => void;
};

function CreatePoForm({ suppliers, clinicId, onCreated, onCancel }: CreatePoFormProps) {
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [poReference, setPoReference] = useState(generatePoReference);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setIsSaving(true);
    try {
      const po = await apiClient.createPurchaseOrder(clinicId, {
        supplierId: supplierId || null,
        notes: notes.trim() || null,
        poReference: poReference.trim() || null,
      });
      onCreated(po);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create purchase order");
    } finally {
      setIsSaving(false);
    }
  }

  const activeSuppliers = suppliers.filter((s) => s.active).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName),
  );

  return (
    <div className="po-create-form">
      <h3>New Purchase Order</h3>
      <div className="product-form__grid">
        <label className="product-form__field">
          Supplier
          <select
            value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); }}
          >
            <option value="">Select supplier (optional for draft)</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.supplierName}</option>
            ))}
          </select>
        </label>
        <label className="product-form__field">
          PO Reference
          <input
            value={poReference}
            onChange={(e) => { setPoReference(e.target.value); }}
            placeholder="e.g. PO-20260724-0001"
          />
        </label>
        <label className="product-form__field product-form__full">
          Notes
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); }}
            placeholder="Optional notes about this order"
          />
        </label>
      </div>
      {error ? (
        <p className="status-card__error" role="alert">{error}</p>
      ) : null}
      <div className="inventory-page__actions">
        <button
          type="button"
          className="button-link"
          onClick={() => { void handleCreate(); }}
          disabled={isSaving}
        >
          {isSaving ? "Creating…" : "Create draft PO"}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Confirm Cancel Dialog ────────────────────────────────────────────────────

type ConfirmCancelDialogProps = {
  poId: string;
  poReference: string | null;
  clinicId: string;
  onCancelled: () => void;
  onDismiss: () => void;
};

function ConfirmCancelDialog({ poId, poReference, clinicId, onCancelled, onDismiss }: ConfirmCancelDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setIsCancelling(true);
    try {
      await apiClient.cancelPurchaseOrder(clinicId, poId);
      onCancelled();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel purchase order");
      setIsCancelling(false);
    }
  }

  return (
    <div className="po-confirm-dialog" role="dialog" aria-modal="true" aria-label="Cancel purchase order">
      <h3>Cancel purchase order?</h3>
      <p>
        {poReference
          ? `Purchase order ${poReference} will be cancelled and preserved for historical visibility.`
          : "This purchase order will be cancelled and preserved for historical visibility."}
        {" "}This action cannot be undone.
      </p>
      {error ? (
        <p className="status-card__error" role="alert">{error}</p>
      ) : null}
      <div className="inventory-page__actions">
        <button
          type="button"
          className="button-link button-link--danger"
          onClick={() => { void handleConfirm(); }}
          disabled={isCancelling}
        >
          {isCancelling ? "Cancelling…" : "Yes, cancel this PO"}
        </button>
        <button type="button" className="link-button" onClick={onDismiss} disabled={isCancelling}>
          Go back
        </button>
      </div>
    </div>
  );
}

// ─── PO document card ─────────────────────────────────────────────────────────

type PoCardProps = {
  po: PoSummary;
  submittingPoId: string | null;
  onSubmit: (poId: string) => void;
  onCancelRequest: (poId: string) => void;
};

function PoCard({ po, submittingPoId, onSubmit, onCancelRequest }: PoCardProps) {
  const isSubmitting = submittingPoId === po.poId;

  return (
    <div className="pd-list__item" data-testid={`po-card-${po.poId}`}>
      <div className="pd-list__item-info">
        <Link to={`/purchase-orders/${encodeURIComponent(po.poId)}`} className="inventory-table__name">
          {po.poReference ?? po.poId.slice(0, 8)}
        </Link>
        <span className="inventory-table__meta">
          {po.supplierName ?? "No supplier"}
          {po.parentPd && (
            <>{" · "}
              <Link to={`/purchasing-drafts/${encodeURIComponent(po.parentPd.id)}`} className="low-stock-queue__doc-link">
                {po.parentPd.draftReference}
              </Link>
            </>
          )}
        </span>
        <span className="inventory-table__meta">
          {String(po.lineCount)} product line{po.lineCount !== 1 ? "s" : ""}
          {" · "}
          {po.hasAnyPricedLine
            ? <><em>Estimated: {formatCurrencyOrDash(po.estimatedSubtotalCents)}</em></>
            : "No pricing available"}
          {" · "}
          {formatDate(po.createdAt)}
        </span>
      </div>

      <div className="pd-list__item-actions">
        <PoStatusBadge status={po.status} />

        {po.status === "draft" && (
          <>
            <Link
              to={`/purchase-orders/${encodeURIComponent(po.poId)}`}
              className="link-button"
              aria-label={`Edit lines for ${po.poReference ?? po.poId}`}
            >
              Edit / Lines
            </Link>
            <button
              type="button"
              className="button-link po-submit-btn"
              onClick={() => { onSubmit(po.poId); }}
              disabled={isSubmitting}
              aria-label={`Submit ${po.poReference ?? po.poId}`}
            >
              {isSubmitting ? "Submitting…" : "Submit PO"}
            </button>
            <button
              type="button"
              className="link-button link-button--danger"
              onClick={() => { onCancelRequest(po.poId); }}
              aria-label={`Cancel ${po.poReference ?? po.poId}`}
            >
              Cancel
            </button>
          </>
        )}

        {(po.status === "submitted" || po.status === "partially_received") && (
          <>
            <Link
              to={`/purchase-orders/${encodeURIComponent(po.poId)}`}
              className="link-button"
              aria-label={`View lines for ${po.poReference ?? po.poId}`}
            >
              View lines
            </Link>
            <Link
              to={`/inventory?mode=receive&poId=${encodeURIComponent(po.poId)}`}
              className="button-link"
              aria-label={`Receive stock for ${po.poReference ?? po.poId}`}
            >
              Receive stock
            </Link>
            <button
              type="button"
              className="link-button link-button--danger"
              onClick={() => { onCancelRequest(po.poId); }}
              aria-label={`Cancel ${po.poReference ?? po.poId}`}
            >
              Cancel
            </button>
          </>
        )}

        {(po.status === "received" || po.status === "cancelled") && (
          <Link
            to={`/purchase-orders/${encodeURIComponent(po.poId)}`}
            className="link-button"
            aria-label={`View ${po.poReference ?? po.poId}`}
          >
            View
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedClinicId = selectedClinic?.id;
  const focusedItemId = searchParams.get("item");
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";

  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [purchasingDrafts, setPurchasingDrafts] = useState<PurchasingDraft[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recentlySubmittedPoId, setRecentlySubmittedPoId] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [cancelConfirmPoId, setCancelConfirmPoId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !canManageUsers(user.role)) return;
    if (!selectedClinicId || isAllClinicsScope) {
      setLines([]);
      setSuppliers([]);
      setIsLoading(false);
      setLoadError(null);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const [linesResult, suppliersResult, draftsResult] = await Promise.all([
        apiClient.listPurchaseOrders(selectedClinicId),
        apiClient.listSuppliers({ active: true }),
        apiClient.listPurchasingDrafts(selectedClinicId),
      ]);
      setLines(linesResult);
      setSuppliers(suppliersResult);
      setPurchasingDrafts(draftsResult);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load purchase orders");
    } finally {
      setIsLoading(false);
    }
  }, [isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ─── Build PD → PO lookup for document-oriented rendering ─────────────────

  const pdByPoId = useMemo(() => {
    const map = new Map<string, PurchasingDraft>();
    for (const pd of purchasingDrafts) {
      for (const po of pd.childPos) {
        map.set(po.id, pd);
      }
    }
    return map;
  }, [purchasingDrafts]);

  // ─── Group lines into one PoSummary per PO document ───────────────────────

  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.supplierName])),
    [suppliers],
  );

  const allPoSummaries = useMemo((): PoSummary[] => {
    const groups = new Map<string, PurchaseOrderLine[]>();
    for (const line of lines) {
      const existing = groups.get(line.draftPurchaseOrderId);
      if (existing) {
        existing.push(line);
      } else {
        groups.set(line.draftPurchaseOrderId, [line]);
      }
    }

    const summaries: PoSummary[] = [];

    for (const [poId, poLines] of groups.entries()) {
      const firstLine = poLines[0];
      if (!firstLine) continue;

      const supplierId = firstLine.poSupplierId ?? null;
      const supplierName = supplierId
        ? (supplierMap.get(supplierId) ?? firstLine.supplierPricing?.[0]?.supplierName ?? "Unknown supplier")
        : null;

      let runningSubtotal = 0;
      let hasAnyPricedLine: boolean = false;
      for (const l of poLines) {
        if (l.estimatedLineCostCents !== null && l.estimatedLineCostCents !== undefined) {
          hasAnyPricedLine = true;
          runningSubtotal += l.estimatedLineCostCents;
        }
      }
      const estimatedSubtotalCents: number | null = hasAnyPricedLine ? runningSubtotal : null;

      summaries.push({
        poId,
        poReference: firstLine.poReference ?? null,
        status: firstLine.orderStatus,
        supplierId,
        supplierName,
        lineCount: poLines.length,
        estimatedSubtotalCents,
        hasAnyPricedLine,
        parentPd: pdByPoId.get(poId) ?? null,
        createdAt: firstLine.createdAt,
        masterCatalogItemIds: poLines.map((l) => l.masterCatalogItemId),
      });
    }

    return summaries.sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [lines, pdByPoId, supplierMap]);

  const visiblePoSummaries = useMemo(() => {
    if (!focusedItemId) return allPoSummaries;
    return allPoSummaries.filter((po) => po.masterCatalogItemIds.includes(focusedItemId));
  }, [allPoSummaries, focusedItemId]);

  const focusedFirstLine = focusedItemId
    ? lines.find((l) => l.masterCatalogItemId === focusedItemId)
    : undefined;

  const submittedReceiveHref = recentlySubmittedPoId
    ? `/inventory?mode=receive&poId=${encodeURIComponent(recentlySubmittedPoId)}`
    : null;

  const cancellingPoRef = cancelConfirmPoId
    ? (allPoSummaries.find((p) => p.poId === cancelConfirmPoId)?.poReference ?? null)
    : null;

  async function handleSubmit(poId: string) {
    if (!user || !selectedClinicId) return;
    setSubmittingPoId(poId);
    setSubmitError(null);
    try {
      await apiClient.submitPurchaseOrder(selectedClinicId, poId);
      setRecentlySubmittedPoId(poId);
      await loadData();
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

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to manage purchase orders</h2>
          <p>
            Purchase orders are operational clinic records. Choose a real clinic
            from Clinic scope before reviewing, submitting, or receiving stock.
          </p>
        </section>
      </AppShell>
    );
  }

  const draftPoSummaries = visiblePoSummaries.filter((p) => p.status === "draft");
  const activePOs = visiblePoSummaries.filter(
    (p) => p.status === "submitted" || p.status === "partially_received",
  );
  const historicalPOs = visiblePoSummaries.filter(
    (p) => p.status === "received" || p.status === "cancelled",
  );

  return (
    <AppShell>
      {/* Cancel confirmation dialog */}
      {cancelConfirmPoId && selectedClinicId ? (
        <div className="po-dialog-overlay" role="presentation">
          <ConfirmCancelDialog
            poId={cancelConfirmPoId}
            poReference={cancellingPoRef}
            clinicId={selectedClinicId}
            onCancelled={() => {
              setCancelConfirmPoId(null);
              void loadData();
            }}
            onDismiss={() => { setCancelConfirmPoId(null); }}
          />
        </div>
      ) : null}

      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Purchase orders</h2>
            <p className="inventory-page__subtitle">
              {(selectedClinic?.name ?? user.homeClinicName)} — create and submit purchase orders,
              then receive deliveries through the receiving workflow.
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/inventory?focus=low-stock" className="link-button">
              Low stock
            </Link>
            <Link to="/suppliers" className="link-button">
              Suppliers
            </Link>
            <button
              type="button"
              className="button-link"
              onClick={() => { setShowCreateForm(!showCreateForm); }}
              disabled={isLoading}
            >
              {showCreateForm ? "Cancel new PO" : "Create PO"}
            </button>
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
              onClick={() => void loadData()}
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

        {/* Create PO inline form */}
        {showCreateForm && selectedClinicId ? (
          <CreatePoForm
            suppliers={suppliers}
            clinicId={selectedClinicId}
            onCreated={(po) => {
              setShowCreateForm(false);
              void navigate(`/purchase-orders/${po.id}`);
            }}
            onCancel={() => { setShowCreateForm(false); }}
          />
        ) : null}

        {submittedReceiveHref ? (
          <div className="inventory-notice inventory-notice--receive" role="status">
            Purchase order submitted.{" "}
            <Link to={submittedReceiveHref} className="inventory-notice__link">
              Receive stock now
            </Link>
            .
          </div>
        ) : null}

        {focusedItemId ? (
          <div className="po-workflow-callout">
            <div>
              <strong>
                {focusedFirstLine ? `Reviewing ${focusedFirstLine.itemName}` : "Reviewing selected inventory item"}
              </strong>
              <p className="inventory-page__subtitle">
                This view was opened from a low-stock product. Clear the filter to review every purchase order.
              </p>
            </div>
            <Link to="/purchase-orders" className="link-button">
              Clear filter
            </Link>
          </div>
        ) : null}

        {/* ── Purchasing Drafts ── */}
        {!loadError && !isLoading && purchasingDrafts.length > 0 && !focusedItemId && (
          <div className="pd-list">
            <h3>Purchasing drafts</h3>
            <p className="inventory-page__subtitle">
              A Purchasing Draft represents one purchasing exercise. Each draft contains one supplier PO per supplier.
            </p>
            {purchasingDrafts.map((pd) => (
              <div key={pd.id} className="pd-list__item">
                <div className="pd-list__item-info">
                  <Link to={`/purchasing-drafts/${encodeURIComponent(pd.id)}`} className="inventory-table__name">
                    {pd.draftReference}
                  </Link>
                  <span className="inventory-table__meta">
                    {String(pd.totalItems)} item{pd.totalItems !== 1 ? "s" : ""}
                    {" · "}
                    {String(pd.supplierCount)} supplier{pd.supplierCount !== 1 ? "s" : ""}
                    {" · "}
                    {formatDate(pd.createdAt)}
                  </span>
                  <span className="inventory-table__meta">
                    Child POs: {pd.childPos.map((po) => po.poReference ?? po.id.slice(0, 8)).join(", ")}
                  </span>
                </div>
                <div className="pd-list__item-actions">
                  <span className="po-badge po-badge--draft">
                    {PD_STATUS_LABELS[pd.derivedStatus]}
                  </span>
                  <Link
                    to={`/purchasing-drafts/${encodeURIComponent(pd.id)}`}
                    className="button-link"
                  >
                    {pd.derivedStatus === "draft" || pd.derivedStatus === "partially_submitted"
                      ? "Continue order"
                      : "View"}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Loading / error / empty states ── */}
        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading purchase orders…</p>
        ) : allPoSummaries.length === 0 && !showCreateForm ? (
          <div className="po-empty">
            <p className="po-empty__title">No purchase orders yet.</p>
            <p className="po-empty__hint">
              Create a purchase order manually using the Create PO button, or
              start from Low Stock to generate supplier-specific orders automatically.
            </p>
            <div className="po-empty__actions">
              <button
                type="button"
                className="button-link"
                onClick={() => { setShowCreateForm(true); }}
              >
                Create PO manually
              </button>
              <Link to="/inventory?focus=low-stock" className="link-button">
                Review low stock
              </Link>
            </div>
          </div>
        ) : visiblePoSummaries.length === 0 && focusedItemId ? (
          <div className="po-empty">
            <p className="po-empty__title">No purchase order found for this product.</p>
            <div className="po-empty__actions">
              <Link to="/inventory?focus=low-stock" className="button-link">
                Review low stock
              </Link>
              <Link to="/purchase-orders" className="link-button">
                Show all purchase orders
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ── Workflow guide ── */}
            <div className="po-workflow-callout">
              <ol className="po-workflow-steps" aria-label="Purchase workflow">
                <li>Create PO</li>
                <li>Add lines</li>
                <li>Submit PO</li>
                <li>Receive stock</li>
              </ol>
            </div>

            {/* ── Supplier Purchase Orders (document-oriented) ── */}
            <div className="pd-list">
              <h3>Supplier purchase orders</h3>
              <p className="inventory-page__subtitle">
                Each row is one Purchase Order document. Product lines are inside the order detail.
              </p>

              {draftPoSummaries.length > 0 && (
                <>
                  <h4 className="inventory-table__section-heading">Draft</h4>
                  {draftPoSummaries.map((po) => (
                    <PoCard
                      key={po.poId}
                      po={po}
                      submittingPoId={submittingPoId}
                      onSubmit={(poId) => { void handleSubmit(poId); }}
                      onCancelRequest={(poId) => { setCancelConfirmPoId(poId); }}
                    />
                  ))}
                </>
              )}

              {activePOs.length > 0 && (
                <>
                  <h4 className="inventory-table__section-heading">Active</h4>
                  {activePOs.map((po) => (
                    <PoCard
                      key={po.poId}
                      po={po}
                      submittingPoId={submittingPoId}
                      onSubmit={(poId) => { void handleSubmit(poId); }}
                      onCancelRequest={(poId) => { setCancelConfirmPoId(poId); }}
                    />
                  ))}
                </>
              )}

              {historicalPOs.length > 0 && (
                <>
                  <h4 className="inventory-table__section-heading">Historical</h4>
                  {historicalPOs.map((po) => (
                    <PoCard
                      key={po.poId}
                      po={po}
                      submittingPoId={submittingPoId}
                      onSubmit={(poId) => { void handleSubmit(poId); }}
                      onCancelRequest={(poId) => { setCancelConfirmPoId(poId); }}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Summary stats ── */}
      <section className="status-card po-summary">
        <dl className="po-summary__stats">
          <div className="po-summary__stat">
            <dt>Total POs</dt>
            <dd>{allPoSummaries.length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Draft</dt>
            <dd>{allPoSummaries.filter((p) => p.status === "draft").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Submitted</dt>
            <dd>{allPoSummaries.filter((p) => p.status === "submitted").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Received</dt>
            <dd>{allPoSummaries.filter((p) => p.status === "received" || p.status === "partially_received").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Total product lines</dt>
            <dd>{lines.filter((l) => l.orderStatus !== "cancelled" && l.orderStatus !== "received").length}</dd>
          </div>
          <div className="po-summary__stat">
            <dt>Unique SKUs</dt>
            <dd>{new Set(lines.filter((l) => l.orderStatus !== "cancelled").map((l) => l.masterSku)).size}</dd>
          </div>
        </dl>

        {/* Supplier subtotals for active (non-cancelled, non-received) POs */}
        {(() => {
          const activePos = allPoSummaries.filter(
            (p) => p.status !== "cancelled" && p.status !== "received",
          );
          const priced = activePos.filter((p) => p.hasAnyPricedLine);
          if (priced.length === 0) return null;

          const overallTotal = priced.reduce<number | null>((acc, p) => {
            if (p.estimatedSubtotalCents === null) return acc;
            return (acc ?? 0) + p.estimatedSubtotalCents;
          }, null);

          return (
            <div className="po-supplier-subtotals">
              <h4>Estimated order totals by supplier PO</h4>
              <p className="inventory-page__subtitle">Amounts are estimates based on supplier catalogue pricing. Actual invoice pricing is authoritative.</p>
              <ul className="po-supplier-subtotals__list">
                {priced.map((p) => (
                  <li key={p.poId}>
                    <span className="inventory-table__name">
                      {p.poReference ?? p.poId.slice(0, 8)} — {p.supplierName ?? "No supplier"}
                    </span>
                    <span className="inventory-table__meta">
                      {String(p.lineCount)} item{p.lineCount !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {p.estimatedSubtotalCents !== null
                        ? <><em>Estimated: {formatCurrencyOrDash(p.estimatedSubtotalCents)}</em></>
                        : "Price unavailable"}
                    </span>
                  </li>
                ))}
                {overallTotal !== null && (
                  <li className="po-supplier-subtotals__total">
                    <strong>Overall estimated total</strong>
                    <strong><em>{formatCurrencyOrDash(overallTotal)}</em></strong>
                  </li>
                )}
              </ul>
            </div>
          );
        })()}
      </section>
    </AppShell>
  );
}
