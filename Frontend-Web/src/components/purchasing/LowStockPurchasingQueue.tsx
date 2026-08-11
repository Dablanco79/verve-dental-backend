/**
 * LowStockPurchasingQueue
 *
 * Allows staff to select low-stock items and either:
 *   A) Create a new Purchasing Draft (one PD + one child supplier PO per supplier)
 *   B) Add selected items to the individual lines of an existing draft supplier PO
 *
 * Pricing source (Issue 1 — Finding 2):
 *   Estimated unit cost = item.unitCostCents, which is the clinic's configured
 *   cost per STOCK UNIT (derived from unitCostOverrideCents ?? defaultUnitCostCents).
 *   This is the authoritative operational price available before a PO is created.
 *
 *   Suggested purchasing quantity is in RECEIVING UNITS.
 *   Conversion: ceil(stockUnitShortfall / unitsPerReceivingUnit).
 *   Estimated line total = receivingQty × unitsPerReceivingUnit × unitCostCents.
 *   Amounts are clearly labelled "Estimated" — they are NOT accounting-grade costs.
 *
 * Supplier guard (Issue 3):
 *   Products without a preferred supplier are shown with a "Supplier required"
 *   warning.  They are excluded from Purchasing Draft creation but remain
 *   visible in the queue and may still be added to an existing draft PO.
 *   No other valid supplier groups are blocked.
 *
 * Suggested order quantity accounts for confirmed on-order stock (submitted POs)
 * to prevent duplicate ordering.  Draft quantities are shown as a warning but
 * are NOT treated as confirmed incoming stock.
 *
 * initialSelectedId (optional):
 *   When provided, the matching eligible item is pre-checked on mount and
 *   whenever the prop changes (e.g. the user clicked "Add to Order" for a row).
 *   The user can add/deselect additional items freely.
 *
 * Editable quantities:
 *   Each selected item shows a numeric input.  Editing updates line cost,
 *   supplier subtotal, and overall estimated total in real-time.
 *   Edited quantities are preserved when the user deselects and reselects the same item.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type {
  InventoryItem,
  PurchaseOrder,
  UnresolvedSupplierGroup,
  UnresolvedSupplierGroupItem,
} from "../../types/inventory.js";
import type { Supplier } from "../../types/supplier.js";

const apiClient = createApiClient(loadConfig());

// ── Currency helpers ──────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}


// ── Cost calculation helpers ──────────────────────────────────────────────────

/**
 * Suggested order quantity in RECEIVING UNITS.
 *
 * Steps:
 * 1. Stock-unit shortfall = reorderPoint − quantityOnHand − onOrderQuantity.
 *    Confirmed on-order stock (submitted POs, always in stock units from the backend)
 *    is deducted so the suggestion already accounts for inbound deliveries.
 * 2. Convert to receiving units: ceil(shortfall / unitsPerReceivingUnit).
 *    Ceiling ensures enough whole receiving units are ordered to cover the need.
 *    When receivingUnit == stockUnit (or unitsPerReceivingUnit absent), factor = 1 (1:1).
 *
 * Returns 0 when the shortfall is fully covered by confirmed on-order stock.
 * Draft quantities are NOT deducted — they are shown as a caution only.
 */
function suggestedReceivingQty(item: InventoryItem): number {
  const onOrder = item.onOrderQuantity ?? 0;
  const stockUnitShortfall = item.reorderPoint - item.quantityOnHand - onOrder;
  if (stockUnitShortfall <= 0) return 0;
  const conversionFactor = item.unitsPerReceivingUnit ?? 1;
  return Math.ceil(stockUnitShortfall / conversionFactor);
}

/**
 * Effective order quantity for a given item, respecting any user edit.
 * Falls back to Math.max(1, suggestedReceivingQty) so the minimum sent
 * to the API is always 1 receiving unit.
 */
function getEffectiveQty(item: InventoryItem, editedQtys: Map<string, number>): number {
  const edited = editedQtys.get(item.id);
  if (edited !== undefined) return Math.max(1, edited);
  return Math.max(1, suggestedReceivingQty(item));
}

