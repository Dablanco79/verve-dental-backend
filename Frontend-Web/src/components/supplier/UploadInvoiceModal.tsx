import { useEffect, useRef, useState } from "react";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type { Supplier, UploadAndExtractResult } from "../../types/supplier.js";

const apiClient = createApiClient(loadConfig());

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const ACCEPTED_EXTENSIONS = ".pdf,.png,.jpg,.jpeg";

type UploadPhase = "select" | "uploading";

// Progress steps shown during upload/OCR processing
const PROGRESS_STEPS = [
  "Uploading Invoice",
  "Processing OCR",
  "Extracting Line Items",
] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return "Invalid file type. Please upload a PDF, PNG, JPG, or JPEG file.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File is too large (${formatFileSize(file.size)}). Maximum size is 20 MB.`;
  }
  return null;
}

// ── Progress display during upload ────────────────────────────────────────────

type ProgressCardProps = {
  activeStep: number;
};

function ProgressCard({ activeStep }: ProgressCardProps) {
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
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(
    defaultSupplierId ?? suppliers[0]?.id ?? "",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advance progress steps during upload
  useEffect(() => {
    if (phase !== "uploading") return;
    setActiveStep(0);
    const t1 = setTimeout(() => { setActiveStep(1); }, 1200);
    const t2 = setTimeout(() => { setActiveStep(2); }, 4000);
    stepTimerRef.current = t2;
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
    if (phase === "uploading") return;
    if (e.target === e.currentTarget) onClose();
  }

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

    setPhase("uploading");
    setUploadError(null);

    try {
      const result = await apiClient.uploadSupplierInvoice(clinicId, selectedFile);
      onUploadSuccess(result);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed. Please try again.");
      setPhase("select");
    }
  }

  const activeSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const hasMultipleSuppliers = suppliers.length > 1;

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
          {phase !== "uploading" ? (
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

        {/* ── Upload & processing phase ── */}
        {phase === "uploading" ? (
          <ProgressCard activeStep={activeStep} />
        ) : (
          <div className="supplier-form">
            {/* Supplier selector */}
            {hasMultipleSuppliers ? (
              <label className="supplier-form__field">
                <span className="supplier-form__label">
                  Supplier <span className="supplier-form__required">*</span>
                </span>
                <select
                  className="supplier-form__control"
                  value={selectedSupplierId}
                  onChange={(e) => {
                    setSelectedSupplierId(e.target.value);
                  }}
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
            ) : null}

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
                      Drag & drop or{" "}
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

            {/* Upload error (from failed attempt) */}
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
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!selectedFile || !!fileError || !selectedSupplierId}
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
