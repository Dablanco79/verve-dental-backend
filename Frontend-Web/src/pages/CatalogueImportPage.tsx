import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type {
  CatalogueImportConfirmResult,
  CatalogueImportPreviewResult,
  Supplier,
  SupplierInvoice,
} from "../types/supplier.js";
import { canManageProducts, canManageSuppliers } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type ImportSourceId =
  | "supplier_invoice_pdf"
  | "supplier_catalogue_pdf"
  | "xlsx"
  | "csv"
  | "image"
  | "supplier_api";

type CatalogueImportStatus =
  | "Pending"
  | "Processing"
  | "Review Required"
  | "Imported"
  | "Failed";

type ImportSource = {
  id: ImportSourceId;
  label: string;
  description: string;
  accept: string;
  disabled?: boolean;
};

type ImportHistoryRow = {
  id: string;
  fileName: string;
  supplierName: string;
  uploadedAt: string;
  status: CatalogueImportStatus;
};

const IMPORT_SOURCES: ImportSource[] = [
  {
    id: "supplier_invoice_pdf",
    label: "Supplier Invoice (PDF)",
    description: "OCR supplier, products, prices, and packaging from invoice documents.",
    accept: ".pdf,application/pdf",
  },
  {
    id: "supplier_catalogue_pdf",
    label: "Supplier Catalogue (PDF)",
    description: "Capture catalogue PDFs for review when catalogue OCR cannot safely extract rows.",
    accept: ".pdf,application/pdf",
  },
  {
    id: "xlsx",
    label: "Excel (.xlsx)",
    description: "Import structured supplier catalogue rows and pricing.",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    id: "csv",
    label: "CSV",
    description: "Import structured supplier catalogue rows and pricing.",
    accept: ".csv,text/csv",
  },
  {
    id: "image",
    label: "Image (PNG/JPG)",
    description: "OCR invoice photos or scans for supplier and price recognition.",
    accept: ".png,.jpg,.jpeg,image/png,image/jpeg",
  },
  {
    id: "supplier_api",
    label: "Supplier API",
    description: "Coming Soon - disabled",
    accept: "",
    disabled: true,
  },
];

const DEFAULT_IMPORT_SOURCE: ImportSource = IMPORT_SOURCES[0] ?? {
  id: "supplier_invoice_pdf",
  label: "Supplier Invoice (PDF)",
  description: "OCR supplier, products, prices, and packaging from invoice documents.",
  accept: ".pdf,application/pdf",
};

const FUTURE_FEATURES = [
  "Supplier API",
  "Catalogue Synchronisation",
  "Automatic Price Updates",
  "Smart Matching",
] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isStructuredSource(sourceId: ImportSourceId): boolean {
  return sourceId === "csv" || sourceId === "xlsx";
}

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function mapInvoiceStatus(invoice: SupplierInvoice): CatalogueImportStatus {
  if (invoice.status === "confirmed") return "Imported";
  if (invoice.status === "voided") return "Failed";
  return "Review Required";
}

function validateFile(file: File, source: ImportSource): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `File is too large (${formatFileSize(file.size)}). Maximum size is 20 MB.`;
  }

  const extension = getFileExtension(file.name);
  const acceptedExtensions = source.accept
    .split(",")
    .filter((part) => part.startsWith("."))
    .map((part) => part.slice(1));

  if (!acceptedExtensions.includes(extension)) {
    return `Select a valid ${source.label} file.`;
  }

  return null;
}

function buildHistoryFromInvoices(
  invoices: SupplierInvoice[],
  supplierNameById: Map<string, string>,
): ImportHistoryRow[] {
  return invoices.map((invoice) => ({
    id: invoice.id,
    fileName: invoice.originalFilename,
    supplierName:
      invoice.supplierId ? supplierNameById.get(invoice.supplierId) ?? "Recognised supplier" : "Not recognised",
    uploadedAt: invoice.createdAt,
    status: mapInvoiceStatus(invoice),
  }));
}

function sourceProcessingCopy(sourceId: ImportSourceId): string {
  if (sourceId === "supplier_catalogue_pdf") {
    return "Catalogue PDF OCR is held for manual review in this sprint. It will not create inventory movements.";
  }
  if (sourceId === "csv" || sourceId === "xlsx") {
    return "Structured files are previewed and imported into supplier catalogue knowledge only.";
  }
  return "OCR upload creates supplier/product/price review data only. It never adjusts stock.";
}

