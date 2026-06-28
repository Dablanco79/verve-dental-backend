import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { InventoryTable } from "../components/inventory/InventoryTable.js";
import { ScanForm } from "../components/inventory/ScanForm.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type {
  BarcodeFormat,
  InventoryAdjustment,
  InventoryItem,
  PurchaseOrderLine,
  ScanMode,
  ScanResponse,
} from "../types/inventory.js";
import {
  canManageInventory,
  canManageProducts,
  canManageUsers,
  canViewAdjustmentHistory,
} from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

type ScanNotice = {
  tone: "success" | "info" | "receive";
  message: string;
};

function buildScanNotice(result: ScanResponse): ScanNotice {
  const { item, draftPoLineAdded, mode } = result;
  const stockLabel = `${String(item.quantityOnHand)} ${item.unitOfMeasure} on hand`;

  if (mode === "receive") {
    return {
      tone: "receive",
      message: `Received ${item.masterSku} — now ${stockLabel}.`,
    };
  }

  if (draftPoLineAdded) {
    return {
      tone: "info",
      message: `Deducted ${item.masterSku} — ${stockLabel}. Draft purchase order line added (below reorder).`,
    };
  }

  return {
    tone: "success",
    message: `Deducted ${item.masterSku} — ${stockLabel}.`,
  };
}

