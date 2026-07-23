import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { ProductCreationReviewModal } from "../components/invoice/ProductCreationReviewModal.js";
import { MasterProductSearchModal } from "../components/masterProduct/MasterProductSearchModal.js";
import { ProductMatchSuggestionCard } from "../components/masterProduct/ProductMatchSuggestionCard.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { loadConfig } from "../config/index.js";
import type { MasterProduct, ProductMatchSuggestion } from "../types/masterProduct.js";
import type {
  ProductCreationData,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  UpdateSupplierInvoiceLineRequest,
  UploadAndExtractResult,
} from "../types/supplier.js";

const apiClient = createApiClient(loadConfig());

// ── Utility helpers ────────────────────────────────────────────────────────────

function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
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

function formatConfidence(confidence: number | null): string | null {
  if (confidence === null) return null;
  return `${String(Math.round(confidence))}% OCR confidence`;
}

// ── Invoice status badge ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<SupplierInvoiceStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready_for_review: "Ready for Review",
  imported: "Imported",
  cancelled: "Cancelled",
  failed: "Failed",
  pending_review: "Pending Review",
  confirmed: "Confirmed",
  voided: "Voided",
};

function InvoiceStatusBadge({ status }: { status: SupplierInvoiceStatus }) {
  return (
    <span className={`supplier-invoice-badge supplier-invoice-badge--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Match badge ────────────────────────────────────────────────────────────────

function MatchBadge({ line }: { line: SupplierInvoiceLine }) {
  if (line.isMatched) {
    const method =
      line.matchMethod === "exact_sku"
        ? "SKU"
        : line.matchMethod === "name_match"
          ? "Name"
          : line.matchMethod === "manual"
            ? "Manual"
            : null;
    return (
      <span className="match-badge match-badge--matched" title={method ? `Matched by ${method}` : undefined}>
        ✓ Matched{method ? ` (${method})` : ""}
      </span>
    );
  }
  return (
    <span className="match-badge match-badge--unmatched">
      Not Matched
    </span>
  );
}

// ── Duplicate warnings ─────────────────────────────────────────────────────────

type DuplicateWarningProps = {
  duplicateFile: UploadAndExtractResult["duplicateFileWarning"];
  duplicateNumber: UploadAndExtractResult["duplicateInvoiceNumberWarning"];
};

function DuplicateWarnings({ duplicateFile, duplicateNumber }: DuplicateWarningProps) {
  if (!duplicateFile && !duplicateNumber) return null;

  return (
    <div className="invoice-review__warnings" role="alert">
      {duplicateFile ? (
        <div className="invoice-review__warning invoice-review__warning--file">
          <strong>Duplicate file detected:</strong> This file was already uploaded on{" "}
          {formatDate(duplicateFile.importedAt)}. The new invoice has been created — review carefully.
        </div>
      ) : null}
      {duplicateNumber ? (
        <div className="invoice-review__warning invoice-review__warning--number">
          <strong>Duplicate invoice number:</strong> An invoice with this number already exists (
          status: {STATUS_LABELS[duplicateNumber.existingStatus]}). Please verify before approving.
        </div>
      ) : null}
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────────

type SummaryCardProps = {
  invoice: SupplierInvoice;
  lineCount: number;
  duplicateFile: UploadAndExtractResult["duplicateFileWarning"];
  duplicateNumber: UploadAndExtractResult["duplicateInvoiceNumberWarning"];
};

function SummaryCard({ invoice, lineCount, duplicateFile, duplicateNumber }: SummaryCardProps) {
  const confidence = formatConfidence(invoice.ocrConfidence);

  return (
    <section className="status-card invoice-review__summary" aria-label="Invoice summary">
      <div className="invoice-review__summary-header">
        <h3 className="supplier-detail__section-title">Invoice Summary</h3>
        <div className="invoice-review__summary-badges">
          <InvoiceStatusBadge status={invoice.status} />
          {confidence ? (
            <span className="ocr-confidence-badge" title="OCR extraction confidence score">
              {confidence}
            </span>
          ) : null}
        </div>
      </div>

      <DuplicateWarnings duplicateFile={duplicateFile} duplicateNumber={duplicateNumber} />

      <dl className="invoice-review__summary-grid">
        <div className="invoice-review__summary-item">
          <dt>Supplier</dt>
          <dd>{invoice.supplierNameRaw ?? "—"}</dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>Invoice Number</dt>
          <dd className="supplier-detail__mono">{invoice.invoiceNumber ?? "—"}</dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>Invoice Date</dt>
          <dd>{formatDate(invoice.invoiceDate)}</dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>Invoice Total</dt>
          <dd>
            {invoice.totalCents !== null ? centsToDollars(invoice.totalCents) : "—"}
          </dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>Line Items</dt>
          <dd>{String(lineCount)}</dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>File</dt>
          <dd className="invoice-review__filename">{invoice.originalFilename}</dd>
        </div>
        <div className="invoice-review__summary-item">
          <dt>Uploaded By</dt>
          <dd>{invoice.importedByEmail}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Editable line row ──────────────────────────────────────────────────────────

type EditDraft = {
  ocrDescription: string;
  quantity: string;
  unitPriceDollars: string;
};

/** Local-only line actions that are tracked in state and passed to confirmImport. */
type LocalLineAction = "ready_to_create" | "skipped";

type LineRowProps = {
  line: SupplierInvoiceLine;
  isEditing: boolean;
  isIgnored: boolean;
  isSaving: boolean;
  editDraft: EditDraft;
  readOnly: boolean;
  onEditStart: (line: SupplierInvoiceLine) => void;
  onEditChange: (field: keyof EditDraft, value: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onIgnoreToggle: (lineId: string) => void;
  // ── Product matching ──
  lineSuggestion: ProductMatchSuggestion | null;
  isFetchingSuggestion: boolean;
  isLinking: boolean;
  matchDisplayName: string | null;
  localAction: LocalLineAction | null;
  onFetchSuggestion: () => void;
  onAcceptSuggestion: (suggestion: ProductMatchSuggestion) => void;
  onChooseDifferent: () => void;
  onCreateNew: () => void;
  onSkipLine: () => void;
  onUndoLine: () => void;
};

function LineRow({
  line,
  isEditing,
  isIgnored,
  isSaving,
  editDraft,
  readOnly,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onIgnoreToggle,
  lineSuggestion,
  isFetchingSuggestion,
  isLinking,
  matchDisplayName,
  localAction,
  onFetchSuggestion,
  onAcceptSuggestion,
  onChooseDifferent,
  onCreateNew,
  onSkipLine,
  onUndoLine,
}: LineRowProps) {
  const rawPreviewTotal = isEditing
    ? parseFloat(editDraft.unitPriceDollars || "0") * parseFloat(editDraft.quantity || "0")
    : NaN;
  const previewTotal = Number.isFinite(rawPreviewTotal) ? rawPreviewTotal : null;

  return (
    <tr
      className={[
        "supplier-table__row",
        isIgnored ? "invoice-review__row--ignored" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Description */}
      <td className="supplier-table__td">
        {isEditing ? (
          <input
            type="text"
            className="invoice-review__edit-input"
            value={editDraft.ocrDescription}
            onChange={(e) => { onEditChange("ocrDescription", e.target.value); }}
            placeholder="Description"
            maxLength={512}
            disabled={isSaving}
            aria-label="Line description"
          />
        ) : (
          <span>
            {line.ocrDescription ?? <span className="supplier-table__muted">—</span>}
            {line.ocrSku ? (
              <span className="invoice-review__sku">SKU: {line.ocrSku}</span>
            ) : null}
          </span>
        )}
      </td>

      {/* Match */}
      <td className="supplier-table__td">
        {line.isMatched ? (
          <div className="invoice-review__match-cell">
            <MatchBadge line={line} />
            {matchDisplayName && matchDisplayName !== line.ocrDescription ? (
              <span className="invoice-review__match-name">{matchDisplayName}</span>
            ) : null}
            {!readOnly ? (
              <button
                type="button"
                className="link-button invoice-review__undo-btn"
                onClick={onUndoLine}
                disabled={isLinking}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : localAction === "ready_to_create" ? (
          <div className="invoice-review__match-cell">
            <span className="match-badge match-badge--create">Ready to Create</span>
            {line.productCreationData ? (
              <span className="invoice-review__match-name">{line.productCreationData.productName}</span>
            ) : null}
            <span className="invoice-review__match-note">
              A new catalogue product will be created from this line when confirmed. No stock change.
            </span>
            <button
              type="button"
              className="link-button invoice-review__undo-btn"
              onClick={onUndoLine}
            >
              Undo
            </button>
          </div>
        ) : localAction === "skipped" ? (
          <div className="invoice-review__match-cell">
            <span className="match-badge match-badge--skipped">Skipped</span>
            <button
              type="button"
              className="link-button invoice-review__undo-btn"
              onClick={onUndoLine}
            >
              Undo
            </button>
          </div>
        ) : !readOnly ? (
          <div className="invoice-review__match-cell">
            <MatchBadge line={line} />
            {lineSuggestion ? (
              <ProductMatchSuggestionCard
                suggestion={lineSuggestion}
                onAccept={() => { onAcceptSuggestion(lineSuggestion); }}
                onChooseDifferent={onChooseDifferent}
                onCreateNew={onCreateNew}
                onSkip={onSkipLine}
              />
            ) : (
              <div className="invoice-review__match-actions">
                <button
                  type="button"
                  className="link-button"
                  disabled={isFetchingSuggestion || isLinking}
                  onClick={onFetchSuggestion}
                >
                  {isFetchingSuggestion ? "Finding…" : "Find suggestions"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={isLinking}
                  onClick={onChooseDifferent}
                >
                  Match existing product
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={onCreateNew}
                >
                  Create new product
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={onSkipLine}
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        ) : (
          <MatchBadge line={line} />
        )}
      </td>

      {/* Qty */}
      <td className="supplier-table__td supplier-table__td--numeric">
        {isEditing ? (
          <input
            type="number"
            className="invoice-review__edit-input invoice-review__edit-input--numeric"
            value={editDraft.quantity}
            onChange={(e) => { onEditChange("quantity", e.target.value); }}
            min="0"
            step="1"
            disabled={isSaving}
            aria-label="Quantity"
          />
        ) : (
          String(line.quantity)
        )}
      </td>

      {/* Unit Price */}
      <td className="supplier-table__td supplier-table__td--numeric">
        {isEditing ? (
          <input
            type="number"
            className="invoice-review__edit-input invoice-review__edit-input--numeric"
            value={editDraft.unitPriceDollars}
            onChange={(e) => { onEditChange("unitPriceDollars", e.target.value); }}
            min="0"
            step="0.01"
            disabled={isSaving}
            aria-label="Unit price"
          />
        ) : (
          <span>
            {centsToDollars(line.unitPriceCents)}
            {line.unitPriceCents === 0 ? (
              <span
                className="match-badge match-badge--free"
                title="Zero-price / free item — can still be received at $0.00"
                style={{ marginLeft: "0.4rem", verticalAlign: "middle" }}
              >
                Free
              </span>
            ) : null}
          </span>
        )}
      </td>

      {/* Line Total */}
      <td className="supplier-table__td supplier-table__td--numeric">
        {isEditing && previewTotal !== null ? (
          <span className="invoice-review__preview-total">
            {centsToDollars(Math.round(previewTotal * 100))}
          </span>
        ) : (
          centsToDollars(line.lineTotalCents)
        )}
      </td>

      {/* Actions */}
      {!readOnly ? (
        <td className="supplier-table__td supplier-table__td--action">
          {isEditing ? (
            <div className="supplier-table__row-actions">
              <button
                type="button"
                className="supplier-form__submit invoice-review__save-btn"
                onClick={onEditSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="supplier-form__cancel invoice-review__cancel-btn"
                onClick={onEditCancel}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="supplier-table__row-actions">
              <button
                type="button"
                className="supplier-edit-btn"
                onClick={() => { onEditStart(line); }}
              >
                Edit
              </button>
              <button
                type="button"
                className={`supplier-toggle-btn ${isIgnored ? "supplier-toggle-btn--activate" : "invoice-review__ignore-btn"}`}
                onClick={() => { onIgnoreToggle(line.id); }}
                title={isIgnored ? "Show this line" : "Ignore this line (display-only — does not affect import)"}
              >
                {isIgnored ? "Show" : "Ignore"}
              </button>
            </div>
          )}
        </td>
      ) : null}
    </tr>
  );
}

// ── Lines table ────────────────────────────────────────────────────────────────

type LinesTableProps = {
  lines: SupplierInvoiceLine[];
  editingLineId: string | null;
  editDraft: EditDraft;
  savingLineId: string | null;
  ignoredLineIds: Set<string>;
  readOnly: boolean;
  onEditStart: (line: SupplierInvoiceLine) => void;
  onEditChange: (field: keyof EditDraft, value: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onIgnoreToggle: (lineId: string) => void;
  // ── Product matching ──
  lineSuggestions: Record<string, ProductMatchSuggestion | null>;
  fetchingSuggestionForLine: string | null;
  linkingLineId: string | null;
  lineMatchDisplayNames: Record<string, string>;
  localLineActions: Record<string, LocalLineAction>;
  onFetchSuggestion: (lineId: string) => void;
  onAcceptSuggestion: (lineId: string, suggestion: ProductMatchSuggestion) => void;
  onChooseDifferent: (lineId: string) => void;
  onCreateNew: (lineId: string) => void;
  onSkipLine: (lineId: string) => void;
  onUndoLine: (lineId: string) => void;
};

function LinesTable({
  lines,
  editingLineId,
  editDraft,
  savingLineId,
  ignoredLineIds,
  readOnly,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onIgnoreToggle,
  lineSuggestions,
  fetchingSuggestionForLine,
  linkingLineId,
  lineMatchDisplayNames,
  localLineActions,
  onFetchSuggestion,
  onAcceptSuggestion,
  onChooseDifferent,
  onCreateNew,
  onSkipLine,
  onUndoLine,
}: LinesTableProps) {
  if (lines.length === 0) {
    return (
      <div className="supplier-empty">
        <p className="supplier-empty__title">No line items extracted</p>
        <p className="supplier-empty__hint">
          The OCR process did not extract any line items from this document. You can still approve
          the invoice header information above.
        </p>
      </div>
    );
  }

  const activeLines = lines.filter((l) => !ignoredLineIds.has(l.id));
  const subtotal = activeLines.reduce(
    (sum, l) => sum + (Number.isFinite(l.lineTotalCents) ? l.lineTotalCents : 0),
    0,
  );

  return (
    <div className="supplier-table-wrap">
      <table className="supplier-table invoice-review__table">
        <thead>
          <tr>
            <th className="supplier-table__th">Product / Description</th>
            <th className="supplier-table__th">Match</th>
            <th className="supplier-table__th supplier-table__th--numeric">Qty</th>
            <th className="supplier-table__th supplier-table__th--numeric">Unit Price</th>
            <th className="supplier-table__th supplier-table__th--numeric">Line Total</th>
            {!readOnly ? (
              <th className="supplier-table__th supplier-table__th--action">Actions</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              isEditing={editingLineId === line.id}
              isIgnored={ignoredLineIds.has(line.id)}
              isSaving={savingLineId === line.id}
              editDraft={editDraft}
              readOnly={readOnly}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditSave={onEditSave}
              onEditCancel={onEditCancel}
              onIgnoreToggle={onIgnoreToggle}
              lineSuggestion={lineSuggestions[line.id] ?? null}
              isFetchingSuggestion={fetchingSuggestionForLine === line.id}
              isLinking={linkingLineId !== null}
              matchDisplayName={lineMatchDisplayNames[line.id] ?? line.masterProductName ?? null}
              localAction={localLineActions[line.id] ?? null}
              onFetchSuggestion={() => { onFetchSuggestion(line.id); }}
              onAcceptSuggestion={(s) => { onAcceptSuggestion(line.id, s); }}
              onChooseDifferent={() => { onChooseDifferent(line.id); }}
              onCreateNew={() => { onCreateNew(line.id); }}
              onSkipLine={() => { onSkipLine(line.id); }}
              onUndoLine={() => { onUndoLine(line.id); }}
            />
          ))}
        </tbody>
        {lines.length > 1 ? (
          <tfoot>
            <tr className="invoice-review__subtotal-row">
              <td
                className="supplier-table__td invoice-review__subtotal-label"
                colSpan={readOnly ? 4 : 4}
              >
                Visible lines subtotal
              </td>
              <td className="supplier-table__td supplier-table__td--numeric invoice-review__subtotal-value">
                {centsToDollars(subtotal)}
              </td>
              {!readOnly ? <td className="supplier-table__td" /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// ── Confirm void dialog ────────────────────────────────────────────────────────

type VoidConfirmProps = {
  isVoiding: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function VoidConfirmDialog({ isVoiding, onConfirm, onCancel }: VoidConfirmProps) {
  return (
    <div
      className="supplier-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-confirm-title"
    >
      <div className="supplier-modal supplier-modal--confirm">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="void-confirm-title">
            Void Invoice
          </h2>
          <button
            type="button"
            className="supplier-modal__close"
            onClick={onCancel}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <p className="supplier-confirm__message">
          Voiding this invoice is permanent and cannot be undone. Are you sure you want to
          continue?
        </p>
        <div className="supplier-form__actions">
          <button
            type="button"
            className="supplier-form__cancel"
            onClick={onCancel}
            disabled={isVoiding}
          >
            Cancel
          </button>
          <button
            type="button"
            className="supplier-confirm__btn supplier-confirm__btn--warning"
            onClick={onConfirm}
            disabled={isVoiding}
          >
            {isVoiding ? "Voiding…" : "Yes, Void Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type LocationState = {
  uploadResult?: UploadAndExtractResult;
  backPath?: string;
};

export function SupplierInvoiceReviewPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const { clinicId, isAllClinicsScope } = useOperationalClinic();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [duplicateFile, setDuplicateFile] =
    useState<UploadAndExtractResult["duplicateFileWarning"]>(null);
  const [duplicateNumber, setDuplicateNumber] =
    useState<UploadAndExtractResult["duplicateInvoiceNumberWarning"]>(null);

  // Inline editing
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    ocrDescription: "",
    quantity: "1",
    unitPriceDollars: "0.00",
  });
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [lineEditError, setLineEditError] = useState<string | null>(null);

  // Ignored lines (local only — no backend field)
  const [ignoredLineIds, setIgnoredLineIds] = useState<Set<string>>(new Set());

  // ── Product matching state ──────────────────────────────────────────────────
  const [lineSuggestions, setLineSuggestions] = useState<Record<string, ProductMatchSuggestion | null>>({});
  const [fetchingSuggestionForLine, setFetchingSuggestionForLine] = useState<string | null>(null);
  const [linkingLineId, setLinkingLineId] = useState<string | null>(null);
  const [matchSearchTargetLineId, setMatchSearchTargetLineId] = useState<string | null>(null);
  const [lineMatchDisplayNames, setLineMatchDisplayNames] = useState<Record<string, string>>({});
  const [localLineActions, setLocalLineActions] = useState<Record<string, LocalLineAction>>({});
  const [matchError, setMatchError] = useState<string | null>(null);

  // Approve / Void
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Product creation review modal
  const [productCreationTargetLine, setProductCreationTargetLine] = useState<SupplierInvoiceLine | null>(null);
  const [isSavingProductCreation, setIsSavingProductCreation] = useState(false);

  const hasMounted = useRef(false);

  // ── Derived review-state helpers ────────────────────────────────────────────

  /**
   * A line has a valid final decision if it is:
   *   - already matched to a product (is_matched = true), OR
   *   - marked to create a product (localAction = "ready_to_create"), OR
   *   - skipped/excluded (localAction = "skipped"), OR
   *   - in the local ignore set (display-only exclusion counts for completion)
   */
  function lineIsResolved(
    line: SupplierInvoiceLine,
    localActions: Record<string, LocalLineAction>,
    ignored: Set<string>,
  ): boolean {
    if (line.isMatched) return true;
    const action = localActions[line.id];
    if (action === "ready_to_create" || action === "skipped") return true;
    if (ignored.has(line.id)) return true;
    return false;
  }

  const loadInvoice = useCallback(async () => {
    if (!invoiceId || !user) {
      setIsLoading(false);
      return;
    }

    // If the upload result was passed via navigation state, use it directly.
    if (!hasMounted.current && locationState?.uploadResult) {
      hasMounted.current = true;
      const { uploadResult } = locationState;
      setInvoice(uploadResult.invoice);
      setLines(uploadResult.lines);
      setDuplicateFile(uploadResult.duplicateFileWarning);
      setDuplicateNumber(uploadResult.duplicateInvoiceNumberWarning);
      hydrateMatchDisplayNames(uploadResult.lines);
      setIsLoading(false);
      return;
    }
    hasMounted.current = true;

    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await apiClient.getSupplierInvoice(clinicId ?? user.homeClinicId, invoiceId);
      setInvoice(data.invoice);
      setLines(data.lines);
      hydrateMatchDisplayNames(data.lines);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load invoice.");
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId, user, clinicId, locationState]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  if (!user) return null;

  // Operational actions are clinic-specific. Block when "All Clinics" is selected
  // to prevent any operation silently targeting a fallback home clinic.
  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card invoice-review__callout" role="status">
          <h2>Select a clinic to review this invoice</h2>
          <p>
            Invoice review and confirmation are clinic-specific operations. Choose a specific
            clinic from the clinic selector before proceeding.
          </p>
          <Link to="/suppliers" className="button-link">
            Back to Suppliers
          </Link>
        </section>
      </AppShell>
    );
  }

  const isReviewable = (s: string | undefined) =>
    s === "pending_review" || s === "ready_for_review";
  const readOnly = !isReviewable(invoice?.status);
  const backPath = locationState?.backPath ?? "/suppliers";

  // ── Product matching helpers ─────────────────────────────────────────────────

  function hydrateMatchDisplayNames(loadedLines: SupplierInvoiceLine[]): void {
    setLineMatchDisplayNames(
      Object.fromEntries(
        loadedLines
          .filter((l) => l.isMatched && l.masterProductName)
          .map((l) => [l.id, l.masterProductName as string]),
      ),
    );
    // Hydrate persisted review decisions so reloads restore prior decisions.
    const hydratedActions: Record<string, LocalLineAction> = {};
    for (const line of loadedLines) {
      if (line.reviewDecision === "create_product") {
        hydratedActions[line.id] = "ready_to_create";
      } else if (line.reviewDecision === "skip") {
        hydratedActions[line.id] = "skipped";
      }
    }
    setLocalLineActions(hydratedActions);
  }

  async function fetchLineSuggestion(lineId: string): Promise<void> {
    if (!invoice?.supplierId) return;
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    setFetchingSuggestionForLine(lineId);
    try {
      const result = await apiClient.suggestMasterProductMatch({
        supplierId: invoice.supplierId,
        supplierSku: line.ocrSku ?? undefined,
        supplierDescription: line.ocrDescription ?? undefined,
      });
      setLineSuggestions((prev) => ({
        ...prev,
        [lineId]: result.suggestions[0] ?? null,
      }));
    } catch {
      setLineSuggestions((prev) => ({ ...prev, [lineId]: null }));
    } finally {
      setFetchingSuggestionForLine(null);
    }
  }

  async function persistLineMatch(
    lineId: string,
    masterProductId: string,
    displayName: string,
  ): Promise<void> {
    if (!invoice || !user) return;
    const effectiveClinicId = clinicId ?? user.homeClinicId;
    const line = lines.find((l) => l.id === lineId);
    setLinkingLineId(lineId);
    setMatchError(null);
    try {
      const updated = await apiClient.updateSupplierInvoiceLine(
        effectiveClinicId,
        invoice.id,
        lineId,
        { masterCatalogItemId: masterProductId, isMatched: true, matchMethod: "manual" },
      );
      setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setLineMatchDisplayNames((prev) => ({ ...prev, [lineId]: displayName }));
      setLineSuggestions((prev) => {
        const { [lineId]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
      // Write supplier_catalogue mapping immediately so it survives page refresh.
      if (invoice.supplierId) {
        void apiClient.confirmMasterProductMatch({
          supplierId: invoice.supplierId,
          masterProductId,
          supplierSku: line?.ocrSku ?? undefined,
          supplierDescription: line?.ocrDescription ?? undefined,
        });
      }
    } catch (err: unknown) {
      setMatchError(err instanceof Error ? err.message : "Could not link this product.");
    } finally {
      setLinkingLineId(null);
    }
  }

  function handleAcceptSuggestion(lineId: string, suggestion: ProductMatchSuggestion): void {
    void persistLineMatch(lineId, suggestion.masterProductId, suggestion.displayName);
  }

  function handleManualMatchSelect(product: MasterProduct): void {
    if (!matchSearchTargetLineId) return;
    setMatchSearchTargetLineId(null);
    void persistLineMatch(matchSearchTargetLineId, product.id, product.displayName);
  }

  function handleSkipLine(lineId: string): void {
    setLocalLineActions((prev) => ({ ...prev, [lineId]: "skipped" }));
    // Persist to DB so reload restores the decision.
    if (invoice && user) {
      void apiClient
        .updateSupplierInvoiceLine(clinicId ?? user.homeClinicId, invoice.id, lineId, {
          reviewDecision: "skip",
        })
        .then((updated) => {
          setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        })
        .catch(() => undefined);
    }
  }

  function handleCreateNew(lineId: string, data: ProductCreationData): void {
    setLocalLineActions((prev) => ({ ...prev, [lineId]: "ready_to_create" }));
    setProductCreationTargetLine(null);
    // Persist to DB so reload restores the decision — include reviewed product data.
    if (invoice && user) {
      setIsSavingProductCreation(true);
      void apiClient
        .updateSupplierInvoiceLine(clinicId ?? user.homeClinicId, invoice.id, lineId, {
          reviewDecision: "create_product",
          productCreationData: data,
        })
        .then((updated) => {
          setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        })
        .catch(() => undefined)
        .finally(() => { setIsSavingProductCreation(false); });
    }
  }

  function handleUndoLine(lineId: string): void {
    if (!user) return;
    setLocalLineActions((prev) => {
      const { [lineId]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    const line = lines.find((l) => l.id === lineId);
    const effectiveClinicId = clinicId ?? user.homeClinicId;

    // Clear the persisted decision (whether it was skip or create_product).
    if (invoice && (line?.reviewDecision === "skip" || line?.reviewDecision === "create_product")) {
      setLinkingLineId(lineId);
      apiClient
        .updateSupplierInvoiceLine(effectiveClinicId, invoice.id, lineId, {
          reviewDecision: null,
        })
        .then((updated) => {
          setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        })
        .catch(() => undefined)
        .finally(() => {
          setLinkingLineId(null);
        });
      return;
    }

    // If the line is already matched in the DB, PATCH it back to unmatched.
    if (line?.isMatched && invoice) {
      setLinkingLineId(lineId);
      apiClient
        .updateSupplierInvoiceLine(effectiveClinicId, invoice.id, lineId, {
          masterCatalogItemId: null,
          isMatched: false,
          matchMethod: null,
        })
        .then((updated) => {
          setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
          setLineMatchDisplayNames((prev) => {
            const { [lineId]: _removed, ...rest } = prev;
            void _removed;
            return rest;
          });
        })
        .catch((err: unknown) => {
          setMatchError(err instanceof Error ? err.message : "Could not undo match.");
        })
        .finally(() => {
          setLinkingLineId(null);
        });
    }
  }

  // ── Editing handlers ────────────────────────────────────────────────────────

  function handleEditStart(line: SupplierInvoiceLine): void {
    setEditingLineId(line.id);
    setEditDraft({
      ocrDescription: line.ocrDescription ?? "",
      quantity: String(line.quantity),
      unitPriceDollars: (line.unitPriceCents / 100).toFixed(2),
    });
    setLineEditError(null);
  }

  function handleEditChange(field: keyof EditDraft, value: string): void {
    setEditDraft((prev) => ({ ...prev, [field]: value }));
  }

  function handleEditCancel(): void {
    setEditingLineId(null);
    setLineEditError(null);
  }

  async function handleEditSave(): Promise<void> {
    if (!editingLineId || !invoice || !user) return;

    const qty = parseFloat(editDraft.quantity);
    const unitPrice = parseFloat(editDraft.unitPriceDollars);

    if (isNaN(qty) || qty < 0) {
      setLineEditError("Quantity must be a valid non-negative number.");
      return;
    }
    if (isNaN(unitPrice) || unitPrice < 0) {
      setLineEditError("Unit price must be a valid non-negative number.");
      return;
    }

    const body: UpdateSupplierInvoiceLineRequest = {
      ocrDescription: editDraft.ocrDescription.trim() || undefined,
      quantity: qty,
      unitPriceCents: Math.round(unitPrice * 100),
    };

    setSavingLineId(editingLineId);
    setLineEditError(null);

    try {
      const updated = await apiClient.updateSupplierInvoiceLine(
        clinicId ?? user.homeClinicId,
        invoice.id,
        editingLineId,
        body,
      );
      setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setEditingLineId(null);
    } catch (err) {
      setLineEditError(err instanceof Error ? err.message : "Failed to save line.");
    } finally {
      setSavingLineId(null);
    }
  }

  function handleIgnoreToggle(lineId: string): void {
    setIgnoredLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  }

  // ── Approve handler ─────────────────────────────────────────────────────────

  async function handleApprove(): Promise<void> {
    if (!invoice || !user) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const readyToCreateLineIds = lines
        .filter((l) => localLineActions[l.id] === "ready_to_create")
        .map((l) => l.id);
      const skippedLineIds = lines
        .filter((l) => localLineActions[l.id] === "skipped")
        .map((l) => l.id);
      const result = await apiClient.confirmSupplierInvoice(
        clinicId ?? user.homeClinicId,
        invoice.id,
        { readyToCreateLineIds, skippedLineIds },
      );
      setInvoice(result.invoice);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Failed to approve invoice.");
    } finally {
      setIsConfirming(false);
    }
  }

  // ── Void handler ────────────────────────────────────────────────────────────

  async function handleVoidConfirm(): Promise<void> {
    if (!invoice || !user) return;
    setIsVoiding(true);
    setVoidError(null);
    try {
      const voided = await apiClient.voidSupplierInvoice(clinicId ?? user.homeClinicId, invoice.id);
      setInvoice(voided);
      setShowVoidConfirm(false);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "Failed to void invoice.");
      setIsVoiding(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="invoice-review">
        <div className="supplier-detail__back">
          <Link to={backPath} className="supplier-detail__back-link">
            ← Back to Suppliers
          </Link>
        </div>

        <div className="supplier-detail__heading">
          <h2>
            {isLoading
              ? "Loading invoice…"
              : invoice
                ? (invoice.supplierNameRaw ?? "Invoice Review")
                : "Invoice Review"}
          </h2>
          {invoice ? <InvoiceStatusBadge status={invoice.status} /> : null}
        </div>

        {loadError ? (
          <p className="status-card__error" role="alert">
            {loadError}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading invoice data…</p>
        ) : invoice ? (
          <>
            <SummaryCard
              invoice={invoice}
              lineCount={lines.length}
              duplicateFile={duplicateFile}
              duplicateNumber={duplicateNumber}
            />

            {/* ── Line items section ── */}
            <section className="status-card supplier-detail__section">
              <div className="invoice-review__lines-header">
                <h3 className="supplier-detail__section-title">
                  Line Items
                  {lines.length > 0 ? (
                    <span className="supplier-detail__count">
                  {String(lines.length - ignoredLineIds.size)} visible /{" "}
                  {String(lines.length)} total
                    </span>
                  ) : null}
                </h3>
              </div>

              {lineEditError ? (
                <p className="status-card__error" role="alert">
                  {lineEditError}
                </p>
              ) : null}

              {matchError ? (
                <p className="status-card__error" role="alert">
                  {matchError}
                </p>
              ) : null}

              <LinesTable
                lines={lines}
                editingLineId={editingLineId}
                editDraft={editDraft}
                savingLineId={savingLineId}
                ignoredLineIds={ignoredLineIds}
                readOnly={readOnly}
                onEditStart={handleEditStart}
                onEditChange={handleEditChange}
                onEditSave={() => { void handleEditSave(); }}
                onEditCancel={handleEditCancel}
                onIgnoreToggle={handleIgnoreToggle}
                lineSuggestions={lineSuggestions}
                fetchingSuggestionForLine={fetchingSuggestionForLine}
                linkingLineId={linkingLineId}
                lineMatchDisplayNames={lineMatchDisplayNames}
                localLineActions={localLineActions}
                onFetchSuggestion={(lineId) => { void fetchLineSuggestion(lineId); }}
                onAcceptSuggestion={handleAcceptSuggestion}
                onChooseDifferent={(lineId) => { setMatchSearchTargetLineId(lineId); }}
                onCreateNew={(lineId) => {
                  setProductCreationTargetLine(lines.find((l) => l.id === lineId) ?? null);
                }}
                onSkipLine={handleSkipLine}
                onUndoLine={handleUndoLine}
              />
            </section>

            {/* ── Approval actions ── */}
            {isReviewable(invoice.status) ? (
              <section className="status-card supplier-detail__section invoice-review__approval">
                <h3 className="supplier-detail__section-title">Confirm Invoice Import</h3>

                {/* Review summary breakdown */}
                {lines.length > 0 ? (() => {
                  const matched = lines.filter(
                    (l) =>
                      l.isMatched &&
                      l.masterCatalogItemId !== null &&
                      !ignoredLineIds.has(l.id) &&
                      localLineActions[l.id] !== "skipped",
                  );
                  const toCreate = lines.filter(
                    (l) => localLineActions[l.id] === "ready_to_create",
                  );
                  const skipped = lines.filter(
                    (l) =>
                      localLineActions[l.id] === "skipped" ||
                      (ignoredLineIds.has(l.id) && !l.isMatched && localLineActions[l.id] !== "ready_to_create"),
                  );
                  const unresolved = lines.filter(
                    (l) => !lineIsResolved(l, localLineActions, ignoredLineIds),
                  );

                  const visibleLineTotal = lines
                    .filter(
                      (l) =>
                        !ignoredLineIds.has(l.id) && localLineActions[l.id] !== "skipped",
                    )
                    .reduce((sum, l) => sum + l.lineTotalCents, 0);
                  const invoiceTotal = invoice.totalCents ?? null;
                  const reconciliationDiff =
                    invoiceTotal !== null ? invoiceTotal - visibleLineTotal : null;

                  const pct =
                    lines.length > 0
                      ? Math.round(((lines.length - unresolved.length) / lines.length) * 100)
                      : 100;

                  return (
                    <div className="invoice-review__progress">
                      <div className="invoice-review__progress-bar-wrap">
                        <div
                          className="invoice-review__progress-bar"
                          style={{ width: `${String(pct)}%` }}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          role="progressbar"
                          aria-label="Review progress"
                        />
                      </div>
                      <div className="invoice-review__summary-grid">
                        <div className="invoice-review__summary-row">
                          <span className="invoice-review__summary-label">✅ Matched</span>
                          <span className="invoice-review__summary-value">{matched.length} line{matched.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="invoice-review__summary-row">
                          <span className="invoice-review__summary-label">🆕 Ready to Create</span>
                          <span className="invoice-review__summary-value">{toCreate.length} line{toCreate.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="invoice-review__summary-row">
                          <span className="invoice-review__summary-label">⏭ Skipped / Ignored</span>
                          <span className="invoice-review__summary-value">{skipped.length} line{skipped.length !== 1 ? "s" : ""}</span>
                        </div>
                        {unresolved.length > 0 ? (
                          <div className="invoice-review__summary-row invoice-review__summary-row--blocking">
                            <span className="invoice-review__summary-label">❓ Unresolved</span>
                            <span className="invoice-review__summary-value invoice-review__progress-blocking">
                              {unresolved.length} line{unresolved.length !== 1 ? "s" : ""} — decision required
                            </span>
                          </div>
                        ) : null}
                        {invoiceTotal !== null ? (
                          <>
                            <div className="invoice-review__summary-row invoice-review__summary-divider">
                              <span className="invoice-review__summary-label">Invoice total (header)</span>
                              <span className="invoice-review__summary-value">{centsToDollars(invoiceTotal)}</span>
                            </div>
                            <div className="invoice-review__summary-row">
                              <span className="invoice-review__summary-label">Active line total</span>
                              <span className="invoice-review__summary-value">{centsToDollars(visibleLineTotal)}</span>
                            </div>
                            {reconciliationDiff !== null && reconciliationDiff !== 0 ? (
                              <div className="invoice-review__summary-row invoice-review__summary-row--warn">
                                <span className="invoice-review__summary-label">Reconciliation difference</span>
                                <span className="invoice-review__summary-value">
                                  {centsToDollars(Math.abs(reconciliationDiff))}{" "}
                                  {reconciliationDiff > 0 ? "(header exceeds lines)" : "(lines exceed header)"}
                                </span>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })() : null}

                <p className="invoice-review__approval-hint">
                  Confirming will create new products for lines marked "Ready to Create" and
                  update supplier pricing for all matched lines. This action cannot be undone.
                  Unreviewed lines will be skipped but can be matched manually later.
                </p>
                {confirmError ? (
                  <p className="status-card__error" role="alert">
                    {confirmError}
                  </p>
                ) : null}
                {voidError ? (
                  <p className="status-card__error" role="alert">
                    {voidError}
                  </p>
                ) : null}
                <div className="invoice-review__approval-actions">
                  <button
                    type="button"
                    className="invoice-review__approve-btn"
                    onClick={() => { void handleApprove(); }}
                    disabled={isConfirming || isVoiding || linkingLineId !== null}
                  >
                    {isConfirming ? "Confirming…" : "Confirm Invoice Import"}
                  </button>
                  <button
                    type="button"
                    className="invoice-review__void-btn"
                    onClick={() => { setShowVoidConfirm(true); }}
                    disabled={isConfirming || isVoiding || linkingLineId !== null}
                  >
                    Void Invoice
                  </button>
                </div>
              </section>
            ) : invoice.status === "confirmed" || invoice.status === "imported" ? (
              <section className="status-card supplier-detail__section invoice-review__confirmed-banner">
                <div className="invoice-review__confirmed-icon" aria-hidden="true">✓</div>
                <div>
                  <strong>Invoice Approved</strong>
                  <p className="invoice-review__confirmed-hint">
                    This invoice was confirmed on {formatDate(invoice.confirmedAt)}.
                  </p>
                  {invoice.receivedAt ? (
                    <p className="invoice-review__confirmed-hint invoice-review__received-hint">
                      Stock received on {formatDate(invoice.receivedAt)} by {invoice.importedByEmail}.
                    </p>
                  ) : null}
                </div>
                <div className="invoice-review__confirmed-actions">
                  {invoice.receivedAt ? (
                    <span className="supplier-invoice-badge supplier-invoice-badge--imported">
                      Stock Received
                    </span>
                  ) : (
                    <Link
                      to={`/inventory/receiving?invoiceId=${invoice.id}`}
                      className="button-link"
                    >
                      Proceed to Receiving
                    </Link>
                  )}
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => { void navigate(backPath); }}
                  >
                    Return to Suppliers
                  </button>
                </div>
              </section>
            ) : invoice.status === "voided" ? (
              <section className="status-card supplier-detail__section invoice-review__voided-banner">
                <div className="invoice-review__voided-icon" aria-hidden="true">✕</div>
                <div>
                  <strong>Invoice Voided</strong>
                  <p className="invoice-review__confirmed-hint">
                    This invoice was voided on {formatDate(invoice.voidedAt)}.
                  </p>
                </div>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => { void navigate(backPath); }}
                >
                  Return to Suppliers
                </button>
              </section>
            ) : invoice.status === "cancelled" ? (
              <section className="status-card supplier-detail__section invoice-review__voided-banner">
                <div className="invoice-review__voided-icon" aria-hidden="true">✕</div>
                <div>
                  <strong>Import Cancelled</strong>
                  <p className="invoice-review__confirmed-hint">
                    This invoice import was cancelled and is no longer active.
                  </p>
                </div>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => { void navigate(backPath); }}
                >
                  Return to Suppliers
                </button>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {showVoidConfirm ? (
        <VoidConfirmDialog
          isVoiding={isVoiding}
          onConfirm={() => { void handleVoidConfirm(); }}
          onCancel={() => { setShowVoidConfirm(false); }}
        />
      ) : null}

      <MasterProductSearchModal
        isOpen={matchSearchTargetLineId !== null}
        onClose={() => { setMatchSearchTargetLineId(null); }}
        onSelect={handleManualMatchSelect}
        title="Match to Master Product"
      />

      {productCreationTargetLine ? (
        <ProductCreationReviewModal
          line={productCreationTargetLine}
          initialData={productCreationTargetLine.productCreationData}
          isSaving={isSavingProductCreation}
          onClose={() => { setProductCreationTargetLine(null); }}
          onSave={(data) => {
            handleCreateNew(productCreationTargetLine.id, data);
          }}
        />
      ) : null}
    </AppShell>
  );
}
