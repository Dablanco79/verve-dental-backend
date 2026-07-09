import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { MasterProductSearchModal } from "../components/masterProduct/MasterProductSearchModal.js";
import { ProductMatchSuggestionCard } from "../components/masterProduct/ProductMatchSuggestionCard.js";
import { ConfirmModal } from "../components/supplier/ConfirmModal.js";
import { loadConfig } from "../config/index.js";
import type { AcceptedMatchOverride } from "../types/masterProduct.js";
import type {
  CatalogueImportConfirmResult,
  CatalogueImportPreviewResult,
  CatalogueImportRow,
  ReviewedCatalogueImportRow,
  Supplier,
  SupplierInvoice,
} from "../types/supplier.js";
import {
  analyseStructuredImportFile,
  buildSupplierSubsetFile,
  type StructuredImportAnalysis,
  type StructuredImportRow,
  type StructuredSupplierGroup,
} from "../utils/catalogueStructuredImport.js";
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
  | "Uploaded"
  | "Pending"
  | "Processing"
  | "Review Required"
  | "Imported"
  | "Cancelled"
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
  reviewPath: string | null;
  isLocalSession?: boolean;
};

type StructuredReviewGroup = {
  supplierName: string;
  matchedSupplier: Supplier | null;
  rows: StructuredImportRow[];
  preview: CatalogueImportPreviewResult | null;
  error: string | null;
};

type StructuredRowReviewState =
  | "Needs Review"
  | "Approved"
  | "Skipped"
  | "Ready to Create"
  | "Matched Existing Product";

type StructuredRowDraft = {
  productName: string;
  quantity: string;
  unitPrice: string;
  gst: string;
  supplierSku: string;
};

type StructuredReviewDisplayRow = {
  rowNumber: number;
  sourceRow: StructuredImportRow | null;
  previewRow: CatalogueImportRow | null;
};

type StructuredSupplierSummary = {
  supplierName: string;
  totalRows: number;
  approved: number;
  skipped: number;
  readyToCreate: number;
  matched: number;
  needsReview: number;
  estimatedNewProducts: number;
  estimatedPriceUpdates: number;
  stillRequiringReview: number;
};

type StructuredSessionMetadata = {
  id: string;
  fileName: string;
  uploadedAt: string;
};

type PersistedStructuredReviewSession = {
  version: 1;
  clinicId: string;
  userId: string;
  selectedSourceId: ImportSourceId;
  selectedSupplierId: string;
  metadata: StructuredSessionMetadata;
  uploadStatus: CatalogueImportStatus;
  processingSummary: string | null;
  structuredAnalysis: StructuredImportAnalysis | null;
  structuredReviewGroups: StructuredReviewGroup[];
  structuredRowStates: Record<string, StructuredRowReviewState>;
  structuredRowDrafts: Record<string, StructuredRowDraft>;
  supplierSelections: Record<string, string>;
};

function canCancelImportStatus(status: CatalogueImportStatus): boolean {
  return status === "Uploaded" || status === "Processing" || status === "Review Required";
}

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
    label: "Excel (.xlsx/.xls)",
    description: "Import structured supplier catalogue rows and pricing.",
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
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
] as const;

const STRUCTURED_SESSION_STORAGE_PREFIX = "verve.catalogueImport.structuredSession";

function getStructuredSessionStorageKey(clinicId: string, userId: string): string {
  return `${STRUCTURED_SESSION_STORAGE_PREFIX}.${clinicId}.${userId}`;
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadPersistedStructuredSession(
  clinicId: string,
  userId: string,
): PersistedStructuredReviewSession | null {
  if (!isBrowserStorageAvailable()) return null;
  const raw = window.localStorage.getItem(getStructuredSessionStorageKey(clinicId, userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; clinicId?: string; userId?: string };
    if (parsed.version !== 1 || parsed.clinicId !== clinicId || parsed.userId !== userId) return null;
    return parsed as PersistedStructuredReviewSession;
  } catch {
    return null;
  }
}

function savePersistedStructuredSession(session: PersistedStructuredReviewSession): void {
  if (!isBrowserStorageAvailable()) return;
  window.localStorage.setItem(
    getStructuredSessionStorageKey(session.clinicId, session.userId),
    JSON.stringify(session),
  );
}

function clearPersistedStructuredSession(clinicId: string | undefined, userId: string | undefined): void {
  if (!clinicId || !userId || !isBrowserStorageAvailable()) return;
  window.localStorage.removeItem(getStructuredSessionStorageKey(clinicId, userId));
}

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

function displayImportValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "Missing";
}

function parseMoneyToCents(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function isStructuredSource(sourceId: ImportSourceId): boolean {
  return sourceId === "csv" || sourceId === "xlsx";
}

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function mapInvoiceStatus(invoice: SupplierInvoice): CatalogueImportStatus {
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
    reviewPath: `/inventory/catalogue-import/${encodeURIComponent(invoice.id)}/review`,
  }));
}

function structuredRowKey(supplierName: string, rowNumber: number): string {
  return `${supplierName}::${String(rowNumber)}`;
}

function buildStructuredDisplayRows(group: StructuredReviewGroup): StructuredReviewDisplayRow[] {
  const sourceByRow = new Map(group.rows.map((row) => [row.rowNumber, row]));
  const previewByRow = new Map((group.preview?.rows ?? []).map((row) => [row.rowNumber, row]));
  const rowNumbers = new Set([...sourceByRow.keys(), ...previewByRow.keys()]);
  return Array.from(rowNumbers)
    .sort((a, b) => a - b)
    .map((rowNumber) => ({
      rowNumber,
      sourceRow: sourceByRow.get(rowNumber) ?? null,
      previewRow: previewByRow.get(rowNumber) ?? null,
    }));
}

