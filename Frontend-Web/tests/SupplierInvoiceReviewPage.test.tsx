import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierInvoiceReviewPage } from "../src/pages/SupplierInvoiceReviewPage.js";
import type {
  SupplierInvoice,
  SupplierInvoiceLine,
  UploadAndExtractResult,
} from "../src/types/supplier.js";
import type {
  DiscoverReviewCandidatesResult,
  ReviewProductCandidate,
} from "../src/types/masterProduct.js";
import { createAdminUser, createManagerUser, TEST_CLINIC_ID } from "./helpers/auth.js";
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
  mockDiscoverReviewCandidates,
  mockConfirmMasterProductMatch,
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
    mockDiscoverReviewCandidates: vi.fn(),
    mockConfirmMasterProductMatch: vi.fn(),
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
    discoverReviewCandidates: mockDiscoverReviewCandidates,
    confirmMasterProductMatch: mockConfirmMasterProductMatch,
    listMasterProducts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listCategories: vi.fn().mockResolvedValue([
      "Consumables", "Dental Supplies", "Medications", "PPE", "Restorative", "Uncategorised",
    ]),
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
  receivedAt: null,
  receivedByUserId: null,
  receivedReference: null,
  notes: null,
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

const sampleLine: SupplierInvoiceLine = {
  id: "line-1111",
  invoiceId: INVOICE_ID,
  lineNumber: 1,
  priceIncludesTax: null,
  discountBasisPoints: 0,
  supplierLineTotalCents: null,
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
  reviewDecision: null,
  productCreationData: null,
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

const gloveSuggestion: ReviewProductCandidate = {
  masterProductId: "master-glove-black-medium",
  displayName: "Nitrile Gloves Black M 100pk",
  sku: "NGB-M-100",
  category: "PPE",
  brand: null,
  stockUnit: "box",
  relevanceScore: 95,
  reasons: ["family_relevance", "size_match", "pack_count_match"],
};

function discoveryResult(
  candidates: ReviewProductCandidate[] = [],
  overrides: Partial<DiscoverReviewCandidatesResult> = {},
): DiscoverReviewCandidatesResult {
  return {
    candidates,
    familyLabel: candidates.length > 0 ? "Nitrile Glove" : null,
    matchedAttributes: [],
    unresolvedAttributes: [],
    selectionRequired: true,
    ...overrides,
  };
}

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
    mockDiscoverReviewCandidates.mockReset();
    mockConfirmMasterProductMatch.mockReset();
    mockDiscoverReviewCandidates.mockResolvedValue(discoveryResult());
    mockConfirmMasterProductMatch.mockResolvedValue({});

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
    expect(screen.getAllByText("$55.00").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("$10.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);
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

  it("calls the suggestions API with supplier and invoice-line identity fields", async () => {
    const user = userEvent.setup();
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [{ ...unmatchedLine, ocrSku: "EEDMGM", ocrDescription: "Nitrile Gloves Medium" }],
    });
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    await waitFor(() => {
      expect(mockDiscoverReviewCandidates).toHaveBeenCalledWith({
        supplierId: sampleInvoice.supplierId,
        supplierSku: "EEDMGM",
        supplierDescription: "Nitrile Gloves Medium",
      });
    });
  });

  it("shows a persistent per-line loading state and prevents duplicate requests", async () => {
    let resolveSuggestions!: (value: DiscoverReviewCandidatesResult) => void;
    mockDiscoverReviewCandidates.mockReturnValue(
      new Promise((resolve) => {
        resolveSuggestions = resolve;
      }),
    );
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    const button = await screen.findByRole("button", { name: "Find suggestions" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Finding suggestions…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Finding suggestions…");
    await user.click(screen.getByRole("button", { name: "Finding suggestions…" }));
    expect(mockDiscoverReviewCandidates).toHaveBeenCalledTimes(1);

    resolveSuggestions(discoveryResult());
    expect(await screen.findByText("No suitable suggestions found")).toBeInTheDocument();
  });

  it("renders one returned candidate without accepting it automatically", async () => {
    mockDiscoverReviewCandidates.mockResolvedValue(discoveryResult([gloveSuggestion]));
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    expect(await screen.findByText(gloveSuggestion.displayName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Match" })).toBeInTheDocument();
    expect(mockUpdateSupplierInvoiceLine).not.toHaveBeenCalled();
    expect(mockConfirmMasterProductMatch).not.toHaveBeenCalled();
  });

  it("renders every Best Candidate, unresolved Colour, and mandatory selection", async () => {
    const blueSuggestion: ReviewProductCandidate = {
      ...gloveSuggestion,
      masterProductId: "master-glove-blue-medium",
      displayName: "Nitrile Gloves Blue M 100pk",
      sku: "NGBL-M-100",
    };
    mockDiscoverReviewCandidates.mockResolvedValue(
      discoveryResult([gloveSuggestion, blueSuggestion], {
        matchedAttributes: [
          { attribute: "size", label: "Size", value: "Medium" },
          { attribute: "pack_count", label: "Pack", value: "100pk" },
        ],
        unresolvedAttributes: [
          {
            attribute: "colour",
            label: "Colour",
            message: "Colour was not provided by the supplier. Choose the correct variant.",
          },
        ],
      }),
    );
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    expect(await screen.findByText(gloveSuggestion.displayName)).toBeInTheDocument();
    expect(screen.getByText(blueSuggestion.displayName)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Accept Match" })).toHaveLength(2);
    expect(screen.getByText("Best matches")).toBeInTheDocument();
    expect(screen.getByText(/Medium · 100pk/)).toBeInTheDocument();
    expect(
      screen.getByText(/Colour was not provided by the supplier/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Selection required/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match existing product" })).toBeInTheDocument();
    expect(mockUpdateSupplierInvoiceLine).not.toHaveBeenCalled();
  });

  it("submits only the explicitly chosen Master Product ID", async () => {
    const blueSuggestion: ReviewProductCandidate = {
      ...gloveSuggestion,
      masterProductId: "master-glove-blue-medium",
      displayName: "Nitrile Gloves Blue M 100pk",
      sku: "NGBL-M-100",
    };
    mockDiscoverReviewCandidates.mockResolvedValue(
      discoveryResult([gloveSuggestion, blueSuggestion]),
    );
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    mockUpdateSupplierInvoiceLine.mockResolvedValue({
      ...unmatchedLine,
      isMatched: true,
      matchMethod: "manual",
      masterCatalogItemId: blueSuggestion.masterProductId,
      masterProductName: blueSuggestion.displayName,
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));
    await screen.findByText(blueSuggestion.displayName);
    const acceptButtons = screen.getAllByRole("button", { name: "Accept Match" });
    const blueAcceptButton = acceptButtons[1];
    if (!blueAcceptButton) throw new Error("Expected the Blue candidate acceptance button");
    await user.click(blueAcceptButton);

    await waitFor(() => {
      expect(mockUpdateSupplierInvoiceLine).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        INVOICE_ID,
        unmatchedLine.id,
        {
          masterCatalogItemId: blueSuggestion.masterProductId,
          isMatched: true,
          matchMethod: "manual",
        },
      );
    });
    expect(mockUpdateSupplierInvoiceLine).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ masterCatalogItemId: gloveSuggestion.masterProductId }),
    );
  });

  it("shows an explicit empty state while preserving manual review actions", async () => {
    mockDiscoverReviewCandidates.mockResolvedValue(discoveryResult());
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    expect(await screen.findByText("No suitable suggestions found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match existing product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("shows a safe per-line error and keeps Find suggestions available for retry", async () => {
    mockDiscoverReviewCandidates.mockRejectedValue(new Error("sensitive backend detail"));
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: sampleInvoice,
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    expect(await screen.findByText("Unable to load suggestions")).toBeInTheDocument();
    expect(screen.getByText(/Please try again/)).toBeInTheDocument();
    expect(screen.queryByText("sensitive backend detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find suggestions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match existing product" })).toBeInTheDocument();
  });

  it("shows Supplier required and does not call the API when supplier is unresolved", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...sampleInvoice, supplierId: null },
      lines: [unmatchedLine],
    });
    const user = userEvent.setup();
    renderReviewPage();

    await user.click(await screen.findByRole("button", { name: "Find suggestions" }));

    expect(await screen.findByText("Supplier required")).toBeInTheDocument();
    expect(mockDiscoverReviewCandidates).not.toHaveBeenCalled();
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

  it("shows Ignore button for each line in pending_review state", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Ignore" })).toBeInTheDocument();
  });

  it("toggles row to hidden state and shows Show button", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Ignore" }));

    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("does not call API when Ignore is clicked — ignore is display-only", async () => {
    const user = userEvent.setup();
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Ignore" }));

    expect(mockUpdateSupplierInvoiceLine).not.toHaveBeenCalled();
  });

  it("shows approval hint explaining what confirming will do", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(
      screen.getByText(/confirming will create new products for lines marked/i),
    ).toBeInTheDocument();
  });

  // ── Confirm Invoice Import ────────────────────────────────────────────────────

  it("shows Confirm Invoice Import button for pending_review invoice", async () => {
    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Confirm Invoice Import" })).toBeInTheDocument();
  });

  it("confirms the invoice when Confirm Invoice Import is clicked", async () => {
    const user = userEvent.setup();
    mockConfirmSupplierInvoice.mockResolvedValue({
      invoice: confirmedInvoice,
      priceUpdates: 1,
    });

    renderReviewPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Confirm Invoice Import" }));

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

    await user.click(screen.getByRole("button", { name: "Confirm Invoice Import" }));

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
    expect(screen.queryByRole("button", { name: "Confirm Invoice Import" })).not.toBeInTheDocument();
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

// ── Additional tests: ready_for_review status and review_decision persistence ──

describe("SupplierInvoiceReviewPage — ready_for_review status and review decisions", () => {
  const readyForReviewInvoice: SupplierInvoice = {
    id: INVOICE_ID,
    clinicId: TEST_CLINIC_ID,
    supplierId: "sup-1111",
    supplierNameRaw: "DentalCo Australia",
    invoiceNumber: "DCO-2026-0042",
    invoiceDate: "2026-06-10",
    dueDate: null,
    status: "ready_for_review",
    subtotalCents: 5000,
    taxCents: 500,
    totalCents: 5500,
    currency: "AUD",
    ocrProvider: "claude",
    ocrConfidence: 90,
    originalFilename: "test.pdf",
    fileMimeType: "application/pdf",
    importedByUserId: "user-1",
    importedByEmail: "admin@clinic.com",
    confirmedByUserId: null,
    confirmedAt: null,
    voidedByUserId: null,
    voidedAt: null,
    receivedAt: null,
    receivedByUserId: null,
    receivedReference: null,
    notes: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  };

  const lineForReadyReview: SupplierInvoiceLine = {
    id: "line-rfr-1",
    invoiceId: INVOICE_ID,
    lineNumber: 1,
    ocrDescription: "Nitrile Gloves",
    ocrSku: null,
    quantity: 3,
    unitPriceCents: 1200,
    priceIncludesTax: null,
    discountBasisPoints: 0,
    lineTotalCents: 3600,
    taxRateBasisPoints: 1000,
    taxCents: 360,
    supplierLineTotalCents: null,
    masterCatalogItemId: null,
    masterProductName: null,
    supplierCatalogueId: null,
    isMatched: false,
    matchMethod: null,
    reviewDecision: null,
    productCreationData: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  };

  beforeEach(() => {
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: "Verve Dental Clinic A" },
    };
    setAuthenticatedUser(authTestState, createAdminUser());
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [lineForReadyReview],
    });
    mockUpdateSupplierInvoiceLine.mockResolvedValue({
      ...lineForReadyReview,
      reviewDecision: "skip",
    });
  });

  afterEach(() => {
    clearAuthenticatedUser(authTestState);
    vi.clearAllMocks();
  });

  // 1. ready_for_review shows actions (not read-only)
  it("shows Edit button for ready_for_review invoice (not read-only)", async () => {
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  // 2. ready_for_review shows Confirm Invoice Import button
  it("shows Confirm Invoice Import button for ready_for_review invoice", async () => {
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    expect(
      screen.getByRole("button", { name: "Confirm Invoice Import" }),
    ).toBeInTheDocument();
  });

  // 3. ready_for_review shows review progress
  it("shows review progress for ready_for_review invoice", async () => {
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    // New summary grid shows "Unresolved" section with "decision required" when line has no decision
    expect(await screen.findByText(/decision required/i)).toBeInTheDocument();
  });

  // 4. skip action persists to API
  it("calls updateSupplierInvoiceLine with reviewDecision=skip when Skip is clicked", async () => {
    const user = userEvent.setup();
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(mockUpdateSupplierInvoiceLine).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        INVOICE_ID,
        "line-rfr-1",
        expect.objectContaining({ reviewDecision: "skip" }),
      );
    });
  });

  // 5. create_product action opens modal, persists to API on save
  it("calls updateSupplierInvoiceLine with reviewDecision=create_product when Create new product modal is submitted", async () => {
    mockUpdateSupplierInvoiceLine.mockResolvedValue({
      ...lineForReadyReview,
      reviewDecision: "create_product",
      productCreationData: {
        productName: "Nitrile Gloves",
        category: "Dental Supplies",
        supplierSku: null,
        stockUnit: "unit",
        receivingUnit: "unit",
        unitsPerReceivingUnit: 1,
        unitCostCents: 1200,
      },
    });
    const user = userEvent.setup();
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });

    // Click opens the modal
    await user.click(screen.getByRole("button", { name: "Create new product" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/product name/i)).toBeInTheDocument();

    // Select a valid category (required since no category is pre-selected)
    const categorySelect = screen.getByLabelText(/category/i);
    await waitFor(() => expect(categorySelect).toBeEnabled());
    await user.selectOptions(categorySelect, "Consumables");

    // Submit the modal (pre-filled name should already be valid)
    await user.click(screen.getByRole("button", { name: /Save and Mark Ready to Create/i }));

    await waitFor(() => {
      expect(mockUpdateSupplierInvoiceLine).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        INVOICE_ID,
        "line-rfr-1",
        expect.objectContaining({
          reviewDecision: "create_product",
          productCreationData: expect.objectContaining({ productName: "Nitrile Gloves" }) as unknown,
        }),
      );
    });
  });

  // 6. DB reviewDecision hydrated on load — shows 'Ready to Create' badge
  it("hydrates Ready to Create badge from line.reviewDecision=create_product on load", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [{ ...lineForReadyReview, reviewDecision: "create_product" }],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    expect(await screen.findByText("Ready to Create")).toBeInTheDocument();
  });

  // 7. DB reviewDecision hydrated on load — shows 'Skipped' badge
  it("hydrates Skipped badge from line.reviewDecision=skip on load", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [{ ...lineForReadyReview, reviewDecision: "skip" }],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
  });

  // 8. progress shows 1/1 when line has a decision
  it("shows 1 of 1 reviewed when line is skipped", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [{ ...lineForReadyReview, reviewDecision: "skip" }],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    // New summary grid — no unresolved section means all lines are resolved
    expect(await screen.findByText(/Skipped \/ Ignored/i)).toBeInTheDocument();
    expect(screen.queryByText(/decision required/i)).not.toBeInTheDocument();
  });

  // 9. progress shows 1/1 when line is matched
  it("shows 1 of 1 reviewed when line is matched", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [{ ...lineForReadyReview, isMatched: true, masterProductName: "Gloves", reviewDecision: null, masterCatalogItemId: "prod-xxx" }],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    // New summary grid — matched line shows in ✅ Matched row, no unresolved
    expect(await screen.findByText("✅ Matched")).toBeInTheDocument();
    expect(screen.queryByText(/decision required/i)).not.toBeInTheDocument();
  });

  // 10. Proceed to Receiving navigates to correct route (not Daily Hub)
  it("Proceed to Receiving link points to /inventory/receiving, not /inventory/receive", async () => {
    const confirmedInvoice = {
      ...readyForReviewInvoice,
      status: "imported" as const,
      confirmedByUserId: "user-1",
      confirmedAt: "2026-07-23T00:00:00.000Z",
      receivedAt: null,
    };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: confirmedInvoice,
      lines: [lineForReadyReview],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    const link = await screen.findByRole("link", { name: "Proceed to Receiving" });
    expect(link).toHaveAttribute("href", `/inventory/receiving?invoiceId=${INVOICE_ID}`);
  });

  // 11. Zero-price line shows Free badge
  it("shows Free badge for a zero-price line", async () => {
    const zeroLine = { ...lineForReadyReview, unitPriceCents: 0, lineTotalCents: 0 };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: readyForReviewInvoice,
      lines: [zeroLine],
    });

    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    expect(await screen.findByText("Free")).toBeInTheDocument();
  });

  // 12. Product creation modal opens and shows pre-filled product name
  it("opens product creation modal with pre-filled product name when Create new product is clicked", async () => {
    const user = userEvent.setup();
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Create new product" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/product name/i);
    expect(nameInput).toHaveValue("Nitrile Gloves");
  });

  // 13. Confirmation summary shows breakdown
  it("shows confirmation summary with matched/create/skipped/unresolved breakdown", async () => {
    renderReviewPage();
    await screen.findByRole("heading", { name: "DentalCo Australia" });
    // With 1 unresolved line, "decision required" text should appear
    expect(await screen.findByText(/decision required/i)).toBeInTheDocument();
    // Summary section labels
    expect(screen.getByText(/✅ Matched/)).toBeInTheDocument();
    expect(screen.getByText(/🆕 Ready to Create/)).toBeInTheDocument();
  });
});