/**
 * Estimated line total in CENTS for a given receiving-unit quantity.
 *
 * Formula: receivingQty × unitsPerReceivingUnit × unitCostCents
 *
 * item.unitCostCents is per STOCK UNIT (the authoritative clinic price).
 * receivingQty is in RECEIVING UNITS.
 * conversionFactor (unitsPerReceivingUnit) converts receiving → stock units.
 *
 * Example: 3 Carton × 10 Box/Carton × $8.00/Box = $240.00
 */
function estimatedLineCostCents(item: InventoryItem, receivingQty: number): number {
  const conversionFactor = item.unitsPerReceivingUnit ?? 1;
  return item.unitCostCents * receivingQty * conversionFactor;
}

/**
 * Supplier subtotal (in cents) for a group of items, using effective quantities.
 */
function groupSubtotalCents(items: InventoryItem[], editedQtys: Map<string, number>): number {
  return items.reduce((total, item) => {
    const qty = getEffectiveQty(item, editedQtys);
    return total + estimatedLineCostCents(item, qty);
  }, 0);
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

/** Items below reorder point that have a clinic inventory item ID. */
function isEligible(item: InventoryItem): boolean {
  return item.isBelowReorderPoint && Boolean(item.id);
}

function getIneligibleReason(item: InventoryItem): string | null {
  if (!item.isBelowReorderPoint) return "Not below reorder point";
  if (!item.id) return "No clinic inventory record";
  return null;
}

/** True when an item has a preferred supplier that can form a real supplier PO. */
function hasSupplier(item: InventoryItem): boolean {
  return Boolean(item.preferredSupplierId);
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
        ? (supplierMap.get(supplierId) ?? groupItems.find((i) => i.preferredSupplierId === supplierId)?.preferredSupplierName ?? "Unknown supplier")
        : "No supplier assigned",
      items: groupItems,
    }))
    .sort((a, b) => {
      if (a.supplierId === null) return 1;
      if (b.supplierId === null) return -1;
      return a.supplierName.localeCompare(b.supplierName);
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  clinicId: string;
  items: InventoryItem[];
  suppliers: Supplier[];
  isLoading: boolean;
  /** Clinic inventory item ID to pre-check on mount (from "Add to Order" navigation). */
  initialSelectedId?: string;
};

type AddToExistingState =
  | { phase: "idle" }
  | { phase: "loading_pos" }
  | { phase: "selecting"; draftPos: PurchaseOrder[] }
  | { phase: "adding"; targetPoId: string; draftPos: PurchaseOrder[] };

type DraftCreatedResult = {
  pdId: string;
  pdReference: string;
  resolvedCount: number;
  unresolvedGroups: UnresolvedSupplierGroup[];
};

export function LowStockPurchasingQueue({ clinicId, items, suppliers, isLoading, initialSelectedId }: Props) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => (initialSelectedId ? new Set([initialSelectedId]) : new Set()),
  );
  const [editedQtys, setEditedQtys] = useState<Map<string, number>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftCreated, setDraftCreated] = useState<DraftCreatedResult | null>(null);
  const [addToExisting, setAddToExisting] = useState<AddToExistingState>({ phase: "idle" });
  const [selectedPoId, setSelectedPoId] = useState("");

  // Classify all items into eligible / ineligible.
  const allEligible = useMemo(() => items.filter(isEligible), [items]);
  const allItems = useMemo(() => items.slice().sort((a, b) => a.name.localeCompare(b.name)), [items]);

  // Reset selection when clinic changes or when the initial preselection changes
  // (e.g. user clicked "Add to Order" for a different item).
  // Items are intentionally NOT in the deps so that inventory refreshes
  // do not silently discard in-progress selections.
  useEffect(() => {
    setSelectedIds(initialSelectedId ? new Set([initialSelectedId]) : new Set());
    setEditedQtys(new Map());
    setSaveError(null);
    setDraftCreated(null);
    setAddToExisting({ phase: "idle" });
  }, [clinicId, initialSelectedId]);

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

  const handleQtyChange = useCallback((id: string, value: number) => {
    setEditedQtys((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () => allEligible.filter((i) => selectedIds.has(i.id)),
    [allEligible, selectedIds],
  );

  // All supplier groups from the selected items.
  const groupSummary = useMemo(
    () => groupBySupplier(selectedItems, suppliers),
    [selectedItems, suppliers],
  );

  // Only groups that have a real supplier can become child supplier POs.
  const actionableGroups = useMemo(
    () => groupSummary.filter((g) => g.supplierId !== null),
    [groupSummary],
  );

  // Items with no preferred supplier — excluded from PD creation.
  const noSupplierGroup = useMemo(
    () => groupSummary.find((g) => g.supplierId === null),
    [groupSummary],
  );

  // Overall estimated total for the actionable selected items (respects edited qtys).
  const overallEstimatedCents = useMemo((): number => {
    return actionableGroups.reduce((total, group) => total + groupSubtotalCents(group.items, editedQtys), 0);
  }, [actionableGroups, editedQtys]);

  // ── Create a Purchasing Draft with one child supplier PO per supplier ────────

  async function handleCreatePurchasingDraft() {
    if (actionableGroups.length === 0) {
      // All selected items have no supplier — cannot create any child POs.
      setSaveError(
        "None of the selected products have a preferred supplier assigned. " +
          "Assign a supplier to each product before creating a Purchasing Draft.",
      );
      return;
    }
    setSaveError(null);
    setDraftCreated(null);
    setIsSaving(true);

    try {
      const result = await apiClient.createPurchasingDraft(clinicId, {
        supplierGroups: actionableGroups.map((g) => ({
          supplierId: g.supplierId,
          supplierName: g.supplierName,
          lines: g.items.map((item) => ({
            masterCatalogItemId: item.masterCatalogItemId,
            clinicInventoryItemId: item.id,
            quantity: getEffectiveQty(item, editedQtys),
            reason: "low_stock",
            receivingUnit: item.receivingUnit ?? null,
            unitCostCents: item.unitCostCents,
          })),
        })),
      });

      const unresolved = result.unresolvedGroups ?? [];
      const resolvedCount = result.childPos.length;

      if (unresolved.length > 0) {
        // Partially resolved — show result inline rather than navigating away.
        setDraftCreated({
          pdId: result.purchasingDraft.id,
          pdReference: result.purchasingDraft.draftReference,
          resolvedCount,
          unresolvedGroups: unresolved,
        });
      } else {
        // Fully resolved — navigate to the new Purchasing Draft.
        await navigate(`/purchasing-drafts/${result.purchasingDraft.id}`);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to create purchasing draft");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Add selected items to an existing draft supplier PO ─────────────────────

  async function handleLoadDraftPos() {
    // RULE 1 — Items from multiple suppliers cannot be added to a single PO.
    // If the selected items span more than one supplier, require a Purchasing
    // Draft instead of dumping them into one existing PO.
    const selectedSupplierIds = new Set(
      selectedItems.map((i) => i.preferredSupplierId ?? null),
    );
    // More than one unique supplier ID (ignoring null) means mixed suppliers.
    const uniqueSupplierIds = [...selectedSupplierIds].filter(Boolean);
    if (uniqueSupplierIds.length > 1) {
      setSaveError(
        `Selected items span ${String(uniqueSupplierIds.length)} suppliers. ` +
          "Items from multiple suppliers cannot be added to a single purchase order. " +
          'Use "Create Purchasing Draft" to split them into supplier-specific POs.',
      );
      return;
    }

    setAddToExisting({ phase: "loading_pos" });
    setSaveError(null);
    try {
      const all = await apiClient.listPurchaseOrderHeaders(clinicId);
      // Only show draft POs that have the same supplier as the selected items
      // (or no supplier for legacy POs created before the rule was enforced).
      const selectedSupplierId = uniqueSupplierIds[0] ?? null;
      const compatible = all.filter((po) => {
        if (po.status !== "draft") return false;
        if (!po.supplierId) return true; // legacy / unassigned — show but backend will enforce
        return po.supplierId === selectedSupplierId;
      });
      setAddToExisting({ phase: "selecting", draftPos: compatible });
      setSelectedPoId(compatible[0]?.id ?? "");
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
          quantity: getEffectiveQty(item, editedQtys),
          reason: "low_stock",
          receivingUnit: item.receivingUnit ?? null,
          unitCostCents: item.unitCostCents,
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
            checked={allSelectedCount === allEligibleCount && allEligibleCount > 0}
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
          {allSelectedCount === allEligibleCount && allEligibleCount > 0
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
          // Raw suggested qty (in receiving units); may be 0 when covered by on-order stock.
          const suggestedQty = suggestedReceivingQty(item);
          // Effective qty: user-edited value if set, otherwise max(1, suggested).
          const effectiveQtyVal = getEffectiveQty(item, editedQtys);
          const supplierName = item.preferredSupplierName ?? (item.supplierPreference ?? null);
          const itemHasSupplier = hasSupplier(item);
          const inDraft = item.inDraftQuantity ?? 0;
          const onOrder = item.onOrderQuantity ?? 0;
          const activeDocs = item.activePurchasingDocuments ?? [];
          const conversionFactor = item.unitsPerReceivingUnit ?? 1;

          // Cost per RECEIVING UNIT = unitCostCents (per stock unit) × conversionFactor.
          // Estimated line total uses the effective (possibly edited) qty.
          const costPerReceivingUnitCents = item.unitCostCents * conversionFactor;
          const lineCostEstimate = estimatedLineCostCents(item, effectiveQtyVal);

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
                  {" · "}On hand: <strong>{String(item.quantityOnHand)}</strong>
                  {" · "}Reorder at: {String(item.reorderPoint)}
                  {" · "}
                  {suggestedQty === 0 && onOrder > 0
                    ? <><strong>Covered</strong> — {String(onOrder)} {item.stockUnit ?? "units"} on order</>
                    : <>
                        <strong>Suggest: {String(Math.max(1, suggestedQty))}</strong>
                        {item.receivingUnit ? ` ${item.receivingUnit}` : ""}
                        {item.receivingUnit && item.stockUnit && item.receivingUnit !== item.stockUnit && conversionFactor > 1
                          ? ` (${String(Math.max(1, suggestedQty) * conversionFactor)} ${item.stockUnit} incoming)`
                          : ""}
                      </>}
                </span>

                {/* Qty to Order — editable input shown when item is selected and eligible */}
                {checked && eligible && (
                  <label className="low-stock-queue__qty-label">
                    Qty to Order:
                    <input
                      type="number"
                      min={1}
                      value={editedQtys.has(item.id) ? (editedQtys.get(item.id) ?? effectiveQtyVal) : Math.max(1, suggestedQty)}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) handleQtyChange(item.id, val);
                      }}
                      className="low-stock-queue__qty-input"
                      aria-label={`Qty to order for ${item.name}`}
                      data-testid={`qty-input-${item.id}`}
                    />
                    {item.receivingUnit ?? item.stockUnit ?? "unit"}
                  </label>
                )}

                {/* Estimated cost — uses effective qty (edited if set, suggested otherwise) */}
                <span className="inventory-table__meta">
                  Estimated: {String(effectiveQtyVal)} × {item.receivingUnit ?? item.stockUnit ?? "unit"} @ {formatCurrency(costPerReceivingUnitCents)} = <strong>{formatCurrency(lineCostEstimate)}</strong>
                </span>

                {supplierName ? (
                  <span className="inventory-table__meta">
                    Supplier: {supplierName}
                  </span>
                ) : (
                  <span className="inventory-table__meta inventory-table__meta--warn">
                    No preferred supplier
                    {eligible && " — assign a supplier in Inventory or Product settings before adding to a Purchasing Draft"}
                  </span>
                )}

                {/* Supplier-required warning for PD creation */}
                {eligible && !itemHasSupplier && (
                  <span className="inventory-table__meta inventory-table__meta--warn" data-testid="supplier-required">
                    Supplier required — this item will not be included in a new Purchasing Draft
                  </span>
                )}

                {/* In-draft warning: quantity is planned but NOT confirmed */}
                {inDraft > 0 && (
                  <span className="inventory-table__meta inventory-table__meta--warn">
                    {String(inDraft)} {item.stockUnit ?? "units"} already in a draft order
                    {activeDocs.filter((d) => d.status === "draft").map((d) => (
                      <span key={d.poId}>
                        {" · "}
                        {d.draftReference ? (
                          <Link to={`/purchasing-drafts/${d.purchasingDraftId ?? ""}`} className="low-stock-queue__doc-link">
                            {d.draftReference}
                          </Link>
                        ) : (
                          <Link to={`/purchase-orders/${d.poId}`} className="low-stock-queue__doc-link">
                            {d.poReference ?? d.poId.slice(0, 8)}
                          </Link>
                        )}
                      </span>
                    ))}
                  </span>
                )}

                {/* On-order status: confirmed incoming */}
                {onOrder > 0 && (
                  <span className="inventory-table__meta">
                    {String(onOrder)} {item.stockUnit ?? "units"} already on order
                    {activeDocs.filter((d) => d.status === "submitted" || d.status === "partially_received").map((d) => (
                      <span key={d.poId}>
                        {" · "}
                        {d.draftReference ? (
                          <Link to={`/purchasing-drafts/${d.purchasingDraftId ?? ""}`} className="low-stock-queue__doc-link">
                            {d.draftReference}
                          </Link>
                        ) : (
                          <Link to={`/purchase-orders/${d.poId}`} className="low-stock-queue__doc-link">
                            {d.poReference ?? d.poId.slice(0, 8)}
                          </Link>
                        )}
                      </span>
                    ))}
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

      {/* Supplier grouping summary with subtotals */}
      {allSelectedCount > 0 && groupSummary.length > 0 && (
        <div className="low-stock-queue__group-summary">
          {actionableGroups.length > 0 && (
            <>
              <p className="inventory-table__meta">
                {actionableGroups.length > 1
                  ? `Selected items span ${String(actionableGroups.length)} supplier groups — one supplier PO will be created per group under a single Purchasing Draft:`
                  : "Selected items will be added to one supplier PO under a Purchasing Draft:"}
              </p>
              <ul className="low-stock-queue__group-list">
                {actionableGroups.map((g, i) => {
                  const subtotal = groupSubtotalCents(g.items, editedQtys);
                  return (
                    <li key={i}>
                      <strong>{g.supplierName}</strong>
                      {": "}
                      {String(g.items.length)} item{g.items.length !== 1 ? "s" : ""}
                      {" — Estimated: "}
                      <strong>{formatCurrency(subtotal)}</strong>
                    </li>
                  );
                })}
              </ul>
              <p className="inventory-table__meta">
                {"Overall Purchasing Draft Estimated: "}
                <strong data-testid="overall-estimated-total">{formatCurrency(overallEstimatedCents)}</strong>
              </p>
            </>
          )}

          {/* Warning about items excluded from PD due to missing supplier */}
          {noSupplierGroup && (
            <div className="inventory-notice inventory-notice--warn" role="status" data-testid="no-supplier-warning">
              <strong>{String(noSupplierGroup.items.length)} item{noSupplierGroup.items.length !== 1 ? "s" : ""} need a supplier</strong>
              {" — "}
              {noSupplierGroup.items.map((i) => i.name).join(", ")}
              {". These will not be included in the Purchasing Draft. "}
              {actionableGroups.length > 0
                ? "The remaining supplier groups will proceed."
                : ""}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {allSelectedCount > 0 && (
        <div className="inventory-page__actions low-stock-queue__actions">
          {actionableGroups.length > 0 && (
            <button
              type="button"
              className="button-link"
              onClick={() => { void handleCreatePurchasingDraft(); }}
              disabled={isSaving}
            >
              {isSaving && addToExisting.phase === "idle"
                ? "Creating…"
                : `Create Purchasing Draft (${String(actionableGroups.length)} supplier PO${actionableGroups.length !== 1 ? "s" : ""})`}
            </button>
          )}

          {/* If ALL selected items lack a supplier, show a clearer message */}
          {actionableGroups.length === 0 && (
            <span className="inventory-table__meta inventory-table__meta--warn">
              Assign a preferred supplier to at least one item to create a Purchasing Draft.
            </span>
          )}

          {addToExisting.phase === "idle" && (
            <button
              type="button"
              className="link-button"
              onClick={() => { void handleLoadDraftPos(); }}
              disabled={isSaving}
            >
              Add to existing draft supplier PO
            </button>
          )}

          {addToExisting.phase === "loading_pos" && (
            <span className="inventory-table__meta">Loading draft POs…</span>
          )}

          {addToExisting.phase === "selecting" && (
            <div className="low-stock-queue__add-to-existing">
              {addToExisting.draftPos.length === 0 ? (
                <div>
                  <p className="inventory-table__meta">
                    No compatible draft supplier POs found for the selected items.
                  </p>
                  <p className="inventory-table__meta inventory-table__meta--warn">
                    Use "Create Purchasing Draft" to generate a new supplier PO.
                  </p>
                </div>
              ) : (
                <label className="product-form__field">
                  Choose existing draft supplier PO (compatible with selected items)
                  <select
                    value={selectedPoId}
                    onChange={(e) => { setSelectedPoId(e.target.value); }}
                  >
                    {addToExisting.draftPos.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.poReference ?? po.id.slice(0, 8)}{po.supplierId ? "" : " — no supplier (legacy)"}
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

      {/* Purchasing Draft creation result — shown when some products were unresolved */}
      {draftCreated ? (
        <div
          className="inventory-notice inventory-notice--success"
          role="status"
          data-testid="draft-created-result"
        >
          <p>
            <strong>Purchasing Draft created successfully.</strong>
            {" "}
            <Link
              to={`/purchasing-drafts/${draftCreated.pdId}`}
              className="inventory-table__link"
              data-testid="draft-created-link"
            >
              {draftCreated.pdReference}
            </Link>
          </p>
          <p>
            {String(draftCreated.resolvedCount)}{" "}
            {draftCreated.resolvedCount !== 1 ? "products were" : "product was"} added to supplier purchase orders.
          </p>
          {draftCreated.unresolvedGroups.length > 0 && (() => {
            const allUnresolvedItems: UnresolvedSupplierGroupItem[] = draftCreated.unresolvedGroups.flatMap(
              (g) => g.items,
            );
            return (
              <div
                className="inventory-notice inventory-notice--warn"
                role="alert"
                data-testid="unresolved-groups-notice"
              >
                <p>
                  <strong>
                    {"The following "}
                    {allUnresolvedItems.length !== 1
                      ? `${String(allUnresolvedItems.length)} products require`
                      : "product requires"}
                    {" supplier assignment before "}
                    {allUnresolvedItems.length !== 1 ? "they" : "it"}
                    {" can be ordered:"}
                  </strong>
                </p>
                <ul
                  className="low-stock-queue__unresolved-list"
                  data-testid="unresolved-items-list"
                >
                  {allUnresolvedItems.map((item) => (
                    <li
                      key={item.masterCatalogItemId}
                      className="low-stock-queue__unresolved-item"
                      data-testid="unresolved-item"
                    >
                      <span className="low-stock-queue__unresolved-name">
                        <Link
                          to={`/inventory/products/${item.clinicInventoryItemId}`}
                          className="inventory-table__link"
                          data-testid="unresolved-product-link"
                        >
                          {item.productName}
                        </Link>
                      </span>
                      {item.sku ? (
                        <span
                          className="inventory-table__meta"
                          data-testid="unresolved-product-sku"
                        >
                          {"SKU: "}
                          <code>{item.sku}</code>
                        </span>
                      ) : null}
                      <span
                        className="inventory-table__meta inventory-table__meta--warn"
                        data-testid="unresolved-product-reason"
                      >
                        {"Reason: "}
                        {item.reason}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="inventory-table__meta">
                  Open each product above to assign a preferred supplier, then create a new Purchasing Draft or purchase order for them.
                </p>
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
