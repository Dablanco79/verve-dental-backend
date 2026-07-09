import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { MasterProductSearchModal } from "../components/masterProduct/MasterProductSearchModal.js";
import { ConfirmModal } from "../components/supplier/ConfirmModal.js";
import { loadConfig } from "../config/index.js";
import type { Supplier, SupplierInvoice, SupplierInvoiceLine } from "../types/supplier.js";
import { canManageProducts, canManageSuppliers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());
const REVIEW_SESSION_STORAGE_PREFIX = "verve.catalogueImport.invoiceReview";

type LineReviewState =
  | "Needs Review"
  | "Approved"
  | "Skipped"
  | "Ready to Create"
  | "Matched Existing Product";

type LineEditDraft = {
  description: string;
  supplierSku: string;
  quantity: string;
  unitPriceCents: string;
  taxCents: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function centsToDollars(cents: unknown, unavailableLabel = "Missing"): string {
  if (!isFiniteNumber(cents)) return unavailableLabel;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function centsToDecimalString(cents: unknown): string {
  if (!isFiniteNumber(cents)) return "";
  return (cents / 100).toFixed(2);
}

function calculateUnitGstCents(line: SupplierInvoiceLine): number | null {
  if (!isFiniteNumber(line.taxCents) || !isFiniteNumber(line.quantity) || line.quantity <= 0) {
    return null;
  }
  return Math.round(line.taxCents / line.quantity);
}

function formatUnitGstForEdit(line: SupplierInvoiceLine): string {
  const unitGstCents = calculateUnitGstCents(line);
  return unitGstCents === null ? "" : centsToDecimalString(unitGstCents);
}

function parseCurrencyToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function formatUploadDate(value: string | null | undefined): string {
  if (!value) return "Missing";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInvoiceStatus(invoice: SupplierInvoice | null): string {
  if (!invoice) return "Missing";
  switch (invoice.status) {
    case "uploaded":
      return "Uploaded";
    case "processing":
      return "Processing";
    case "ready_for_review":
    case "pending_review":
      return "Review Required";
    case "imported":
    case "confirmed":
      return "Imported";
    case "cancelled":
      return "Cancelled";
    case "failed":
    case "voided":
      return "Failed";
  }
}

function formatMatchStatus(line: SupplierInvoiceLine): string {
  if (!line.isMatched) return "Needs Review";
  if (line.matchMethod === "exact_sku") return "Matched by SKU";
  if (line.matchMethod === "name_match") return "Possible name match";
  if (line.matchMethod === "manual") return "Matched manually";
  return "Matched";
}

function formatTax(line: SupplierInvoiceLine): string {
  if (!isFiniteNumber(line.taxCents)) return "Missing";
  const rate = isFiniteNumber(line.taxRateBasisPoints)
    ? ` (${(line.taxRateBasisPoints / 100).toFixed(2)}%)`
    : "";
  return `${centsToDollars(line.taxCents, "Missing")}${rate}`;
}

function formatUnitGst(line: SupplierInvoiceLine): string {
  const unitGstCents = calculateUnitGstCents(line);
  return unitGstCents === null ? "Unable to normalise" : centsToDollars(unitGstCents, "Missing");
}

function calculateLineTotalCents(line: SupplierInvoiceLine): number | null {
  if (isFiniteNumber(line.lineTotalCents)) return line.lineTotalCents;
  if (!isFiniteNumber(line.quantity) || !isFiniteNumber(line.unitPriceCents)) return null;

  const baseTotal = line.quantity * line.unitPriceCents;
  const tax = isFiniteNumber(line.taxCents) ? line.taxCents : 0;
  const total = baseTotal + tax;
  return Number.isFinite(total) ? Math.round(total) : null;
}

function formatLineTotal(line: SupplierInvoiceLine): string {
  const total = calculateLineTotalCents(line);
  return total === null ? "Missing" : centsToDollars(total, "Missing");
}

function initialReviewStateForLine(line: SupplierInvoiceLine): LineReviewState {
  return line.isMatched ? "Matched Existing Product" : "Needs Review";
}

function isImportReadyState(state: LineReviewState): boolean {
  return (
    state === "Approved" ||
    state === "Skipped" ||
    state === "Ready to Create" ||
    state === "Matched Existing Product"
  );
}

function buildEditDraft(line: SupplierInvoiceLine): LineEditDraft {
  return {
    description: line.ocrDescription ?? "",
    supplierSku: line.ocrSku ?? "",
    quantity: isFiniteNumber(line.quantity) ? String(line.quantity) : "",
    unitPriceCents: centsToDecimalString(line.unitPriceCents),
    taxCents: formatUnitGstForEdit(line),
  };
}

function applyDraftToLine(line: SupplierInvoiceLine, draft: LineEditDraft): SupplierInvoiceLine {
  const quantity = Number(draft.quantity);
  const unitPriceCents = parseCurrencyToCents(draft.unitPriceCents);
  const unitGstCents = parseCurrencyToCents(draft.taxCents);
  const hasQuantity = Number.isFinite(quantity);
  const hasUnitPrice = unitPriceCents !== null;
  const hasUnitGst = unitGstCents !== null;
  const originalUnitGst = formatUnitGstForEdit(line);
  const quantityChanged = hasQuantity && quantity !== line.quantity;
  const taxCents =
    hasQuantity && hasUnitGst
      ? draft.taxCents === originalUnitGst && !quantityChanged
        ? line.taxCents
        : Math.round(unitGstCents * quantity)
      : line.taxCents;
  const recalculatedTotal = hasQuantity && hasUnitPrice
    ? Math.round(quantity * unitPriceCents + taxCents)
    : line.lineTotalCents;

  return {
    ...line,
    ocrDescription: draft.description.trim() || null,
    ocrSku: draft.supplierSku.trim() || null,
    quantity: hasQuantity ? quantity : line.quantity,
    unitPriceCents: hasUnitPrice ? unitPriceCents : line.unitPriceCents,
    taxCents,
    lineTotalCents: recalculatedTotal,
  };
}

function calculateTaxRateBasisPoints(quantity: number, unitPriceCents: number, taxCents: number): number {
  const subtotalCents = quantity * unitPriceCents;
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return Math.max(0, Math.min(10_000, Math.round((taxCents * 10_000) / subtotalCents)));
}

function getReviewSessionStorageKey(clinicId: string, userId: string, importId: string): string {
  return `${REVIEW_SESSION_STORAGE_PREFIX}.${clinicId}.${userId}.${importId}`;
}

function readPersistedLineReviewStates(
  clinicId: string,
  userId: string,
  importId: string,
): Record<string, LineReviewState> | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(getReviewSessionStorageKey(clinicId, userId, importId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; lineReviewStates?: Record<string, LineReviewState> };
    if (parsed.version !== 1 || !parsed.lineReviewStates) return null;
    return parsed.lineReviewStates;
  } catch {
    return null;
  }
}

function persistLineReviewStates(
  clinicId: string | undefined,
  userId: string | undefined,
  importId: string | undefined,
  lineReviewStates: Record<string, LineReviewState>,
): void {
  if (!clinicId || !userId || !importId || typeof window === "undefined") return;
  window.localStorage.setItem(
    getReviewSessionStorageKey(clinicId, userId, importId),
    JSON.stringify({ version: 1, lineReviewStates }),
  );
}

function clearPersistedLineReviewStates(
  clinicId: string | undefined,
  userId: string | undefined,
  importId: string | undefined,
): void {
  if (!clinicId || !userId || !importId || typeof window === "undefined") return;
  window.localStorage.removeItem(getReviewSessionStorageKey(clinicId, userId, importId));
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
  const navigate = useNavigate();
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [lineReviewStates, setLineReviewStates] = useState<Record<string, LineReviewState>>({});
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LineEditDraft | null>(null);
  // Product Matching Engine: display names for manually-matched lines (lineId → displayName)
  const [lineMatchDisplayNames, setLineMatchDisplayNames] = useState<Record<string, string>>({});
  const [matchSearchTargetLineId, setMatchSearchTargetLineId] = useState<string | null>(null);
  // Tracks lines whose masterCatalogItemId PATCH is in-flight; blocks Import button
  const [linkingLineId, setLinkingLineId] = useState<string | null>(null);

  const matchedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === invoice?.supplierId) ?? null,
    [invoice?.supplierId, suppliers],
  );
  const hasLineData = lines.length > 0;
  const reviewStates = useMemo(
    () => lines.map((line) => lineReviewStates[line.id] ?? initialReviewStateForLine(line)),
    [lineReviewStates, lines],
  );
  const matchedLineCount = reviewStates.filter((state) => state === "Matched Existing Product").length;
  const approvedLines = reviewStates.filter((state) => state === "Approved" || state === "Matched Existing Product").length;
  const skippedLines = reviewStates.filter((state) => state === "Skipped").length;
  const stillRequiringReview = reviewStates.filter((state) => !isImportReadyState(state)).length;
  const hasOnlySafelyImportableStates = reviewStates.every(
    (state) => isImportReadyState(state),
  );
  const canConfirmImport =
    !!invoice &&
    invoice.status === "pending_review" &&
    hasLineData &&
    stillRequiringReview === 0 &&
    hasOnlySafelyImportableStates &&
    linkingLineId === null;
  const canCancelImport =
    !!invoice &&
    (invoice.status === "uploaded" ||
      invoice.status === "processing" ||
      invoice.status === "ready_for_review" ||
      invoice.status === "pending_review");
  const importDisabledReason = canConfirmImport
    ? null
    : "Import Reviewed Products becomes available after every row is Approved, Skipped, Matched, or Ready to Create.";

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
      const initialStates = Object.fromEntries(
        importData.lines.map((line) => [line.id, initialReviewStateForLine(line)]),
      );
      const persistedStates =
        importData.invoice.status === "pending_review"
          ? readPersistedLineReviewStates(clinicId, user.id, importId)
          : null;
      setLineReviewStates({ ...initialStates, ...(persistedStates ?? {}) });
      setEditingLineId(null);
      setEditDraft(null);
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
      const readyToCreateLineIds = lines
        .filter((line) => (lineReviewStates[line.id] ?? initialReviewStateForLine(line)) === "Ready to Create")
        .map((line) => line.id);
      const skippedLineIds = lines
        .filter((line) => (lineReviewStates[line.id] ?? initialReviewStateForLine(line)) === "Skipped")
        .map((line) => line.id);
      const result = await apiClient.confirmSupplierInvoice(clinicId, invoice.id, {
        readyToCreateLineIds,
        skippedLineIds,
      });
      setInvoice(result.invoice);
      setLineReviewStates({});
      clearPersistedLineReviewStates(clinicId, user?.id, invoice.id);
      setImportMessage(
        `Catalogue imported. ${String(result.createdProducts)} products created and ${String(result.priceUpdates)} price updates applied.`,
      );
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Catalogue import could not be confirmed.");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleCancelImport(): Promise<void> {
    if (!invoice || !clinicId || !canCancelImport) return;

    setIsCancelling(true);
    setImportError(null);
    try {
      await apiClient.cancelSupplierInvoiceImport(clinicId, invoice.id);
      clearPersistedLineReviewStates(clinicId, user?.id, invoice.id);
      setIsCancelModalOpen(false);
      void navigate("/inventory/catalogue-import", {
        state: { toast: "Import cancelled." },
      });
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Catalogue import could not be cancelled.");
      setIsCancelling(false);
      throw err;
    }
  }

  function setLineState(lineId: string, state: LineReviewState): void {
    setLineReviewStates((current) => {
      const next = { ...current, [lineId]: state };
      persistLineReviewStates(clinicId, user?.id, importId, next);
      return next;
    });
    if (editingLineId === lineId) {
      setEditingLineId(null);
      setEditDraft(null);
    }
  }

  function startEditingLine(line: SupplierInvoiceLine): void {
    setEditingLineId(line.id);
    setEditDraft(buildEditDraft(line));
  }

  function updateEditDraft(field: keyof LineEditDraft, value: string): void {
    setEditDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveLineEdit(lineId: string): Promise<void> {
    if (!editDraft) return;
    const existingLine = lines.find((line) => line.id === lineId);
    if (!existingLine || !clinicId || !invoice) return;
    const nextLine = applyDraftToLine(existingLine, editDraft);
    const taxRateBasisPoints = calculateTaxRateBasisPoints(
      nextLine.quantity,
      nextLine.unitPriceCents,
      nextLine.taxCents,
    );
    const persisted = await apiClient.updateSupplierInvoiceLine(clinicId, invoice.id, lineId, {
      ocrDescription: nextLine.ocrDescription ?? "",
      ocrSku: nextLine.ocrSku,
      quantity: nextLine.quantity,
      unitPriceCents: nextLine.unitPriceCents,
      taxRateBasisPoints,
    });
    setLines((current) => current.map((line) => (line.id === lineId ? persisted : line)));
    setEditingLineId(null);
    setEditDraft(null);
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
              <dd>{invoice?.originalFilename ?? "Missing"}</dd>
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
                        <th>Line GST from source</th>
                        <th>Total</th>
                        <th>Match status</th>
                        <th>Review state</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const reviewState = lineReviewStates[line.id] ?? initialReviewStateForLine(line);
                        const isEditing = editingLineId === line.id && editDraft;

                        return (
                          <tr key={line.id}>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={editDraft.description}
                                  onChange={(event) => {
                                    updateEditDraft("description", event.target.value);
                                  }}
                                  aria-label={`Description for line ${String(line.lineNumber)}`}
                                />
                              ) : (
                                line.ocrDescription ?? "Missing"
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={editDraft.supplierSku}
                                  onChange={(event) => {
                                    updateEditDraft("supplierSku", event.target.value);
                                  }}
                                  aria-label={`Supplier SKU for line ${String(line.lineNumber)}`}
                                />
                              ) : (
                                line.ocrSku ?? "Missing"
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input catalogue-review__edit-input--numeric"
                                  value={editDraft.quantity}
                                  onChange={(event) => {
                                    updateEditDraft("quantity", event.target.value);
                                  }}
                                  aria-label={`Quantity for line ${String(line.lineNumber)}`}
                                />
                              ) : isFiniteNumber(line.quantity) ? (
                                String(line.quantity)
                              ) : (
                                "Missing"
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input catalogue-review__edit-input--numeric"
                                  value={editDraft.unitPriceCents}
                                  onChange={(event) => {
                                    updateEditDraft("unitPriceCents", event.target.value);
                                  }}
                                  aria-label={`Unit price for line ${String(line.lineNumber)}`}
                                />
                              ) : (
                                centsToDollars(line.unitPriceCents, "Missing")
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <>
                                  <input
                                    className="catalogue-review__edit-input catalogue-review__edit-input--numeric"
                                    value={editDraft.taxCents}
                                    onChange={(event) => {
                                      updateEditDraft("taxCents", event.target.value);
                                    }}
                                    aria-label={`Unit GST for line ${String(line.lineNumber)}`}
                                  />
                                  <span className="catalogue-review__future-note">
                                    Line GST from source: {formatTax(line)}
                                  </span>
                                  {editDraft.taxCents ? null : (
                                    <span className="catalogue-review__future-note">
                                      Unable to normalise Unit GST because quantity is invalid.
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span>{formatTax(line)}</span>
                                  <span className="catalogue-review__future-note">
                                    Unit GST for catalogue: {formatUnitGst(line)}
                                  </span>
                                </>
                              )}
                            </td>
                            <td>{formatLineTotal(line)}</td>
                            <td>{formatMatchStatus(line)}</td>
                            <td>
                              {linkingLineId === line.id ? (
                                <span className="catalogue-line-state catalogue-line-state--needs-review" role="status" aria-label="Linking product…">
                                  Linking…
                                </span>
                              ) : (
                                <>
                                  <span className={`catalogue-line-state catalogue-line-state--${reviewState.toLowerCase().replace(/\s+/g, "-")}`}>
                                    {reviewState}
                                  </span>
                                  {reviewState === "Matched Existing Product" && lineMatchDisplayNames[line.id] ? (
                                    <span className="catalogue-review__future-note">
                                      {lineMatchDisplayNames[line.id]}
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td>
                              <div className="catalogue-review__line-actions">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => {
                                        void saveLineEdit(line.id);
                                      }}
                                    >
                                      Save edit
                                    </button>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => {
                                        setEditingLineId(null);
                                        setEditDraft(null);
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  reviewState === "Ready to Create" ? (
                                    <>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          startEditingLine(line);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          setLineState(line.id, initialReviewStateForLine(line));
                                        }}
                                      >
                                        Undo
                                      </button>
                                      <span className="catalogue-review__future-note">
                                        Creates catalogue product only. Does not change stock.
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          setLineState(line.id, "Approved");
                                        }}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          startEditingLine(line);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          setLineState(line.id, "Skipped");
                                        }}
                                      >
                                        Reject / Skip
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        disabled={linkingLineId !== null}
                                        onClick={() => {
                                          setMatchSearchTargetLineId(line.id);
                                        }}
                                      >
                                        Match existing product
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          setLineState(line.id, "Ready to Create");
                                        }}
                                      >
                                        Create new product
                                      </button>
                                      <span className="catalogue-review__future-note">
                                        Creates catalogue product only. Does not change stock.
                                      </span>
                                    </>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
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
                <SummaryMetric label="Total lines" value={hasLineData ? String(lines.length) : "Missing"} />
                <SummaryMetric label="Approved" value={hasLineData ? String(approvedLines) : "Missing"} />
                <SummaryMetric label="Skipped" value={hasLineData ? String(skippedLines) : "Missing"} />
                <SummaryMetric label="Still requiring review" value={hasLineData ? String(stillRequiringReview) : "Missing"} />
                <SummaryMetric label="Products detected" value={hasLineData ? String(lines.length) : "Missing"} />
                <SummaryMetric label="New products" value="Missing" />
                <SummaryMetric label="Possible matches" value={hasLineData ? String(matchedLineCount) : "Missing"} />
                <SummaryMetric label="Price updates" value="Missing" />
                <SummaryMetric label="Pack-size changes" value="Missing" />
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
              <div className="inventory-page__actions">
                <button
                  type="button"
                  className="link-button catalogue-review__cancel-button"
                  disabled={!canCancelImport || isImporting || isCancelling}
                  onClick={() => {
                    setIsCancelModalOpen(true);
                  }}
                >
                  Cancel Import
                </button>
                <button
                  type="button"
                  className="button-link"
                  disabled={!canConfirmImport || isImporting || isCancelling}
                  onClick={() => {
                    void handleImportCatalogue();
                  }}
                >
                  {isImporting ? "Importing..." : "Import Reviewed Products"}
                </button>
              </div>
              {importDisabledReason ? (
                <p className="catalogue-import-page__safety-note">{importDisabledReason}</p>
              ) : null}
            </section>
          </>
        ) : null}
        {isCancelModalOpen ? (
          <ConfirmModal
            title="Cancel Import?"
            message="This will discard the uploaded invoice and all extracted catalogue review data. No products, pricing or inventory changes will be saved."
            cancelLabel="Keep Reviewing"
            confirmLabel={isCancelling ? "Cancelling..." : "Cancel Import"}
            confirmVariant="danger"
            onClose={() => {
              if (!isCancelling) setIsCancelModalOpen(false);
            }}
            onConfirm={handleCancelImport}
          />
        ) : null}
        <MasterProductSearchModal
          isOpen={matchSearchTargetLineId !== null}
          title="Match Existing Master Product"
          onClose={() => {
            setMatchSearchTargetLineId(null);
          }}
          onSelect={(product) => {
            const targetLineId = matchSearchTargetLineId;
            setMatchSearchTargetLineId(null);
            if (!targetLineId || !invoice || !clinicId) return;

            // Persist the link to the DB first — only update UI state on success.
            setLinkingLineId(targetLineId);
            apiClient
              .updateSupplierInvoiceLine(clinicId, invoice.id, targetLineId, {
                masterCatalogItemId: product.id,
                isMatched: true,
                matchMethod: "manual",
              })
              .then(() => {
                setLineMatchDisplayNames((current) => ({
                  ...current,
                  [targetLineId]: product.displayName,
                }));
                setLineState(targetLineId, "Matched Existing Product");
              })
              .catch((err: unknown) => {
                setImportError(
                  err instanceof Error
                    ? err.message
                    : "Could not link this product. Please try again.",
                );
              })
              .finally(() => {
                setLinkingLineId(null);
              });
          }}
        />
      </div>
    </AppShell>
  );
}
