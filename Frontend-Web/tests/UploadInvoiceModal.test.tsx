import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadInvoiceModal } from "../src/components/supplier/UploadInvoiceModal.js";
import type { Supplier, UploadAndExtractResult } from "../src/types/supplier.js";
import { TEST_CLINIC_ID } from "./helpers/auth.js";

const { mockUploadSupplierInvoice } = vi.hoisted(() => ({
  mockUploadSupplierInvoice: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    uploadSupplierInvoice: mockUploadSupplierInvoice,
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

const dentalCo: Supplier = {
  id: "sup-1111",
  supplierName: "DentalCo Australia",
  supplierCode: "DCO",
  contactName: "Jane Smith",
  email: "orders@dentalco.com.au",
  phone: null,
  website: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const burDirect: Supplier = {
  id: "sup-2222",
  supplierName: "BurDirect",
  supplierCode: null,
  contactName: null,
  email: null,
  phone: null,
  website: null,
  notes: null,
  active: true,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const uploadResult: UploadAndExtractResult = {
  invoice: {
    id: "inv-aaaa",
    clinicId: TEST_CLINIC_ID,
    supplierId: "sup-1111",
    supplierNameRaw: "DentalCo Australia",
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    dueDate: null,
    status: "pending_review",
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
  },
  lines: [],
  duplicateFileWarning: null,
  duplicateInvoiceNumberWarning: null,
};

function makePdfFile(name = "invoice.pdf"): File {
  return new File(["dummy content"], name, { type: "application/pdf" });
}

function renderModal(
  props: Partial<{
    suppliers: Supplier[];
    defaultSupplierId: string;
    onClose: () => void;
    onUploadSuccess: (result: UploadAndExtractResult) => void;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onUploadSuccess = props.onUploadSuccess ?? vi.fn();
  return render(
    <MemoryRouter>
      <UploadInvoiceModal
        clinicId={TEST_CLINIC_ID}
        suppliers={props.suppliers ?? [dentalCo]}
        defaultSupplierId={props.defaultSupplierId ?? dentalCo.id}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
      />
    </MemoryRouter>,
  );
}

describe("UploadInvoiceModal", () => {
  beforeEach(() => {
    mockUploadSupplierInvoice.mockReset();
  });

  // ── Rendering ────────────────────────────────────────────────────────────────

  it("renders as a dialog with correct title", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload Invoice" })).toBeInTheDocument();
  });

  it("shows supplier name as readonly when only one supplier is provided", () => {
    renderModal({ suppliers: [dentalCo], defaultSupplierId: dentalCo.id });
    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows supplier dropdown when multiple suppliers are provided", () => {
    renderModal({
      suppliers: [dentalCo, burDirect],
      defaultSupplierId: undefined,
    });
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
  });

  it("renders the file drop zone with browse affordance", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /drop invoice file/i })).toBeInTheDocument();
    expect(screen.getByText(/browse files/i)).toBeInTheDocument();
  });

  it("shows accepted file type hint", () => {
    renderModal();
    expect(screen.getByText(/PDF, PNG, JPG, JPEG/)).toBeInTheDocument();
  });

  it("renders Upload & Process button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Upload & Process" })).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  it("disables Upload & Process button when no file is selected", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Upload & Process" })).toBeDisabled();
  });

  it("shows invalid file type error for non-PDF/image files", async () => {
    const user = userEvent.setup();
    renderModal();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    // Use a .pdf extension so user-event passes the accept attribute check,
    // but give it a text/plain MIME type so our component's MIME validation rejects it.
    const masqueradeFile = new File(["hello"], "invoice.pdf", { type: "text/plain" });
    await user.upload(input, masqueradeFile);

    expect(
      await screen.findByText(/Invalid file type/i),
    ).toBeInTheDocument();
  });

  it("shows file size error for files exceeding 20 MB", async () => {
    const user = userEvent.setup();
    renderModal();

    const bigContent = "x".repeat(21 * 1024 * 1024);
    const bigFile = new File([bigContent], "huge.pdf", { type: "application/pdf" });
    const input = document
      .querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, bigFile);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
  });

  it("enables Upload & Process after a valid file is selected", async () => {
    const user = userEvent.setup();
    renderModal();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeEnabled();
    });
  });

  it("shows selected file name and size after picking a file", async () => {
    const user = userEvent.setup();
    renderModal();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile("my-invoice.pdf"));

    expect(await screen.findByText("my-invoice.pdf")).toBeInTheDocument();
  });

  // ── Upload success ────────────────────────────────────────────────────────────

  it("calls uploadSupplierInvoice with clinicId and the file on submit", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockResolvedValue(uploadResult);

    const onUploadSuccess = vi.fn();
    renderModal({ onUploadSuccess });

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = makePdfFile();
    await user.upload(input, file);

    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    await waitFor(() => {
      expect(mockUploadSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, file);
    });

    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledWith(uploadResult);
    });
  });

  it("shows progress steps during upload", async () => {
    const user = userEvent.setup();
    // Keep the promise pending to observe the loading state
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

    resolveUpload(uploadResult);
  });

  it("hides close button during upload", async () => {
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

    resolveUpload(uploadResult);
  });

  // ── Upload failure ────────────────────────────────────────────────────────────

  it("shows error message and retry button after upload failure", async () => {
    const user = userEvent.setup();
    mockUploadSupplierInvoice.mockRejectedValue(new Error("File too large for OCR"));

    renderModal();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, makePdfFile());
    await user.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByText(/File too large for OCR/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Upload" })).toBeInTheDocument();
  });

  // ── Close ────────────────────────────────────────────────────────────────────

  it("calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when × close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.click(screen.getByRole("button", { name: /close modal/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