export function InventoryPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const [searchParams] = useSearchParams();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const canUseReceivingWorkflow = user ? canManageInventory(user.role) : false;
  const canReceiveStock = canUseReceivingWorkflow && !isAllClinicsScope;
  const requestedMode: ScanMode =
    searchParams.get("mode") === "receive" ? "receive" : "deduct";
  const requestedReference = searchParams.get("reference") ?? "";
  const shouldFocusLowStock = searchParams.get("focus") === "low-stock";
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recentAdjustments, setRecentAdjustments] = useState<InventoryAdjustment[]>([]);
  const [purchaseOrderLines, setPurchaseOrderLines] = useState<PurchaseOrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReceiving, setIsLoadingReceiving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivingError, setReceivingError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<ScanNotice | null>(null);
  // Monotonically-increasing counter used to discard responses from
  // superseded fetches. Each loadInventory call snapshots the current id;
  // state updates are only applied when the snapshot still matches.
  // NOTE: apiClient.listInventory does not accept an AbortSignal, so the
  // underlying network request is NOT cancelled — only stale state updates
  // are suppressed. Passing a signal to the client is a future improvement.
  const requestIdRef = useRef({ id: 0 });

  const loadInventory = useCallback(async () => {
    if (isAllClinicsScope) {
      setItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!user || !selectedClinicId) {
      // Clear the spinner immediately — there is no authenticated user to
      // fetch inventory for, so the loading state must not persist.
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;

    setError(null);
    setIsLoading(true);

    try {
      const inventory = await apiClient.listInventory(selectedClinicId);
      // Discard the response if a newer request has started since this
      // one was dispatched.
      if (requestId === requestIdRef.current.id) {
        setItems(inventory);
      }
    } catch (err: unknown) {
      if (requestId === requestIdRef.current.id) {
        const message = err instanceof Error ? err.message : "Unable to load inventory";
        setError(message);
        setItems([]);
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [isAllClinicsScope, selectedClinicId, user]);

  const loadReceivingWorkflow = useCallback(async () => {
    if (!user || !selectedClinicId || !canUseReceivingWorkflow || isAllClinicsScope) {
      setRecentAdjustments([]);
      setPurchaseOrderLines([]);
      setReceivingError(null);
      setIsLoadingReceiving(false);
      return;
    }

    setIsLoadingReceiving(true);
    setReceivingError(null);

    const [adjustmentsResult, purchaseOrdersResult] = await Promise.allSettled([
      apiClient.listAdjustments(selectedClinicId, { limit: 25 }),
      apiClient.listPurchaseOrders(selectedClinicId),
    ]);

    if (adjustmentsResult.status === "fulfilled") {
      setRecentAdjustments(adjustmentsResult.value.items);
    } else {
      setRecentAdjustments([]);
      setReceivingError("Receiving history could not be loaded.");
    }

    if (purchaseOrdersResult.status === "fulfilled") {
      setPurchaseOrderLines(purchaseOrdersResult.value);
    } else {
      setPurchaseOrderLines([]);
      setReceivingError((current) =>
        current
          ? `${current} Purchase orders could not be loaded.`
          : "Purchase orders could not be loaded.",
      );
    }

    setIsLoadingReceiving(false);
  }, [canUseReceivingWorkflow, isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadInventory();
    // Capture the ref object so the cleanup closes over it directly, which
    // satisfies react-hooks/exhaustive-deps. Because requestIdRef.current is
    // never reassigned (only its .id property is mutated), this is always the
    // same object and incrementing .id in the cleanup correctly invalidates
    // any in-flight response without cancelling the underlying network request.
    const requestTracker = requestIdRef.current;
    return () => {
      requestTracker.id++;
    };
  }, [loadInventory]);

  useEffect(() => {
    void loadReceivingWorkflow();
  }, [loadReceivingWorkflow]);

  async function handleScan(values: {
    barcodeValue: string;
    barcodeFormat?: BarcodeFormat;
    quantity: number;
    mode: ScanMode;
    reason?: string;
  }): Promise<void> {
    if (!user || !selectedClinicId) {
      return;
    }

    if (values.mode === "receive" && !canReceiveStock) {
      setScanNotice({
        tone: "info",
        message: "Select a clinic before receiving stock.",
      });
      return;
    }

    setIsScanning(true);
    setScanNotice(null);

    try {
      const result = await apiClient.handleScan(selectedClinicId, values);
      setScanNotice(buildScanNotice(result));
      await loadInventory();
      await loadReceivingWorkflow();
    } finally {
      setIsScanning(false);
    }
  }

  const receivingAdjustments = useMemo(
    () =>
      recentAdjustments.filter(
        (adjustment) => adjustment.adjustmentType === "receive" && adjustment.quantityDelta > 0,
      ),
    [recentAdjustments],
  );
  const todaysReceivingAdjustments = useMemo(
    () =>
      receivingAdjustments.filter(
        (adjustment) =>
          new Date(adjustment.createdAt).toLocaleDateString("en-CA") === todayLocalDate(),
      ),
    [receivingAdjustments],
  );
  const submittedPurchaseOrderLines = useMemo(
    () => purchaseOrderLines.filter((line) => line.orderStatus === "submitted"),
    [purchaseOrderLines],
  );
  const lowStockItems = useMemo(
    () => items.filter((item) => item.isBelowReorderPoint),
    [items],
  );
  const canReviewPurchaseOrders = user ? canManageUsers(user.role) : false;
  const itemNameById = useMemo(
    () => new Map(items.map((item) => [item.id, item.name])),
    [items],
  );
  const receivedUnitsToday = todaysReceivingAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.quantityDelta,
    0,
  );
  const expectedSubmittedUnits = submittedPurchaseOrderLines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );
  const scannerSubtitle = isAllClinicsScope
    ? "Inventory actions require a specific clinic"
    : selectedClinic
      ? `${selectedClinic.name} — ${canReceiveStock ? "scan to deduct or receive stock" : "scan to deduct stock"}`
      : "Clinic inventory";

  const noticeClassName =
    scanNotice?.tone === "info"
      ? "inventory-notice inventory-notice--info"
      : scanNotice?.tone === "receive"
        ? "inventory-notice inventory-notice--receive"
        : "inventory-notice";

  return (
    <AppShell>
      <section className="status-card inventory-page__section">
        <div className="status-card__header">
          <div>
            <h2>Scanner</h2>
            <p className="inventory-page__subtitle">{scannerSubtitle}</p>
          </div>
          <div className="inventory-page__actions">
            {user && canManageInventory(user.role) ? (
              <Link to="/inventory/adjust" className="button-link">
                Adjust stock
              </Link>
            ) : null}
            {user && canViewAdjustmentHistory(user.role) ? (
              <Link to="/inventory/adjustments" className="link-button">
                Adjustment history
              </Link>
            ) : null}
            {user && canManageProducts(user.role) ? (
              <Link to="/inventory/products/new" className="link-button">
                Add product
              </Link>
            ) : null}
            {canReviewPurchaseOrders ? (
              <Link to="/purchase-orders" className="link-button">
                Purchase orders
              </Link>
            ) : null}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                void loadInventory();
              }}
              disabled={isLoading}
            >
              Refresh
            </button>
          </div>
        </div>

        {isAllClinicsScope ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Select a clinic to receive stock</h3>
            <p>
              Inventory receiving is clinic-specific. Choose a real clinic from
              Clinic scope before scanning delivered items.
            </p>
          </div>
        ) : (
          <ScanForm
            isSubmitting={isScanning}
            initialMode={requestedMode}
            initialReason={requestedReference}
            allowReceive={canReceiveStock}
            onSubmit={handleScan}
          />
        )}

        {scanNotice ? (
          <p className={noticeClassName} role="status">
            {scanNotice.message}
          </p>
        ) : null}
      </section>

      {canReviewPurchaseOrders && !isAllClinicsScope ? (
        <section
          className={
            shouldFocusLowStock
              ? "status-card inventory-page__section inventory-page__section--focus"
              : "status-card inventory-page__section"
          }
        >
          <div className="status-card__header">
            <div>
              <h2>Low stock purchasing queue</h2>
              <p className="inventory-page__subtitle">
                Review products that are below reorder point, then continue to purchase orders.
              </p>
            </div>
            <div className="inventory-page__actions">
              <Link to="/purchase-orders" className="button-link">
                Review purchase orders
              </Link>
              <Link to="/suppliers" className="link-button">
                View suppliers
              </Link>
            </div>
          </div>

          {isLoading ? (
            <p className="loading-message">Checking low-stock products...</p>
          ) : lowStockItems.length > 0 ? (
            <div className="inventory-receiving-list">
              <ul>
                {lowStockItems.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      {" "}
                      <span className="inventory-table__meta">
                        {item.masterSku} — {item.quantityOnHand} on hand, reorder at {item.reorderPoint}
                        {item.supplierPreference ? ` — supplier: ${item.supplierPreference}` : ""}
                      </span>
                    </span>
                    <Link
                      to={`/purchase-orders?item=${encodeURIComponent(item.masterCatalogItemId)}`}
                      className="link-button"
                      aria-label={`Review purchase order for ${item.name}`}
                    >
                      Review PO
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="inventory-page__subtitle">
              No products are currently below reorder point for this clinic.
            </p>
          )}
        </section>
      ) : null}

      {canUseReceivingWorkflow ? (
        <section className="status-card inventory-page__section">
          <div className="status-card__header">
            <div>
              <h2>Receiving workflow</h2>
              <p className="inventory-page__subtitle">
                {isAllClinicsScope
                  ? "Select a clinic before receiving stock."
                  : "Receive deliveries by scanning items, then use adjustment history as the receiving log."}
              </p>
            </div>
            {!isAllClinicsScope ? (
              <div className="inventory-page__actions">
                <Link to="/purchase-orders" className="link-button">
                  View purchase orders
                </Link>
                <Link to="/inventory/adjustments" className="link-button">
                  Receiving history
                </Link>
              </div>
            ) : null}
          </div>

          {isAllClinicsScope ? (
            <p className="inventory-page__subtitle">
              Stock movements cannot be recorded against All Clinics.
            </p>
          ) : (
            <>
              {isLoadingReceiving ? (
                <p className="loading-message">Loading receiving summary…</p>
              ) : null}
              {receivingError ? (
                <p className="status-card__error" role="alert">
                  {receivingError}
                </p>
              ) : null}

              <dl className="po-summary__stats inventory-receiving-summary">
                <div className="po-summary__stat">
                  <dt>Received today</dt>
                  <dd>{todaysReceivingAdjustments.length}</dd>
                </div>
                <div className="po-summary__stat">
                  <dt>Units received</dt>
                  <dd>{receivedUnitsToday}</dd>
                </div>
                <div className="po-summary__stat">
                  <dt>Submitted PO lines</dt>
                  <dd>{submittedPurchaseOrderLines.length}</dd>
                </div>
                <div className="po-summary__stat">
                  <dt>Expected units</dt>
                  <dd>{expectedSubmittedUnits}</dd>
                </div>
              </dl>

              {submittedPurchaseOrderLines.length > 0 ? (
                <div className="inventory-receiving-list">
                  <h3>Submitted purchase orders</h3>
                  <p className="inventory-page__subtitle">
                    These items appear on submitted purchase orders. Scan items to add them to stock.
                    Purchase order status does not update automatically when items are received.
                  </p>
                  <ul>
                    {submittedPurchaseOrderLines.slice(0, 4).map((line) => (
                      <li key={line.id}>
                        <span>
                          {line.itemName} — {line.quantity} ordered
                        </span>
                        <Link
                          to={`/inventory?mode=receive&reference=${encodeURIComponent(line.draftPurchaseOrderId)}`}
                          className="link-button"
                        >
                          Receive
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="inventory-page__subtitle">
                  No submitted purchase order lines are waiting for stock receipt.
                </p>
              )}

              {receivingAdjustments.length > 0 ? (
                <div className="inventory-receiving-list">
                  <h3>Recently received</h3>
                  <ul>
                    {receivingAdjustments.slice(0, 4).map((adjustment) => (
                      <li key={adjustment.id}>
                        <span>
                          {itemNameById.get(adjustment.clinicInventoryItemId) ?? "Inventory item"} —
                          {" "}
                          {adjustment.quantityDelta} received
                        </span>
                        <span className="inventory-table__meta">
                          {new Date(adjustment.createdAt).toLocaleString("en-AU", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="inventory-page__subtitle">
                  No recent receive scans have been recorded for this clinic.
                </p>
              )}
            </>
          )}
        </section>
      ) : null}

      <section className="status-card inventory-page__section">
        <h2>Stock on hand</h2>

        {isLoading ? <p className="loading-message">Loading inventory…</p> : null}
        {error ? <p className="status-card__error">{error}</p> : null}
        {isAllClinicsScope ? (
          <p className="inventory-page__subtitle">
            Select a clinic to view stock on hand.
          </p>
        ) : !isLoading && !error ? (
          <InventoryTable
            items={items}
            purchaseOrderHrefForItem={
              canReviewPurchaseOrders
                ? (item) =>
                    `/purchase-orders?item=${encodeURIComponent(item.masterCatalogItemId)}`
                : undefined
            }
          />
        ) : null}
      </section>
    </AppShell>
  );
}
