import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { InventoryItem } from "../types/inventory.js";
import {
  formatInventoryCurrency,
  getInventoryBarcode,
  getInventoryReceivingUnit,
  getInventoryStockUnit,
  getInventoryStockStatus,
  getInventorySupplierDisplay,
  getInventoryUnitsPerReceivingUnit,
} from "../utils/inventoryDisplay.js";

const apiClient = createApiClient(loadConfig());

const FUTURE_FEATURES = [
  "Purchase Orders",
  "Price History",
  "Forecast",
  "OCR",
  "Stock Activity",
  "AI Insights",
] as const;

function ProductNotFound() {
  return (
    <AppShell>
      <section className="status-card product-detail product-detail__not-found">
        <h2>Product not found.</h2>
        <Link to="/inventory" className="button-link">
          Return to Inventory
        </Link>
      </section>
    </AppShell>
  );
}

function DetailMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="product-detail__metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ProductDetailPage() {
  const { productId = "" } = useParams();
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef({ id: 0 });

  const loadProduct = useCallback(async () => {
    if (!user || !selectedClinicId || isAllClinicsScope || !productId) {
      setProduct(null);
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;
    setIsLoading(true);
    setNotFound(false);

    try {
      const item = await apiClient.getInventoryItem(selectedClinicId, productId);
      if (requestId === requestIdRef.current.id) {
        setProduct(item);
      }
    } catch {
      if (requestId === requestIdRef.current.id) {
        setProduct(null);
        setNotFound(true);
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [isAllClinicsScope, productId, selectedClinicId, user]);

  useEffect(() => {
    void loadProduct();
    const tracker = requestIdRef.current;
    return () => {
      tracker.id++;
    };
  }, [loadProduct]);

  if (isLoading) {
    return (
      <AppShell>
        <section className="status-card product-detail">
          <p className="loading-message">Loading product...</p>
        </section>
      </AppShell>
    );
  }

  if (notFound || !product) {
    return <ProductNotFound />;
  }

  const stockStatus = getInventoryStockStatus(product);
  const supplierDisplay = getInventorySupplierDisplay(product);

  return (
    <AppShell>
      <section className="status-card product-detail product-detail__hero">
        <div className="product-detail__breadcrumb">
          <Link to="/inventory" className="link-button">
            Back to Inventory
          </Link>
        </div>
        <div className="product-detail__hero-content">
          <div>
            <h2>{product.name}</h2>
            <p className="inventory-page__subtitle">
              {selectedClinic?.name ?? user?.homeClinicName ?? "Clinic inventory"} product workspace
            </p>
          </div>
          <span className={stockStatus.className}>{stockStatus.label}</span>
        </div>
        <dl className="product-detail__header-grid">
          <DetailMetric label="SKU" value={product.masterSku} />
          <DetailMetric label="Barcode" value={getInventoryBarcode(product)} />
          <DetailMetric label="Category" value={product.category} />
          <DetailMetric label="Stock Unit" value={getInventoryStockUnit(product)} />
          <DetailMetric label="Receiving Unit" value={getInventoryReceivingUnit(product)} />
          <DetailMetric
            label="Units Per Receiving Unit"
            value={getInventoryUnitsPerReceivingUnit(product)}
          />
          <DetailMetric label="Preferred Supplier" value={supplierDisplay} />
          <DetailMetric label="Current Quantity" value={product.quantityOnHand} />
          <DetailMetric label="Reorder Point" value={product.reorderPoint} />
        </dl>
      </section>

      <section className="product-detail__grid" aria-label="Product detail cards">
        <article className="status-card product-detail__card">
          <h3>Inventory Summary</h3>
          <dl className="product-detail__metric-list">
            <DetailMetric label="Current Stock" value={product.quantityOnHand} />
            <DetailMetric label="Reorder Point" value={product.reorderPoint} />
            <DetailMetric label="Unit Cost" value={formatInventoryCurrency(product.unitCostCents)} />
            <DetailMetric label="Stock Status" value={stockStatus.label} />
          </dl>
        </article>

        <article className="status-card product-detail__card">
          <h3>Supplier</h3>
          <dl className="product-detail__metric-list">
            <DetailMetric label="Preferred Supplier" value={supplierDisplay} />
            <DetailMetric label="Supplier Name" value={supplierDisplay} />
          </dl>
        </article>
      </section>

      <section className="status-card product-detail__future">
        <div className="status-card__header">
          <div>
            <h3>Future Features</h3>
            <p className="inventory-page__subtitle">
              These sections are intentionally data-free until the underlying workflows exist.
            </p>
          </div>
        </div>
        <div className="product-detail__future-grid">
          {FUTURE_FEATURES.map((feature) => (
            <article key={feature} className="product-detail__future-card">
              <h4>{feature}</h4>
              <p>Available in a future release.</p>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
