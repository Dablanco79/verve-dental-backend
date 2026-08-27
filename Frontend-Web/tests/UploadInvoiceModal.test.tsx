/**
 * UploadInvoiceModal tests — Smart Supplier Detection.
 *
 * Covers:
 *   ── Rendering ──────────────────────────────────────────────────────────────
 *   1.  Renders dialog with title
 *   2.  Manual mode: single supplier shown readonly
 *   3.  Manual mode: supplier dropdown shown for multiple suppliers
 *   4.  Auto-detect mode: shows hint instead of supplier dropdown
 *   5.  File drop zone renders
 *   6.  Upload & Process button renders
 *   7.  Cancel button renders
 *   ── Validation ─────────────────────────────────────────────────────────────
 *   8.  Button disabled when no file selected
 *   9.  Invalid file type error
 *   10. File too large error
 *   11. Enabled after valid file selected
 *   12. Selected file name shown
 *   ── Manual supplier upload (preserve current behaviour) ────────────────────
 *   13. Calls uploadSupplierInvoice then updateSupplierInvoice then onUploadSuccess
 *   ── Auto-detect: matched supplier ──────────────────────────────────────────
 *   14. Shows "Supplier matched" badge with supplier name
 *   15. Continue to Review calls onUploadSuccess
 *   ── Auto-detect: needs_confirmation ────────────────────────────────────────
 *   16. Shows "New supplier detected" badge with detected fields
 *   17. Create Supplier & Continue creates supplier then attaches
 *   18. Choose Existing Supplier navigates to supplier picker step
 *   ── Auto-detect: not_detected ──────────────────────────────────────────────
 *   19. Shows "Supplier not detected" message
 *   20. Choose Existing from not_detected shows supplier picker
 *   ── No silent supplier creation ────────────────────────────────────────────
 *   21. createSupplier NOT called unless user explicitly clicks Create Supplier
 *   ── Upload failure ──────────────────────────────────────────────────────────
 *   22. Shows error and retry button on failure
 *   ── Close ──────────────────────────────────────────────────────────────────
 *   23. Cancel closes modal
 *   24. × close button closes modal
 *   ── Progress ───────────────────────────────────────────────────────────────
 *   25. Progress steps shown during upload
 *   26. Close button hidden during upload
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadInvoiceModal } from "../src/components/supplier/UploadInvoiceModal.js";
import type { Supplier, SupplierInvoiceLine, UploadAndExtractResult } from "../src/types/supplier.js";
import { TEST_CLINIC_ID } from "./helpers/auth.js";

// ── Mock API client ───────────────────────────────────────────────────────────

const {
  mockUploadSupplierInvoice,
  mockUpdateSupplierInvoice,
  mockGetSupplierInvoice,
  mockCreateSupplier,
} = vi.hoisted(() => ({
  mockUploadSupplierInvoice: vi.fn(),
  mockUpdateSupplierInvoice: vi.fn(),
  mockGetSupplierInvoice: vi.fn(),
  mockCreateSupplier: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    uploadSupplierInvoice: mockUploadSupplierInvoice,
    updateSupplierInvoice: mockUpdateSupplierInvoice,
    getSupplierInvoice: mockGetSupplierInvoice,
    createSupplier: mockCreateSupplier,
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const supplierMetaDefaults = {
  legalName: null,
  tradingName: null,
  countryCode: "AU",
  currencyCode: "AUD",
  industryCategory: null,
  healthcareSubcategory: null,
  supplierCategory: null,
  verified: false,
  apiAvailable: false,
  catalogueAvailable: false,
  livePricing: false,
  onlineOrdering: false,
  preferredCommMethod: null,
  logoStorageKey: null,
  createdByClinicId: null,
  isPublic: true,
};

const dentalCo: Supplier = {
  id: "sup-1111",
  supplierName: "DentalCo Australia",
  supplierCode: "DCO",
  contactName: "Jane Smith",
  email: "orders@dentalco.com.au",
  phone: null,
  website: null,
  abn: "12 345 678 901",
  address: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...supplierMetaDefaults,
};

const burDirect: Supplier = {
  id: "sup-2222",
  supplierName: "BurDirect",
  supplierCode: null,
  contactName: null,
  email: null,
  phone: null,
  website: null,
  abn: null,
  address: null,
  notes: null,
  active: true,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...supplierMetaDefaults,
};

function makeSampleInvoice(supplierId: string | null = "sup-1111", supplierName: string | null = null) {
  return {
    id: "inv-aaaa",
    clinicId: TEST_CLINIC_ID,
    supplierId,
    supplierName,
    supplierNameRaw: "DentalCo Australia",
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    dueDate: null,
    status: "pending_review" as const,
    subtotalCents: 10000,
    taxCents: 1000,
    totalCents: 11000,
    currency: "AUD",
    ocrProvider: "claude",
    ocrConfidence: 95,
    originalFilename: "invoice.pdf",
    fileMimeType: "application/pdf",
    importedByUserId: "user-1",
    importedByEmail: "admin@clinic-a.au",
    confirmedByUserId: null,
    confirmedAt: null,
    voidedByUserId: null,
    voidedAt: null,
    receivedAt: null,
    receivedByUserId: null,
    receivedReference: null,
    notes: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

/** Upload result where backend matched the supplier automatically. */
const matchedUploadResult: UploadAndExtractResult = {
  invoice: makeSampleInvoice("sup-1111"),
  lines: [],
  duplicateFileWarning: null,
  duplicateInvoiceNumberWarning: null,
  detectedSupplier: {
    supplierName: "DentalCo Australia",
    abn: "12 345 678 901",
    email: null,
    phone: null,
    address: null,
    website: null,
  },
  matchedSupplier: dentalCo,
  supplierMatchStatus: "matched",
  supplierExists: true,
  relationshipExists: true,
};