// ── Tax treatment and financial display tests ──────────────────────────────────

describe("SupplierInvoiceReviewPage — tax treatment and financial summary display", () => {
  const taxInvoice: SupplierInvoice = {
    id: "inv-tax-test",
    clinicId: TEST_CLINIC_ID,
    supplierId: "sup-tax",
    supplierNameRaw: "Tax Test Supplier",
    invoiceNumber: "TX-001",
    invoiceDate: "2026-08-17",
    dueDate: null,
    status: "pending_review",
    subtotalCents: null,
    taxCents: null,
    totalCents: null,
    currency: "AUD",
    ocrProvider: "claude",
    ocrConfidence: 95,
    originalFilename: "test-invoice.pdf",
    fileMimeType: "application/pdf",
    importedByUserId: "user-1",
    importedByEmail: "test@clinic.com",
    confirmedByUserId: null,
    confirmedAt: null,
    voidedByUserId: null,
    voidedAt: null,
    receivedAt: null,
    receivedByUserId: null,
    receivedReference: null,
    notes: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  const baseLine: SupplierInvoiceLine = {
    id: "line-tax-1",
    invoiceId: "inv-tax-test",
    lineNumber: 1,
    ocrDescription: "Test Product",
    ocrSku: "TP-001",
    quantity: 1,
    unitPriceCents: 11000,
    priceIncludesTax: null,
    discountBasisPoints: 0,
    lineTotalCents: 11000,
    taxRateBasisPoints: 1000,
    taxCents: 1000,
    supplierLineTotalCents: null,
    masterCatalogItemId: null,
    masterProductName: null,
    supplierCatalogueId: null,
    isMatched: false,
    matchMethod: null,
    reviewDecision: null,
    productCreationData: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  beforeEach(() => {
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: "Verve Dental Clinic A" },
    };
    setAuthenticatedUser(authTestState, createManagerUser());
  });

  afterEach(() => {
    clearAuthenticatedUser(authTestState);
    vi.clearAllMocks();
  });

  // Test 1: GST-inclusive unit price shows "incl. GST"
  it("displays incl. GST label for priceIncludesTax=true lines", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, priceIncludesTax: true }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getAllByText("incl. GST").length).toBeGreaterThan(0);
  });

  // Test 2: GST-exclusive price shows "ex GST"
  it("displays ex GST label for priceIncludesTax=false lines", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, priceIncludesTax: false }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getByText("ex GST")).toBeInTheDocument();
  });

  // Test 3: Unknown tax basis shows "tax basis unknown"
  it("displays tax basis unknown label for priceIncludesTax=null lines", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, priceIncludesTax: null }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getByText("tax basis unknown")).toBeInTheDocument();
  });

  // Test 4: Discount displays clearly in GST/Discount column
  it("displays discount label in GST/Discount column for lines with discountBasisPoints > 0", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, discountBasisPoints: 1000 }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getByText("10% discount")).toBeInTheDocument();
  });

  // Test 5: Supplier line total is shown when available
  it("shows supplier-stated line total when supplierLineTotalCents is set", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, supplierLineTotalCents: 9900, lineTotalCents: 11000 }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    // Supplier total $99.00 takes priority over lineTotalCents $110.00.
    // $99.00 should appear in both the Line Total column and the financial summary.
    expect(screen.getAllByText("$99.00").length).toBeGreaterThanOrEqual(2);
  });

  // Test 6: Visible lines subtotal uses supplier line totals
  it("shows correct visible lines subtotal from supplier line totals in financial summary", async () => {
    const line1 = { ...baseLine, id: "l1", supplierLineTotalCents: 9900, lineTotalCents: 11000, taxCents: 900 };
    const line2 = { ...baseLine, id: "l2", supplierLineTotalCents: 4950, lineTotalCents: 5500, taxCents: 450 };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [line1, line2],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    // Combined supplier total = $99.00 + $49.50 = $148.50
    expect(await screen.findByText("$148.50")).toBeInTheDocument();
  });

  // Test 7: Balanced invoice shows "$0.00" and "Balanced ✓"
  it("shows $0.00 and Balanced ✓ when invoice total matches active line totals", async () => {
    const balancedInvoice = { ...taxInvoice, totalCents: 11000 };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: balancedInvoice,
      lines: [{ ...baseLine, supplierLineTotalCents: 11000, lineTotalCents: 11000 }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(await screen.findByText("Balanced ✓")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  // Test 8: Piksters medium gloves line — $55.00, 10% discount, $148.50
  it("shows $55.00 unit price, incl. GST, 10% discount and $148.50 line total for discounted incl-GST line", async () => {
    const gloveLine: SupplierInvoiceLine = {
      ...baseLine,
      id: "line-gloves-medium",
      ocrDescription: "Erskine Everyday Dental Nitrile Glove Medium,100pk",
      ocrSku: "EEDNGM",
      quantity: 3,
      unitPriceCents: 5500,
      priceIncludesTax: true,
      discountBasisPoints: 1000,
      taxRateBasisPoints: 1000,
      taxCents: 1350,
      lineTotalCents: 14850,
      supplierLineTotalCents: 14850,
    };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [gloveLine],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });

    expect(screen.getAllByText("$55.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("incl. GST").length).toBeGreaterThan(0);
    expect(screen.getByText("10% discount")).toBeInTheDocument();
    // $148.50 appears in both the line row and the financial summary.
    expect(screen.getAllByText("$148.50").length).toBeGreaterThan(0);
  });

  it("normalises defensive string cents without concatenating reconciliation totals", async () => {
    const runtimeStringLine = {
      ...baseLine,
      priceIncludesTax: true,
      supplierLineTotalCents: "11990" as unknown as number,
      lineTotalCents: 11_990,
      taxCents: 1_090,
    };
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: {
        ...taxInvoice,
        subtotalCents: 10_900,
        taxCents: 1_090,
        totalCents: 11_990,
      },
      lines: [runtimeStringLine],
    });

    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });

    expect(screen.getAllByText("$119.90").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Balanced ✓")).toBeInTheDocument();
    expect(screen.queryByText(/1199011990/)).not.toBeInTheDocument();
  });

  it("reconciles all eight Piksters lines to $714.05 with supplier header truth", async () => {
    const pikstersLines: SupplierInvoiceLine[] = [
      ["ERVA363", "Diapro Twist RA Set - 6pk", 1, 11_990, 0, 1_090, 11_990],
      [".PKRP140", "Piksters Professional Pack Refills (1) Purple 40pk", 1, 685, 0, 62, 685],
      [".PKRP040", "Piksters Professional Pack Refills (0) Silver 40pk", 3, 685, 0, 187, 2_055],
      [".PKRP0040", "Piksters Professional Pack Refills (00) Pink 40pk", 3, 685, 0, 187, 2_055],
      [".PKRP00040", "Piksters Professional Pack Refills (000) Navy 40pk", 2, 685, 0, 125, 1_370],
      ["EPAK0001", "Piksters - On the Go - Essential Oral Care Kit", 1, 28_500, 0, 2_591, 28_500],
      ["EEDNGS", "Erskine Everyday Dental Nitrile Glove Small,100pk", 2, 5_500, 1_000, 900, 9_900],
      ["EEDMGM", "Erskine Everyday Dental Nitrile Glove Medium,100pk", 3, 5_500, 1_000, 1_350, 14_850],
    ].map(([sku, description, quantity, unitPriceCents, discountBasisPoints, taxCents, total], index) => ({
      ...baseLine,
      id: `piksters-${String(index + 1)}`,
      lineNumber: index + 1,
      ocrSku: sku as string,
      ocrDescription: description as string,
      quantity: quantity as number,
      unitPriceCents: unitPriceCents as number,
      priceIncludesTax: true,
      discountBasisPoints: discountBasisPoints as number,
      taxCents: taxCents as number,
      lineTotalCents: total as number,
      supplierLineTotalCents: total as number,
    }));
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: {
        ...taxInvoice,
        supplierNameRaw: "Erskine Oral Care",
        invoiceNumber: "INV538147",
        invoiceDate: "2026-05-04",
        subtotalCents: 64_913,
        taxCents: 6_492,
        totalCents: 71_405,
      },
      lines: pikstersLines,
    });

    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Erskine Oral Care" });

    expect(screen.getAllByText("$714.05").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("$649.13")).toBeInTheDocument();
    expect(screen.getByText("$64.92")).toBeInTheDocument();
    expect(screen.getByText("-$27.50")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("Balanced ✓")).toBeInTheDocument();
    expect(screen.queryByText("ex GST")).not.toBeInTheDocument();
  });

  // Test 9: Existing match buttons continue to render for unmatched lines
  it("still renders all match action buttons for unmatched lines after UI changes", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine, isMatched: false }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getByRole("button", { name: "Find suggestions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match existing product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  // Test 10: Existing review actions (Edit, Ignore, Confirm) still work after UI changes
  it("still renders Edit, Ignore, and Confirm Invoice Import buttons after UI changes", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: taxInvoice,
      lines: [{ ...baseLine }],
    });
    renderReviewPage("inv-tax-test");
    await screen.findByRole("heading", { name: "Tax Test Supplier" });
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Invoice Import" })).toBeInTheDocument();
  });
});

