/**
 * LowStockPurchasingQueue
 *
 * Allows staff to select low-stock items, group them by preferred supplier,
 * and create one or more draft POs (or add to an existing draft PO) — all
 * using the same purchaseOrderService paths as manual PO creation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type { InventoryItem, PurchaseOrder } from "../../types/inventory.js";
import type { Supplier } from "../../types/supplier.js";

const apiClient = createApiClient(loadConfig());

// ── Helpers ──────────────────────────────────────────────────────────────────

function generatePoReference(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `PO-${String(y)}${m}${day}-${rand}`;
}

/** Items below reorder point that have a clinic inventory item ID */
function isEligible(item: InventoryItem): boolean {
  return item.isBelowReorderPoint && Boolean(item.id);
}

function getIneligibleReason(item: InventoryItem): string | null {
  if (!item.isBelowReorderPoint) return "Not below reorder point";
  if (!item.id) return "No clinic inventory record";
  return null;
}

function suggestedQty(item: InventoryItem): number {
  return Math.max(1, item.reorderPoint - item.quantityOnHand);
}

type SupplierGroup = {
  supplierId: string | null;
  supplierName: string;
  items: InventoryItem[];
};

function groupBySupplier(items: InventoryItem[], suppliers: Supplier[]): SupplierGroup[] {
  const supplierMap = new Map(suppliers.map((s) => [s.id, s.supplierName]));
  const groups = new Map<string | null, InventoryItem[]>();

  for (const item of items) {
    const key = item.preferredSupplierId ?? null;
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return Array.from(groups.entries())
    .map(([supplierId, groupItems]) => ({
      supplierId,
      supplierName: supplierId
        ? (supplierMap.get(supplierId) ?? item_preferredSupplierName(groupItems, supplierId) ?? "Unknown supplier")
        : "No supplier assigned",
      items: groupItems,
    }))
    .sort((a, b) => {
      if (a.supplierId === null) return 1;
      if (b.supplierId === null) return -1;
      return a.supplierName.localeCompare(b.supplierName);
    });
}

function item_preferredSupplierName(items: InventoryItem[], supplierId: string): string | null {
  return items.find((i) => i.preferredSupplierId === supplierId)?.preferredSupplierName ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  clinicId: string;
  items: InventoryItem[];
  suppliers: Supplier[];
  isLoading: boolean;
};

type AddToExistingState =
  | { phase: "idle" }
  | { phase: "loading_pos" }
  | { phase: "selecting"; draftPos: PurchaseOrder[] }
  | { phase: "adding"; targetPoId: string; draftPos: PurchaseOrder[] };

export function LowStockPurchasingQueue({ clinicId, items, suppliers, isLoading }: Props) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addToExisting, setAddToExisting] = useState<AddToExistingState>({ phase: "idle" });
  const [selectedPoId, setSelectedPoId] = useState("");

  // Classify all items into eligible / ineligible.
  const allEligible = useMemo(() => items.filter(isEligible), [items]);
  const allItems = useMemo(() => items.sort((a, b) => a.name.localeCompare(b.name)), [items]);

  // Reset selection when clinic or items change.
  useEffect(() => {
    setSelectedIds(new Set());
    setSaveError(null);
    setAddToExisting({ phase: "idle" });
  }, [clinicId, items]);

  const handleToggle = useCallback((id: string, eligible: boolean) => {
    if (!eligible) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(allEligible.map((i) => i.id)));
  }, [allEligible]);

  const handleClearAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedItems = useMemo(
    () => allEligible.filter((i) => selectedIds.has(i.id)),
    [allEligible, selectedIds],
  );

  // ── Create draft PO(s) from selected items ──────────────────────────────────

  async function handleCreateFromSelected() {
    if (selectedItems.length === 0) return;
    setSaveError(null);
    setIsSaving(true);

    try {
      const groups = groupBySupplier(selectedItems, suppliers);
      const createdPoIds: string[] = [];

      for (const group of groups) {
        const poRef = generatePoReference();
        const detail = await apiClient.createPurchaseOrderWithLines(clinicId, {
          supplierId: group.supplierId,
          poReference: poRef,
          notes: null,
          lines: group.items.map((item) => ({
            masterCatalogItemId: item.masterCatalogItemId,
            clinicInventoryItemId: item.id,
            quantity: suggestedQty(item),
            reason: "low_stock",
            receivingUnit: item.receivingUnit ?? null,
            unitCostCents: null,
          })),
        });
        createdPoIds.push(detail.purchaseOrder.id);
      }

      // Navigate to the first created PO; the user can review the others from the PO list.
      if (createdPoIds[0]) {
        const extraCount = createdPoIds.length - 1;
        const note = extraCount > 0
          ? `?notice=${encodeURIComponent(`Created ${String(createdPoIds.length)} draft POs (one per supplier). You are viewing the first.`)}`
          : "";
        await navigate(`/purchase-orders/${createdPoIds[0]}${note}`);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to create purchase order");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Add selected items to an existing draft PO ──────────────────────────────

  async function handleLoadDraftPos() {
    setAddToExisting({ phase: "loading_pos" });
    setSaveError(null);
    try {
      const all = await apiClient.listPurchaseOrderHeaders(clinicId);
      const drafts = all.filter((po) => po.status === "draft");
      setAddToExisting({ phase: "selecting", draftPos: drafts });
      setSelectedPoId(drafts[0]?.id ?? "");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Could not load existing purchase orders");
      setAddToExisting({ phase: "idle" });
    }
  }

  async function handleAddToExistingPo() {
    if (!selectedPoId || selectedItems.length === 0) return;
    const currentDraftPos = addToExisting.phase === "selecting" ? addToExisting.draftPos : [];
    setAddToExisting({ phase: "adding", targetPoId: selectedPoId, draftPos: currentDraftPos });
    setSaveError(null);
    setIsSaving(true);
    try {
      await apiClient.addLinesToPurchaseOrder(clinicId, selectedPoId, {
        lines: selectedItems.map((item) => ({
          masterCatalogItemId: item.masterCatalogItemId,
          clinicInventoryItemId: item.id,
          quantity: suggestedQty(item),
          reason: "low_stock",
          receivingUnit: item.receivingUnit ?? null,
          unitCostCents: null,
        })),
      });
      await navigate(`/purchase-orders/${selectedPoId}`);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to add lines to purchase order");
      setAddToExisting({ phase: "selecting", draftPos: currentDraftPos });
    } finally {
      setIsSaving(false);
    }
  }

  const groupSummary = useMemo(
    () => groupBySupplier(selectedItems, suppliers),
    [selectedItems, suppliers],
  );

  const allSelectedCount = selectedIds.size;
  const allEligibleCount = allEligible.length;

  if (isLoading) {
    return <p className="loading-message">Checking low-stock products...</p>;
  }

  if (allEligibleCount === 0) {
    return (
      <p className="inventory-page__subtitle">
        No products are currently below reorder point for this clinic.
      </p>
    );
  }

  return (
    <div className="low-stock-queue">
      {/* Selection controls */}
      <div className="low-stock-queue__toolbar">
        <label className="low-stock-queue__select-all">
          <input
            type="checkbox"
            checked={allSelectedCount === allEligibleCount}
            ref={(el) => {
              if (el) {
                el.indeterminate = allSelectedCount > 0 && allSelectedCount < allEligibleCount;
              }
            }}
            onChange={() => {
              if (allSelectedCount < allEligibleCount) {
                handleSelectAll();
              } else {
                handleClearAll();
              }
            }}
          />
          {allSelectedCount === allEligibleCount
            ? `Deselect all (${String(allEligibleCount)})`
            : `Select all eligible (${String(allEligibleCount)})`}
        </label>

        {allSelectedCount > 0 && (
          <span className="inventory-table__meta">
            {String(allSelectedCount)} item{allSelectedCount !== 1 ? "s" : ""} selected
          </span>
        )}
      </div>

      {/* Item list */}
      <div className="low-stock-queue__list">
        {allItems.map((item) => {
          const eligible = isEligible(item);
          const reason = getIneligibleReason(item);
          const checked = selectedIds.has(item.id);
          const qty = suggestedQty(item);
          const supplierName =
            item.preferredSupplierName ??
            (item.supplierPreference ?? null);

          return (
            <div
              key={item.id}
              className={`low-stock-queue__item${checked ? " low-stock-queue__item--selected" : ""}${!eligible ? " low-stock-queue__item--ineligible" : ""}`}
            >
              <label className="low-stock-queue__check-label">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!eligible}
                  onChange={() => { handleToggle(item.id, eligible); }}
                />
              </label>

              <div className="low-stock-queue__item-info">
                <strong>{item.name}</strong>
                <span className="inventory-table__meta">
                  {item.masterSku}
                  {" · "}On hand: {String(item.quantityOnHand)}
                  {" · "}Reorder at: {String(item.reorderPoint)}
                  {" · "}
                  <strong>Suggest: {String(qty)}</strong>
                  {item.receivingUnit ? ` ${item.receivingUnit}` : ""}
                  {item.receivingUnit && item.stockUnit && item.receivingUnit !== item.stockUnit && item.unitsPerReceivingUnit
                    ? ` (= ${String(qty * item.unitsPerReceivingUnit)} ${item.stockUnit})`
                    : ""}
                </span>
                {supplierName ? (
                  <span className="inventory-table__meta">
                    Supplier: {supplierName}
                  </span>
                ) : (
                  <span className="inventory-table__meta inventory-table__meta--warn">
                    No preferred supplier
                  </span>
                )}
                {reason ? (
                  <span className="inventory-table__meta inventory-table__meta--warn">
                    {reason}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Supplier grouping summary */}
      {allSelectedCount > 0 && groupSummary.length > 1 && (
        <div className="low-stock-queue__group-summary">
          <p className="inventory-table__meta">
            Selected items span {String(groupSummary.length)} supplier groups — one draft PO will be created per group:
          </p>
          <ul className="low-stock-queue__group-list">
            {groupSummary.map((g, i) => (
              <li key={i}>
                <strong>{g.supplierName}</strong>: {String(g.items.length)} item{g.items.length !== 1 ? "s" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      {allSelectedCount > 0 && (
        <div className="inventory-page__actions low-stock-queue__actions">
          <button
            type="button"
            className="button-link"
            onClick={() => { void handleCreateFromSelected(); }}
            disabled={isSaving}
          >
            {isSaving && addToExisting.phase === "idle"
              ? "Creating…"
              : `Create draft PO${groupSummary.length > 1 ? `s (${String(groupSummary.length)})` : ""} from selected`}
          </button>

          {addToExisting.phase === "idle" && (
            <button
              type="button"
              className="link-button"
              onClick={() => { void handleLoadDraftPos(); }}
              disabled={isSaving}
            >
              Add to existing draft PO
            </button>
          )}

          {addToExisting.phase === "loading_pos" && (
            <span className="inventory-table__meta">Loading draft POs…</span>
          )}

          {addToExisting.phase === "selecting" && (
            <div className="low-stock-queue__add-to-existing">
              {addToExisting.draftPos.length === 0 ? (
                <p className="inventory-table__meta">No draft POs found for this clinic.</p>
              ) : (
                <label className="product-form__field">
                  Choose existing draft PO
                  <select
                    value={selectedPoId}
                    onChange={(e) => { setSelectedPoId(e.target.value); }}
                  >
                    {addToExisting.draftPos.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.poReference ?? po.id.slice(0, 8)} — {po.supplierId ? "supplier assigned" : "no supplier"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="inventory-page__actions">
                {addToExisting.draftPos.length > 0 && (
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => { void handleAddToExistingPo(); }}
                    disabled={!selectedPoId || isSaving}
                  >
                    {isSaving ? "Adding…" : "Add selected items to this PO"}
                  </button>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => { setAddToExisting({ phase: "idle" }); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {saveError ? (
        <p className="status-card__error" role="alert">{saveError}</p>
      ) : null}
    </div>
  );
}
