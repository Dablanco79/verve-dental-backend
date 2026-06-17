import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { InventoryTable } from "../components/inventory/InventoryTable.js";
import { ScanForm } from "../components/inventory/ScanForm.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { BarcodeFormat, InventoryItem, ScanMode, ScanResponse } from "../types/inventory.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

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
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<ScanNotice | null>(null);
  // Monotonically-increasing counter used to discard responses from
  // superseded fetches. Each loadInventory call snapshots the current id;
  // state updates are only applied when the snapshot still matches.
  // NOTE: apiClient.listInventory does not accept an AbortSignal, so the
  // underlying network request is NOT cancelled — only stale state updates
  // are suppressed. Passing a signal to the client is a future improvement.
  const requestIdRef = useRef({ id: 0 });

  const loadInventory = useCallback(async () => {
    if (!user) {
      // Clear the spinner immediately — there is no authenticated user to
      // fetch inventory for, so the loading state must not persist.
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;

    setError(null);
    setIsLoading(true);

    try {
      const inventory = await apiClient.listInventory(user.homeClinicId);
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
  }, [user]);

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

  async function handleScan(values: {
    barcodeValue: string;
    barcodeFormat?: BarcodeFormat;
    quantity: number;
    mode: ScanMode;
    reason?: string;
  }): Promise<void> {
    if (!user) {
      return;
    }

    setIsScanning(true);
    setScanNotice(null);

    try {
      const result = await apiClient.handleScan(user.homeClinicId, values);
      setScanNotice(buildScanNotice(result));
      await loadInventory();
    } finally {
      setIsScanning(false);
    }
  }

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
            <p className="inventory-page__subtitle">
              {user ? `${user.homeClinicName} — scan to deduct or receive stock` : "Clinic inventory"}
            </p>
          </div>
          <div className="inventory-page__actions">
            {user && canManageProducts(user.role) ? (
              <Link to="/inventory/products/new" className="button-link">
                Add product
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

        <ScanForm isSubmitting={isScanning} onSubmit={handleScan} />

        {scanNotice ? (
          <p className={noticeClassName} role="status">
            {scanNotice.message}
          </p>
        ) : null}
      </section>

      <section className="status-card inventory-page__section">
        <h2>Stock on hand</h2>

        {isLoading ? <p className="loading-message">Loading inventory…</p> : null}
        {error ? <p className="status-card__error">{error}</p> : null}
        {!isLoading && !error ? <InventoryTable items={items} /> : null}
      </section>
    </AppShell>
  );
}
