import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { ConfirmModal } from "../components/supplier/ConfirmModal.js";
import { EditSupplierModal } from "../components/supplier/EditSupplierModal.js";
import { UploadInvoiceModal } from "../components/supplier/UploadInvoiceModal.js";
import { loadConfig } from "../config/index.js";
import type {
  Supplier,
  SupplierInvoice,
  SupplierInvoiceStatus,
  SupplierProduct,
  UploadAndExtractResult,
} from "../types/supplier.js";
import { canManageSuppliers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Utility helpers ────────────────────────────────────────────────────────────

function centsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Status badges ──────────────────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`supplier-badge supplier-badge--${active ? "active" : "inactive"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

const INVOICE_STATUS_LABELS: Record<SupplierInvoiceStatus, string> = {
  pending_review: "Pending Review",
  confirmed: "Confirmed",
  voided: "Voided",
};

function InvoiceStatusBadge({ status }: { status: SupplierInvoiceStatus }) {
  return (
    <span className={`supplier-invoice-badge supplier-invoice-badge--${status}`}>
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

// ── Section: Supplier Overview ─────────────────────────────────────────────────

function SupplierOverview({ supplier }: { supplier: Supplier }) {
  return (
    <section className="status-card supplier-detail__section">
      <h3 className="supplier-detail__section-title">Supplier Overview</h3>
      <dl className="supplier-detail__overview-grid">
        <div className="supplier-detail__overview-item">
          <dt>Supplier Name</dt>
          <dd>{supplier.supplierName}</dd>
        </div>
        {supplier.supplierCode ? (
          <div className="supplier-detail__overview-item">
            <dt>Supplier Code</dt>
            <dd className="supplier-detail__mono">{supplier.supplierCode}</dd>
          </div>
        ) : null}
        <div className="supplier-detail__overview-item">
          <dt>Status</dt>
          <dd>
            <ActiveBadge active={supplier.active} />
          </dd>
        </div>
        {supplier.contactName ? (
          <div className="supplier-detail__overview-item">
            <dt>Contact Name</dt>
            <dd>{supplier.contactName}</dd>
          </div>
        ) : null}
        {supplier.email ? (
          <div className="supplier-detail__overview-item">
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${supplier.email}`} className="supplier-detail__link">
                {supplier.email}
              </a>
            </dd>
          </div>
        ) : null}
        {supplier.phone ? (
          <div className="supplier-detail__overview-item">
            <dt>Phone</dt>
            <dd>{supplier.phone}</dd>
          </div>
        ) : null}
        {supplier.website ? (
          <div className="supplier-detail__overview-item">
            <dt>Website</dt>
            <dd>
              <a
                href={supplier.website}
                target="_blank"
                rel="noopener noreferrer"
                className="supplier-detail__link"
              >
                {supplier.website}
              </a>
            </dd>
          </div>
        ) : null}
        {supplier.notes ? (
          <div className="supplier-detail__overview-item supplier-detail__overview-item--full">
            <dt>Notes</dt>
            <dd className="supplier-detail__notes">{supplier.notes}</dd>
          </div>
        ) : null}
        <div className="supplier-detail__overview-item">
          <dt>Created</dt>
          <dd>{formatDate(supplier.createdAt)}</dd>
        </div>
        <div className="supplier-detail__overview-item">
          <dt>Last Updated</dt>
          <dd>{formatDate(supplier.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Section: Supplier Products ─────────────────────────────────────────────────

type SupplierProductsProps = {
  catalogue: SupplierProduct[];
  isLoading: boolean;
};

function SupplierProductsSection({ catalogue, isLoading }: SupplierProductsProps) {
  const activeProducts = catalogue.filter((p) => p.active);

  return (
    <section className="status-card supplier-detail__section">
      <h3 className="supplier-detail__section-title">
        Supplier Products
        {!isLoading && catalogue.length > 0 ? (
          <span className="supplier-detail__count">{activeProducts.length} active</span>
        ) : null}
      </h3>

      {isLoading ? (
        <p className="loading-message">Loading catalogue…</p>
      ) : catalogue.length === 0 ? (
        <div className="supplier-empty">
          <p className="supplier-empty__title">No products linked</p>
          <p className="supplier-empty__hint">
            Products will appear here once the supplier catalogue is populated.
          </p>
        </div>
      ) : (
        <div className="supplier-table-wrap">
          <table className="supplier-table">
            <thead>
              <tr>
                <th className="supplier-table__th">SKU</th>
                <th className="supplier-table__th">Description</th>
                <th className="supplier-table__th">Unit</th>
                <th className="supplier-table__th supplier-table__th--numeric">Unit Cost</th>
                <th className="supplier-table__th">Status</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.map((product) => (
                <tr key={product.id} className="supplier-table__row">
                  <td className="supplier-table__td supplier-table__td--mono">
                    {product.supplierSku ?? <span className="supplier-table__muted">—</span>}
                  </td>
                  <td className="supplier-table__td">
                    {product.supplierDescription ?? (
                      <span className="supplier-table__muted">—</span>
                    )}
                  </td>
                  <td className="supplier-table__td">
                    {product.unitOfMeasure ?? <span className="supplier-table__muted">—</span>}
                  </td>
                  <td className="supplier-table__td supplier-table__td--numeric">
                    {centsToDollars(product.unitCostCents)}
                  </td>
                  <td className="supplier-table__td">
                    <ActiveBadge active={product.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Section: Recent Invoices ───────────────────────────────────────────────────

type RecentInvoicesProps = {
  invoices: SupplierInvoice[];
  isLoading: boolean;
};

function RecentInvoicesSection({ invoices, isLoading }: RecentInvoicesProps) {
  return (
    <section className="status-card supplier-detail__section">
      <h3 className="supplier-detail__section-title">
        Recent Invoices
        {!isLoading && invoices.length > 0 ? (
          <span className="supplier-detail__count">{invoices.length} total</span>
        ) : null}
      </h3>

      {isLoading ? (
        <p className="loading-message">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <div className="supplier-empty">
          <p className="supplier-empty__title">No invoices found</p>
          <p className="supplier-empty__hint">
            Supplier invoices uploaded via OCR will appear here once confirmed.
          </p>
        </div>
      ) : (
        <div className="supplier-table-wrap">
          <table className="supplier-table">
            <thead>
              <tr>
                <th className="supplier-table__th">Invoice #</th>
                <th className="supplier-table__th">Invoice Date</th>
                <th className="supplier-table__th">Status</th>
                <th className="supplier-table__th supplier-table__th--numeric">Total</th>
                <th className="supplier-table__th">Uploaded By</th>
                <th className="supplier-table__th">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="supplier-table__row">
                  <td className="supplier-table__td supplier-table__td--mono">
                    {inv.invoiceNumber ?? (
                      <span className="supplier-table__muted">No number</span>
                    )}
                  </td>
                  <td className="supplier-table__td">{formatDate(inv.invoiceDate)}</td>
                  <td className="supplier-table__td">
                    <InvoiceStatusBadge status={inv.status} />
                  </td>
                  <td className="supplier-table__td supplier-table__td--numeric">
                    {inv.totalCents !== null ? centsToDollars(inv.totalCents) : "—"}
                  </td>
                  <td className="supplier-table__td">{inv.importedByEmail}</td>
                  <td className="supplier-table__td">{formatDate(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Section: Current Price Records ─────────────────────────────────────────────

function PriceRecordsSection() {
  // TODO: Price history chart and records will be implemented in a future sprint.
  // The backend endpoint GET /api/v1/suppliers/:supplierId/catalogue returns
  // current pricing. Historical pricing via supplier_price_history is available
  // but a dedicated frontend chart/table is out of scope for Sprint 1.
  return (
    <section className="status-card supplier-detail__section">
      <h3 className="supplier-detail__section-title">Current Price Records</h3>
      <div className="supplier-empty">
        <p className="supplier-empty__title">Price history coming soon</p>
        <p className="supplier-empty__hint">
          Detailed price change history and trend charts will be available in a future release.
          Current unit costs are shown in the Supplier Products section above.
        </p>
      </div>
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function SupplierDetailPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [catalogue, setCatalogue] = useState<SupplierProduct[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);

  const [isLoadingSupplier, setIsLoadingSupplier] = useState(true);
  const [isLoadingCatalogue, setIsLoadingCatalogue] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);

  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingStatusChange, setIsConfirmingStatusChange] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const loadAll = useCallback(async () => {
    if (!supplierId || !user) {
      setIsLoadingSupplier(false);
      setIsLoadingCatalogue(false);
      setIsLoadingInvoices(false);
      return;
    }

    setIsLoadingSupplier(true);
    setIsLoadingCatalogue(true);
    setIsLoadingInvoices(true);
    setSupplierError(null);

    try {
      const supplierData = await apiClient.getSupplier(supplierId);
      setSupplier(supplierData);
      setIsLoadingSupplier(false);
    } catch (err) {
      setSupplierError(err instanceof Error ? err.message : "Failed to load supplier.");
      setIsLoadingSupplier(false);
      setIsLoadingCatalogue(false);
      setIsLoadingInvoices(false);
      return;
    }

    // Load catalogue and invoices in parallel after supplier is confirmed to exist.
    try {
      const catalogueData = await apiClient.getSupplierCatalogue(supplierId);
      setCatalogue(catalogueData);
    } catch {
      setCatalogue([]);
    } finally {
      setIsLoadingCatalogue(false);
    }

    try {
      const invoiceData = await apiClient.listClinicSupplierInvoices(user.homeClinicId, {
        supplierId,
        limit: 50,
      });
      setInvoices(invoiceData);
    } catch {
      setInvoices([]);
    } finally {
      setIsLoadingInvoices(false);
    }
  }, [supplierId, user]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (!user) return null;

  const canManage = canManageSuppliers(user.role);

  function handleSupplierUpdated(updated: Supplier): void {
    setSupplier(updated);
    setIsEditing(false);
  }

  function handleUploadSuccess(result: UploadAndExtractResult): void {
    void navigate(`/invoice-review/${result.invoice.id}`, {
      state: {
        uploadResult: result,
        backPath: supplierId ? `/suppliers/${supplierId}` : "/suppliers",
      },
    });
  }

  async function handleToggleStatus(): Promise<void> {
    if (!supplier) return;
    const updated = await apiClient.updateSupplier(supplier.id, {
      active: !supplier.active,
    });
    setSupplier(updated);
    setIsConfirmingStatusChange(false);
  }

  return (
    <AppShell>
      <div className="supplier-detail">
        <div className="supplier-detail__back">
          <Link to="/suppliers" className="supplier-detail__back-link">
            ← Back to Suppliers
          </Link>
        </div>

        <div className="supplier-detail__heading">
          <h2>
            {isLoadingSupplier
              ? "Loading supplier…"
              : (supplier?.supplierName ?? "Supplier")}
          </h2>
          {supplier ? <ActiveBadge active={supplier.active} /> : null}
        </div>

        {supplier && canManage ? (
          <div className="supplier-detail__actions">
            <button
              type="button"
              className="supplier-edit-btn"
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Edit Supplier
            </button>
            <button
              type="button"
              className="supplier-toggle-btn supplier-toggle-btn--activate"
              onClick={() => {
                setShowUploadModal(true);
              }}
            >
              Upload Invoice
            </button>
            <button
              type="button"
              className={`supplier-toggle-btn supplier-toggle-btn--${supplier.active ? "deactivate" : "activate"}`}
              onClick={() => {
                setIsConfirmingStatusChange(true);
              }}
            >
              {supplier.active ? "Deactivate Supplier" : "Reactivate Supplier"}
            </button>
          </div>
        ) : null}

        {supplierError ? (
          <p className="status-card__error" role="alert">
            {supplierError}
          </p>
        ) : isLoadingSupplier ? (
          <p className="loading-message">Loading supplier details…</p>
        ) : supplier ? (
          <>
            <SupplierOverview supplier={supplier} />
            <SupplierProductsSection
              catalogue={catalogue}
              isLoading={isLoadingCatalogue}
            />
            <RecentInvoicesSection invoices={invoices} isLoading={isLoadingInvoices} />
            <PriceRecordsSection />
          </>
        ) : null}
      </div>

      {isEditing && supplier ? (
        <EditSupplierModal
          key={supplier.id}
          supplier={supplier}
          onClose={() => {
            setIsEditing(false);
          }}
          onSaved={handleSupplierUpdated}
        />
      ) : null}

      {isConfirmingStatusChange && supplier ? (
        <ConfirmModal
          title={supplier.active ? "Deactivate Supplier" : "Reactivate Supplier"}
          message={
            supplier.active
              ? `Deactivate "${supplier.supplierName}"? It will be hidden from active supplier lists but all historical data will be retained.`
              : `Reactivate "${supplier.supplierName}"? It will become visible in active supplier lists again.`
          }
          confirmLabel={supplier.active ? "Yes, Deactivate" : "Yes, Reactivate"}
          confirmVariant={supplier.active ? "warning" : "danger"}
          onClose={() => {
            setIsConfirmingStatusChange(false);
          }}
          onConfirm={handleToggleStatus}
        />
      ) : null}

      {showUploadModal ? (
        <UploadInvoiceModal
          clinicId={user.homeClinicId}
          suppliers={[supplier]}
          defaultSupplierId={supplier.id}
          onClose={() => {
            setShowUploadModal(false);
          }}
          onUploadSuccess={handleUploadSuccess}
        />
      ) : null}
    </AppShell>
  );
}