// ── Conditional incl. GST label tests ─────────────────────────────────────────

describe("SupplierInvoiceReviewPage — conditional incl. GST labelling", () => {
  const labelTestInvoice: SupplierInvoice = {
    id: "inv-label-test",
    clinicId: TEST_CLINIC_ID,
    supplierId: "sup-label",
    supplierNameRaw: "Label Test Supplier",
    invoiceNumber: "LBL-001",
    invoiceDate: "2026-08-17",
    dueDate: null,
    status: "pending_review",
    subtotalCents: null,
    taxCents: null,
    totalCents: 11000,
    currency: "AUD",
    ocrProvider: "claude",
    ocrConfidence: 90,
    originalFilename: "label-test.pdf",
    fileMimeType: "application/pdf",
    importedByUserId: "user-1",
    importedByEmail: "test@clinic.com",
    confirmedByUserId: null,
    confirmedAt: null,
    voidedByUserId: null,
    voidedAt: null,
    receivedAt: null,
    receivedByUserId: null,
    receivedReference: null,
    notes: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  const inclGSTLine: SupplierInvoiceLine = {
    id: "line-lbl-1",
    invoiceId: "inv-label-test",
    lineNumber: 1,
    ocrDescription: "GST-Inclusive Product",
    ocrSku: "GIP-001",
    quantity: 1,
    unitPriceCents: 11000,
    priceIncludesTax: true,
    discountBasisPoints: 0,
    lineTotalCents: 11000,
    taxRateBasisPoints: 1000,
    taxCents: 1000,
    supplierLineTotalCents: 11000,
    masterCatalogItemId: null,
    masterProductName: null,
    supplierCatalogueId: null,
    isMatched: false,
    matchMethod: null,
    reviewDecision: null,
    productCreationData: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  beforeEach(() => {
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: "Verve Dental Clinic A" },
    };
    setAuthenticatedUser(authTestState, createManagerUser());
  });

  afterEach(() => {
    clearAuthenticatedUser(authTestState);
    vi.clearAllMocks();
  });

  // Test A: Piksters-style / all lines priceIncludesTax=true, taxRateBasisPoints=1000
  it("shows incl. GST on invoice total and Line Total column when all lines are GST-inclusive", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: labelTestInvoice,
      lines: [inclGSTLine],
    });
    renderReviewPage("inv-label-test");
    await screen.findByRole("heading", { name: "Label Test Supplier" });

    // Column header must be "Line Total (incl. GST)"
    expect(screen.getByRole("columnheader", { name: "Line Total (incl. GST)" })).toBeInTheDocument();
    // "incl. GST" must appear at least once (invoice total sublabel and/or unit price area)
    expect(screen.getAllByText("incl. GST").length).toBeGreaterThanOrEqual(1);
  });

  // Test B: Unknown tax semantics — priceIncludesTax=null
  it("does not show incl. GST anywhere when tax treatment is unknown (priceIncludesTax=null)", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: labelTestInvoice,
      lines: [{ ...inclGSTLine, priceIncludesTax: null }],
    });
    renderReviewPage("inv-label-test");
    await screen.findByRole("heading", { name: "Label Test Supplier" });

    // Column header must be plain "Line Total"
    expect(screen.queryByRole("columnheader", { name: "Line Total (incl. GST)" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Line Total" })).toBeInTheDocument();
    // No "incl. GST" text — unit price shows "tax basis unknown" instead
    expect(screen.queryByText("incl. GST")).not.toBeInTheDocument();
  });

  // Test C: GST-free invoice — taxRateBasisPoints=0 (no GST charged)
  it("does not show incl. GST in column header or invoice total when all lines are GST-free", async () => {
    mockGetSupplierInvoice.mockResolvedValue({
      invoice: { ...labelTestInvoice, totalCents: 10000 },
      lines: [{ ...inclGSTLine, taxRateBasisPoints: 0, taxCents: 0, priceIncludesTax: null }],
    });
    renderReviewPage("inv-label-test");
    await screen.findByRole("heading", { name: "Label Test Supplier" });

    // Column header must be plain "Line Total" (GST-free: no incl. GST qualifier)
    expect(screen.queryByRole("columnheader", { name: "Line Total (incl. GST)" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Line Total" })).toBeInTheDocument();
    // No "incl. GST" text anywhere (priceIncludesTax=null → "tax basis unknown" in unit price)
    expect(screen.queryByText("incl. GST")).not.toBeInTheDocument();
  });
});
