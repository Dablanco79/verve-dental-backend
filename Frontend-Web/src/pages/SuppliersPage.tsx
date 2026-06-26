import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { ConfirmModal } from "../components/supplier/ConfirmModal.js";
import { EditSupplierModal } from "../components/supplier/EditSupplierModal.js";
import { UploadInvoiceModal } from "../components/supplier/UploadInvoiceModal.js";
import { loadConfig } from "../config/index.js";
import type {
  CreateSupplierRequest,
  Supplier,
  SupplierInvoice,
  UploadAndExtractResult,
} from "../types/supplier.js";
import { canManageSuppliers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Utility helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Status badge ───────────────────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`supplier-badge supplier-badge--${active ? "active" : "inactive"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── KPI bar ────────────────────────────────────────────────────────────────────

type KpiBarProps = {
  suppliers: Supplier[];
  pendingOcrCount: number;
};

function SupplierKpiBar({ suppliers, pendingOcrCount }: KpiBarProps) {
  const totalCount = suppliers.length;
  const activeCount = suppliers.filter((s) => s.active).length;

  return (
    <dl className="supplier-kpi-bar">
      <div className="supplier-kpi-bar__stat">
        <dt>Total Suppliers</dt>
        <dd>{totalCount}</dd>
      </div>
      <div className="supplier-kpi-bar__stat">
        <dt>Active Suppliers</dt>
        <dd className="supplier-kpi-bar__dd--active">{activeCount}</dd>
      </div>
      <div className="supplier-kpi-bar__stat">
        <dt>Products Linked</dt>
        <dd className="supplier-kpi-bar__dd--muted">—</dd>
      </div>
      <div className="supplier-kpi-bar__stat">
        <dt>Pending OCR Imports</dt>
        <dd className={pendingOcrCount > 0 ? "supplier-kpi-bar__dd--pending" : undefined}>
          {pendingOcrCount}
        </dd>
      </div>
    </dl>
  );
}

// ── Pending invoice review queue ───────────────────────────────────────────────

type PendingInvoiceQueueProps = {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
};

function PendingInvoiceQueue({ invoices, suppliers }: PendingInvoiceQueueProps) {
  if (invoices.length === 0) {
    return null;
  }

  function getSupplierName(invoice: SupplierInvoice): string {
    const matchedSupplier = suppliers.find((supplier) => supplier.id === invoice.supplierId);
    return matchedSupplier?.supplierName ?? invoice.supplierNameRaw ?? "Unmatched supplier";
  }

  return (
    <section className="status-card supplier-detail__section" id="pending-invoice-review">
      <div className="status-card__header">
        <div>
          <h3 className="supplier-detail__section-title">Pending OCR Review</h3>
          <p className="inventory-page__subtitle">
            Resume uploaded invoices that still need line review and confirmation.
          </p>
        </div>
      </div>

      <div className="supplier-table-wrap">
        <table className="supplier-table">
          <thead>
            <tr>
              <th className="supplier-table__th">Supplier</th>
              <th className="supplier-table__th">Invoice #</th>
              <th className="supplier-table__th">Uploaded</th>
              <th className="supplier-table__th">Uploaded By</th>
              <th className="supplier-table__th supplier-table__th--action" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="supplier-table__row">
                <td className="supplier-table__td">Supplier: {getSupplierName(invoice)}</td>
                <td className="supplier-table__td supplier-table__td--mono">
                  {invoice.invoiceNumber ?? (
                    <span className="supplier-table__muted">No number</span>
                  )}
                </td>
                <td className="supplier-table__td">{formatDate(invoice.createdAt)}</td>
                <td className="supplier-table__td">{invoice.importedByEmail}</td>
                <td className="supplier-table__td supplier-table__td--action">
                  <Link
                    to={`/invoice-review/${invoice.id}`}
                    state={{ backPath: "/suppliers" }}
                    className="supplier-view-btn"
                  >
                    Review OCR
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Create supplier modal ──────────────────────────────────────────────────────

type CreateModalProps = {
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
};

function CreateSupplierModal({ onClose, onCreated }: CreateModalProps) {
  const [supplierName, setSupplierName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    const trimmed = supplierName.trim();
    if (!trimmed) {
      setError("Supplier name is required.");
      return;
    }

    const body: CreateSupplierRequest = {
      supplierName: trimmed,
      contactName: contactName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
    };

    setSubmitting(true);
    try {
      const created = await apiClient.createSupplier(body);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="supplier-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-supplier-modal-title"
    >
      <div className="supplier-modal">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="create-supplier-modal-title">
            New Supplier
          </h2>
          <button
            type="button"
            className="supplier-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form
          className="supplier-form"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <label className="supplier-form__field">
            <span className="supplier-form__label">
              Supplier Name <span className="supplier-form__required">*</span>
            </span>
            <input
              type="text"
              className="supplier-form__control"
              value={supplierName}
              onChange={(e) => {
                setSupplierName(e.target.value);
              }}
              maxLength={200}
              placeholder="e.g. DentalCo Australia"
              disabled={submitting}
              required
              autoFocus
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Contact Name</span>
            <input
              type="text"
              className="supplier-form__control"
              value={contactName}
              onChange={(e) => {
                setContactName(e.target.value);
              }}
              maxLength={200}
              placeholder="e.g. Jane Smith"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Email</span>
            <input
              type="email"
              className="supplier-form__control"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="e.g. orders@dentalco.com.au"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Phone</span>
            <input
              type="text"
              className="supplier-form__control"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              maxLength={50}
              placeholder="e.g. 1800 123 456"
              disabled={submitting}
            />
          </label>

          {error ? (
            <p className="supplier-form__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="supplier-form__actions">
            <button
              type="button"
              className="supplier-form__cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="supplier-form__submit"
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create Supplier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Suppliers table ────────────────────────────────────────────────────────────

type SuppliersTableProps = {
  suppliers: Supplier[];
  recentInvoices: SupplierInvoice[];
  canManage: boolean;
  onEdit: (supplier: Supplier) => void;
  onToggleStatus: (supplier: Supplier) => void;
};

function SuppliersTable({
  suppliers,
  recentInvoices,
  canManage,
  onEdit,
  onToggleStatus,
}: SuppliersTableProps) {
  if (suppliers.length === 0) {
    return (
      <div className="supplier-empty">
        <p className="supplier-empty__title">No suppliers found</p>
        <p className="supplier-empty__hint">
          Adjust the search or filters, or create a new supplier.
        </p>
      </div>
    );
  }

  function getLastInvoiceDate(supplierId: string): string {
    const invoicesForSupplier = recentInvoices
      .filter((inv) => inv.supplierId === supplierId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return invoicesForSupplier[0]
      ? formatDate(invoicesForSupplier[0].invoiceDate ?? invoicesForSupplier[0].createdAt)
      : "—";
  }

  return (
    <div className="supplier-table-wrap">
      <table className="supplier-table">
        <thead>
          <tr>
            <th className="supplier-table__th">Supplier Name</th>
            <th className="supplier-table__th">Contact / Email</th>
            <th className="supplier-table__th">Phone</th>
            <th className="supplier-table__th">Status</th>
            <th className="supplier-table__th">Last Invoice</th>
            <th className="supplier-table__th supplier-table__th--action" />
          </tr>
        </thead>
        <tbody>
          {suppliers.map((supplier) => (
            <tr key={supplier.id} className="supplier-table__row">
              <td className="supplier-table__td">
                <span className="supplier-table__name">{supplier.supplierName}</span>
                {supplier.supplierCode ? (
                  <span className="supplier-table__code">{supplier.supplierCode}</span>
                ) : null}
              </td>
              <td className="supplier-table__td">
                {supplier.contactName ? (
                  <span className="supplier-table__contact">{supplier.contactName}</span>
                ) : null}
                {supplier.email ? (
                  <span className="supplier-table__email">{supplier.email}</span>
                ) : null}
                {!supplier.contactName && !supplier.email ? (
                  <span className="supplier-table__muted">—</span>
                ) : null}
              </td>
              <td className="supplier-table__td">
                {supplier.phone ?? <span className="supplier-table__muted">—</span>}
              </td>
              <td className="supplier-table__td">
                <ActiveBadge active={supplier.active} />
              </td>
              <td className="supplier-table__td">{getLastInvoiceDate(supplier.id)}</td>
              <td className="supplier-table__td supplier-table__td--action">
                <div className="supplier-table__row-actions">
                  <Link to={`/suppliers/${supplier.id}`} className="supplier-view-btn">
                    View
                  </Link>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        className="supplier-edit-btn"
                        onClick={() => {
                          onEdit(supplier);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`supplier-toggle-btn supplier-toggle-btn--${supplier.active ? "deactivate" : "activate"}`}
                        onClick={() => {
                          onToggleStatus(supplier);
                        }}
                      >
                        {supplier.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type ActiveFilter = "all" | "active" | "inactive";

export function SuppliersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<SupplierInvoice[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<SupplierInvoice[]>([]);
  const [pendingOcrCount, setPendingOcrCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [confirmToggleSupplier, setConfirmToggleSupplier] = useState<Supplier | null>(null);

  const loadData = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [allSuppliers, pendingInvoices] = await Promise.all([
        apiClient.listSuppliers(),
        apiClient.listClinicSupplierInvoices(user.homeClinicId, {
          status: "pending_review",
          limit: 100,
        }),
      ]);
      setSuppliers(allSuppliers);
      setPendingInvoices(pendingInvoices);
      setPendingOcrCount(pendingInvoices.length);

      if (allSuppliers.length > 0) {
        const recentInvs = await apiClient.listClinicSupplierInvoices(user.homeClinicId, {
          limit: 50,
        });
        setRecentInvoices(recentInvs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppliers.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!user) return null;

  const canManage = canManageSuppliers(user.role);

  const filteredSuppliers = suppliers.filter((s) => {
    const matchesSearch =
      searchTerm === "" ||
      s.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contactName?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
      (s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);

    const matchesActive =
      activeFilter === "all" ||
      (activeFilter === "active" && s.active) ||
      (activeFilter === "inactive" && !s.active);

    return matchesSearch && matchesActive;
  });

  function handleSupplierCreated(created: Supplier): void {
    setSuppliers((prev) => [created, ...prev]);
    setShowCreateModal(false);
  }

  function handleUploadSuccess(result: UploadAndExtractResult): void {
    void navigate(`/invoice-review/${result.invoice.id}`, {
      state: { uploadResult: result, backPath: "/suppliers" },
    });
  }

  function handleSupplierUpdated(updated: Supplier): void {
    setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setEditingSupplier(null);
  }

  async function handleToggleStatus(): Promise<void> {
    if (!confirmToggleSupplier) return;
    const updated = await apiClient.updateSupplier(confirmToggleSupplier.id, {
      active: !confirmToggleSupplier.active,
    });
    setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setConfirmToggleSupplier(null);
  }

  const toggleTarget = confirmToggleSupplier;

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Suppliers</h2>
            <p className="inventory-page__subtitle">
              Manage supplier records and track procurement relationships
            </p>
          </div>
          <div className="inventory-page__actions">
            {canManage ? (
              <>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => {
                    setShowUploadModal(true);
                  }}
                >
                  Upload Invoice
                </button>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => {
                    setShowCreateModal(true);
                  }}
                >
                  + New Supplier
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="button-link"
              onClick={() => {
                void loadData();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading suppliers…</p>
        ) : (
          <>
            <SupplierKpiBar suppliers={suppliers} pendingOcrCount={pendingOcrCount} />

            {canManage ? (
              <PendingInvoiceQueue invoices={pendingInvoices} suppliers={suppliers} />
            ) : null}

            <div className="supplier-search-bar">
              <label className="supplier-search-bar__field">
                <span className="supplier-search-bar__label">Search</span>
                <input
                  type="search"
                  className="supplier-search-bar__control"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                  }}
                  placeholder="Supplier name, contact or email…"
                />
              </label>

              <label className="supplier-search-bar__field">
                <span className="supplier-search-bar__label">Status</span>
                <select
                  className="supplier-search-bar__control"
                  value={activeFilter}
                  onChange={(e) => {
                    setActiveFilter(e.target.value as ActiveFilter);
                  }}
                >
                  <option value="all">All</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
              </label>

              {searchTerm !== "" || activeFilter !== "all" ? (
                <button
                  type="button"
                  className="supplier-search-bar__clear"
                  onClick={() => {
                    setSearchTerm("");
                    setActiveFilter("all");
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>

            <SuppliersTable
              suppliers={filteredSuppliers}
              recentInvoices={recentInvoices}
              canManage={canManage}
              onEdit={setEditingSupplier}
              onToggleStatus={setConfirmToggleSupplier}
            />
          </>
        )}
      </section>

      {showCreateModal ? (
        <CreateSupplierModal
          onClose={() => {
            setShowCreateModal(false);
          }}
          onCreated={handleSupplierCreated}
        />
      ) : null}

      {editingSupplier ? (
        <EditSupplierModal
          key={editingSupplier.id}
          supplier={editingSupplier}
          onClose={() => {
            setEditingSupplier(null);
          }}
          onSaved={handleSupplierUpdated}
        />
      ) : null}

      {toggleTarget ? (
        <ConfirmModal
          title={toggleTarget.active ? "Deactivate Supplier" : "Reactivate Supplier"}
          message={
            toggleTarget.active
              ? `Deactivate "${toggleTarget.supplierName}"? It will be hidden from active supplier lists but all historical data will be retained.`
              : `Reactivate "${toggleTarget.supplierName}"? It will become visible in active supplier lists again.`
          }
          confirmLabel={toggleTarget.active ? "Yes, Deactivate" : "Yes, Reactivate"}
          confirmVariant={toggleTarget.active ? "warning" : "danger"}
          onClose={() => {
            setConfirmToggleSupplier(null);
          }}
          onConfirm={handleToggleStatus}
        />
      ) : null}

      {showUploadModal ? (
        <UploadInvoiceModal
          clinicId={user.homeClinicId}
          suppliers={suppliers.filter((s) => s.active)}
          onClose={() => {
            setShowUploadModal(false);
          }}
          onUploadSuccess={handleUploadSuccess}
        />
      ) : null}
    </AppShell>
  );
}
