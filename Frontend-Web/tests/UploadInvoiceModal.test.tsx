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

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadInvoiceModal } from "../src/components/supplier/UploadInvoiceModal.js";
import type { Supplier, UploadAndExtractResult } from "../src/types/supplier.js";
import { TEST_CLINIC_ID } from "./helpers/auth.js";

// ── Mock API client ───────────────────────────────────────────────────────────

const {
  mockUploadSupplierInvoice,
  mockUpdateSupplierInvoice,
  mockCreateSupplier,
} = vi.hoisted(() => ({
  mockUploadSupplierInvoice: vi.fn(),
  mockUpdateSupplierInvoice: vi.fn(),
  mockCreateSupplier: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    uploadSupplierInvoice: mockUploadSupplierInvoice,
    updateSupplierInvoice: mockUpdateSupplierInvoice,
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

function makeSampleInvoice(supplierId: string | null = "sup-1111") {
  return {
    id: "inv-aaaa",
    clinicId: TEST_CLINIC_ID,
    supplierId,
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
    mockCreateSupplier.mockReset();
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
    const user = userEvent.setup();
    renderModal();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const masqueradeFile = new File(["hello"], "invoice.pdf", { type: "text/plain" });
    await user.upload(input, masqueradeFile);
    expect(await screen.findByText(/Invalid file type/i)).toBeInTheDocument();
  });

  it("10. shows file size error for files exceeding 20 MB", async () => {
    const user = userEvent.setup();
    renderModal();
    const bigContent = "x".repeat(21 * 1024 * 1024);
    const bigFile = new File([bigContent], "huge.pdf", { type: "application/pdf" });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, bigFile);
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
});
