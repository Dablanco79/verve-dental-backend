import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierInvoiceReviewPage } from "../src/pages/SupplierInvoiceReviewPage.js";
import type {
  SupplierInvoice,
  SupplierInvoiceLine,
  UploadAndExtractResult,
} from "../src/types/supplier.js";
import { createManagerUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const INVOICE_ID = "inv-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const {
  authTestState,
  selectedClinicState,
  mockGetSupplierInvoice,
  mockUpdateSupplierInvoiceLine,
  mockConfirmSupplierInvoice,
  mockVoidSupplierInvoice,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  // Hardcoded because vi.hoisted() runs before module imports resolve.
  const selectedClinicState = {
    selectedClinic: { id: "11111111-1111-4111-8111-111111111111", name: "Verve Dental Clinic A" },
    selectedDashboardScope: {
      type: "clinic" as const,
      clinic: { id: "11111111-1111-4111-8111-111111111111", name: "Verve Dental Clinic A" },
    } as { type: "all_clinics" } | { type: "clinic"; clinic: { id: string; name: string } },
  };
  return {
    authTestState,
    selectedClinicState,
    mockGetSupplierInvoice: vi.fn(),
    mockUpdateSupplierInvoiceLine: vi.fn(),
    mockConfirmSupplierInvoice: vi.fn(),
    mockVoidSupplierInvoice: vi.fn(),
  };
});

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: authTestState.user,
    isLoading: authTestState.isLoading,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/clinic/useSelectedClinic.js", () => ({
  useSelectedClinic: () => ({
    selectedClinic: selectedClinicState.selectedClinic,
    selectedDashboardScope: selectedClinicState.selectedDashboardScope,
    availableClinics: [selectedClinicState.selectedClinic],
    canSwitchClinics: false,
    canSelectAllClinics: false,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getSupplierInvoice: mockGetSupplierInvoice,
    updateSupplierInvoiceLine: mockUpdateSupplierInvoiceLine,
    confirmSupplierInvoice: mockConfirmSupplierInvoice,
    voidSupplierInvoice: mockVoidSupplierInvoice,
    suggestMasterProductMatch: vi.fn().mockResolvedValue({ suggestions: [] }),
    confirmMasterProductMatch: vi.fn().mockResolvedValue({}),
    listMasterProducts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

// ── Sample data ────────────────────────────────────────────────────────────────

const sampleInvoice: SupplierInvoice = {
  id: INVOICE_ID,
  clinicId: TEST_CLINIC_ID,
  supplierId: "sup-1111",
  supplierNameRaw: "DentalCo Australia",
  invoiceNumber: "DCO-2026-0042",
  invoiceDate: "2026-06-10",
  dueDate: "2026-07-10",
  status: "pending_review",
  subtotalCents: 5000,
  taxCents: 500,
  totalCents: 5500,
  currency: "AUD",
  ocrProvider: "claude",
  ocrConfidence: 94,
  originalFilename: "dco-invoice.pdf",
  fileMimeType: "application/pdf",
  importedByUserId: "user-1",
  importedByEmail: "manager@clinic-a.au",
  confirmedByUserId: null,
  confirmedAt: null,
  voidedByUserId: null,
  voidedAt: null,
  notes: null,
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

const sampleLine: SupplierInvoiceLine = {
  id: "line-1111",
  invoiceId: INVOICE_ID,
  lineNumber: 1,
  ocrDescription: "Nitrile Gloves Large",
  ocrSku: "DCO-GLV-L",
  quantity: 5,
  unitPriceCents: 1000,
  lineTotalCents: 5000,
  taxRateBasisPoints: 1000,
  taxCents: 500,
  masterCatalogItemId: "prod-1111",
  masterProductName: "Nitrile Gloves Large",
  supplierCatalogueId: "cat-1111",
  isMatched: true,
  matchMethod: "exact_sku",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

const unmatchedLine: SupplierInvoiceLine = {
  ...sampleLine,
  id: "line-2222",
  lineNumber: 2,
  ocrDescription: "Unknown Product X",
  ocrSku: null,
  masterCatalogItemId: null,
  supplierCatalogueId: null,
  isMatched: false,
  matchMethod: null,
};

const confirmedInvoice: SupplierInvoice = {
  ...sampleInvoice,
  status: "confirmed",
  confirmedByUserId: "user-1",
  confirmedAt: "2026-06-11T00:00:00.000Z",
};

const voidedInvoice: SupplierInvoice = {
  ...sampleInvoice,
  status: "voided",
  voidedByUserId: "user-1",
  voidedAt: "2026-06-11T00:00:00.000Z",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderReviewPage(
  invoiceId: string = INVOICE_ID,
  locationState?: object,
) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: `/invoice-review/${invoiceId}`, state: locationState ?? {} },
      ]}
    >
      <Routes>
        <Route path="/invoice-review/:invoiceId" element={<SupplierInvoiceReviewPage />} />
        <Route path="/suppliers" element={<div>Suppliers Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SupplierInvoiceReviewPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockGetSupplierInvoice.mockReset();
    mockUpdateSupplierInvoiceLine.mockReset();
    mockConfirmSupplierInvoice.mockReset();
    mockVoidSupplierInvoice.mockReset();

    // Reset clinic scope to a specific clinic before each test.
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: "Verve Dental Clinic A" };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: "Verve Dental Clinic A" },
    };

    setAuthenticatedUser(authTestState, createManagerUser());
    mockGetSupplierInvoice.mockResolvedValue({ invoice: sampleInvoice, lines: [sampleLine] });
  });

  // ── Loading / fetching ────────────────────────────────────────────────────────

  it("shows loading state then renders invoice data", async () => {
    renderReviewPage();

    expect(screen.getByText("Loading invoice…")).toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { name: "DentalCo Australia" }),
    ).toBeInTheDocument();
    expect(mockGetSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, INVOICE_ID);
  });

  it("can hydrate from uploadResult in navigation state without fetching", async () => {
    const uploadResult: UploadAndExtractResult = {
      invoice: sampleInvoice,
      lines: [sampleLine],
      duplicateFileWarning: null,
      duplicateInvoiceNumberWarning: null,
      detectedSupplier: null,
      matchedSupplier: null,
      supplierMatchStatus: "not_detected",
      supplierExists: false,
      relationshipExists: null,
    };

    renderReviewPage(INVOICE_ID, { uploadResult });

    expect(
      await screen.findByRole("heading", { name: "DentalCo Australia" }),
    ).toBeInTheDocument();
    expect(mockGetSupplierInvoice).not.toHaveBeenCalled();
  });

  it("shows error state when invoice load fails", async () => {
    mockGetSupplierInvoice.mockRejectedValue(new Error("Invoice not found"));
    renderReviewPage();

    expect(await screen.findByText("Invoice not found")).toBeInTheDocument();
  });

  it("does not call API when user is not authenticated", async () => {
    clearAuthenticatedUser(authTestState);
    renderReviewPage();

    await waitFor(() => {
      expect(screen.queryByText("Loading invoice…")).not.toBeInTheDocument();
    });

    expect(mockGetSupplierInvoice).not.toHaveBeenCalled();
  });

  // ── Summary card ─────────────────────────────────────────────────────────────

  it("renders invoice summary with supplier name, number, date, total", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("Invoice Summary")).toBeInTheDocument();
    expect(screen.getByText("DCO-2026-0042")).toBeInTheDocument();
    expect(screen.getByText("$55.00")).toBeInTheDocument();
  });

  it("renders OCR confidence badge when ocrConfidence is present", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("94% OCR confidence")).toBeInTheDocument();
  });

  it("does not render OCR confidence badge when ocrConfidence is null", async () => {
    const noConfidenceInvoice = { ...sampleInvoice, ocrConfidence: null };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: noConfidenceInvoice,
      lines: [sampleLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.queryByText(/OCR confidence/)).not.toBeInTheDocument();
  });

  it("shows Pending Review status badge", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getAllByText("Pending Review").length).toBeGreaterThanOrEqual(1);
  });

  // ── Duplicate warnings ────────────────────────────────────────────────────────

  it("renders duplicate file warning when present in navigation state", async () => {
    const uploadResult: UploadAndExtractResult = {
      invoice: sampleInvoice,
      lines: [sampleLine],
      duplicateFileWarning: {
        existingInvoiceId: "inv-old",
        importedAt: "2026-05-01T00:00:00.000Z",
      },
      duplicateInvoiceNumberWarning: null,
      detectedSupplier: null,
      matchedSupplier: null,
      supplierMatchStatus: "not_detected",
      supplierExists: false,
      relationshipExists: null,
    };

    renderReviewPage(INVOICE_ID, { uploadResult });

    expect(await screen.findByText(/Duplicate file detected/i)).toBeInTheDocument();
  });

  it("renders duplicate invoice number warning when present", async () => {
    const uploadResult: UploadAndExtractResult = {
      invoice: sampleInvoice,
      lines: [sampleLine],
      duplicateFileWarning: null,
      duplicateInvoiceNumberWarning: {
        existingInvoiceId: "inv-old",
        existingStatus: "confirmed",
      },
      detectedSupplier: null,
      matchedSupplier: null,
      supplierMatchStatus: "not_detected",
      supplierExists: false,
      relationshipExists: null,
    };

    renderReviewPage(INVOICE_ID, { uploadResult });

    expect(await screen.findByText(/Duplicate invoice number/i)).toBeInTheDocument();
  });

  // ── Line items ────────────────────────────────────────────────────────────────

  it("renders line items table with product description, qty, price, total", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("Nitrile Gloves Large")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
  });

  it("renders matched badge for matched lines", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText(/✓ Matched/)).toBeInTheDocument();
  });

  it("renders Not Matched badge for unmatched lines", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("Not Matched")).toBeInTheDocument();
  });

  it("renders product matching action buttons for unmatched lines", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    // New product matching UI replaces the old disabled placeholder button.
    expect(screen.getByRole("button", { name: "Find suggestions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match existing product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("shows empty state when no lines are returned", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: sampleInvoice, lines: [] });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("No line items extracted")).toBeInTheDocument();
  });

  // ── Edit row ──────────────────────────────────────────────────────────────────

  it("shows Edit button for pending_review invoice lines", async () => {
    renderReviewPage();

    await screen.findByText("Nitrile Gloves Large");

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("enters edit mode when Edit is clicked", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByText("Nitrile Gloves Large");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Line description")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit price")).toBeInTheDocument();
  });

  it("pre-populates edit fields with current line values", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByText("Nitrile Gloves Large");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Nitrile Gloves Large")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.00")).toBeInTheDocument();
  });

  it("cancels edit and returns to read mode", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByText("Nitrile Gloves Large");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("saves edited line and updates the row", async () => {
    const user = userEvent.setup();
    const updatedLine: SupplierInvoiceLine = {
      ...sampleLine,
      ocrDescription: "Nitrile Gloves XL",
      quantity: 10,
      unitPriceCents: 900,
      lineTotalCents: 9000,
    };
    mockUpdateSupplierInvoiceLine.mockResolvedValue(updatedLine);

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const descInput = screen.getByLabelText("Line description");
    await user.clear(descInput);
    await user.type(descInput, "Nitrile Gloves XL");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateSupplierInvoiceLine).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        INVOICE_ID,
        "line-1111",
        expect.objectContaining({ ocrDescription: "Nitrile Gloves XL" }),
      );
    });

    expect(await screen.findByText("Nitrile Gloves XL")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows error when line save fails", async () => {
    const user = userEvent.setup();
    mockUpdateSupplierInvoiceLine.mockRejectedValue(new Error("Database error"));

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Database error")).toBeInTheDocument();
  });

  // ── Hide row (display-only, no backend persist) ────────────────────────────────

  it("shows Hide button for each line in pending_review state", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });

  it("toggles row to hidden state and shows Show button", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("does not call API when Hide is clicked — hide is display-only", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Hide" }));

    expect(mockUpdateSupplierInvoiceLine).not.toHaveBeenCalled();
  });

  it("shows approval hint explaining hidden lines are still imported if matched", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(
      screen.getByText(/hidden lines are display-only and are still imported if they are matched/i),
    ).toBeInTheDocument();
  });

  // ── Approve Import ────────────────────────────────────────────────────────────

  it("shows Approve Import button for pending_review invoice", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Approve Import" })).toBeInTheDocument();
  });

  it("confirms the invoice when Approve Import is clicked", async () => {
    const user = userEvent.setup();
    mockConfirmSupplierInvoice.mockResolvedValue({
      invoice: confirmedInvoice,
      priceUpdates: 1,
    });

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Approve Import" }));

    await waitFor(() => {
      expect(mockConfirmSupplierInvoice).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        INVOICE_ID,
        expect.objectContaining({ readyToCreateLineIds: [], skippedLineIds: [] }),
      );
    });

    expect(await screen.findByText("Invoice Approved")).toBeInTheDocument();
  });

  it("shows confirm error when approval API call fails", async () => {
    const user = userEvent.setup();
    mockConfirmSupplierInvoice.mockRejectedValue(
      new Error("Invoice number is required to confirm."),
    );

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Approve Import" }));

    expect(
      await screen.findByText("Invoice number is required to confirm."),
    ).toBeInTheDocument();
  });

  // ── Void Invoice ──────────────────────────────────────────────────────────────

  it("shows Void Invoice button for pending_review invoice", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Void Invoice" })).toBeInTheDocument();
  });

  it("opens void confirm dialog when Void Invoice is clicked", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Void Invoice" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Void Invoice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, Void Invoice" })).toBeInTheDocument();
  });

  it("dismisses void dialog when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Void Invoice" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockVoidSupplierInvoice).not.toHaveBeenCalled();
  });

  it("voids the invoice on confirm and shows voided banner", async () => {
    const user = userEvent.setup();
    mockVoidSupplierInvoice.mockResolvedValue(voidedInvoice);

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Void Invoice" }));
    await user.click(screen.getByRole("button", { name: "Yes, Void Invoice" }));

    await waitFor(() => {
      expect(mockVoidSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, INVOICE_ID);
    });

    expect(await screen.findByText("Invoice Voided")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Read-only state ───────────────────────────────────────────────────────────

  it("hides Edit and Ignore buttons for confirmed invoices", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: confirmedInvoice,
      lines: [sampleLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignore" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve Import" })).not.toBeInTheDocument();
  });

  it("shows confirmed banner for confirmed invoices", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: confirmedInvoice,
      lines: [sampleLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(await screen.findByText("Invoice Approved")).toBeInTheDocument();
  });

  it("shows voided banner for voided invoices", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: voidedInvoice,
      lines: [sampleLine],
    });
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(await screen.findByText("Invoice Voided")).toBeInTheDocument();
  });

  // ── Navigation ────────────────────────────────────────────────────────────────

  it("renders back to suppliers link", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    const backLink = screen.getByRole("link", { name: /back to suppliers/i });
    expect(backLink).toBeInTheDocument();
  });
});