/** Upload result where OCR detected a name but no existing supplier matched. */
const needsConfirmationResult: UploadAndExtractResult = {
  invoice: makeSampleInvoice(null),
  lines: [],
  duplicateFileWarning: null,
  duplicateInvoiceNumberWarning: null,
  detectedSupplier: {
    supplierName: "Henry Schein Pty Ltd",
    abn: "98 765 432 109",
    email: "accounts@hs.com.au",
    phone: "02 9000 1234",
    address: "1 Dental Drive, Sydney NSW 2000",
    website: null,
  },
  matchedSupplier: null,
  supplierMatchStatus: "needs_confirmation",
  supplierExists: false,
  relationshipExists: null,
};

/**
 * Upload result where OCR matched DentalCo (Supplier B) but the upload came
 * from BurDirect's detail page (Supplier A).  The invoice is created under
 * DentalCo's ID by the backend.
 */
const mismatchUploadResult: UploadAndExtractResult = {
  invoice: makeSampleInvoice("sup-1111"),  // OCR created under DentalCo (Supplier B)
  lines: [],
  duplicateFileWarning: null,
  duplicateInvoiceNumberWarning: null,
  detectedSupplier: {
    supplierName: "DentalCo Australia",
    abn: "12 345 678 901",
    email: null,
    phone: null,
    address: null,
    website: null,
  },
  matchedSupplier: dentalCo,              // OCR matched DentalCo (Supplier B)
  supplierMatchStatus: "matched",
  supplierExists: true,
  relationshipExists: true,
};

/** Upload result where OCR could not detect a supplier. */
const notDetectedResult: UploadAndExtractResult = {
  invoice: makeSampleInvoice(null),
  lines: [],
  duplicateFileWarning: null,
  duplicateInvoiceNumberWarning: null,
  detectedSupplier: null,
  matchedSupplier: null,
  supplierMatchStatus: "not_detected",
  supplierExists: false,
  relationshipExists: null,
};

// ── Realistic stale-line fixtures (regression: invoice 1043916) ───────────────
//
// The original mismatchUploadResult uses lines:[] and therefore never exposed
// the stale-lines defect: when OCR auto-matches an exact_sku line under Supplier
// B at upload time, "Keep Supplier A" must NOT forward those stale isMatched=true
// lines to the review page after the backend has cleared them.

