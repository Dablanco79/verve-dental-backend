import { useEffect, useRef, useState } from "react";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type {
  DetectedSupplierInfo,
  Supplier,
  SupplierMatchStatus,
  UploadAndExtractResult,
} from "../../types/supplier.js";

const apiClient = createApiClient(loadConfig());

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const ACCEPTED_EXTENSIONS = ".pdf,.png,.jpg,.jpeg";

// ── Phase types ──────────────────────────────────────────────────────────────

type UploadPhase =
  | "select"          // Initial: choose mode + file
  | "uploading"       // OCR processing in progress
  | "detection"       // Show supplier detection result
  | "choose_existing" // User picks existing supplier from dropdown
  | "attaching";      // PATCH invoice supplier_id in progress

type SupplierMode = "manual" | "auto_detect";

// ── Progress steps ────────────────────────────────────────────────────────────

const PROGRESS_STEPS = [
  "Uploading Invoice",
  "Processing OCR",
  "Extracting Line Items",
] as const;

// ── Utility ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const hasAcceptedExtension = ["pdf", "png", "jpg", "jpeg"].includes(extension);
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type) && !hasAcceptedExtension) {
    return "Invalid file type. Please upload a PDF, PNG, JPG, or JPEG file.";
  }
  if (!file.type && !hasAcceptedExtension) {
    return "Invalid file type. Please upload a PDF, PNG, JPG, or JPEG file.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File is too large (${formatFileSize(file.size)}). Maximum size is 20 MB.`;
  }
  return null;
}

