import { useCallback, useEffect, useState } from "react";
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

  const loadInventory = useCallback(async () => {
    if (!user) {
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const inventory = await apiClient.listInventory(user.clinicId);
      setItems(inventory);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load inventory";
      setError(message);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadInventory();
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
      const result = await apiClient.handleScan(user.clinicId, values);
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
              {user ? `${user.clinicName} — scan to deduct or receive stock` : "Clinic inventory"}
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
