import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { MasterProductFormModal } from "../components/masterProduct/MasterProductFormModal.js";
import { ConfirmModal } from "../components/supplier/ConfirmModal.js";
import { loadConfig } from "../config/index.js";
import type { MasterProduct, MasterProductStatusFilter } from "../types/masterProduct.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const PAGE_SIZE = 20;

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`supplier-badge supplier-badge--${isActive ? "active" : "inactive"}`}>
      {isActive ? "Active" : "Archived"}
    </span>
  );
}

// ── Pagination bar ─────────────────────────────────────────────────────────────

type PaginationBarProps = {
  total: number;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
};

function PaginationBar({ total, page, pageSize, onPrev, onNext }: PaginationBarProps) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const isFirstPage = page === 0;
  const isLastPage = (page + 1) * pageSize >= total;

  return (
    <div className="analytics-pagination">
      <span className="analytics-pagination__summary">
        {total === 0
          ? "0 master products"
          : `${start.toString()}–${end.toString()} of ${total.toString()} master products`}
      </span>
      <div className="analytics-pagination__controls">
        <button
          type="button"
          className="button-link"
          onClick={onPrev}
          disabled={isFirstPage}
          aria-label="Previous page"
        >
          ← Previous
        </button>
        <button
          type="button"
          className="button-link"
          onClick={onNext}
          disabled={isLastPage}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Products table ─────────────────────────────────────────────────────────────

type ProductsTableProps = {
  products: MasterProduct[];
  canManage: boolean;
  onEdit: (product: MasterProduct) => void;
  onArchive: (product: MasterProduct) => void;
  onReactivate: (product: MasterProduct) => void;
};

function ProductsTable({ products, canManage, onEdit, onArchive, onReactivate }: ProductsTableProps) {
  if (products.length === 0) {
    return (
      <div className="supplier-empty">
        <p className="supplier-empty__title">No master products found</p>
        <p className="supplier-empty__hint">
          Adjust the search or filters, or add a new master product.
        </p>
      </div>
    );
  }

  return (
    <div className="supplier-table-wrap">
      <table className="supplier-table">
        <thead>
          <tr>
            <th className="supplier-table__th">Display Name</th>
            <th className="supplier-table__th">SKU</th>
            <th className="supplier-table__th">Category</th>
            <th className="supplier-table__th">Brand</th>
            <th className="supplier-table__th">Unit</th>
            <th className="supplier-table__th">Status</th>
            <th className="supplier-table__th supplier-table__th--action" />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="supplier-table__row">
              <td className="supplier-table__td">
                <span className="supplier-table__name">{product.displayName}</span>
                {product.subcategory ? (
                  <span className="supplier-table__code">{product.subcategory}</span>
                ) : null}
              </td>
              <td className="supplier-table__td supplier-table__td--mono">
                <code>{product.sku}</code>
              </td>
              <td className="supplier-table__td">{product.category}</td>
              <td className="supplier-table__td">
                {product.brand ?? <span className="supplier-table__muted">—</span>}
              </td>
              <td className="supplier-table__td">{product.stockUnit}</td>
              <td className="supplier-table__td">
                <StatusBadge isActive={product.isActive} />
              </td>
              <td className="supplier-table__td supplier-table__td--action">
                {canManage ? (
                  <div className="supplier-table__row-actions">
                    <button
                      type="button"
                      className="supplier-edit-btn"
                      onClick={() => {
                        onEdit(product);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`supplier-toggle-btn supplier-toggle-btn--${product.isActive ? "deactivate" : "activate"}`}
                      onClick={() => {
                        if (product.isActive) {
                          onArchive(product);
                        } else {
                          onReactivate(product);
                        }
                      }}
                    >
                      {product.isActive ? "Archive" : "Reactivate"}
                    </button>
                  </div>
                ) : (
                  <span className="supplier-table__muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function MasterProductsPage() {
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<MasterProductStatusFilter>("active");
  const [page, setPage] = useState(0);

  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MasterProduct | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MasterProduct | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<MasterProduct | null>(null);

  // Debounce free-text search so we don't hit the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  // Reset to page 0 whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, categoryFilter, statusFilter]);

  const loadProducts = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.listMasterProducts({
        search: debouncedSearch || undefined,
        category: categoryFilter.trim() || undefined,
        status: statusFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setProducts(result.items);
      setTotal(result.total);
    } catch (err) {
      setProducts([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : "Failed to load master products.");
    } finally {
      setIsLoading(false);
    }
  }, [user, debouncedSearch, categoryFilter, statusFilter, page]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  if (!user) return null;

  const canManage = canManageProducts(user.role);

  const hasActiveFilters = searchInput !== "" || categoryFilter !== "" || statusFilter !== "active";

  function handleClearFilters(): void {
    setSearchInput("");
    setCategoryFilter("");
    setStatusFilter("active");
  }

  function handleCreated(): void {
    setShowCreateModal(false);
    void loadProducts();
  }

  function handleUpdated(): void {
    setEditingProduct(null);
    void loadProducts();
  }

  async function handleArchive(): Promise<void> {
    if (!archiveTarget) return;
    await apiClient.archiveMasterProduct(archiveTarget.id);
    setArchiveTarget(null);
    await loadProducts();
  }

  async function handleReactivate(): Promise<void> {
    if (!reactivateTarget) return;
    await apiClient.reactivateMasterProduct(reactivateTarget.id);
    setReactivateTarget(null);
    await loadProducts();
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Master Products</h2>
            <p className="inventory-page__subtitle">
              View, search, and manage the master catalogue used across all clinics. Managing
              master products never changes stock quantities in any clinic.
            </p>
          </div>
          <div className="inventory-page__actions">
            {canManage ? (
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setShowCreateModal(true);
                }}
              >
                + Add Master Product
              </button>
            ) : null}
            <button
              type="button"
              className="button-link"
              onClick={() => {
                void loadProducts();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="supplier-search-bar">
          <label className="supplier-search-bar__field">
            <span className="supplier-search-bar__label">Search</span>
            <input
              type="search"
              className="supplier-search-bar__control"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
              }}
              placeholder="Display name, SKU, category, or brand…"
            />
          </label>

          <label className="supplier-search-bar__field">
            <span className="supplier-search-bar__label">Category</span>
            <input
              type="text"
              className="supplier-search-bar__control"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
              }}
              placeholder="e.g. PPE"
            />
          </label>

          <label className="supplier-search-bar__field">
            <span className="supplier-search-bar__label">Status</span>
            <select
              className="supplier-search-bar__control"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as MasterProductStatusFilter);
              }}
            >
              <option value="active">Active only</option>
              <option value="archived">Archived only</option>
              <option value="all">All</option>
            </select>
          </label>

          {hasActiveFilters ? (
            <button type="button" className="supplier-search-bar__clear" onClick={handleClearFilters}>
              Clear
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading master products…</p>
        ) : (
          <>
            <ProductsTable
              products={products}
              canManage={canManage}
              onEdit={setEditingProduct}
              onArchive={setArchiveTarget}
              onReactivate={setReactivateTarget}
            />
            <PaginationBar
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
              onPrev={() => {
                setPage((p) => Math.max(0, p - 1));
              }}
              onNext={() => {
                setPage((p) => p + 1);
              }}
            />
          </>
        )}
      </section>

      {showCreateModal ? (
        <MasterProductFormModal
          onClose={() => {
            setShowCreateModal(false);
          }}
          onSaved={handleCreated}
        />
      ) : null}

      {editingProduct ? (
        <MasterProductFormModal
          key={editingProduct.id}
          product={editingProduct}
          onClose={() => {
            setEditingProduct(null);
          }}
          onSaved={handleUpdated}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmModal
          title="Archive Master Product"
          message={`Archive "${archiveTarget.displayName}"? It will be hidden from active product lists but all historical data will be retained.`}
          confirmLabel="Yes, Archive"
          confirmVariant="warning"
          onClose={() => {
            setArchiveTarget(null);
          }}
          onConfirm={handleArchive}
        />
      ) : null}

      {reactivateTarget ? (
        <ConfirmModal
          title="Reactivate Master Product"
          message={`Reactivate "${reactivateTarget.displayName}"? It will become visible in active product lists again.`}
          confirmLabel="Yes, Reactivate"
          confirmVariant="danger"
          onClose={() => {
            setReactivateTarget(null);
          }}
          onConfirm={handleReactivate}
        />
      ) : null}
    </AppShell>
  );
}