function formatUploadError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Upload failed. Please try again.";
  const lower = message.toLowerCase();

  if (lower.includes("unsupported_media_type") || lower.includes("unsupported file type")) {
    return "Unsupported file type. Upload a PDF, PNG, JPG, or JPEG invoice file.";
  }

  if (lower.includes("no file uploaded") || lower.includes("validation_error")) {
    return `Upload failed before OCR processing. ${message}`;
  }

  if (
    lower.includes("anthropic_api_key") ||
    lower.includes("api key") ||
    lower.includes("ocr_provider")
  ) {
    return "OCR processing is unavailable because the OCR provider is not configured for this environment. Ask an administrator to verify the provider key before uploading real pilot invoices.";
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "OCR processing timed out. Retry once with the same file; if it repeats, OCR may be unavailable or the file may be too large/complex.";
  }

  if (lower.includes("failed while processing ocr") || lower.includes("ocr")) {
    return `${message}. OCR processing did not complete. Retry once, then capture the Request ID for backend/OCR investigation if shown.`;
  }

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Upload failed before the server responded. Check the connection and confirm the API is running, then retry.";
  }

  return message;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressCard({ activeStep }: { activeStep: number }) {
  return (
    <div className="upload-progress">
      <div className="upload-progress__spinner" aria-hidden="true" />
      <ul className="upload-progress__steps" role="list">
        {PROGRESS_STEPS.map((step, idx) => (
          <li
            key={step}
            className={[
              "upload-progress__step",
              idx < activeStep ? "upload-progress__step--done" : "",
              idx === activeStep ? "upload-progress__step--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="upload-progress__step-icon" aria-hidden="true">
              {idx < activeStep ? "✓" : idx === activeStep ? "●" : "○"}
            </span>
            {step}
          </li>
        ))}
      </ul>
      <p className="upload-progress__hint">
        This may take up to 60 seconds while the AI processes your document.
      </p>
    </div>
  );
}

function AttachingSpinner() {
  return (
    <div className="upload-progress">
      <div className="upload-progress__spinner" aria-hidden="true" />
      <p className="upload-progress__hint">Attaching supplier to invoice…</p>
    </div>
  );
}

// ── Detection result panels ────────────────────────────────────────────────────

type DetectionPanelProps = {
  status: SupplierMatchStatus;
  detected: DetectedSupplierInfo | null;
  matched: Supplier | null;
  onContinue: () => void;
  onCreateSupplier: () => void;
  onChooseExisting: () => void;
  onCancel: () => void;
  actionError: string | null;
};

function DetectionPanel({
  status,
  detected,
  matched,
  onContinue,
  onCreateSupplier,
  onChooseExisting,
  onCancel,
  actionError,
}: DetectionPanelProps) {
  if (status === "matched" && matched) {
    return (
      <div className="supplier-detection">
        <div className="supplier-detection__badge supplier-detection__badge--matched">
          Supplier matched
        </div>
        <p className="supplier-detection__label">
          Matched supplier: <strong>{matched.supplierName}</strong>
        </p>
        {matched.abn ? (
          <p className="supplier-detection__meta">ABN: {matched.abn}</p>
        ) : null}
        {actionError ? (
          <div className="upload-error-banner" role="alert">
            <strong>Error:</strong> {actionError}
          </div>
        ) : null}
        <div className="supplier-form__actions">
          <button type="button" className="supplier-form__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="supplier-form__submit" onClick={onContinue}>
            Continue to Review
          </button>
        </div>
      </div>
    );
  }

  if (status === "needs_confirmation" && detected) {
    return (
      <div className="supplier-detection">
        <div className="supplier-detection__badge supplier-detection__badge--new">
          New supplier detected
        </div>
        <p className="supplier-detection__hint">
          We could not match this to an existing supplier. Please review the detected
          information and choose how to proceed.
        </p>
        <dl className="supplier-detection__fields">
          <div className="supplier-detection__field">
            <dt>Supplier Name</dt>
            <dd>{detected.supplierName}</dd>
          </div>
          {detected.abn ? (
            <div className="supplier-detection__field">
              <dt>ABN</dt>
              <dd>{detected.abn}</dd>
            </div>
          ) : null}
          {detected.email ? (
            <div className="supplier-detection__field">
              <dt>Email</dt>
              <dd>{detected.email}</dd>
            </div>
          ) : null}
          {detected.phone ? (
            <div className="supplier-detection__field">
              <dt>Phone</dt>
              <dd>{detected.phone}</dd>
            </div>
          ) : null}
          {detected.address ? (
            <div className="supplier-detection__field">
              <dt>Address</dt>
              <dd>{detected.address}</dd>
            </div>
          ) : null}
        </dl>
        {actionError ? (
          <div className="upload-error-banner" role="alert">
            <strong>Error:</strong> {actionError}
          </div>
        ) : null}
        <div className="supplier-form__actions supplier-form__actions--column">
          <button
            type="button"
            className="supplier-form__submit"
            onClick={onCreateSupplier}
          >
            Create Supplier &amp; Continue
          </button>
          <button
            type="button"
            className="supplier-form__secondary"
            onClick={onChooseExisting}
          >
            Choose Existing Supplier
          </button>
          <button type="button" className="supplier-form__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // not_detected
  return (
    <div className="supplier-detection">
      <div className="supplier-detection__badge supplier-detection__badge--none">
        Supplier not detected
      </div>
      <p className="supplier-detection__hint">
        We could not detect a supplier from this invoice. Please choose an existing
        supplier to continue.
      </p>
      {actionError ? (
        <div className="upload-error-banner" role="alert">
          <strong>Error:</strong> {actionError}
        </div>
      ) : null}
      <div className="supplier-form__actions">
        <button type="button" className="supplier-form__cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="supplier-form__submit"
          onClick={onChooseExisting}
        >
          Choose Existing Supplier
        </button>
      </div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

type Props = {
  clinicId: string;
  suppliers: Supplier[];
  defaultSupplierId?: string;
  onClose: () => void;
  onUploadSuccess: (result: UploadAndExtractResult) => void;
};

export function UploadInvoiceModal({
  clinicId,
  suppliers,
  defaultSupplierId,
  onClose,
  onUploadSuccess,
}: Props) {
  const [phase, setPhase] = useState<UploadPhase>("select");
  const [mode, setMode] = useState<SupplierMode>(
    defaultSupplierId ? "manual" : "auto_detect",
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(
    defaultSupplierId ?? suppliers[0]?.id ?? "",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Upload result held during the detection/choose steps.
  const [uploadResult, setUploadResult] = useState<UploadAndExtractResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Advance progress steps during upload.
  useEffect(() => {
    if (phase !== "uploading") return;
    setActiveStep(0);
    const t1 = setTimeout(() => { setActiveStep(1); }, 1200);
    const t2 = setTimeout(() => { setActiveStep(2); }, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  function applyFile(file: File): void {
    const err = validateFile(file);
    setFileError(err);
    setSelectedFile(file);
    setUploadError(null);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) applyFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
  }

  function handleDropzoneClick(): void {
    fileInputRef.current?.click();
  }

  function handleDropzoneKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (phase === "uploading" || phase === "attaching") return;
    if (e.target === e.currentTarget) onClose();
  }

  // ── Attach supplier to invoice ────────────────────────────────────────────

  async function attachSupplierAndContinue(
    result: UploadAndExtractResult,
    supplierId: string,
  ): Promise<void> {
    setPhase("attaching");
    setActionError(null);
    try {
      const patched = await apiClient.updateSupplierInvoice(
        clinicId,
        result.invoice.id,
        { supplierId },
      );
      onUploadSuccess({ ...result, invoice: patched.invoice });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to attach supplier.");
      setPhase("detection");
    }
  }

  // ── Submit upload ──────────────────────────────────────────────────────────

  async function handleSubmit(): Promise<void> {
    if (!selectedFile) {
      setFileError("Please select a file to upload.");
      return;
    }
    const err = validateFile(selectedFile);
    if (err) {
      setFileError(err);
      return;
    }
    if (mode === "manual" && !selectedSupplierId) {
      return;
    }

    setPhase("uploading");
    setUploadError(null);

    try {
      const result = await apiClient.uploadSupplierInvoice(clinicId, selectedFile);

      if (mode === "manual") {
        // Manual mode: attach the explicitly selected supplier, then navigate.
        await attachSupplierAndContinue(result, selectedSupplierId);
        return;
      }

      // Auto-detect mode: show detection result.
      setUploadResult(result);
      setPhase("detection");
    } catch (e) {
      setUploadError(formatUploadError(e));
      setPhase("select");
    }
  }

  // ── Detection actions ──────────────────────────────────────────────────────

  function handleDetectionContinue(): void {
    if (!uploadResult) return;
    // Supplier was auto-matched by the backend — navigate directly.
    onUploadSuccess(uploadResult);
  }

  async function handleCreateSupplier(): Promise<void> {
    if (!uploadResult?.detectedSupplier) return;
    const detected = uploadResult.detectedSupplier;
    setPhase("attaching");
    setActionError(null);
    try {
      const newSupplier = await apiClient.createSupplier({
        supplierName: detected.supplierName,
        abn: detected.abn ?? undefined,
        email: detected.email ?? undefined,
        phone: detected.phone ?? undefined,
        address: detected.address ?? undefined,
        website: detected.website ?? undefined,
      });
      await attachSupplierAndContinue(uploadResult, newSupplier.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to create supplier.",
      );
      setPhase("detection");
    }
  }

  function handleChooseExisting(): void {
    if (!uploadResult) return;
    setActionError(null);
    setPhase("choose_existing");
  }

  async function handleChooseExistingConfirm(): Promise<void> {
    if (!uploadResult || !selectedSupplierId) return;
    await attachSupplierAndContinue(uploadResult, selectedSupplierId);
  }

  function handleBackToDetection(): void {
    setPhase("detection");
    setActionError(null);
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const activeSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const hasMultipleSuppliers = suppliers.length > 1;

  const submitDisabled =
    !selectedFile ||
    !!fileError ||
    (mode === "manual" && !selectedSupplierId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="supplier-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-invoice-modal-title"
    >
      <div className="supplier-modal supplier-modal--upload">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="upload-invoice-modal-title">
            Upload Invoice
          </h2>
          {phase !== "uploading" && phase !== "attaching" ? (
            <button
              type="button"
              className="supplier-modal__close"
              onClick={onClose}
              aria-label="Close modal"
            >
              ×
            </button>
          ) : null}
        </div>

        {/* ── Processing phases ── */}
        {phase === "uploading" ? (
          <ProgressCard activeStep={activeStep} />
        ) : phase === "attaching" ? (
          <AttachingSpinner />
        ) : phase === "detection" && uploadResult ? (
          <DetectionPanel
            status={uploadResult.supplierMatchStatus}
            detected={uploadResult.detectedSupplier}
            matched={uploadResult.matchedSupplier}
            onContinue={handleDetectionContinue}
            onCreateSupplier={() => { void handleCreateSupplier(); }}
            onChooseExisting={handleChooseExisting}
            onCancel={onClose}
            actionError={actionError}
          />
        ) : phase === "choose_existing" ? (
          /* ── Choose existing supplier after detection ── */
          <div className="supplier-form">
            <p className="supplier-detection__hint">
              Select an existing supplier to attach to this invoice.
            </p>
            <label className="supplier-form__field">
              <span className="supplier-form__label">
                Supplier <span className="supplier-form__required">*</span>
              </span>
              <select
                className="supplier-form__control"
                value={selectedSupplierId}
                onChange={(e) => { setSelectedSupplierId(e.target.value); }}
              >
                <option value="">— Select supplier —</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supplierName}
                    </option>
                  ))}
              </select>
            </label>
            {actionError ? (
              <div className="upload-error-banner" role="alert">
                <strong>Error:</strong> {actionError}
              </div>
            ) : null}
            <div className="supplier-form__actions">
              <button
                type="button"
                className="supplier-form__cancel"
                onClick={handleBackToDetection}
              >
                Back
              </button>
              <button
                type="button"
                className="supplier-form__submit"
                disabled={!selectedSupplierId}
                onClick={() => { void handleChooseExistingConfirm(); }}
              >
                Confirm Supplier
              </button>
            </div>
          </div>
        ) : (
          /* ── Select phase ── */
          <div className="supplier-form">
            {/* Supplier mode toggle */}
            <div className="supplier-form__field">
              <span className="supplier-form__label">Supplier</span>
              <div className="upload-mode-toggle" role="group" aria-label="Supplier selection method">
                <button
                  type="button"
                  className={[
                    "upload-mode-toggle__btn",
                    mode === "auto_detect" ? "upload-mode-toggle__btn--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => { setMode("auto_detect"); }}
                >
                  Auto-detect from invoice
                </button>
                <button
                  type="button"
                  className={[
                    "upload-mode-toggle__btn",
                    mode === "manual" ? "upload-mode-toggle__btn--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => { setMode("manual"); }}
                >
                  Select existing supplier
                </button>
              </div>
            </div>

            {/* Manual supplier selector */}
            {mode === "manual" ? (
              hasMultipleSuppliers ? (
                <label className="supplier-form__field">
                  <span className="supplier-form__label">
                    Supplier <span className="supplier-form__required">*</span>
                  </span>
                  <select
                    className="supplier-form__control"
                    value={selectedSupplierId}
                    onChange={(e) => { setSelectedSupplierId(e.target.value); }}
                  >
                    <option value="">— Select supplier —</option>
                    {suppliers
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.supplierName}
                        </option>
                      ))}
                  </select>
                </label>
              ) : activeSupplier ? (
                <div className="upload-supplier-readonly">
                  <span className="supplier-form__label">Supplier</span>
                  <span className="upload-supplier-readonly__name">
                    {activeSupplier.supplierName}
                  </span>
                </div>
              ) : null
            ) : (
              <p className="upload-mode-toggle__hint">
                The supplier will be automatically detected from the invoice content.
                You can confirm or override after upload. If no supplier is matched,
                Verve will ask you to choose or create the supplier before review.
              </p>
            )}

            <div className="inventory-receiving-callout" role="status">
              <h3>OCR environment check</h3>
              <p>
                Upload accepts PDF, PNG, JPG, and JPEG files. If OCR provider configuration is
                missing or processing is unavailable, this dialog will show the safe error detail
                and any request ID returned by the API.
              </p>
            </div>

            {/* File drop zone */}
            <div className="supplier-form__field">
              <span className="supplier-form__label">
                Invoice File <span className="supplier-form__required">*</span>
              </span>
              <div
                className={[
                  "upload-dropzone",
                  isDragging ? "upload-dropzone--dragging" : "",
                  selectedFile && !fileError ? "upload-dropzone--has-file" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleDropzoneClick}
                onKeyDown={handleDropzoneKeyDown}
                role="button"
                tabIndex={0}
                aria-label="Drop invoice file here or click to browse"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="upload-dropzone__input"
                  onChange={handleFileInputChange}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                {selectedFile ? (
                  <div className="upload-dropzone__file-info">
                    <span className="upload-dropzone__file-icon" aria-hidden="true">
                      📄
                    </span>
                    <span className="upload-dropzone__file-name">{selectedFile.name}</span>
                    <span className="upload-dropzone__file-size">
                      {formatFileSize(selectedFile.size)}
                    </span>
                  </div>
                ) : (
                  <div className="upload-dropzone__placeholder">
                    <span className="upload-dropzone__icon" aria-hidden="true">
                      ⬆
                    </span>
                    <span className="upload-dropzone__primary">
                      Drag &amp; drop or{" "}
                      <span className="upload-dropzone__browse">browse files</span>
                    </span>
                    <span className="upload-dropzone__hint">
                      PDF, PNG, JPG, JPEG — max 20 MB
                    </span>
                  </div>
                )}
              </div>

              {fileError ? (
                <p className="supplier-form__error" role="alert">
                  {fileError}
                </p>
              ) : null}
            </div>

            {/* Upload error from failed attempt */}
            {uploadError ? (
              <div className="upload-error-banner" role="alert">
                <strong>Upload failed:</strong> {uploadError}
              </div>
            ) : null}

            <div className="supplier-form__actions">
              <button
                type="button"
                className="supplier-form__cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="supplier-form__submit"
                onClick={() => { void handleSubmit(); }}
                disabled={submitDisabled}
              >
                {uploadError ? "Retry Upload" : "Upload & Process"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
