import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { InventoryAdjustment, InventoryItem } from "../types/inventory.js";
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

const TIMELINE_ADJUSTMENTS_LIMIT = 100;

const FUTURE_TIMELINE_EVENTS = [
  "Purchase Orders",
  "OCR",
  "Forecast",
  "Transfers",
  "Cycle Counts",
] as const;

type TimelineEvent = {
  id: string;
  type: "created" | "adjustment";
  title: string;
  occurredAt: string;
  userEmail?: string;
  quantityDelta?: number;
  reason?: string | null;
};

const timelineDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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

function isValidDateString(value: string | null | undefined) {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}

function getAdjustmentEventTitle(adjustment: InventoryAdjustment) {
  if (adjustment.adjustmentType === "receive") {
    return "Stock Received";
  }

  return "Inventory Adjustment";
}

function buildTimelineEvents(
  product: InventoryItem,
  adjustments: InventoryAdjustment[],
): TimelineEvent[] {
  const events: TimelineEvent[] = adjustments.map((adjustment) => ({
    id: adjustment.id,
    type: "adjustment",
    title: getAdjustmentEventTitle(adjustment),
    occurredAt: adjustment.createdAt,
    userEmail: adjustment.performedByEmail,
    quantityDelta: adjustment.quantityDelta,
    reason: adjustment.reason,
  }));

  if (isValidDateString(product.createdAt)) {
    events.push({
      id: `${product.id}-created`,
      type: "created",
      title: "Product Created",
      occurredAt: product.createdAt,
    });
  }

  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

function formatTimelineDate(value: string) {
  return timelineDateFormatter.format(new Date(value));
}

function formatSignedQuantity(value: number, stockUnit: string | undefined) {
  const sign = value > 0 ? "+" : "";
  const absoluteValue = Math.abs(value);
  const unit = stockUnit?.trim() || "unit";
  const unitLabel =
    absoluteValue === 1
      ? unit
      : unit.toLowerCase() === "box"
        ? "boxes"
        : `${unit}s`;

  return `${sign}${String(value)} ${unitLabel}`;
}

function ProductTimeline({
  events,
  product,
  loadError,
}: {
  events: TimelineEvent[];
  product: InventoryItem;
  loadError: string | null;
}) {
  return (
    <section className="status-card product-detail__timeline" aria-labelledby="product-timeline-title">
      <div className="status-card__header">
        <div>
          <h3 id="product-timeline-title">Product Timeline</h3>
          <p className="inventory-page__subtitle">Newest event first.</p>
        </div>
      </div>

      {loadError ? (
        <p className="status-card__error">{loadError}</p>
      ) : events.length === 0 ? (
        <p className="product-detail__timeline-empty">
          No activity has been recorded for this product.
        </p>
      ) : (
        <ol className="product-detail__timeline-list">
          {events.map((event) => (
            <li key={event.id} className="product-detail__timeline-item">
              <div className="product-detail__timeline-marker" aria-hidden="true" />
              <div className="product-detail__timeline-body">
                <h4>{event.title}</h4>
                <time dateTime={event.occurredAt}>{formatTimelineDate(event.occurredAt)}</time>
                <dl className="product-detail__timeline-details">
                  {event.userEmail ? (
                    <div>
                      <dt>User</dt>
                      <dd>{event.userEmail}</dd>
                    </div>
                  ) : null}
                  {event.quantityDelta !== undefined ? (
                    <div>
                      <dt>Quantity Change</dt>
                      <dd>
                        {formatSignedQuantity(
                          event.quantityDelta,
                          product.stockUnit ?? product.unitOfMeasure,
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {event.reason ? (
                    <div>
                      <dt>Reason</dt>
                      <dd>{event.reason}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="product-detail__timeline-future" aria-labelledby="future-timeline-events-title">
        <h4 id="future-timeline-events-title">Future Timeline Events</h4>
        <div className="product-detail__future-grid">
          {FUTURE_TIMELINE_EVENTS.map((feature) => (
            <article key={feature} className="product-detail__future-card">
              <h5>{feature}</h5>
              <p>Available in a future release.</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProductDetailPage() {
  const { productId = "" } = useParams();
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const canViewAdjustmentHistory =
    user?.role === "owner_admin" || user?.role === "group_practice_manager";
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef({ id: 0 });

  const loadProduct = useCallback(async () => {
    if (!user || !selectedClinicId || isAllClinicsScope || !productId) {
      setProduct(null);
      setAdjustments([]);
      setTimelineError(null);
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;
    setIsLoading(true);
    setNotFound(false);
    setTimelineError(null);

    try {
      const [item, adjustmentPage] = await Promise.all([
        apiClient.getInventoryItem(selectedClinicId, productId),
        canViewAdjustmentHistory
          ? apiClient
              .listAdjustments(selectedClinicId, {
                itemId: productId,
                limit: TIMELINE_ADJUSTMENTS_LIMIT,
                offset: 0,
              })
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (requestId === requestIdRef.current.id) {
        setProduct(item);
        setAdjustments(adjustmentPage?.items ?? []);
        setTimelineError(null);
      }
    } catch {
      if (requestId === requestIdRef.current.id) {
        setProduct(null);
        setAdjustments([]);
        setTimelineError(null);
        setNotFound(true);
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [canViewAdjustmentHistory, isAllClinicsScope, productId, selectedClinicId, user]);

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
  const timelineEvents = buildTimelineEvents(product, adjustments);

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

      <ProductTimeline events={timelineEvents} product={product} loadError={timelineError} />
    </AppShell>
  );
}
