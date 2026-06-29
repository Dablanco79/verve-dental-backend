import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { InventoryItem } from "../types/inventory.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

function sortProducts(a: InventoryItem, b: InventoryItem): number {
  return a.name.localeCompare(b.name);
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export function ProductManagementPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const [products, setProducts] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef({ id: 0 });

  const loadProducts = useCallback(async () => {
    if (!user || !selectedClinicId || isAllClinicsScope) {
      setProducts([]);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;
    setIsLoading(true);
    setLoadError(null);

    try {
      const inventory = await apiClient.listInventory(selectedClinicId);
      if (requestId === requestIdRef.current.id) {
        setProducts(inventory);
      }
    } catch (err: unknown) {
      if (requestId === requestIdRef.current.id) {
        setProducts([]);
        setLoadError(err instanceof Error ? err.message : "Unable to load products");
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadProducts();
    const tracker = requestIdRef.current;
    return () => {
      tracker.id++;
    };
  }, [loadProducts]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...products].sort(sortProducts);
    if (!query) return sorted;

    return sorted.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.masterSku.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.unitOfMeasure.toLowerCase().includes(query),
    );
  }, [products, search]);

  if (!user) return null;

  if (!canManageProducts(user.role)) {
    return <Navigate to="/inventory" replace />;
  }

  return (
    <AppShell>
      <section className="status-card inventory-page__section">
        <div className="status-card__header">
          <div>
            <h2>Product management</h2>
            <p className="inventory-page__subtitle">
              {isAllClinicsScope
                ? "Select a clinic to view real products."
                : `${selectedClinic?.name ?? user.homeClinicName} — products backed by the live clinic inventory API.`}
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/inventory/products/new" className="button-link">
              Add product
            </Link>
            <Link to="/inventory/adjust?mode=opening" className="link-button">
              Opening stock counts
            </Link>
            <Link to="/inventory" className="link-button">
              Back to inventory
            </Link>
          </div>
        </div>

        <div className="inventory-receiving-callout" role="status">
          <h3>Product edit/deactivate backend gap</h3>
          <p>
            Product creation is supported. Editing product name, SKU/code, barcode, unit,
            reorder threshold, and active/inactive status is not exposed by the current backend.
            Required backend change: add authenticated Owner/Admin and Practice Manager endpoints
            to update master catalogue fields, primary barcode mapping, clinic reorder threshold,
            and product active status, then return the updated clinic inventory view.
          </p>
        </div>

        {isAllClinicsScope ? (
          <p className="inventory-page__subtitle">
            Product rows are clinic-specific in the current API. Choose one clinic from Clinic scope.
          </p>
        ) : (
          <>
            <div className="billing-filters">
              <label className="billing-filters__field">
                <span className="billing-filters__label">Search products</span>
                <input
                  type="search"
                  className="billing-filters__control"
                  placeholder="Name, SKU, category, or unit"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="billing-filters__clear"
                onClick={() => {
                  setSearch("");
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  void loadProducts();
                }}
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>

            {loadError ? (
              <p className="status-card__error" role="alert">
                {loadError}
              </p>
            ) : isLoading ? (
              <p className="loading-message">Loading products...</p>
            ) : visibleProducts.length === 0 ? (
              <div className="billing-empty">
                <p className="billing-empty__title">No products found</p>
                <p className="billing-empty__hint">
                  Add real products for this clinic before entering opening stock counts.
                </p>
              </div>
            ) : (
              <div className="inventory-table-wrap">
                <div className="inventory-summary">
                  <span>{visibleProducts.length} products shown</span>
                  <span className="inventory-summary__ok">Live clinic inventory list</span>
                </div>
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">SKU/code</th>
                      <th scope="col">Unit</th>
                      <th scope="col" className="inventory-table__numeric">Reorder threshold</th>
                      <th scope="col" className="inventory-table__numeric">On hand</th>
                      <th scope="col" className="inventory-table__numeric">Unit cost</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <span className="inventory-table__name">{product.name}</span>
                          <span className="inventory-table__meta">{product.category}</span>
                        </td>
                        <td><code>{product.masterSku}</code></td>
                        <td>{product.unitOfMeasure}</td>
                        <td className="inventory-table__numeric">{product.reorderPoint}</td>
                        <td className="inventory-table__numeric">{product.quantityOnHand}</td>
                        <td className="inventory-table__numeric">{formatCurrency(product.unitCostCents)}</td>
                        <td>
                          <span className="inventory-badge inventory-badge--ok">Active in clinic</span>
                        </td>
                        <td>
                          <Link
                            to={`/inventory/adjust?mode=opening&item=${encodeURIComponent(product.id)}`}
                            className="link-button"
                          >
                            Opening count
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
