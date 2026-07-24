/**
 * PurchaseOrderDetailPage
 *
 * Shows a single PO with its header and lines.
 * - Draft POs: allow editing header fields, adding/editing/removing lines.
 * - Submitted / partially_received: read-only header, show outstanding qtys, link to receive.
 * - Received / cancelled: read-only display only.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type {
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderLine,
} from "../types/inventory.js";
import type { InventoryItem } from "../types/inventory.js";
import type { Supplier } from "../types/supplier.js";
import { canManageInventory } from "../utils/roles.js";
import { RECEIVING_UNIT_OPTIONS } from "../constants/inventoryUnits.js";

const apiClient = createApiClient(loadConfig());

// ─── Status helpers ───────────────────────────────────────────────────────────

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Add line form ────────────────────────────────────────────────────────────

type AddLineFormProps = {
  inventoryItems: InventoryItem[];
  onAdd: (values: {
    clinicInventoryItemId: string;
    masterCatalogItemId: string;
    itemName: string;
    quantity: number;
    unitCostCents: number | null;
    receivingUnit: string | null;
  }) => Promise<void>;
  onCancel: () => void;
};

function AddLineForm({ inventoryItems, onAdd, onCancel }: AddLineFormProps) {
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCostCentsStr, setUnitCostCentsStr] = useState("");
  const [receivingUnit, setReceivingUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = inventoryItems
    .filter((item) => {
      const q = search.toLowerCase();
      return !q || item.name.toLowerCase().includes(q) || item.masterSku.toLowerCase().includes(q);
    })
    .slice(0, 10);

  const selectedItem = inventoryItems.find((i) => i.id === selectedItemId) ?? null;

  async function handleAdd() {
    if (!selectedItem) { setError("Select an item."); return; }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) { setError("Quantity must be a positive whole number."); return; }
    setError(null);
    setIsSaving(true);
    try {
      const costCents = unitCostCentsStr.trim() ? Math.round(parseFloat(unitCostCentsStr) * 100) : null;
      await onAdd({
        clinicInventoryItemId: selectedItem.id,
        masterCatalogItemId: selectedItem.masterCatalogItemId,
        itemName: selectedItem.name,
        quantity: qty,
        unitCostCents: costCents && !isNaN(costCents) ? costCents : null,
        receivingUnit: receivingUnit.trim() || null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add line.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="po-add-line-form">
      <h4>Add product line</h4>
      <div className="product-form__grid">
        <label className="product-form__field product-form__full">
          Product search
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedItemId(""); }}
            placeholder="Search by name or SKU…"
            autoFocus
          />
        </label>
        {search && !selectedItemId ? (
          <ul className="po-add-line-form__results" role="listbox">
            {filtered.length === 0 ? (
              <li className="po-add-line-form__no-results">No products found</li>
            ) : filtered.map((item) => (
              <li
                key={item.id}
                role="option"
                aria-selected={false}
                className="po-add-line-form__result-item"
                onClick={() => {
                  setSelectedItemId(item.id);
                  setSearch(item.name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSelectedItemId(item.id);
                    setSearch(item.name);
                  }
                }}
                tabIndex={0}
              >
                <span className="inventory-table__name">{item.name}</span>
                <span className="inventory-table__meta"> — {item.masterSku}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="product-form__field">
          Quantity ordered
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => { setQuantity(e.target.value); }}
          />
        </label>
        <label className="product-form__field">
          Receiving unit (optional)
          <select
            value={receivingUnit}
            onChange={(e) => { setReceivingUnit(e.target.value); }}
          >
            <option value="">— not specified —</option>
            {RECEIVING_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="product-form__field">
          Unit cost (AUD, optional)
          <input
            type="number"
            min={0}
            step={0.01}
            value={unitCostCentsStr}
            onChange={(e) => { setUnitCostCentsStr(e.target.value); }}
            placeholder="e.g. 12.50"
          />
        </label>
      </div>
      {error ? <p className="status-card__error" role="alert">{error}</p> : null}
      <div className="inventory-page__actions">
        <button type="button" className="button-link" onClick={() => { void handleAdd(); }} disabled={isSaving}>
          {isSaving ? "Adding…" : "Add line"}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Edit line form ────────────────────────────────────────────────────────────

type EditLineFormProps = {
  line: PurchaseOrderLine;
  onSave: (values: { quantity: number; unitCostCents: number | null; receivingUnit: string | null }) => Promise<void>;
  onCancel: () => void;
};

function EditLineForm({ line, onSave, onCancel }: EditLineFormProps) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitCostStr, setUnitCostStr] = useState(
    line.unitCostCents != null ? String(line.unitCostCents / 100) : "",
  );
  const [receivingUnit, setReceivingUnit] = useState(line.receivingUnit ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) { setError("Quantity must be a positive whole number."); return; }
    setError(null);
    setIsSaving(true);
    try {
      const costCents = unitCostStr.trim() ? Math.round(parseFloat(unitCostStr) * 100) : null;
      await onSave({
        quantity: qty,
        unitCostCents: costCents && !isNaN(costCents) ? costCents : null,
        receivingUnit: receivingUnit.trim() || null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update line.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="po-edit-line-form">
      <div className="product-form__grid">
        <label className="product-form__field">
          Quantity
          <input type="number" min={1} step={1} value={quantity} onChange={(e) => { setQuantity(e.target.value); }} />
        </label>
        <label className="product-form__field">
          Receiving unit
          <select value={receivingUnit} onChange={(e) => { setReceivingUnit(e.target.value); }}>
            <option value="">— not specified —</option>
            {RECEIVING_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="product-form__field">
          Unit cost (AUD)
          <input type="number" min={0} step={0.01} value={unitCostStr} onChange={(e) => { setUnitCostStr(e.target.value); }} placeholder="e.g. 12.50" />
        </label>
      </div>
      {error ? <p className="status-card__error" role="alert">{error}</p> : null}
      <div className="inventory-page__actions">
        <button type="button" className="button-link" onClick={() => { void handleSave(); }} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PurchaseOrderDetailPage() {
  const { user } = useAuth();
  const { selectedClinic } = useSelectedClinic();
  const { poId } = useParams<{ poId: string }>();

  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingHeader, setEditingHeader] = useState(false);
  const [headerSupplierId, setHeaderSupplierId] = useState("");
  const [headerNotes, setHeaderNotes] = useState("");
  const [headerReference, setHeaderReference] = useState("");
  const [headerSaveError, setHeaderSaveError] = useState<string | null>(null);
  const [isSavingHeader, setIsSavingHeader] = useState(false);

  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const selectedClinicId = selectedClinic?.id;
  const canWrite = user ? canManageInventory(user.role) : false;

  const loadDetail = useCallback(async () => {
    if (!selectedClinicId || !poId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [poDetail, supplierList, inventory] = await Promise.all([
        apiClient.getPurchaseOrderDetail(selectedClinicId, poId),
        apiClient.listSuppliers({ active: true }),
        apiClient.listInventory(selectedClinicId),
      ]);
      setDetail(poDetail);
      setSuppliers(supplierList);
      setInventoryItems(inventory);
      setHeaderSupplierId(poDetail.purchaseOrder.supplierId ?? "");
      setHeaderNotes(poDetail.purchaseOrder.notes ?? "");
      setHeaderReference(poDetail.purchaseOrder.poReference ?? "");
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load purchase order.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedClinicId, poId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!user) return null;

  if (!selectedClinicId) {
    return (
      <AppShell>
        <section className="status-card" role="status">
          <h2>Select a clinic</h2>
          <p>Choose a clinic from the scope selector to view this purchase order.</p>
        </section>
      </AppShell>
    );
  }

  if (!poId) return <Navigate to="/purchase-orders" replace />;

  const po = detail?.purchaseOrder ?? null;
  const lines = detail?.lines ?? [];
  const isDraft = po?.status === "draft";
  const activeSuppliers = suppliers.filter((s) => s.active).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  const supplierName = activeSuppliers.find((s) => s.id === po?.supplierId)?.supplierName;

  async function handleSaveHeader() {
    if (!selectedClinicId || !poId) return;
    setIsSavingHeader(true);
    setHeaderSaveError(null);
    try {
      const updated = await apiClient.updatePurchaseOrder(selectedClinicId, poId, {
        supplierId: headerSupplierId || null,
        notes: headerNotes.trim() || null,
        poReference: headerReference.trim() || null,
      });
      setDetail((prev) => prev ? { ...prev, purchaseOrder: updated } : null);
      setEditingHeader(false);
    } catch (err: unknown) {
      setHeaderSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setIsSavingHeader(false);
    }
  }

  async function handleAddLine(values: {
    clinicInventoryItemId: string;
    masterCatalogItemId: string;
    itemName: string;
    quantity: number;
    unitCostCents: number | null;
    receivingUnit: string | null;
  }) {
    if (!selectedClinicId || !poId) return;
    setLineError(null);
    await apiClient.addPoLine(selectedClinicId, poId, {
      masterCatalogItemId: values.masterCatalogItemId,
      clinicInventoryItemId: values.clinicInventoryItemId,
      quantity: values.quantity,
      unitCostCents: values.unitCostCents,
      receivingUnit: values.receivingUnit,
    });
    setShowAddLine(false);
    await loadDetail();
  }

  async function handleUpdateLine(lineId: string, values: {
    quantity: number;
    unitCostCents: number | null;
    receivingUnit: string | null;
  }) {
    if (!selectedClinicId || !poId) return;
    setLineError(null);
    await apiClient.updatePoLine(selectedClinicId, poId, lineId, values);
    setEditingLineId(null);
    await loadDetail();
  }

  async function handleRemoveLine(lineId: string) {
    if (!selectedClinicId || !poId) return;
    setRemovingLineId(lineId);
    setLineError(null);
    try {
      await apiClient.removePoLine(selectedClinicId, poId, lineId);
      await loadDetail();
    } catch (err: unknown) {
      setLineError(err instanceof Error ? err.message : "Failed to remove line.");
    } finally {
      setRemovingLineId(null);
    }
  }

  async function handleSubmit() {
    if (!selectedClinicId || !poId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await apiClient.submitPurchaseOrder(selectedClinicId, poId);
      setDetail(updated);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit purchase order.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!selectedClinicId || !poId) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await apiClient.cancelPurchaseOrder(selectedClinicId, poId);
      await loadDetail();
      setShowCancelConfirm(false);
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel purchase order.");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card receiving-page">
        <div className="status-card__header">
          <div>
            <h2>
              Purchase Order{po?.poReference ? ` — ${po.poReference}` : ""}
              {po ? (
                <span className={`${STATUS_BADGE_CLASS[po.status]} po-badge--inline`}>
                  {STATUS_LABELS[po.status]}
                </span>
              ) : null}
            </h2>
            {po ? (
              <p className="inventory-page__subtitle">
                Created {formatDate(po.createdAt)}
                {supplierName ? ` · ${supplierName}` : ""}
              </p>
            ) : null}
          </div>
          <div className="po-header-actions">
            <Link to="/purchase-orders" className="link-button">← Back to POs</Link>
          </div>
        </div>

        {isLoading ? <p className="loading-message">Loading purchase order…</p> : null}
        {loadError ? <p className="status-card__error" role="alert">{loadError}</p> : null}

        {po && !isLoading ? (
          <>
            {/* ─── Header section ─────────────────────────────────────────── */}
            <div className="po-detail-header">
              {editingHeader && isDraft ? (
                <div className="po-edit-header-form">
                  <div className="product-form__grid">
                    <label className="product-form__field">
                      Supplier
                      <select value={headerSupplierId} onChange={(e) => { setHeaderSupplierId(e.target.value); }}>
                        <option value="">— select supplier —</option>
                        {activeSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.supplierName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="product-form__field">
                      PO Reference
                      <input value={headerReference} onChange={(e) => { setHeaderReference(e.target.value); }} />
                    </label>
                    <label className="product-form__field product-form__full">
                      Notes
                      <textarea rows={2} value={headerNotes} onChange={(e) => { setHeaderNotes(e.target.value); }} />
                    </label>
                  </div>
                  {headerSaveError ? <p className="status-card__error" role="alert">{headerSaveError}</p> : null}
                  <div className="inventory-page__actions">
                    <button type="button" className="button-link" onClick={() => { void handleSaveHeader(); }} disabled={isSavingHeader}>
                      {isSavingHeader ? "Saving…" : "Save header"}
                    </button>
                    <button type="button" className="link-button" onClick={() => { setEditingHeader(false); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <dl className="po-header-details">
                  <div>
                    <dt>Supplier</dt>
                    <dd>{supplierName ?? <span className="inventory-table__meta">Not set</span>}</dd>
                  </div>
                  <div>
                    <dt>PO Reference</dt>
                    <dd>{po.poReference ?? <span className="inventory-table__meta">—</span>}</dd>
                  </div>
                  {po.notes ? (
                    <div className="po-header-details__full">
                      <dt>Notes</dt>
                      <dd>{po.notes}</dd>
                    </div>
                  ) : null}
                  {isDraft && canWrite ? (
                    <div>
                      <button type="button" className="link-button" onClick={() => { setEditingHeader(true); }}>
                        Edit header
                      </button>
                    </div>
                  ) : null}
                </dl>
              )}
            </div>

            {/* ─── Lines section ───────────────────────────────────────────── */}
            <div className="po-detail-lines">
              <div className="status-card__header">
                <h3>Order lines</h3>
                {isDraft && canWrite && !showAddLine ? (
                  <button type="button" className="button-link" onClick={() => { setShowAddLine(true); }}>
                    + Add product
                  </button>
                ) : null}
              </div>

              {showAddLine && isDraft ? (
                <AddLineForm
                  inventoryItems={inventoryItems}
                  onAdd={handleAddLine}
                  onCancel={() => { setShowAddLine(false); }}
                />
              ) : null}

              {lineError ? <p className="status-card__error" role="alert">{lineError}</p> : null}

              {lines.length === 0 && !showAddLine ? (
                <div className="billing-empty" role="status">
                  <p className="billing-empty__title">No lines added yet.</p>
                  {isDraft && canWrite ? (
                    <p className="billing-empty__hint">
                      Use <strong>+ Add product</strong> to add ordered items to this draft.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {lines.length > 0 ? (
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="inventory-table__numeric">Ordered</th>
                      {!isDraft ? (
                        <>
                          <th className="inventory-table__numeric">Received</th>
                          <th className="inventory-table__numeric">Outstanding</th>
                        </>
                      ) : null}
                      <th>Receiving unit</th>
                      <th className="inventory-table__numeric">Unit cost</th>
                      {isDraft && canWrite ? <th>Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <>
                        <tr key={line.id}>
                          <td>
                            <span className="inventory-table__name">{line.itemName}</span>
                            <span className="inventory-table__meta">{line.masterSku}</span>
                          </td>
                          <td className="inventory-table__numeric">{line.quantity}</td>
                          {!isDraft ? (
                            <>
                              <td className="inventory-table__numeric">{line.receivedQuantity}</td>
                              <td className="inventory-table__numeric">{line.outstandingQuantity}</td>
                            </>
                          ) : null}
                          <td className="inventory-table__meta">{line.receivingUnit ?? "—"}</td>
                          <td className="inventory-table__numeric">
                            {line.unitCostCents != null
                              ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(line.unitCostCents / 100)
                              : "—"}
                          </td>
                          {isDraft && canWrite ? (
                            <td>
                              <div className="po-row-actions">
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={() => { setEditingLineId(editingLineId === line.id ? null : line.id); }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="link-button link-button--danger"
                                  onClick={() => { void handleRemoveLine(line.id); }}
                                  disabled={removingLineId === line.id}
                                >
                                  {removingLineId === line.id ? "Removing…" : "Remove"}
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                        {editingLineId === line.id ? (
                          <tr key={`${line.id}-edit`}>
                            <td colSpan={isDraft ? 5 : 6}>
                              <EditLineForm
                                line={line}
                                onSave={(values) => handleUpdateLine(line.id, values)}
                                onCancel={() => { setEditingLineId(null); }}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>

            {/* ─── Actions ─────────────────────────────────────────────────── */}
            <div className="po-detail-actions">
              {isDraft && canWrite ? (
                <>
                  {submitError ? <p className="status-card__error" role="alert">{submitError}</p> : null}
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => { void handleSubmit(); }}
                    disabled={isSubmitting || lines.length === 0 || !po.supplierId}
                    title={
                      !po.supplierId ? "Set a supplier before submitting" :
                      lines.length === 0 ? "Add at least one line before submitting" : undefined
                    }
                  >
                    {isSubmitting ? "Submitting…" : "Submit PO"}
                  </button>
                  <button
                    type="button"
                    className="link-button link-button--danger"
                    onClick={() => { setShowCancelConfirm(true); }}
                  >
                    Cancel PO
                  </button>
                </>
              ) : null}

              {(po.status === "submitted" || po.status === "partially_received") && canWrite ? (
                <>
                  <Link
                    to={`/inventory?mode=receive&poId=${encodeURIComponent(po.id)}`}
                    className="button-link"
                  >
                    Receive stock
                  </Link>
                  <button
                    type="button"
                    className="link-button link-button--danger"
                    onClick={() => { setShowCancelConfirm(true); }}
                  >
                    Cancel PO
                  </button>
                </>
              ) : null}

              {po.status === "received" ? (
                <p className="inventory-table__meta">This purchase order has been fully received.</p>
              ) : null}

              {po.status === "cancelled" ? (
                <p className="inventory-table__meta">This purchase order was cancelled.</p>
              ) : null}

              {cancelError ? <p className="status-card__error" role="alert">{cancelError}</p> : null}
            </div>
          </>
        ) : null}

        {/* ─── Cancel confirmation dialog ──────────────────────────────────── */}
        {showCancelConfirm ? (
          <div className="po-cancel-confirm" role="dialog" aria-label="Confirm cancellation">
            <div className="po-cancel-confirm__body">
              <h3>Cancel this purchase order?</h3>
              <p>
                Cancelling will permanently mark this PO as cancelled.
                The order and its lines will be preserved for historical reference.
              </p>
              <div className="inventory-page__actions">
                <button
                  type="button"
                  className="button-danger"
                  onClick={() => { void handleCancel(); }}
                  disabled={isCancelling}
                >
                  {isCancelling ? "Cancelling…" : "Yes, cancel PO"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => { setShowCancelConfirm(false); }}
                >
                  Keep PO
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

export default PurchaseOrderDetailPage;