function defaultStructuredRowState(row: StructuredReviewDisplayRow): StructuredRowReviewState {
  if (row.previewRow?.matchStatus === "unmatched" || row.previewRow?.error) {
    return "Needs Review";
  }
  return row.previewRow ? "Matched Existing Product" : "Needs Review";
}

function isStructuredTerminalState(state: StructuredRowReviewState): boolean {
  return (
    state === "Approved" ||
    state === "Skipped" ||
    state === "Ready to Create" ||
    state === "Matched Existing Product"
  );
}

function buildStructuredRowDraft(row: StructuredReviewDisplayRow): StructuredRowDraft {
  return {
    productName: row.sourceRow?.productName ?? row.previewRow?.description ?? "",
    quantity: row.sourceRow?.quantity ?? "",
    unitPrice: row.sourceRow?.unitPrice ?? row.previewRow?.rawUnitCost ?? "",
    gst: row.sourceRow?.gst ?? "",
    supplierSku: row.sourceRow?.supplierSku ?? row.previewRow?.supplierSku ?? "",
  };
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
  const location = useLocation();
  const navigate = useNavigate();
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
  const [pageToast, setPageToast] = useState<string | null>(null);
  const [structuredAnalysis, setStructuredAnalysis] = useState<StructuredImportAnalysis | null>(null);
  const [structuredReviewGroups, setStructuredReviewGroups] = useState<StructuredReviewGroup[]>([]);
  const [structuredRowStates, setStructuredRowStates] = useState<Record<string, StructuredRowReviewState>>({});
  const [structuredRowDrafts, setStructuredRowDrafts] = useState<Record<string, StructuredRowDraft>>({});
  const [editingStructuredRowKey, setEditingStructuredRowKey] = useState<string | null>(null);
  const [structuredSessionMetadata, setStructuredSessionMetadata] = useState<StructuredSessionMetadata | null>(null);
  const [supplierSelections, setSupplierSelections] = useState<Record<string, string>>({});
  // Product Matching Engine: stores the user-accepted master product override per row key
  const [structuredMatchOverrides, setStructuredMatchOverrides] = useState<Record<string, AcceptedMatchOverride>>({});
  // Which row is currently waiting for a "Choose Different" modal selection
  const [matchSearchTarget, setMatchSearchTarget] = useState<{
    group: StructuredReviewGroup;
    row: StructuredReviewDisplayRow;
    rowKey: string;
  } | null>(null);
  const [isAnalysingFile, setIsAnalysingFile] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ImportHistoryRow | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredStructuredSessionRef = useRef(false);
  const shouldPersistStructuredSessionRef = useRef(true);

  const selectedSource = IMPORT_SOURCES.find((source) => source.id === selectedSourceId) ?? DEFAULT_IMPORT_SOURCE;
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active).sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    [suppliers],
  );
  const selectedSupplier = activeSuppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const requiresSupplier = isStructuredSource(selectedSourceId) && !structuredAnalysis?.hasSupplierColumn;
  const hasStructuredReview = structuredReviewGroups.length > 0;
  const hasUnresolvedStructuredSuppliers =
    hasStructuredReview && structuredReviewGroups.some((group) => group.matchedSupplier === null);
  const hasUnreviewedStructuredRows =
    hasStructuredReview &&
    structuredReviewGroups.some((group) =>
      buildStructuredDisplayRows(group).some((row) => {
        const state = structuredRowStates[structuredRowKey(group.supplierName, row.rowNumber)] ?? defaultStructuredRowState(row);
        return !isStructuredTerminalState(state);
      }),
    );
  const canProcessStructuredReview =
    hasStructuredReview &&
    !hasUnresolvedStructuredSuppliers &&
    !hasUnreviewedStructuredRows;
  const structuredImportDisabledReason = !hasStructuredReview || canProcessStructuredReview
    ? null
    : hasUnresolvedStructuredSuppliers
      ? "Resolve supplier review before importing products."
      : "Review all product rows before importing products.";
  const canUpload =
    hasStructuredReview
      ? canUseCatalogueImport && canProcessStructuredReview && !isUploading && !isAllClinicsScope
      : canUseCatalogueImport &&
        !!selectedFile &&
        !fileError &&
        !isAnalysingFile &&
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

      if (!selectedClinicId || isAllClinicsScope) {
        setImports([]);
        return;
      }

      const invoiceImports = await apiClient.listClinicSupplierInvoices(selectedClinicId, { limit: 25 });
      const supplierNameById = new Map(supplierList.map((supplier) => [supplier.id, supplier.supplierName]));
      const invoiceHistory = buildHistoryFromInvoices(invoiceImports, supplierNameById);
      const persistedSession = loadPersistedStructuredSession(selectedClinicId, user.id);
      const localSessionRow: ImportHistoryRow | null = persistedSession
        ? {
            id: persistedSession.metadata.id,
            fileName: persistedSession.metadata.fileName,
            supplierName: `${String(persistedSession.structuredReviewGroups.length)} supplier review session`,
            uploadedAt: persistedSession.metadata.uploadedAt,
            status: persistedSession.uploadStatus,
            reviewPath: null,
            isLocalSession: true,
          }
        : null;
      setImports(localSessionRow ? [localSessionRow, ...invoiceHistory] : invoiceHistory);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Catalogue import workspace could not be loaded.");
      setSuppliers([]);
      setImports([]);
    } finally {
      setIsLoadingImports(false);
    }
  }, [canUseCatalogueImport, isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadImportWorkspace();
  }, [loadImportWorkspace]);

  useEffect(() => {
    if (
      restoredStructuredSessionRef.current ||
      !user ||
      !selectedClinicId ||
      isAllClinicsScope ||
      isLoadingImports ||
      selectedFile ||
      hasStructuredReview
    ) {
      return;
    }

    const persistedSession = loadPersistedStructuredSession(selectedClinicId, user.id);
    if (!persistedSession) {
      restoredStructuredSessionRef.current = true;
      return;
    }

    restoredStructuredSessionRef.current = true;
    shouldPersistStructuredSessionRef.current = true;
    setSelectedSourceId(persistedSession.selectedSourceId);
    setSupplierId(persistedSession.selectedSupplierId);
    setStructuredSessionMetadata(persistedSession.metadata);
    setStructuredAnalysis(persistedSession.structuredAnalysis);
    setStructuredReviewGroups(persistedSession.structuredReviewGroups);
    setStructuredRowStates(persistedSession.structuredRowStates);
    setStructuredRowDrafts(persistedSession.structuredRowDrafts);
    setSupplierSelections(persistedSession.supplierSelections);
    setUploadStatus(persistedSession.uploadStatus);
    setProcessingSummary(persistedSession.processingSummary);
    setPageToast("Restored your in-progress catalogue review.");
  }, [
    hasStructuredReview,
    isAllClinicsScope,
    isLoadingImports,
    selectedClinicId,
    selectedFile,
    user,
  ]);

  useEffect(() => {
    if (!shouldPersistStructuredSessionRef.current) return;
    if (!user || !selectedClinicId || !structuredSessionMetadata || structuredReviewGroups.length === 0) return;
    savePersistedStructuredSession({
      version: 1,
      clinicId: selectedClinicId,
      userId: user.id,
      selectedSourceId,
      selectedSupplierId: supplierId,
      metadata: structuredSessionMetadata,
      uploadStatus,
      processingSummary,
      structuredAnalysis,
      structuredReviewGroups,
      structuredRowStates,
      structuredRowDrafts,
      supplierSelections,
    });
  }, [
    processingSummary,
    selectedClinicId,
    selectedSourceId,
    structuredAnalysis,
    structuredReviewGroups,
    structuredRowDrafts,
    structuredRowStates,
    structuredSessionMetadata,
    supplierId,
    supplierSelections,
    uploadStatus,
    user,
  ]);

  useEffect(() => {
    const state = location.state as { toast?: string } | null;
    if (!state?.toast) return;
    setPageToast(state.toast);
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  async function applyFile(file: File): Promise<void> {
    shouldPersistStructuredSessionRef.current = true;
    const error = validateFile(file, selectedSource);
    setSelectedFile(file);
    setFileError(error);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Pending");
    setStructuredAnalysis(null);
    setStructuredReviewGroups([]);
    setStructuredRowStates({});
    setStructuredRowDrafts({});
    setStructuredSessionMetadata(null);
    setEditingStructuredRowKey(null);
    setSupplierSelections({});

    if (error || !isStructuredSource(selectedSourceId)) return;

    setIsAnalysingFile(true);
    try {
      const analysis = await analyseStructuredImportFile(file);
      setStructuredSessionMetadata({
        id: `structured-${String(Date.now())}`,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      });
      setStructuredAnalysis(analysis);
      if (analysis.hasSupplierColumn && analysis.supplierGroups.length === 0) {
        setFileError("The Supplier column is present, but no supplier names were found in the data rows.");
      }
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "The structured catalogue file could not be read.");
    } finally {
      setIsAnalysingFile(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void applyFile(file);
  }

  function handleSourceChange(sourceId: ImportSourceId): void {
    const nextSource = IMPORT_SOURCES.find((source) => source.id === sourceId);
    if (!nextSource || nextSource.disabled) return;

    shouldPersistStructuredSessionRef.current = false;
    setSelectedSourceId(sourceId);
    setSelectedFile(null);
    setFileError(null);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Pending");
    setStructuredAnalysis(null);
    setStructuredReviewGroups([]);
    setStructuredRowStates({});
    setStructuredRowDrafts({});
    setStructuredSessionMetadata(null);
    setEditingStructuredRowKey(null);
    setSupplierSelections({});
    setSupplierId("");
    clearPersistedStructuredSession(selectedClinicId, user?.id);
  }

  function addLocalImport(row: ImportHistoryRow): void {
    setImports((current) => [row, ...current.filter((item) => item.id !== row.id)]);
  }

  function resetStructuredReviewSession(options: { clearStorage?: boolean } = {}): void {
    shouldPersistStructuredSessionRef.current = false;
    if (options.clearStorage) {
      clearPersistedStructuredSession(selectedClinicId, user?.id);
    }
    setSelectedFile(null);
    setFileError(null);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Pending");
    setStructuredAnalysis(null);
    setStructuredReviewGroups([]);
    setStructuredRowStates({});
    setStructuredRowDrafts({});
    setStructuredSessionMetadata(null);
    setEditingStructuredRowKey(null);
    setSupplierSelections({});
    setSupplierId("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function findSupplierByImportedName(supplierName: string): Supplier | null {
    const normalized = supplierName.trim().toLowerCase();
    return activeSuppliers.find((supplier) => supplier.supplierName.trim().toLowerCase() === normalized) ?? null;
  }

  function buildStructuredReviewGroup(
    group: StructuredSupplierGroup,
    preview: CatalogueImportPreviewResult | null,
    error: string | null,
    supplierOverride?: Supplier | null,
  ): StructuredReviewGroup {
    return {
      supplierName: group.supplierName,
      matchedSupplier: supplierOverride ?? findSupplierByImportedName(group.supplierName),
      rows: group.rows,
      preview,
      error,
    };
  }

  function upsertStructuredReviewGroup(nextGroup: StructuredReviewGroup): void {
    setStructuredReviewGroups((current) =>
      current.map((group) => (group.supplierName === nextGroup.supplierName ? nextGroup : group)),
    );
  }

  function getStructuredRowState(group: StructuredReviewGroup, row: StructuredReviewDisplayRow): StructuredRowReviewState {
    return structuredRowStates[structuredRowKey(group.supplierName, row.rowNumber)] ?? defaultStructuredRowState(row);
  }

  function setStructuredRowState(group: StructuredReviewGroup, row: StructuredReviewDisplayRow, state: StructuredRowReviewState): void {
    const key = structuredRowKey(group.supplierName, row.rowNumber);
    setStructuredRowStates((current) => ({ ...current, [key]: state }));
    if (editingStructuredRowKey === key) {
      setEditingStructuredRowKey(null);
    }
  }

  function startEditingStructuredRow(group: StructuredReviewGroup, row: StructuredReviewDisplayRow): void {
    const key = structuredRowKey(group.supplierName, row.rowNumber);
    setStructuredRowDrafts((current) => ({
      ...current,
      [key]: current[key] ?? buildStructuredRowDraft(row),
    }));
    setEditingStructuredRowKey(key);
  }

  function updateStructuredRowDraft(
    key: string,
    field: keyof StructuredRowDraft,
    value: string,
  ): void {
    setStructuredRowDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { productName: "", quantity: "", unitPrice: "", gst: "", supplierSku: "" }),
        [field]: value,
      },
    }));
  }

  function saveStructuredRowEdit(group: StructuredReviewGroup, row: StructuredReviewDisplayRow): void {
    void group;
    void row;
    setEditingStructuredRowKey(null);
  }

  function setAllStructuredGroupRows(group: StructuredReviewGroup, state: StructuredRowReviewState): void {
    const rows = buildStructuredDisplayRows(group);
    setStructuredRowStates((current) => ({
      ...current,
      ...Object.fromEntries(rows.map((row) => [structuredRowKey(group.supplierName, row.rowNumber), state])),
    }));
    setEditingStructuredRowKey(null);
  }

  function markUnmatchedStructuredGroupRowsForCreate(group: StructuredReviewGroup): void {
    const unmatchedRows = buildStructuredDisplayRows(group).filter(
      (row) => row.previewRow?.matchStatus === "unmatched" || row.previewRow?.error,
    );
    setStructuredRowStates((current) => ({
      ...current,
      ...Object.fromEntries(
        unmatchedRows.map((row) => [
          structuredRowKey(group.supplierName, row.rowNumber),
          "Ready to Create" satisfies StructuredRowReviewState,
        ]),
      ),
    }));
    setEditingStructuredRowKey(null);
  }

  function getStructuredSupplierSummary(group: StructuredReviewGroup): StructuredSupplierSummary {
    const rows = buildStructuredDisplayRows(group);
    const states = rows.map((row) => getStructuredRowState(group, row));
    const estimatedPriceUpdates = rows.filter((row) => {
      const state = getStructuredRowState(group, row);
      return !!row.previewRow?.matchedProductId && (state === "Approved" || state === "Matched Existing Product");
    }).length;
    return {
      supplierName: group.supplierName,
      totalRows: rows.length,
      approved: states.filter((state) => state === "Approved").length,
      skipped: states.filter((state) => state === "Skipped").length,
      readyToCreate: states.filter((state) => state === "Ready to Create").length,
      matched: states.filter((state) => state === "Matched Existing Product").length,
      needsReview: states.filter((state) => state === "Needs Review").length,
      estimatedNewProducts: states.filter((state) => state === "Ready to Create").length,
      estimatedPriceUpdates,
      stillRequiringReview: states.filter((state) => !isStructuredTerminalState(state)).length,
    };
  }

  async function handleCancelImport(): Promise<void> {
    if (!cancelTarget || !selectedClinicId || !canCancelImportStatus(cancelTarget.status)) return;

    if (cancelTarget.isLocalSession) {
      resetStructuredReviewSession({ clearStorage: true });
      setImports((current) => current.filter((item) => item.id !== cancelTarget.id));
      setPageToast("Import cancelled.");
      setCancelTarget(null);
      return;
    }

    setIsCancelling(true);
    setLoadError(null);
    try {
      await apiClient.cancelSupplierInvoiceImport(selectedClinicId, cancelTarget.id);
      setImports((current) =>
        current.map((item) => (item.id === cancelTarget.id ? { ...item, status: "Cancelled" } : item)),
      );
      setPageToast("Import cancelled.");
      setCancelTarget(null);
      await loadImportWorkspace();
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Catalogue import could not be cancelled.");
      throw err;
    } finally {
      setIsCancelling(false);
    }
  }

  function summarizePreview(preview: CatalogueImportPreviewResult): string {
    return `${String(preview.totalRows)} rows checked: ${String(preview.matchedRows)} matched, ${String(preview.unmatchedRows)} unmatched, ${String(preview.errorRows)} with errors.`;
  }

  function summarizeConfirm(confirm: CatalogueImportConfirmResult): string {
    return `${String(confirm.imported)} imported, ${String(confirm.updated)} updated, ${String(confirm.skipped)} skipped, ${String(confirm.errors)} failed.`;
  }

  async function previewStructuredSupplierGroup(
    analysis: StructuredImportAnalysis,
    group: StructuredSupplierGroup,
    supplier: Supplier,
  ): Promise<CatalogueImportPreviewResult> {
    const originalFileName = selectedFile?.name ?? structuredSessionMetadata?.fileName;
    if (!originalFileName) throw new Error("Select a structured catalogue file before previewing suppliers.");
    const supplierFile = buildSupplierSubsetFile(originalFileName, analysis, group);
    return apiClient.previewSupplierCatalogueImport(supplier.id, supplierFile);
  }

  async function handleStructuredSupplierFile(analysis: StructuredImportAnalysis): Promise<void> {
    if (!selectedFile) return;

    const reviewGroups: StructuredReviewGroup[] = [];
    let matchedSupplierCount = 0;
    let previewedRowCount = 0;

    for (const group of analysis.supplierGroups) {
      const matchedSupplier = findSupplierByImportedName(group.supplierName);
      if (!matchedSupplier) {
        reviewGroups.push(buildStructuredReviewGroup(group, null, null, null));
        continue;
      }

      matchedSupplierCount++;
      try {
        const preview = await previewStructuredSupplierGroup(analysis, group, matchedSupplier);
        previewedRowCount += preview.totalRows;
        reviewGroups.push(buildStructuredReviewGroup(group, preview, null, matchedSupplier));
      } catch (err: unknown) {
        reviewGroups.push(
          buildStructuredReviewGroup(
            group,
            null,
            err instanceof Error ? err.message : "Catalogue preview failed for this supplier.",
            matchedSupplier,
          ),
        );
      }
    }

    setStructuredReviewGroups(reviewGroups);
    const metadata = structuredSessionMetadata ?? {
      id: `structured-${String(Date.now())}`,
      fileName: selectedFile.name,
      uploadedAt: new Date().toISOString(),
    };
    setStructuredSessionMetadata(metadata);
    addLocalImport({
      id: metadata.id,
      fileName: metadata.fileName,
      supplierName: `${String(analysis.supplierGroups.length)} suppliers detected`,
      uploadedAt: metadata.uploadedAt,
      status: "Review Required",
      reviewPath: null,
      isLocalSession: true,
    });
    setUploadStatus("Review Required");
    setProcessingSummary(
      `${String(analysis.supplierGroups.length)} suppliers detected; ${String(matchedSupplierCount)} matched existing suppliers. ${String(previewedRowCount)} rows are ready for supplier-group review.`,
    );
  }

  async function handleAssignSupplier(group: StructuredReviewGroup, supplier: Supplier): Promise<void> {
    if (!structuredAnalysis) return;

    const sourceGroup = structuredAnalysis.supplierGroups.find((candidate) => candidate.supplierName === group.supplierName);
    if (!sourceGroup) return;

    try {
      const preview = await previewStructuredSupplierGroup(structuredAnalysis, sourceGroup, supplier);
      upsertStructuredReviewGroup({
        supplierName: group.supplierName,
        matchedSupplier: supplier,
        rows: group.rows,
        preview,
        error: null,
      });
    } catch (err: unknown) {
      upsertStructuredReviewGroup({
        supplierName: group.supplierName,
        matchedSupplier: supplier,
        rows: group.rows,
        preview: null,
        error: err instanceof Error ? err.message : "Catalogue preview failed for this supplier.",
      });
    }
  }

  async function handleCreateSupplierForGroup(group: StructuredReviewGroup): Promise<void> {
    const created = await apiClient.createSupplier({ supplierName: group.supplierName });
    setSuppliers((current) => [...current, created]);
    await handleAssignSupplier(group, created);
  }

  function buildReviewedRowsForGroup(group: StructuredReviewGroup): ReviewedCatalogueImportRow[] {
    return buildStructuredDisplayRows(group).map((row) => {
      const key = structuredRowKey(group.supplierName, row.rowNumber);
      const draft = structuredRowDrafts[key] ?? buildStructuredRowDraft(row);
      const state = getStructuredRowState(group, row);
      // Use accepted match override if present, otherwise fall back to preview match
      const override = structuredMatchOverrides[key];
      const matchedProductId =
        override?.masterProductId ?? row.previewRow?.matchedProductId ?? null;
      return {
        rowNumber: row.rowNumber,
        state: state === "Needs Review" ? "Skipped" : state,
        supplierSku: draft.supplierSku.trim() || null,
        description: draft.productName.trim() || null,
        unitCostCents: parseMoneyToCents(draft.unitPrice) ?? row.previewRow?.unitCostCents ?? null,
        unitOfMeasure: draft.quantity.trim() || (row.previewRow?.unitOfMeasure ?? null),
        matchedProductId,
      };
    });
  }

  function acceptStructuredRowMatch(
    group: StructuredReviewGroup,
    row: StructuredReviewDisplayRow,
    override: AcceptedMatchOverride,
  ): void {
    const key = structuredRowKey(group.supplierName, row.rowNumber);
    setStructuredMatchOverrides((current) => ({ ...current, [key]: override }));
    setStructuredRowState(group, row, "Matched Existing Product");
  }

  function undoStructuredRowMatch(
    group: StructuredReviewGroup,
    row: StructuredReviewDisplayRow,
  ): void {
    const key = structuredRowKey(group.supplierName, row.rowNumber);
    setStructuredMatchOverrides((current) => {
      const { [key]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
    setStructuredRowState(group, row, defaultStructuredRowState(row));
  }

  async function handleProcessStructuredReview(): Promise<void> {
    if (!canProcessStructuredReview) {
      setUploadError("Review all structured rows and match every supplier before importing. Rows must be approved, skipped, matched to an existing product, or marked ready to create.");
      return;
    }
    if (!selectedClinicId || !structuredSessionMetadata) return;

    setIsUploading(true);
    setUploadError(null);
    setProcessingSummary(null);
    setUploadStatus("Processing");

    try {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      let createdProducts = 0;

      for (const group of structuredReviewGroups) {
        if (!group.matchedSupplier) continue;
        const result = await apiClient.confirmReviewedSupplierCatalogueImport(group.matchedSupplier.id, {
          clinicId: selectedClinicId,
          rows: buildReviewedRowsForGroup(group),
        });
        imported += result.imported;
        updated += result.updated;
        skipped += result.skipped;
        errors += result.errors;
        createdProducts += result.createdProducts;
      }

      if (errors > 0) {
        setUploadStatus("Review Required");
        setUploadError(`${String(errors)} reviewed catalogue rows could not be imported. Please review the row data and try again.`);
        setProcessingSummary(`${String(imported)} imported, ${String(updated)} updated, ${String(skipped)} skipped, ${String(createdProducts)} products created.`);
        return;
      }

      const completedSessionId = structuredSessionMetadata.id;
      resetStructuredReviewSession({ clearStorage: true });
      setUploadStatus("Imported");
      setPageToast(
        `Catalogue import completed. ${String(createdProducts)} products created, ${String(imported)} imported, ${String(updated)} updated, ${String(skipped)} skipped.`,
      );
      setImports((current) =>
        current.map((item) => (
          item.id === completedSessionId
            ? { ...item, status: "Imported", isLocalSession: false }
            : item
        )),
      );
    } catch (err: unknown) {
      setUploadStatus("Failed");
      setUploadError(err instanceof Error ? err.message : "Reviewed catalogue rows could not be imported.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleUpload(): Promise<void> {
    if (hasStructuredReview) {
      void handleProcessStructuredReview();
      return;
    }

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
          reviewPath: null,
        });
        setUploadStatus("Review Required");
        setProcessingSummary("Catalogue PDF uploaded for manual review. Automated catalogue PDF extraction is not available yet.");
        return;
      }

      if (isStructuredSource(selectedSourceId) && structuredAnalysis?.hasSupplierColumn) {
        await handleStructuredSupplierFile(structuredAnalysis);
        return;
      }

      if (isStructuredSource(selectedSourceId) && selectedSupplier) {
        const preview = await apiClient.previewSupplierCatalogueImport(selectedSupplier.id, selectedFile);
        if (preview.unmatchedRows > 0 || preview.errorRows > 0) {
          const metadata = structuredSessionMetadata ?? {
            id: `preview-${String(Date.now())}`,
            fileName: selectedFile.name,
            uploadedAt: new Date().toISOString(),
          };
          setStructuredSessionMetadata(metadata);
          setStructuredReviewGroups([
            {
              supplierName: selectedSupplier.supplierName,
              matchedSupplier: selectedSupplier,
              rows: [],
              preview,
              error: null,
            },
          ]);
          addLocalImport({
            id: metadata.id,
            fileName: metadata.fileName,
            supplierName: selectedSupplier.supplierName,
            uploadedAt: metadata.uploadedAt,
            status: "Review Required",
            reviewPath: null,
            isLocalSession: true,
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
          reviewPath: null,
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
        reviewPath: `/inventory/catalogue-import/${encodeURIComponent(result.invoice.id)}/review`,
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
          <div className="catalogue-import-table__actions">
            {hasStructuredReview || selectedFile ? (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  resetStructuredReviewSession({ clearStorage: true });
                  setPageToast("Started a new catalogue import.");
                }}
              >
                New Import
              </button>
            ) : null}
            <Link to="/inventory" className="link-button">
              Back to Inventory
            </Link>
          </div>
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

        {pageToast ? <p className="inventory-notice--inline" role="status">{pageToast}</p> : null}

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
                <span className="catalogue-import-page__safety-note">
                  Required when a CSV or Excel file does not include a Supplier column.
                </span>
              </label>
            ) : null}
            {isStructuredSource(selectedSourceId) && structuredAnalysis?.hasSupplierColumn ? (
              <div className="inventory-receiving-callout" role="status">
                <h3>Supplier column detected</h3>
                <p>
                  Supplier preselection is not required. Rows will be grouped by supplier for review.
                </p>
              </div>
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
                  if (file) void applyFile(file);
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
            {isAnalysingFile ? <p className="loading-message">Checking structured file columns...</p> : null}
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
                {hasStructuredReview ? (isUploading ? "Importing..." : "Import Reviewed Products") : isUploading ? "Processing..." : "Upload & Process"}
              </button>
              <span className="catalogue-import-page__safety-note">
                No inventory adjustments, stock quantity changes, or receiving timeline events are created.
              </span>
            </div>
            {structuredImportDisabledReason ? (
              <p className="catalogue-import-page__safety-note" role="status">
                {structuredImportDisabledReason}
              </p>
            ) : null}
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

      {structuredReviewGroups.length > 0 ? (
        <section className="status-card inventory-page__section">
          <div className="status-card__header">
            <div>
              <h2>Structured Supplier Review</h2>
              <p className="inventory-page__subtitle">
                CSV and Excel catalogue rows are grouped by supplier. This workflow reviews catalogue data only and does not change stock quantities.
              </p>
            </div>
          </div>
          <div className="catalogue-structured-review">
            {structuredReviewGroups.map((group) => (
              <article key={group.supplierName} className="catalogue-structured-review__group">
                <div className="status-card__header">
                  <div>
                    <h3>{group.supplierName}</h3>
                    <p className="inventory-page__subtitle">
                      {group.matchedSupplier
                        ? `Matched existing supplier: ${group.matchedSupplier.supplierName}`
                        : "No existing supplier match found."}
                    </p>
                  </div>
                  <span className={`catalogue-status catalogue-status--${group.matchedSupplier ? "imported" : "review-required"}`}>
                    {group.matchedSupplier ? "Supplier Matched" : "Supplier Review Required"}
                  </span>
                </div>

                {!group.matchedSupplier ? (
                  <div className="catalogue-structured-review__supplier-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        void handleCreateSupplierForGroup(group);
                      }}
                    >
                      Create Supplier
                    </button>
                    <label className="scan-form__field catalogue-structured-review__match-field">
                      Match Existing
                      <select
                        value={supplierSelections[group.supplierName] ?? ""}
                        onChange={(event) => {
                          setSupplierSelections((current) => ({
                            ...current,
                            [group.supplierName]: event.target.value,
                          }));
                        }}
                      >
                        <option value="">Select supplier...</option>
                        {activeSuppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.supplierName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="link-button"
                      disabled={!supplierSelections[group.supplierName]}
                      onClick={() => {
                        const supplier = activeSuppliers.find((candidate) => candidate.id === supplierSelections[group.supplierName]);
                        if (supplier) void handleAssignSupplier(group, supplier);
                      }}
                    >
                      Apply Match
                    </button>
                  </div>
                ) : null}

                {group.error ? <p className="status-card__error" role="alert">{group.error}</p> : null}
                {(() => {
                  const summary = getStructuredSupplierSummary(group);
                  return (
                    <>
                      <dl className="po-summary__stats catalogue-structured-review__summary">
                        <div>
                          <dt>Supplier</dt>
                          <dd>{summary.supplierName}</dd>
                        </div>
                        <div>
                          <dt>Rows</dt>
                          <dd>{summary.totalRows}</dd>
                        </div>
                        <div>
                          <dt>Approved</dt>
                          <dd>{summary.approved}</dd>
                        </div>
                        <div>
                          <dt>Skipped</dt>
                          <dd>{summary.skipped}</dd>
                        </div>
                        <div>
                          <dt>Ready to create</dt>
                          <dd>{summary.readyToCreate}</dd>
                        </div>
                        <div>
                          <dt>Matched</dt>
                          <dd>{summary.matched}</dd>
                        </div>
                        <div>
                          <dt>Needs review</dt>
                          <dd>{summary.needsReview}</dd>
                        </div>
                        <div>
                          <dt>Estimated new products</dt>
                          <dd>{summary.estimatedNewProducts}</dd>
                        </div>
                        <div>
                          <dt>Estimated price updates</dt>
                          <dd>{summary.estimatedPriceUpdates}</dd>
                        </div>
                      </dl>
                      <div className="catalogue-structured-review__bulk-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            // Only approve rows that already have a matched product —
                            // unmatched rows must be resolved via Match Existing, Create Product, or Skip.
                            const rows = buildStructuredDisplayRows(group);
                            setStructuredRowStates((current) => ({
                              ...current,
                              ...Object.fromEntries(
                                rows
                                  .filter((r) => {
                                    const k = structuredRowKey(group.supplierName, r.rowNumber);
                                    return !!(structuredMatchOverrides[k]?.masterProductId ?? r.previewRow?.matchedProductId);
                                  })
                                  .map((r) => [structuredRowKey(group.supplierName, r.rowNumber), "Approved" satisfies StructuredRowReviewState]),
                              ),
                            }));
                            setEditingStructuredRowKey(null);
                          }}
                        >
                          Approve all matched rows
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            setAllStructuredGroupRows(group, "Skipped");
                          }}
                        >
                          Skip all visible rows
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            markUnmatchedStructuredGroupRowsForCreate(group);
                          }}
                        >
                          Mark all unmatched as Ready to Create
                        </button>
                      </div>
                    </>
                  );
                })()}

                <div className="inventory-table-wrap">
                  <table className="inventory-table catalogue-import-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Supplier SKU</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Unit Price</th>
                        <th>GST</th>
                        <th>Match status</th>
                        <th>Review state</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buildStructuredDisplayRows(group).map((row) => {
                        const key = structuredRowKey(group.supplierName, row.rowNumber);
                        const state = getStructuredRowState(group, row);
                        const isEditing = editingStructuredRowKey === key;
                        const draft = structuredRowDrafts[key] ?? buildStructuredRowDraft(row);
                        const supplierSku = displayImportValue(draft.supplierSku);
                        const productName = displayImportValue(draft.productName);
                        const quantity = displayImportValue(draft.quantity);
                        const unitPrice = displayImportValue(draft.unitPrice);
                        const gst = displayImportValue(draft.gst);
                        const matchStatus = row.previewRow
                          ? row.previewRow.error ?? (row.previewRow.matchStatus === "unmatched" ? "Unmatched product" : `Matched by ${row.previewRow.matchStatus}`)
                          : "Pending supplier match";

                        return (
                          <tr key={row.rowNumber}>
                            <td>{row.rowNumber}</td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={draft.supplierSku}
                                  onChange={(event) => {
                                    updateStructuredRowDraft(key, "supplierSku", event.target.value);
                                  }}
                                  aria-label={`Supplier SKU for structured row ${String(row.rowNumber)}`}
                                />
                              ) : (
                                supplierSku
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={draft.productName}
                                  onChange={(event) => {
                                    updateStructuredRowDraft(key, "productName", event.target.value);
                                  }}
                                  aria-label={`Product name for structured row ${String(row.rowNumber)}`}
                                />
                              ) : (
                                productName
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={draft.quantity}
                                  onChange={(event) => {
                                    updateStructuredRowDraft(key, "quantity", event.target.value);
                                  }}
                                  aria-label={`Quantity for structured row ${String(row.rowNumber)}`}
                                />
                              ) : (
                                quantity
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={draft.unitPrice}
                                  onChange={(event) => {
                                    updateStructuredRowDraft(key, "unitPrice", event.target.value);
                                  }}
                                  aria-label={`Unit price for structured row ${String(row.rowNumber)}`}
                                />
                              ) : (
                                unitPrice
                              )}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="catalogue-review__edit-input"
                                  value={draft.gst}
                                  onChange={(event) => {
                                    updateStructuredRowDraft(key, "gst", event.target.value);
                                  }}
                                  aria-label={`GST for structured row ${String(row.rowNumber)}`}
                                />
                              ) : (
                                gst
                              )}
                            </td>
                            <td>{matchStatus}</td>
                            <td>
                              <span className={`catalogue-line-state catalogue-line-state--${state.toLowerCase().replace(/\s+/g, "-")}`}>
                                {state}
                              </span>
                              {state === "Ready to Create" ? (
                                <span className="catalogue-structured-review__create-note">
                                  Creates catalogue product only. Does not change stock.
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <div className="catalogue-review__line-actions">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => {
                                        saveStructuredRowEdit(group, row);
                                      }}
                                    >
                                      Save edit
                                    </button>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => {
                                        setEditingStructuredRowKey(null);
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  state === "Ready to Create" ? (
                                    <>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          startEditingStructuredRow(group, row);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          setStructuredRowState(group, row, defaultStructuredRowState(row));
                                        }}
                                      >
                                        Undo
                                      </button>
                                    </>
                                  ) : state === "Matched Existing Product" ? (
                                    <>
                                      <span className="catalogue-review__match-label">
                                        {structuredMatchOverrides[key]?.displayName
                                          ?? row.previewRow?.matchedProductName
                                          ?? "Matched"}
                                      </span>
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => {
                                          undoStructuredRowMatch(group, row);
                                        }}
                                      >
                                        Undo
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {row.previewRow?.matchedProductId ? (
                                        <ProductMatchSuggestionCard
                                          suggestion={{
                                            masterProductId: row.previewRow.matchedProductId,
                                            displayName: row.previewRow.matchedProductName ?? row.previewRow.matchedProductId,
                                            sku: row.previewRow.matchedProductSku ?? "",
                                            category: "",
                                            brand: null,
                                            stockUnit: "",
                                            confidence: row.previewRow.matchStatus === "barcode"
                                              ? 100
                                              : row.previewRow.matchStatus === "sku"
                                                ? 95
                                                : 85,
                                            reasons: row.previewRow.matchStatus === "barcode"
                                              ? ["supplier_sku_mapping"]
                                              : row.previewRow.matchStatus === "sku"
                                                ? ["exact_name"]
                                                : ["token_similarity"],
                                          }}
                                          onAccept={() => {
                                            if (row.previewRow?.matchedProductId) {
                                              acceptStructuredRowMatch(group, row, {
                                                masterProductId: row.previewRow.matchedProductId,
                                                displayName: row.previewRow.matchedProductName ?? row.previewRow.matchedProductId,
                                                sku: row.previewRow.matchedProductSku ?? "",
                                              });
                                            }
                                          }}
                                          onChooseDifferent={() => {
                                            setMatchSearchTarget({ group, row, rowKey: key });
                                          }}
                                          onCreateNew={() => {
                                            setStructuredRowState(group, row, "Ready to Create");
                                          }}
                                          onSkip={() => {
                                            setStructuredRowState(group, row, "Skipped");
                                          }}
                                        />
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => {
                                              startEditingStructuredRow(group, row);
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => {
                                              setStructuredRowState(group, row, "Skipped");
                                            }}
                                          >
                                            Skip
                                          </button>
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => {
                                              setMatchSearchTarget({ group, row, rowKey: key });
                                            }}
                                          >
                                            Match Existing
                                          </button>
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => {
                                              setStructuredRowState(group, row, "Ready to Create");
                                            }}
                                          >
                                            Create Product
                                          </button>
                                        </>
                                      )}
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
              </article>
            ))}
          </div>
        </section>
      ) : null}

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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => {
                  const canCancel = canCancelImportStatus(item.status);
                  const primaryActionLabel = item.status === "Review Required" ? "Review" : "View";

                  return (
                    <tr key={item.id}>
                      <td>{item.fileName}</td>
                      <td>{item.supplierName}</td>
                      <td>{formatUploadDate(item.uploadedAt)}</td>
                      <td>
                        <span className={`catalogue-status catalogue-status--${item.status.toLowerCase().replace(/\s+/g, "-")}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        <div className="catalogue-import-table__actions">
                          {item.reviewPath ? (
                            <Link
                              to={item.reviewPath}
                              className="link-button"
                            >
                              {primaryActionLabel}
                              <span className="visually-hidden"> {item.fileName}</span>
                            </Link>
                          ) : (
                            <span className="inventory-table__meta">
                              {item.status === "Review Required" ? "Review on page" : "No invoice review"}
                            </span>
                          )}
                          {canCancel ? (
                            <button
                              type="button"
                              className="link-button catalogue-review__cancel-button"
                              onClick={() => {
                                setCancelTarget(item);
                              }}
                              disabled={isCancelling}
                            >
                              Cancel
                              <span className="visually-hidden"> {item.fileName}</span>
                            </button>
                          ) : null}
                          {item.status === "Failed" ? (
                            <button
                              type="button"
                              className="link-button"
                              disabled
                              title="Retry will be available when the backend exposes it."
                            >
                              Retry
                              <span className="visually-hidden"> {item.fileName}</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {cancelTarget ? (
        <ConfirmModal
          title="Cancel Import?"
          message={`This will discard ${cancelTarget.fileName} and all extracted catalogue review data. No products, pricing or inventory changes will be saved.`}
          cancelLabel="Keep Import"
          confirmLabel={isCancelling ? "Cancelling..." : "Cancel Import"}
          confirmVariant="danger"
          onClose={() => {
            if (!isCancelling) setCancelTarget(null);
          }}
          onConfirm={handleCancelImport}
        />
      ) : null}
      <MasterProductSearchModal
        isOpen={matchSearchTarget !== null}
        title="Choose Master Product"
        onClose={() => {
          setMatchSearchTarget(null);
        }}
        onSelect={(product) => {
          if (matchSearchTarget) {
            acceptStructuredRowMatch(matchSearchTarget.group, matchSearchTarget.row, {
              masterProductId: product.id,
              displayName: product.displayName,
              sku: product.sku,
            });
          }
          setMatchSearchTarget(null);
        }}
      />
    </AppShell>
  );
}