export function CatalogueImportPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const canUseCatalogueImport = user
    ? canManageProducts(user.role) || canManageSuppliers(user.role)
    : false;

  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>("supplier_invoice_pdf");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [imports, setImports] = useState<ImportHistoryRow[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<CatalogueImportStatus>("Pending");
  const [processingSummary, setProcessingSummary] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSource = IMPORT_SOURCES.find((source) => source.id === selectedSourceId) ?? DEFAULT_IMPORT_SOURCE;
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active).sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    [suppliers],
  );
  const selectedSupplier = activeSuppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const requiresSupplier = isStructuredSource(selectedSourceId);
  const canUpload =
    canUseCatalogueImport &&
    !!selectedFile &&
    !fileError &&
    !isUploading &&
    !isAllClinicsScope &&
    selectedSourceId !== "supplier_api" &&
    (!requiresSupplier || !!supplierId);

  const loadImportWorkspace = useCallback(async () => {
    if (!user || !canUseCatalogueImport) {
      setIsLoadingImports(false);
      return;
    }

    setIsLoadingImports(true);
    setLoadError(null);

    try {
      const supplierList = await apiClient.listSuppliers({ active: true });
      setSuppliers(supplierList);
      if (!supplierId && supplierList[0]) {
        setSupplierId(supplierList[0].id);
      }

      if (!selectedClinicId || isAllClinicsScope) {
        setImports([]);
        return;
      }

      const invoiceImports = await apiClient.listClinicSupplierInvoices(selectedClinicId, { limit: 25 });
      const supplierNameById = new Map(supplierList.map((supplier) => [supplier.id, supplier.supplierName]));
      setImports(buildHistoryFromInvoices(invoiceImports, supplierNameById));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Catalogue import workspace could not be loaded.");
      setSuppliers([]);
      setImports([]);
    } finally {
      setIsLoadingImports(false);
    }
  }, [canUseCatalogueImport, isAllClinicsScope, selectedClinicId, supplierId, user]);

  useEffect(() => {
    void loadImportWorkspace();
  }, [loadImportWorkspace]);

  function applyFile(file: File): void {
    const error = validateFile(file, selectedSource);
    setSelectedFile(file);
    setFileError(error);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Pending");
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) applyFile(file);
  }

  function handleSourceChange(sourceId: ImportSourceId): void {
    const nextSource = IMPORT_SOURCES.find((source) => source.id === sourceId);
    if (!nextSource || nextSource.disabled) return;

    setSelectedSourceId(sourceId);
    setSelectedFile(null);
    setFileError(null);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Pending");
  }

  function addLocalImport(row: ImportHistoryRow): void {
    setImports((current) => [row, ...current.filter((item) => item.id !== row.id)]);
  }

  function summarizePreview(preview: CatalogueImportPreviewResult): string {
    return `${String(preview.totalRows)} rows checked: ${String(preview.matchedRows)} matched, ${String(preview.unmatchedRows)} unmatched, ${String(preview.errorRows)} with errors.`;
  }

  function summarizeConfirm(confirm: CatalogueImportConfirmResult): string {
    return `${String(confirm.imported)} imported, ${String(confirm.updated)} updated, ${String(confirm.skipped)} skipped, ${String(confirm.errors)} failed.`;
  }

  async function handleUpload(): Promise<void> {
    if (!selectedFile || !selectedClinicId) return;

    const validationError = validateFile(selectedFile, selectedSource);
    if (validationError) {
      setFileError(validationError);
      return;
    }

    if (requiresSupplier && !selectedSupplier) {
      setUploadError("Select a supplier before importing a CSV or Excel catalogue.");
      return;
    }

    setIsUploading(true);
    setUploadStatus("Processing");
    setUploadError(null);
    setProcessingSummary(null);

    try {
      if (selectedSourceId === "supplier_catalogue_pdf") {
        addLocalImport({
          id: `local-${String(Date.now())}`,
          fileName: selectedFile.name,
          supplierName: selectedSupplier?.supplierName ?? "Not recognised",
          uploadedAt: new Date().toISOString(),
          status: "Review Required",
        });
        setUploadStatus("Review Required");
        setProcessingSummary("Catalogue PDF uploaded for manual review. Automated catalogue PDF extraction is not available yet.");
        return;
      }

      if (isStructuredSource(selectedSourceId) && selectedSupplier) {
        const preview = await apiClient.previewSupplierCatalogueImport(selectedSupplier.id, selectedFile);
        if (preview.unmatchedRows > 0 || preview.errorRows > 0) {
          addLocalImport({
            id: `preview-${String(Date.now())}`,
            fileName: selectedFile.name,
            supplierName: selectedSupplier.supplierName,
            uploadedAt: new Date().toISOString(),
            status: "Review Required",
          });
          setUploadStatus("Review Required");
          setProcessingSummary(`${summarizePreview(preview)} Review required before catalogue knowledge can be imported.`);
          return;
        }

        const confirm = await apiClient.confirmSupplierCatalogueImport(selectedSupplier.id, selectedFile);
        addLocalImport({
          id: `import-${String(Date.now())}`,
          fileName: selectedFile.name,
          supplierName: selectedSupplier.supplierName,
          uploadedAt: new Date().toISOString(),
          status: confirm.errors > 0 || confirm.skipped > 0 ? "Review Required" : "Imported",
        });
        setUploadStatus(confirm.errors > 0 || confirm.skipped > 0 ? "Review Required" : "Imported");
        setProcessingSummary(`${summarizePreview(preview)} ${summarizeConfirm(confirm)}`);
        return;
      }

      const result = await apiClient.uploadSupplierInvoice(selectedClinicId, selectedFile);
      const supplierName =
        result.matchedSupplier?.supplierName ??
        result.detectedSupplier?.supplierName ??
        result.invoice.supplierNameRaw ??
        "Not recognised";
      const hasReviewWork =
        result.supplierMatchStatus !== "matched" ||
        result.lines.some((line) => !line.isMatched);

      addLocalImport({
        id: result.invoice.id,
        fileName: result.invoice.originalFilename,
        supplierName,
        uploadedAt: result.invoice.createdAt,
        status: "Review Required",
      });
      setUploadStatus("Review Required");
      setProcessingSummary(
        hasReviewWork
          ? "OCR completed and flagged supplier/product details for review."
          : "OCR completed. Review is still required before invoice-derived knowledge is confirmed.",
      );
    } catch (err: unknown) {
      setUploadStatus("Failed");
      setUploadError(err instanceof Error ? err.message : "Catalogue import failed.");
    } finally {
      setIsUploading(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell>
      <section className="status-card catalogue-import-page">
        <div className="status-card__header catalogue-import-page__header">
          <div>
            <p className="catalogue-import-page__eyebrow">Inventory</p>
            <h2>Catalogue Import</h2>
            <p className="inventory-page__subtitle">
              Build supplier master data, products, prices, and pack-size knowledge without changing inventory quantities.
            </p>
          </div>
          <Link to="/inventory" className="link-button">
            Back to Inventory
          </Link>
        </div>

        {!canUseCatalogueImport ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Catalogue import is restricted</h3>
            <p>You need product or supplier management access to import catalogue knowledge.</p>
          </div>
        ) : null}

        {isAllClinicsScope ? (
          <div className="inventory-receiving-callout" role="status">
            <h3>Select a clinic</h3>
            <p>OCR invoice history is clinic-scoped. Choose a clinic before uploading files.</p>
          </div>
        ) : null}

        <section className="catalogue-import-page__grid" aria-label="Catalogue import workspace">
          <div className="catalogue-import-page__panel">
            <div className="catalogue-import-page__section-heading">
              <h3>Import Source</h3>
              <p>{sourceProcessingCopy(selectedSourceId)}</p>
            </div>

            <div className="catalogue-source-grid" role="radiogroup" aria-label="Import source">
              {IMPORT_SOURCES.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={[
                    "catalogue-source-card",
                    source.id === selectedSourceId ? "catalogue-source-card--active" : "",
                    source.disabled ? "catalogue-source-card--disabled" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    handleSourceChange(source.id);
                  }}
                  disabled={source.disabled}
                  role="radio"
                  aria-checked={source.id === selectedSourceId}
                >
                  <span className="catalogue-source-card__title">{source.label}</span>
                  <span className="catalogue-source-card__description">{source.description}</span>
                </button>
              ))}
            </div>

            {requiresSupplier ? (
              <label className="scan-form__field catalogue-import-page__supplier">
                Supplier *
                <select
                  value={supplierId}
                  onChange={(event) => {
                    setSupplierId(event.target.value);
                  }}
                  disabled={activeSuppliers.length === 0}
                >
                  <option value="">Select supplier...</option>
                  {activeSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.supplierName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div
              className={[
                "upload-dropzone",
                "catalogue-import-page__dropzone",
                isDragging ? "upload-dropzone--dragging" : "",
                selectedFile && !fileError ? "upload-dropzone--has-file" : "",
              ].filter(Boolean).join(" ")}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Drag and drop upload area or browse files"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={selectedSource.accept}
                className="upload-dropzone__input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) applyFile(file);
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
              {selectedFile ? (
                <div className="upload-dropzone__file-info">
                  <span className="upload-dropzone__file-icon" aria-hidden="true">File</span>
                  <span className="upload-dropzone__file-name">{selectedFile.name}</span>
                  <span className="upload-dropzone__file-size">{formatFileSize(selectedFile.size)}</span>
                </div>
              ) : (
                <div className="upload-dropzone__placeholder">
                  <span className="upload-dropzone__icon" aria-hidden="true">Upload</span>
                  <span className="upload-dropzone__primary">
                    Drag &amp; Drop upload area or <span className="upload-dropzone__browse">Browse Files</span>
                  </span>
                  <span className="upload-dropzone__hint">{selectedSource.label} - max 20 MB</span>
                </div>
              )}
            </div>

            {fileError ? <p className="status-card__error" role="alert">{fileError}</p> : null}
            {uploadError ? <p className="status-card__error" role="alert">{uploadError}</p> : null}
            {processingSummary ? (
              <div className="catalogue-import-page__summary" role="status">
                <strong>{uploadStatus}</strong>
                <span>{processingSummary}</span>
              </div>
            ) : null}

            <div className="inventory-page__actions">
              <button
                type="button"
                className="button-link"
                disabled={!canUpload}
                onClick={() => {
                  void handleUpload();
                }}
              >
                {isUploading ? "Processing..." : "Upload & Process"}
              </button>
              <span className="catalogue-import-page__safety-note">
                No inventory adjustments, stock quantity changes, or receiving timeline events are created.
              </span>
            </div>
          </div>

          <aside className="catalogue-import-page__panel catalogue-import-page__panel--future">
            <div className="catalogue-import-page__section-heading">
              <h3>Future Placeholders</h3>
              <p>Available in a future release</p>
            </div>
            <div className="catalogue-future-grid">
              {FUTURE_FEATURES.map((feature) => (
                <article key={feature} className="catalogue-future-card" aria-disabled="true">
                  <h4>{feature}</h4>
                  <p>Available in a future release</p>
                </article>
              ))}
            </div>
          </aside>
        </section>
      </section>

      <section className="status-card inventory-page__section">
        <div className="status-card__header">
          <div>
            <h2>Imported Files</h2>
            <p className="inventory-page__subtitle">
              Previous imports show recognised suppliers, upload date, and review/import status.
            </p>
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void loadImportWorkspace();
            }}
            disabled={isLoadingImports}
          >
            Refresh
          </button>
        </div>

        {isLoadingImports ? <p className="loading-message">Loading imported files...</p> : null}
        {loadError ? <p className="status-card__error" role="alert">{loadError}</p> : null}
        {!isLoadingImports && !loadError && imports.length === 0 ? (
          <div className="billing-empty" role="status">
            <p className="billing-empty__title">No catalogue imports yet.</p>
            <p className="billing-empty__hint">
              Upload a supplier invoice, catalogue, spreadsheet, CSV, or image to start building catalogue knowledge.
            </p>
          </div>
        ) : null}
        {imports.length > 0 ? (
          <div className="inventory-table-wrap">
            <table className="inventory-table catalogue-import-table">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Supplier</th>
                  <th>Upload date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fileName}</td>
                    <td>{item.supplierName}</td>
                    <td>{formatUploadDate(item.uploadedAt)}</td>
                    <td>
                      <span className={`catalogue-status catalogue-status--${item.status.toLowerCase().replace(/\s+/g, "-")}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