/** FB215 Frostbite line as it appears in the upload response — auto-matched under Adam Dental. */
const fb215MatchedLine: SupplierInvoiceLine = {
  id: "line-fb215",
  invoiceId: "inv-aaaa",
  lineNumber: 1,
  ocrDescription: "ADM Frostbite Cryogenic Tooth Vitality Test Spray A-CLASS DANGEROUS GOODS",
  ocrSku: "FB215",
  quantity: 1,
  unitPriceCents: 8500,
  priceIncludesTax: false,
  discountBasisPoints: 0,
  lineTotalCents: 9350,
  taxRateBasisPoints: 1000,
  taxCents: 850,
  supplierLineTotalCents: 9350,
  masterCatalogItemId: "master-frostbite-001",
  masterProductName: "ADM Frostbite Cryogenic Tooth Vitality Test Spray",
  supplierCatalogueId: "cat-adam-dental-fb215",
  isMatched: true,
  matchMethod: "exact_sku",
  reviewDecision: null,
  productCreationData: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

/** The same FB215 line as returned by the backend AFTER atomicUpdateSupplierAndClearMatches clears the match. */
const fb215ClearedLine: SupplierInvoiceLine = {
  ...fb215MatchedLine,
  isMatched: false,
  matchMethod: null,
  masterCatalogItemId: null,
  supplierCatalogueId: null,
};

/**
 * Mismatch result containing the realistic FB215 exact_sku match — the defect
 * was invisible in mismatchUploadResult because its lines array is empty.
 * This fixture mirrors what the backend returns for invoice 1043916.
 */
const mismatchUploadResultWithMatchedLine: UploadAndExtractResult = {
  ...mismatchUploadResult,
  lines: [fb215MatchedLine],
};

function makePdfFile(name = "invoice.pdf"): File {
  return new File(["dummy content"], name, { type: "application/pdf" });
}

/**
 * Render the modal.
 * - Default: manual mode with dentalCo pre-selected.
 * - Pass `autoDetect: true` to start in auto-detect mode (no pre-selected supplier).
 * - Pass `defaultSupplierId` to override the pre-selected supplier in manual mode.
 */
function renderModal(
  props: Partial<{
    suppliers: Supplier[];
    defaultSupplierId: string;
    autoDetect: boolean;
    onClose: () => void;
    onUploadSuccess: (result: UploadAndExtractResult) => void;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onUploadSuccess = props.onUploadSuccess ?? vi.fn();
  const defaultSupplierId = props.autoDetect ? undefined : (props.defaultSupplierId ?? dentalCo.id);

  return render(
    <MemoryRouter>
      <UploadInvoiceModal
        clinicId={TEST_CLINIC_ID}
        suppliers={props.suppliers ?? [dentalCo]}
        defaultSupplierId={defaultSupplierId}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
      />
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UploadInvoiceModal", () => {
  beforeEach(() => {
    mockUploadSupplierInvoice.mockReset();
    mockUpdateSupplierInvoice.mockReset();
    mockGetSupplierInvoice.mockReset();
    mockCreateSupplier.mockReset();
    // Default re-fetch: returns a valid empty-lines result so that tests which
    // exercise handleMismatchKeepSelected without caring about line refresh
    // do not fail on an unresolved mock.  Individual tests override this to
    // assert specific line-state scenarios.
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: makeSampleInvoice("sup-1111"),
      lines: [],
    });
  });

  // ── Rendering ────────────────────────────────────────────────────────────────

  it("1. renders as a dialog with correct title", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload Invoice" })).toBeInTheDocument();
  });

  it("2. manual mode: single supplier shown readonly when defaultSupplierId provided", () => {
    renderModal({ suppliers: [dentalCo], defaultSupplierId: dentalCo.id });
    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("3. manual mode: supplier dropdown shown for multiple suppliers", () => {
    renderModal({
      suppliers: [dentalCo, burDirect],
      defaultSupplierId: dentalCo.id,
    });
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
  });

  it("4. auto-detect mode: shows hint instead of supplier dropdown", () => {
    renderModal({ suppliers: [dentalCo], autoDetect: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/automatically detected/i)).toBeInTheDocument();
  });

  it("5. renders the file drop zone with browse affordance", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /drop invoice file/i })).toBeInTheDocument();
    expect(screen.getByText(/browse files/i)).toBeInTheDocument();
  });

  it("6. renders Upload & Process button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Upload & Process" })).toBeInTheDocument();
  });

  it("7. renders Cancel button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  it("8. disables Upload & Process button when no file is selected", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Upload & Process" })).toBeDisabled();
  });

  it("9. shows invalid file type error for non-PDF/image files", async () => {
    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const masqueradeFile = new File(["hello"], "invoice.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [masqueradeFile] } });
    expect(await screen.findByText(/Invalid file type/i)).toBeInTheDocument();
  });

  it("10. shows file size error for files exceeding 20 MB", async () => {
    renderModal();
    const bigFile = new File(["x"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 21 * 1024 * 1024 });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
  });

  it("11. enables Upload & Process after a valid file is selected", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeEnabled();
    });
  });

  it("12. shows selected file name and size after picking a file", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile("my-invoice.pdf"));
    expect(await screen.findByText("my-invoice.pdf")).toBeInTheDocument();
  });

  // ── Manual supplier upload ────────────────────────────────────────────────────

  it("13. manual mode: calls uploadSupplierInvoice, updateSupplierInvoice, then onUploadSuccess", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(matchedUploadResult);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: matchedUploadResult.invoice,
      duplicateInvoiceNumberWarning: null,
    });

    const onUploadSuccess = vi.fn();
    renderModal({ onUploadSuccess, defaultSupplierId: dentalCo.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = makePdfFile();
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await waitFor(() => {
      expect(mockUploadSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, file);
    });
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        matchedUploadResult.invoice.id,
        expect.objectContaining({ supplierId: dentalCo.id }),
      );
    });
    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalled();
    });
  });

  // ── Auto-detect: matched supplier ────────────────────────────────────────────

  it("14. auto-detect matched: shows matched supplier badge and name", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(matchedUploadResult);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/Supplier matched/i)).toBeInTheDocument();
    expect(screen.getByText(/DentalCo Australia/)).toBeInTheDocument();
  });

  it("15. auto-detect matched: Continue to Review calls onUploadSuccess", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(matchedUploadResult);

    const onUploadSuccess = vi.fn();
    renderModal({ autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier matched/i);
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));

    expect(onUploadSuccess).toHaveBeenCalledWith(matchedUploadResult);
  });

  // ── Auto-detect: needs_confirmation ──────────────────────────────────────────

  it("16. needs_confirmation: shows detected supplier fields", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/New supplier detected/i)).toBeInTheDocument();
    expect(screen.getByText("Henry Schein Pty Ltd")).toBeInTheDocument();
    expect(screen.getByText("98 765 432 109")).toBeInTheDocument();
    expect(screen.getByText("accounts@hs.com.au")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Supplier/i })).toBeInTheDocument();
  });

  it("17. needs_confirmation: Create Supplier calls createSupplier then updateSupplierInvoice", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);
    const newSupplier = { ...burDirect, id: "sup-new", supplierName: "Henry Schein Pty Ltd" };
    mockCreateSupplier.mockResolvedValue(newSupplier);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: needsConfirmationResult.invoice,
      duplicateInvoiceNumberWarning: null,
    });

    const onUploadSuccess = vi.fn();
    renderModal({ autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: /Create Supplier/i }));

    await waitFor(() => {
      expect(mockCreateSupplier).toHaveBeenCalledWith(
        expect.objectContaining({ supplierName: "Henry Schein Pty Ltd" }),
      );
    });
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        needsConfirmationResult.invoice.id,
        expect.objectContaining({ supplierId: "sup-new" }),
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
  });

  it("18. needs_confirmation: Choose Existing Supplier shows supplier picker", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);

    renderModal({ suppliers: [dentalCo, burDirect], autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: "Choose Existing Supplier" }));

    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Supplier" })).toBeInTheDocument();
  });

  // ── Auto-detect: not_detected ─────────────────────────────────────────────────

  it("19. not_detected: shows supplier not detected message", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(notDetectedResult);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/Supplier not detected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Existing Supplier" })).toBeInTheDocument();
  });

  it("20. not_detected: Choose Existing shows supplier picker", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(notDetectedResult);

    renderModal({ suppliers: [dentalCo, burDirect], autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier not detected/i);
    await user.click(screen.getByRole("button", { name: "Choose Existing Supplier" }));

    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  // ── No silent supplier creation ───────────────────────────────────────────────

  it("21. createSupplier is NOT called unless user explicitly clicks Create Supplier", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    // Do NOT click "Create Supplier"
    expect(mockCreateSupplier).not.toHaveBeenCalled();
  });

  // ── Upload failure ────────────────────────────────────────────────────────────

  it("22. shows error message and retry button after upload failure", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockRejectedValue(new Error("File too large for OCR"));

    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/File too large for OCR/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Upload" })).toBeInTheDocument();
  });

  // ── Close ─────────────────────────────────────────────────────────────────────

  it("23. calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("24. calls onClose when × close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole("button", { name: /close modal/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Progress ──────────────────────────────────────────────────────────────────

  it("25. shows progress steps during upload", async () => {
    const user = userEvent.setup();
    let resolveUpload!: (result: UploadAndExtractResult) => void;
    mockUploadSupplierInvoice.mockReturnValue(
      new Promise<UploadAndExtractResult>((resolve) => { resolveUpload = resolve; }),
    );

    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText("Uploading Invoice")).toBeInTheDocument();
    expect(screen.getByText("Processing OCR")).toBeInTheDocument();
    expect(screen.getByText("Extracting Line Items")).toBeInTheDocument();

    resolveUpload(matchedUploadResult);
  });

  // ── Supplier mismatch detection (A–C) ────────────────────────────────────────

  it("13a. manual mode + same OCR supplier → no mismatch prompt, normal PATCH flow", async () => {
    // upload from DentalCo + OCR also detects DentalCo → no mismatch.
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(matchedUploadResult);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: matchedUploadResult.invoice,
      duplicateInvoiceNumberWarning: null,
    });

    const onUploadSuccess = vi.fn();
    renderModal({ onUploadSuccess, defaultSupplierId: dentalCo.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
    // No mismatch dialog should appear.
    expect(screen.queryByText(/Supplier mismatch detected/i)).not.toBeInTheDocument();
    // PATCH should have been called (normal manual flow).
    expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
      TEST_CLINIC_ID,
      matchedUploadResult.invoice.id,
      expect.objectContaining({ supplierId: dentalCo.id }),
    );
  });

  it("27. manual mode + OCR detects different supplier → shows mismatch panel", async () => {
    // Upload from BurDirect (defaultSupplierId: sup-2222)
    // but OCR matches DentalCo (sup-1111).
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);

    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/Supplier mismatch detected/i)).toBeInTheDocument();
  });

  it("28. mismatch panel displays both supplier names clearly", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);

    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    expect(screen.getByText("Uploaded under")).toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
    expect(screen.getByText("Detected on invoice")).toBeInTheDocument();
    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
  });

  it("29. mismatch panel: neither supplier is automatically selected (both buttons present)", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);

    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    expect(screen.getByRole("button", { name: /Use DentalCo Australia/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keep BurDirect/i })).toBeInTheDocument();
    // No automatic action taken — updateSupplierInvoice must not have been called.
    expect(mockUpdateSupplierInvoice).not.toHaveBeenCalled();
  });

  it("30. mismatch: Use Supplier B does NOT call updateSupplierInvoice, calls onUploadSuccess", async () => {
    // B. USE DETECTED SUPPLIER B — invoice already under Supplier B, no PATCH needed.
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);

    const onUploadSuccess = vi.fn();
    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id, onUploadSuccess });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    await user.click(screen.getByRole("button", { name: /Use DentalCo Australia/i }));

    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
    // No second upload — still only one uploadSupplierInvoice call.
    expect(mockUploadSupplierInvoice).toHaveBeenCalledTimes(1);
    // No PATCH needed since invoice is already under Supplier B.
    expect(mockUpdateSupplierInvoice).not.toHaveBeenCalled();
  });

  it("31. mismatch: Keep Supplier A calls updateSupplierInvoice with selectedSupplierId, then onUploadSuccess", async () => {
    // C. KEEP SELECTED SUPPLIER A — PATCH to Supplier A; backend clears stale matches.
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);
    const patchedInvoice = { ...mismatchUploadResult.invoice, supplierId: burDirect.id };
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: patchedInvoice,
      duplicateInvoiceNumberWarning: null,
    });

    const onUploadSuccess = vi.fn();
    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id, onUploadSuccess });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    await user.click(screen.getByRole("button", { name: /Keep BurDirect/i }));

    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        mismatchUploadResult.invoice.id,
        expect.objectContaining({ supplierId: burDirect.id }),
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
    // No second upload.
    expect(mockUploadSupplierInvoice).toHaveBeenCalledTimes(1);
  });

  it("32. mismatch: no second upload occurs for either action", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResult);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: mismatchUploadResult.invoice,
      duplicateInvoiceNumberWarning: null,
    });

    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    await user.click(screen.getByRole("button", { name: /Keep BurDirect/i }));

    await waitFor(() => { expect(mockUpdateSupplierInvoice).toHaveBeenCalled(); });
    // Upload must have been called exactly once — no duplicate record creation.
    expect(mockUploadSupplierInvoice).toHaveBeenCalledTimes(1);
  });

  it("33. mismatch: Keep Supplier A re-fetches authoritative backend state; stale exact_sku line is NOT forwarded to review", async () => {
    // Regression test for production invoice 1043916.
    // The original mismatchUploadResult has lines:[] so it never exposed this
    // defect.  This test uses a realistic fixture where FB215 was auto-matched
    // under Adam Dental (Supplier B) at upload time.
    //
    // After "Keep BurDirect" (Supplier A):
    //   1. PATCH fires → backend atomically clears the exact_sku match.
    //   2. getSupplierInvoice fires → returns the cleared line state.
    //   3. onUploadSuccess receives cleared lines (isMatched=false, not stale isMatched=true).
    const user = userEvent.setup();

    mockUploadSupplierInvoice.mockResolvedValue(mismatchUploadResultWithMatchedLine);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: { ...mismatchUploadResultWithMatchedLine.invoice, supplierId: burDirect.id },
      duplicateInvoiceNumberWarning: null,
    });
    // Backend re-fetch returns the same line with match cleared.
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...mismatchUploadResultWithMatchedLine.invoice, supplierId: burDirect.id },
      lines: [fb215ClearedLine],
    });

    const onUploadSuccess = vi.fn();
    renderModal({ suppliers: [dentalCo, burDirect], defaultSupplierId: burDirect.id, onUploadSuccess });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/Supplier mismatch detected/i);
    await user.click(screen.getByRole("button", { name: /Keep BurDirect/i }));

    // 1. Supplier PATCH was called with Supplier A (BurDirect).
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        mismatchUploadResultWithMatchedLine.invoice.id,
        expect.objectContaining({ supplierId: burDirect.id }),
      );
    });

    // 2. Backend re-fetch was called AFTER the PATCH.
    await waitFor(() => {
      expect(mockGetSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        mismatchUploadResultWithMatchedLine.invoice.id,
      );
    });

    // 3 & 4. onUploadSuccess receives refreshed lines — NOT the stale upload lines.
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
    const [result] = onUploadSuccess.mock.calls[0] as [UploadAndExtractResult];

    expect(result.lines).toHaveLength(1);
    // Refreshed: match cleared.
    expect(result.lines[0]?.isMatched).toBe(false);
    expect(result.lines[0]?.matchMethod).toBeNull();
    expect(result.lines[0]?.masterCatalogItemId).toBeNull();
    expect(result.lines[0]?.supplierCatalogueId).toBeNull();
    // Stale exact_sku match must NOT be present.
    expect(result.lines[0]?.matchMethod).not.toBe("exact_sku");

    // 5. Supplier A (BurDirect) is the authoritative invoice supplier.
    expect(result.invoice.supplierId).toBe(burDirect.id);

    // 6. No second upload.
    expect(mockUploadSupplierInvoice).toHaveBeenCalledTimes(1);
  });

  it("26. hides close button during upload", async () => {
    const user = userEvent.setup();
    let resolveUpload!: (result: UploadAndExtractResult) => void;
    mockUploadSupplierInvoice.mockReturnValue(
      new Promise<UploadAndExtractResult>((resolve) => { resolveUpload = resolve; }),
    );

    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText("Uploading Invoice");
    expect(screen.queryByRole("button", { name: /close modal/i })).not.toBeInTheDocument();

    resolveUpload(matchedUploadResult);
  });

  // ── Website normalisation & display ──────────────────────────────────────────

  it("34. needs_confirmation: detected website is displayed in the New Supplier panel", async () => {
    // Test 6 from requirements: detected website visible to reviewer.
    const user = userEvent.setup();
    const baseDetected = needsConfirmationResult.detectedSupplier;
    expect(baseDetected).not.toBeNull();
    if (!baseDetected) return;
    const resultWithWebsite: UploadAndExtractResult = {
      ...needsConfirmationResult,
      detectedSupplier: {
        ...baseDetected,
        website: "www.piksters.com",
      },
    };
    mockUploadSupplierInvoice.mockResolvedValue(resultWithWebsite);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("www.piksters.com")).toBeInTheDocument();
  });

  it("35. needs_confirmation: Create Supplier & Continue succeeds with a bare-domain OCR website (frontend passes through, backend normalises)", async () => {
    // Test 7 from requirements: bare domain does not cause frontend to fail.
    const user = userEvent.setup();
    const baseDetected = needsConfirmationResult.detectedSupplier;
    expect(baseDetected).not.toBeNull();
    if (!baseDetected) return;
    const resultWithBareDomain: UploadAndExtractResult = {
      ...needsConfirmationResult,
      detectedSupplier: {
        ...baseDetected,
        website: "www.piksters.com",
      },
    };
    mockUploadSupplierInvoice.mockResolvedValue(resultWithBareDomain);
    const newSupplier = { ...burDirect, id: "sup-piksters", supplierName: "Henry Schein Pty Ltd" };
    mockCreateSupplier.mockResolvedValue(newSupplier);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: { ...resultWithBareDomain.invoice, supplierId: newSupplier.id },
      duplicateInvoiceNumberWarning: null,
    });

    const onUploadSuccess = vi.fn();
    renderModal({ autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: /Create Supplier/i }));

    // createSupplier is called with the bare-domain website exactly as received from OCR.
    await waitFor(() => {
      expect(mockCreateSupplier).toHaveBeenCalledWith(
        expect.objectContaining({ website: "www.piksters.com" }),
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
  });

  // ── ABN duplicate protection (frontend) ──────────────────────────────────────

  it("36. needs_confirmation: DUPLICATE_ABN error shows message and 'Use existing supplier' button", async () => {
    // Test 8 from requirements: duplicate ABN prevents silent creation.
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);

    const dupAbnError = Object.assign(
      new Error("An existing supplier already uses ABN 98 765 432 109: DentalCo Australia"),
      {
        code: "DUPLICATE_ABN",
        details: [
          { field: "existingSupplierId", message: "sup-1111" },
          { field: "existingSupplierName", message: "DentalCo Australia" },
        ],
      },
    );
    mockCreateSupplier.mockRejectedValue(dupAbnError);

    renderModal({ autoDetect: true });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: /Create Supplier/i }));

    // Error message displayed.
    await screen.findByText(/An existing supplier already uses ABN/i);
    // "Use DentalCo Australia" button appears.
    expect(screen.getByRole("button", { name: /Use DentalCo Australia/i })).toBeInTheDocument();
    // No new supplier was created on the server.
    expect(mockUpdateSupplierInvoice).not.toHaveBeenCalled();
  });

  it("37. needs_confirmation: clicking 'Use existing supplier' attaches invoice via PATCH and re-fetches", async () => {
    // Test 12+13 from requirements: choose-existing path re-fetches authoritative lines.
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(needsConfirmationResult);

    const dupAbnError = Object.assign(
      new Error("An existing supplier already uses ABN 98 765 432 109: DentalCo Australia"),
      {
        code: "DUPLICATE_ABN",
        details: [
          { field: "existingSupplierId", message: "sup-1111" },
          { field: "existingSupplierName", message: "DentalCo Australia" },
        ],
      },
    );
    mockCreateSupplier.mockRejectedValue(dupAbnError);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: { ...needsConfirmationResult.invoice, supplierId: "sup-1111" },
      duplicateInvoiceNumberWarning: null,
    });
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...needsConfirmationResult.invoice, supplierId: "sup-1111" },
      lines: [],
    });

    const onUploadSuccess = vi.fn();
    renderModal({ autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: /Create Supplier/i }));
    await screen.findByRole("button", { name: /Use DentalCo Australia/i });
    await user.click(screen.getByRole("button", { name: /Use DentalCo Australia/i }));

    // PATCH called with the existing supplier's ID.
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        needsConfirmationResult.invoice.id,
        expect.objectContaining({ supplierId: "sup-1111" }),
      );
    });
    // Re-fetch called after PATCH.
    await waitFor(() => {
      expect(mockGetSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        needsConfirmationResult.invoice.id,
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });
    // Authoritative supplier in forwarded result.
    const [result] = onUploadSuccess.mock.calls[0] as [UploadAndExtractResult];
    expect(result.invoice.supplierId).toBe("sup-1111");
    // No second upload.
    expect(mockUploadSupplierInvoice).toHaveBeenCalledTimes(1);
  });

  // ── Authoritative re-fetch after new-supplier creation ──────────────────────

  it("38. Create Supplier & Continue re-fetches authoritative invoice + lines after PATCH", async () => {
    // Test 11+13+14 from requirements: new-supplier path re-fetches and does
    // NOT forward stale upload-time lines.
    const user = userEvent.setup();

    // Upload result has a stale matched line (simulates OCR matching under a
    // previously detected supplier).
    const resultWithStaleLine: UploadAndExtractResult = {
      ...needsConfirmationResult,
      lines: [fb215MatchedLine],
    };
    mockUploadSupplierInvoice.mockResolvedValue(resultWithStaleLine);

    const newSupplier = { ...burDirect, id: "sup-new-99", supplierName: "Henry Schein Pty Ltd" };
    mockCreateSupplier.mockResolvedValue(newSupplier);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: { ...resultWithStaleLine.invoice, supplierId: "sup-new-99" },
      duplicateInvoiceNumberWarning: null,
    });
    // Backend re-fetch returns the cleared line state.
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...resultWithStaleLine.invoice, supplierId: "sup-new-99" },
      lines: [fb215ClearedLine],
    });

    const onUploadSuccess = vi.fn();
    renderModal({ autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: /Create Supplier/i }));

    // PATCH called.
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        resultWithStaleLine.invoice.id,
        expect.objectContaining({ supplierId: "sup-new-99" }),
      );
    });
    // Re-fetch called after PATCH.
    await waitFor(() => {
      expect(mockGetSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        resultWithStaleLine.invoice.id,
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });

    const [result] = onUploadSuccess.mock.calls[0] as [UploadAndExtractResult];
    // Refreshed — stale exact_sku match cleared.
    expect(result.lines[0]?.isMatched).toBe(false);
    expect(result.lines[0]?.matchMethod).toBeNull();
    // Stale upload-time line NOT forwarded.
    expect(result.lines[0]?.matchMethod).not.toBe("exact_sku");
  });

  it("39. Choose Existing Supplier re-fetches authoritative invoice + lines after PATCH", async () => {
    // Test 12+13 from requirements: choose-existing path also re-fetches.
    const user = userEvent.setup();

    const resultWithStaleLine: UploadAndExtractResult = {
      ...needsConfirmationResult,
      lines: [fb215MatchedLine],
    };
    mockUploadSupplierInvoice.mockResolvedValue(resultWithStaleLine);
    mockUpdateSupplierInvoice.mockResolvedValue({
      invoice: { ...resultWithStaleLine.invoice, supplierId: dentalCo.id },
      duplicateInvoiceNumberWarning: null,
    });
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...resultWithStaleLine.invoice, supplierId: dentalCo.id },
      lines: [fb215ClearedLine],
    });

    const onUploadSuccess = vi.fn();
    renderModal({ suppliers: [dentalCo, burDirect], autoDetect: true, onUploadSuccess });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await screen.findByText(/New supplier detected/i);
    await user.click(screen.getByRole("button", { name: "Choose Existing Supplier" }));

    await screen.findByRole("combobox");
    await user.click(screen.getByRole("button", { name: "Confirm Supplier" }));

    // PATCH called with existing supplier.
    await waitFor(() => {
      expect(mockUpdateSupplierInvoice).toHaveBeenCalledTimes(1);
    });
    // Re-fetch called.
    await waitFor(() => {
      expect(mockGetSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        resultWithStaleLine.invoice.id,
      );
    });
    await waitFor(() => { expect(onUploadSuccess).toHaveBeenCalled(); });

    const [result] = onUploadSuccess.mock.calls[0] as [UploadAndExtractResult];
    // Refreshed lines forwarded — stale exact_sku cleared.
    expect(result.lines[0]?.isMatched).toBe(false);
    expect(result.lines[0]?.matchMethod).toBeNull();
  });
});
