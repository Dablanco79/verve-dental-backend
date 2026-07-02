import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { Supplier, SupplierInvoice, SupplierInvoiceLine } from "../types/supplier.js";
import { canManageProducts, canManageSuppliers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

function centsToDollars(cents: number | null): string {
  if (cents === null) return "Not available yet";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatUploadDate(value: string | null | undefined): string {
  if (!value) return "Not available yet";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInvoiceStatus(invoice: SupplierInvoice | null): string {
  if (!invoice) return "Not available yet";
  if (invoice.status === "pending_review") return "Review Required";
  if (invoice.status === "confirmed") return "Imported";
  return "Failed";
}

function formatMatchStatus(line: SupplierInvoiceLine): string {
  if (!line.isMatched) return "Review Required";
  if (line.matchMethod === "exact_sku") return "Matched by SKU";
  if (line.matchMethod === "name_match") return "Possible name match";
  if (line.matchMethod === "manual") return "Matched manually";
  return "Matched";
}

function formatTax(line: SupplierInvoiceLine): string {
  const rate = `${(line.taxRateBasisPoints / 100).toFixed(2)}%`;
  return `${centsToDollars(line.taxCents)} (${rate})`;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="po-summary__stat catalogue-review__metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function CatalogueImportReviewPage() {
  const { importId } = useParams<{ importId: string }>();
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const clinicId = selectedClinic?.id ?? user?.homeClinicId;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const canUseCatalogueImport = user
    ? canManageProducts(user.role) || canManageSuppliers(user.role)
    : false;

  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const matchedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === invoice?.supplierId) ?? null,
    [invoice?.supplierId, suppliers],
  );
  const matchedLines = lines.filter((line) => line.isMatched).length;
  const hasLineData = lines.length > 0;
  const canConfirmImport =
    !!invoice &&
    invoice.status === "pending_review" &&
    hasLineData &&
    lines.every((line) => line.isMatched);
  const importDisabledReason = canConfirmImport
    ? null
    : "Import confirmation will be available after matching rules are completed.";

  const loadReview = useCallback(async () => {
    if (!user || !canUseCatalogueImport || !clinicId || isAllClinicsScope || !importId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const [supplierList, importData] = await Promise.all([
        apiClient.listSuppliers({ active: true }),
        apiClient.getSupplierInvoice(clinicId, importId),
      ]);
      setSuppliers(supplierList);
      setInvoice(importData.invoice);
      setLines(importData.lines);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Catalogue import review could not be loaded.");
      setInvoice(null);
      setLines([]);
      setSuppliers([]);
    } finally {
      setIsLoading(false);
    }
  }, [canUseCatalogueImport, clinicId, importId, isAllClinicsScope, user]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  async function handleImportCatalogue(): Promise<void> {
    if (!invoice || !clinicId || !canConfirmImport) return;

    setIsImporting(true);
    setImportError(null);
    setImportMessage(null);
    try {
      const result = await apiClient.confirmSupplierInvoice(clinicId, invoice.id);
      setInvoice(result.invoice);
      setImportMessage(`Catalogue imported. ${String(result.priceUpdates)} price updates applied.`);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Catalogue import could not be confirmed.");
    } finally {
      setIsImporting(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell>
      <div className="catalogue-review">
        <div className="supplier-detail__back">
          <Link to="/inventory/catalogue-import" className="supplier-detail__back-link">
            Back to Catalogue Import
          </Link>
        </div>

        <section className="status-card catalogue-review__hero">
          <p className="catalogue-import-page__eyebrow">Inventory / Catalogue Import / Review</p>
          <div className="status-card__header catalogue-import-page__header">
            <div>
              <h2>{invoice?.originalFilename ?? "Catalogue Review"}</h2>
              <p className="inventory-page__subtitle">
                Review supplier, product, price, and pack-size data before committing catalogue knowledge.
              </p>
            </div>
            <span className={`catalogue-status catalogue-status--${formatInvoiceStatus(invoice).toLowerCase().replace(/\s+/g, "-")}`}>
              {formatInvoiceStatus(invoice)}
            </span>
          </div>

          <dl className="invoice-review__summary-grid catalogue-review__header-grid">
            <div className="invoice-review__summary-item">
              <dt>File name</dt>
              <dd>{invoice?.originalFilename ?? "Not available yet"}</dd>
            </div>
            <div className="invoice-review__summary-item">
              <dt>Supplier recognition</dt>
              <dd>
                {matchedSupplier
                  ? `Matched supplier: ${matchedSupplier.supplierName}`
                  : invoice?.supplierNameRaw
                    ? `Detected supplier: ${invoice.supplierNameRaw}`
                    : "Not recognised"}
              </dd>
            </div>
            <div className="invoice-review__summary-item">
              <dt>Upload date</dt>
              <dd>{formatUploadDate(invoice?.createdAt)}</dd>
            </div>
            <div className="invoice-review__summary-item">
              <dt>Import status</dt>
              <dd>{formatInvoiceStatus(invoice)}</dd>
            </div>
          </dl>
        </section>

        <div className="inventory-receiving-callout catalogue-review__safety" role="status">
          <h3>Catalogue Import does not change stock quantities.</h3>
          <p>No stock adjustments, receive scans, or receiving timeline events are created by this workflow.</p>
        </div>

        {!canUseCatalogueImport ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Catalogue review is restricted</h3>
            <p>You need product or supplier management access to review catalogue imports.</p>
          </div>
        ) : null}

        {isAllClinicsScope ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Select a clinic</h3>
            <p>Catalogue import review is clinic-scoped. Choose a clinic to continue.</p>
          </div>
        ) : null}

        {isLoading ? <p className="loading-message">Loading catalogue import review...</p> : null}
        {loadError ? <p className="status-card__error" role="alert">{loadError}</p> : null}

        {!isLoading && !loadError ? (
          <>
            <section className="status-card supplier-detail__section">
              <h3 className="supplier-detail__section-title">Supplier Review</h3>
              {matchedSupplier ? (
                <div className="catalogue-review__supplier-card">
                  <span className="catalogue-status catalogue-status--imported">Recognised</span>
                  <strong>{matchedSupplier.supplierName}</strong>
                  {matchedSupplier.abn ? <span>ABN: {matchedSupplier.abn}</span> : null}
                </div>
              ) : (
                <div className="catalogue-review__supplier-card">
                  <span className="catalogue-status catalogue-status--review-required">Review Required</span>
                  <strong>{invoice?.supplierNameRaw ?? "No supplier detected"}</strong>
                  <div className="catalogue-review__placeholder-actions">
                    <button type="button" className="link-button" disabled>
                      Match existing supplier - Available in a future release
                    </button>
                    <button type="button" className="link-button" disabled>
                      Create supplier - Available in a future release
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="status-card supplier-detail__section">
              <h3 className="supplier-detail__section-title">Product / Line Review</h3>
              {hasLineData ? (
                <div className="inventory-table-wrap">
                  <table className="inventory-table catalogue-review__lines-table">
                    <thead>
                      <tr>
                        <th>Product / description</th>
                        <th>Supplier SKU</th>
                        <th>Quantity / pack text</th>
                        <th>Unit price</th>
                        <th>GST / tax</th>
                        <th>Total</th>
                        <th>Match status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.ocrDescription ?? "Not available yet"}</td>
                          <td>{line.ocrSku ?? "Not available yet"}</td>
                          <td>{String(line.quantity)}</td>
                          <td>{centsToDollars(line.unitPriceCents)}</td>
                          <td>{formatTax(line)}</td>
                          <td>{centsToDollars(line.lineTotalCents)}</td>
                          <td>{formatMatchStatus(line)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="billing-empty" role="status">
                  <p className="billing-empty__title">No extracted line items are available for review yet.</p>
                  <p className="billing-empty__hint">
                    The current API did not expose extracted catalogue lines for this import.
                  </p>
                </div>
              )}
            </section>

            <section className="status-card supplier-detail__section">
              <div className="status-card__header">
                <div>
                  <h3 className="supplier-detail__section-title">Review Summary</h3>
                  <p className="inventory-page__subtitle">
                    Counts are shown only where current APIs expose the data.
                  </p>
                </div>
              </div>
              <dl className="po-summary__stats catalogue-review__summary-grid">
                <SummaryMetric label="Products detected" value={hasLineData ? String(lines.length) : "Not available yet"} />
                <SummaryMetric label="New products" value="Not available yet" />
                <SummaryMetric label="Possible matches" value={hasLineData ? String(matchedLines) : "Not available yet"} />
                <SummaryMetric label="Price updates" value="Not available yet" />
                <SummaryMetric label="Pack-size changes" value="Not available yet" />
                <SummaryMetric label="Inventory quantity changes" value="0" />
              </dl>
            </section>

            <section className="status-card supplier-detail__section catalogue-review__actions">
              <div>
                <h3 className="supplier-detail__section-title">Import Action</h3>
                <p className="inventory-page__subtitle">
                  Import Catalogue commits catalogue knowledge only. Inventory quantity changes remain 0.
                </p>
              </div>
              {importError ? <p className="status-card__error" role="alert">{importError}</p> : null}
              {importMessage ? <p className="inventory-notice--inline" role="status">{importMessage}</p> : null}
              <button
                type="button"
                className="button-link"
                disabled={!canConfirmImport || isImporting}
                onClick={() => {
                  void handleImportCatalogue();
                }}
              >
                {isImporting ? "Importing..." : "Import Catalogue"}
              </button>
              {importDisabledReason ? (
                <p className="catalogue-import-page__safety-note">{importDisabledReason}</p>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
