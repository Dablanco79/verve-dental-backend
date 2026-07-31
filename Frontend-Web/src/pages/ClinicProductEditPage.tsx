import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { InventoryItem } from "../types/inventory.js";
import type { Supplier } from "../types/supplier.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

type FieldErrors = Partial<{
  reorderPoint: string;
  supplierId: string;
}>;

export function ClinicProductEditPage() {
  const { productId = "" } = useParams();
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reorderPoint, setReorderPoint] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const requestIdRef = useRef({ id: 0 });

  const activeSuppliers = useMemo(
    () =>
      suppliers
        .filter((s) => s.active)
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    [suppliers],
  );

  const loadData = useCallback(async () => {
    if (!user || !selectedClinicId || isAllClinicsScope || !productId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);

    try {
      const [item, supplierList] = await Promise.all([
        apiClient.getInventoryItem(selectedClinicId, productId),
        apiClient.listSuppliers({ active: true }),
      ]);

      if (requestId === requestIdRef.current.id) {
        setProduct(item);
        setSuppliers(supplierList);
        setReorderPoint(String(item.reorderPoint));
        setSupplierId(item.preferredSupplierId ?? "");
      }
    } catch {
      if (requestId === requestIdRef.current.id) {
        setNotFound(true);
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [isAllClinicsScope, productId, selectedClinicId, user]);

  useEffect(() => {
    void loadData();
    const tracker = requestIdRef.current;
    return () => {
      tracker.id++;
    };
  }, [loadData]);

  if (!user) return null;

  if (!canManageProducts(user.role)) {
    return <Navigate to={`/inventory/products/${productId}`} replace />;
  }

  if (isLoading) {
    return (
      <AppShell>
        <section className="status-card product-detail">
          <p className="loading-message">Loading product…</p>
        </section>
      </AppShell>
    );
  }

  if (notFound || !product) {
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

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !selectedClinicId || !product) return;

    setApiError(null);
    setSaveSuccess(false);

    const errors: FieldErrors = {};

    const parsedReorderPoint = Number(reorderPoint);
    if (!Number.isInteger(parsedReorderPoint) || parsedReorderPoint < 0) {
      errors.reorderPoint = "Reorder point must be a non-negative whole number.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const patch: { reorderPoint?: number; supplierId?: string | null } = {};
      patch.reorderPoint = parsedReorderPoint;
      if (supplierId) {
        patch.supplierId = supplierId;
      } else if (!supplierId && product.preferredSupplierId) {
        patch.supplierId = null;
      }

      const result = await apiClient.updateClinicProduct(selectedClinicId, product.id, patch);
      setProduct(result.clinicItem);
      setReorderPoint(String(result.clinicItem.reorderPoint));
      setSupplierId(result.clinicItem.preferredSupplierId ?? "");
      setSaveSuccess(true);
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSubmitting(false);
    }
  }

  const detailHref = `/inventory/products/${product.id}`;

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Edit clinic settings</h2>
            <p className="inventory-page__subtitle">
              {selectedClinic?.name ?? user.homeClinicName} — operational settings for{" "}
              <strong>{product.name}</strong>
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to={detailHref} className="link-button">
              Back to product
            </Link>
            <Link to="/inventory" className="link-button">
              Inventory
            </Link>
          </div>
        </div>

        {loadError ? (
          <p className="status-card__error" role="alert">{loadError}</p>
        ) : null}

        {/* Master product info — read-only */}
        <div className="product-form__section product-form__readonly-section">
          <h3>Master product (read-only)</h3>
          <dl className="product-detail__header-grid">
            <div className="product-detail__metric">
              <dt>Product name</dt>
              <dd>{product.name}</dd>
            </div>
            <div className="product-detail__metric">
              <dt>SKU</dt>
              <dd><code>{product.masterSku}</code></dd>
            </div>
            <div className="product-detail__metric">
              <dt>Category</dt>
              <dd>{product.category}</dd>
            </div>
            <div className="product-detail__metric">
              <dt>Stock unit</dt>
              <dd>{product.stockUnit ?? product.unitOfMeasure}</dd>
            </div>
            <div className="product-detail__metric">
              <dt>Unit cost</dt>
              <dd>{formatCurrency(product.unitCostCents)}</dd>
            </div>
            <div className="product-detail__metric">
              <dt>Quantity on hand</dt>
              <dd>{product.quantityOnHand}</dd>
            </div>
          </dl>
          <p className="inventory-page__subtitle">
            To edit product name, category, or units,{" "}
            <Link to="/inventory/master-products" className="link-button">
              manage master products
            </Link>.
          </p>
        </div>

        {/* Clinic settings form — editable */}
        <form
          className="product-form"
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
        >
          <fieldset className="product-form__section">
            <legend>Clinic operational settings</legend>
            <div className="product-form__grid">

              <div className="product-form__field">
                <label>
                  Reorder point
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={reorderPoint}
                    onChange={(event) => { setReorderPoint(event.target.value); }}
                    aria-invalid={fieldErrors.reorderPoint ? true : undefined}
                    required
                  />
                </label>
                <p className="product-form__hint">
                  When stock falls below this level, the product appears in the low-stock list.
                </p>
                {fieldErrors.reorderPoint ? (
                  <p className="product-form__field-error" role="alert">
                    {fieldErrors.reorderPoint}
                  </p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Preferred supplier
                  <select
                    value={supplierId}
                    onChange={(event) => { setSupplierId(event.target.value); }}
                    aria-invalid={fieldErrors.supplierId ? true : undefined}
                  >
                    <option value="">— No preferred supplier —</option>
                    {activeSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.supplierName}
                      </option>
                    ))}
                  </select>
                </label>
                {fieldErrors.supplierId ? (
                  <p className="product-form__field-error" role="alert">
                    {fieldErrors.supplierId}
                  </p>
                ) : null}
              </div>

            </div>
          </fieldset>

          {saveSuccess ? (
            <p className="status-card__success" role="status">
              Settings saved successfully.
            </p>
          ) : null}

          {apiError ? (
            <p className="status-card__error" role="alert">{apiError}</p>
          ) : null}

          <div className="product-form__actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save settings"}
            </button>
            <Link
              to={`/inventory/products/${product.id}`}
              className="link-button"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
