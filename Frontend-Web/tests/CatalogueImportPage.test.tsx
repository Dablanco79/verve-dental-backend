import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogueImportPage } from "../src/pages/CatalogueImportPage.js";
import { CatalogueImportReviewPage } from "../src/pages/CatalogueImportReviewPage.js";
import type { ConfirmImportResult, Supplier, SupplierInvoice, SupplierInvoiceLine } from "../src/types/supplier.js";
import { createManagerUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockListSuppliers,
  mockListClinicSupplierInvoices,
  mockPreviewSupplierCatalogueImport,
  mockConfirmSupplierCatalogueImport,
  mockConfirmReviewedSupplierCatalogueImport,
  mockUploadSupplierInvoice,
  mockGetSupplierInvoice,
  mockUpdateSupplierInvoiceLine,
  mockConfirmSupplierInvoice,
  mockCancelSupplierInvoiceImport,
  mockAdjustInventory,
  mockHandleScan,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  const selectedClinicState = {
    selectedClinic: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Verve Dental Clinic A",
    },
    selectedDashboardScope: {
      type: "clinic" as const,
      clinic: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Verve Dental Clinic A",
      },
    } as
      | { type: "all_clinics" }
      | { type: "clinic"; clinic: { id: string; name: string } },
  };
  return {
    authTestState,
    selectedClinicState,
    mockListSuppliers: vi.fn(),
    mockListClinicSupplierInvoices: vi.fn(),
    mockPreviewSupplierCatalogueImport: vi.fn(),
    mockConfirmSupplierCatalogueImport: vi.fn(),
    mockConfirmReviewedSupplierCatalogueImport: vi.fn(),
    mockUploadSupplierInvoice: vi.fn(),
    mockGetSupplierInvoice: vi.fn(),
    mockUpdateSupplierInvoiceLine: vi.fn(),
    mockConfirmSupplierInvoice: vi.fn(),
    mockCancelSupplierInvoiceImport: vi.fn(),
    mockAdjustInventory: vi.fn(),
    mockHandleScan: vi.fn(),
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

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listSuppliers: mockListSuppliers,
    listClinicSupplierInvoices: mockListClinicSupplierInvoices,
    previewSupplierCatalogueImport: mockPreviewSupplierCatalogueImport,
    confirmSupplierCatalogueImport: mockConfirmSupplierCatalogueImport,
    confirmReviewedSupplierCatalogueImport: mockConfirmReviewedSupplierCatalogueImport,
    uploadSupplierInvoice: mockUploadSupplierInvoice,
    getSupplierInvoice: mockGetSupplierInvoice,
    updateSupplierInvoiceLine: mockUpdateSupplierInvoiceLine,
    confirmSupplierInvoice: mockConfirmSupplierInvoice,
    cancelSupplierInvoiceImport: mockCancelSupplierInvoiceImport,
    adjustInventory: mockAdjustInventory,
    handleScan: mockHandleScan,
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

const supplier = {
  id: "33333333-3333-4333-8333-333333333333",
  supplierName: "DentalCo AU",
  active: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
} as Supplier;

const adamDentalSupplier = {
  ...supplier,
  id: "44444444-4444-4444-8444-444444444444",
  supplierName: "Adam Dental",
};

const dentavisionSupplier = {
  ...supplier,
  id: "55555555-5555-4555-8555-555555555555",
  supplierName: "Dentavision",
};

const invoiceImport = {
  id: "invoice-1",
  clinicId: TEST_CLINIC_ID,
  supplierId: supplier.id,
  supplierNameRaw: "DentalCo AU",
  invoiceNumber: "INV-100",
  invoiceDate: "2026-07-01",
  dueDate: null,
  status: "pending_review",
  subtotalCents: null,
  taxCents: null,
  totalCents: null,
  currency: "AUD",
  ocrProvider: "claude",
  ocrConfidence: 0.84,
  originalFilename: "invoice-100.pdf",
  fileMimeType: "application/pdf",
  importedByUserId: "user-1",
  importedByEmail: "manager@clinic-a.au",
  confirmedByUserId: null,
  confirmedAt: null,
  voidedByUserId: null,
  voidedAt: null,
  notes: null,
  createdAt: "2026-07-01T02:30:00.000Z",
  updatedAt: "2026-07-01T02:30:00.000Z",
} as SupplierInvoice;

function buildInvoiceImport(
  id: string,
  originalFilename: string,
  status: SupplierInvoice["status"],
): SupplierInvoice {
  return {
    ...invoiceImport,
    id,
    originalFilename,
    status,
  };
}

const matchedLine = {
  id: "line-1",
  invoiceId: invoiceImport.id,
  lineNumber: 1,
  ocrDescription: "Nitrile Examination Gloves Box 100",
  ocrSku: "GLV-100",
  quantity: 2,
  unitPriceCents: 1250,
  lineTotalCents: 2500,
  taxRateBasisPoints: 1000,
  taxCents: 250,
  masterCatalogItemId: "master-gloves",
  supplierCatalogueId: "catalogue-gloves",
  isMatched: true,
  matchMethod: "exact_sku",
  createdAt: "2026-07-01T02:30:00.000Z",
  updatedAt: "2026-07-01T02:30:00.000Z",
} as SupplierInvoiceLine;

const unmatchedLine = {
  ...matchedLine,
  id: "line-unmatched",
  ocrDescription: "Unknown bonding agent",
  ocrSku: null,
  lineTotalCents: Number.NaN,
  masterCatalogItemId: null,
  supplierCatalogueId: null,
  isMatched: false,
  matchMethod: null,
} as SupplierInvoiceLine;

function renderCatalogueImportPage() {
  return render(
    <MemoryRouter initialEntries={["/inventory/catalogue-import"]}>
      <CatalogueImportPage />
    </MemoryRouter>,
  );
}

function renderCatalogueImportRoutes(initialEntry = "/inventory/catalogue-import") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/inventory/catalogue-import" element={<CatalogueImportPage />} />
        <Route
          path="/inventory/catalogue-import/:importId/review"
          element={<CatalogueImportReviewPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected file input");
  }
  return input;
}

function selectSupplier(supplierId: string): void {
  fireEvent.change(screen.getByLabelText(/Supplier \*/), { target: { value: supplierId } });
}

async function renderStructuredProductReview() {
  mockListSuppliers.mockResolvedValue([adamDentalSupplier]);
  mockPreviewSupplierCatalogueImport.mockResolvedValue({
    supplierId: adamDentalSupplier.id,
    totalRows: 2,
    matchedRows: 1,
    unmatchedRows: 1,
    errorRows: 0,
    rows: [
      {
        rowNumber: 2,
        supplierSku: "GLV-100",
        description: "Gloves",
        rawUnitCost: "12.50",
        unitCostCents: 1250,
        unitOfMeasure: null,
        matchedProductId: "product-gloves",
        matchedProductName: "Gloves",
        matchedProductSku: "GLV",
        matchStatus: "name",
        error: null,
      },
      {
        rowNumber: 3,
        supplierSku: "MASK-5",
        description: "Masks",
        rawUnitCost: "8.00",
        unitCostCents: 800,
        unitOfMeasure: null,
        matchedProductId: null,
        matchedProductName: null,
        matchedProductSku: null,
        matchStatus: "unmatched",
        error: null,
      },
    ],
  });

  const rendered = renderCatalogueImportPage();
  await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
  fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));
  await screen.findByLabelText(/Supplier \*/);

  const file = new File(
    [[
      "Supplier,Product,Quantity,Unit Price,GST,supplier_sku",
      "Adam Dental,Gloves,2 boxes,12.50,1.25,GLV-100",
      "Adam Dental,Masks,5 packs,8.00,0.80,MASK-5",
    ].join("\n")],
    "structured-actions.csv",
    { type: "text/csv" },
  );
  fireEvent.change(getFileInput(rendered.container), { target: { files: [file] } });
  await screen.findByText("Supplier column detected");
  fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));
  await screen.findByRole("heading", { name: "Structured Supplier Review" });
  return rendered;
}

describe("CatalogueImportPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createManagerUser());
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockListSuppliers.mockReset();
    mockListClinicSupplierInvoices.mockReset();
    mockPreviewSupplierCatalogueImport.mockReset();
    mockConfirmSupplierCatalogueImport.mockReset();
    mockConfirmReviewedSupplierCatalogueImport.mockReset();
    mockUploadSupplierInvoice.mockReset();
    mockGetSupplierInvoice.mockReset();
    mockUpdateSupplierInvoiceLine.mockReset();
    mockConfirmSupplierInvoice.mockReset();
    mockCancelSupplierInvoiceImport.mockReset();
    mockAdjustInventory.mockReset();
    mockHandleScan.mockReset();
    mockListSuppliers.mockResolvedValue([supplier]);
    mockListClinicSupplierInvoices.mockResolvedValue([invoiceImport]);
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [] });
    mockConfirmSupplierInvoice.mockResolvedValue({
      invoice: { ...invoiceImport, status: "confirmed", confirmedAt: "2026-07-01T03:00:00.000Z" },
      priceUpdates: 1,
      createdProducts: 0,
    } satisfies ConfirmImportResult);
    mockCancelSupplierInvoiceImport.mockResolvedValue({
      ...invoiceImport,
      status: "cancelled",
      voidedByUserId: "user-1",
      voidedAt: "2026-07-01T03:00:00.000Z",
    });
    mockPreviewSupplierCatalogueImport.mockResolvedValue({
      supplierId: supplier.id,
      totalRows: 2,
      matchedRows: 2,
      unmatchedRows: 0,
      errorRows: 0,
      rows: [],
    });
    mockConfirmSupplierCatalogueImport.mockResolvedValue({
      supplierId: supplier.id,
      imported: 2,
      updated: 0,
      skipped: 0,
      errors: 0,
      rows: [],
    });
    mockConfirmReviewedSupplierCatalogueImport.mockResolvedValue({
      supplierId: adamDentalSupplier.id,
      imported: 2,
      updated: 0,
      skipped: 0,
      errors: 0,
      createdProducts: 1,
      rows: [],
    });
  });

  it("renders import sources, disabled future cards, and previous imports", async () => {
    renderCatalogueImportPage();

    expect(await screen.findByRole("heading", { name: "Catalogue Import" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Supplier Invoice \(PDF\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Supplier Catalogue \(PDF\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Excel \(\.xlsx\/\.xls\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^CSV/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Image \(PNG\/JPG\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Supplier API/ })).toBeDisabled();
    expect(screen.getAllByText("Available in a future release")).toHaveLength(5);

    expect(await screen.findByRole("link", { name: /Review invoice-100\.pdf/ })).toBeInTheDocument();
    expect(screen.getByText("DentalCo AU")).toBeInTheDocument();
    expect(screen.getByText("Review Required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review invoice-100\.pdf/ })).toHaveAttribute(
      "href",
      "/inventory/catalogue-import/invoice-1/review",
    );
    expect(screen.getByRole("button", { name: /Cancel invoice-100\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete invoice-100\.pdf/ })).not.toBeInTheDocument();
  });

  it("renders lifecycle actions for each import status without delete", async () => {
    mockListClinicSupplierInvoices.mockResolvedValue([
      buildInvoiceImport("review-import", "review-required.pdf", "pending_review"),
      buildInvoiceImport("processing-import", "processing.pdf", "processing"),
      buildInvoiceImport("imported-import", "imported.pdf", "confirmed"),
      buildInvoiceImport("cancelled-import", "cancelled.pdf", "cancelled"),
      buildInvoiceImport("failed-import", "failed.pdf", "failed"),
    ]);

    renderCatalogueImportPage();

    expect(await screen.findByRole("link", { name: /Review review-required\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel review-required\.pdf/ })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /View processing\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel processing\.pdf/ })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /View imported\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel imported\.pdf/ })).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: /View cancelled\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel cancelled\.pdf/ })).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: /View failed\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry failed\.pdf/ })).toBeDisabled();

    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("cancels an import from the imported files list and refreshes to Cancelled", async () => {
    const cancelledImport = buildInvoiceImport("invoice-1", "invoice-100.pdf", "cancelled");
    let hasCancelled = false;
    mockListClinicSupplierInvoices.mockImplementation(() => Promise.resolve(hasCancelled ? [cancelledImport] : [invoiceImport]));
    mockCancelSupplierInvoiceImport.mockImplementation(() => {
      hasCancelled = true;
      return Promise.resolve(cancelledImport);
    });

    renderCatalogueImportPage();

    fireEvent.click(await screen.findByRole("button", { name: /Cancel invoice-100\.pdf/ }));

    expect(screen.getByRole("dialog", { name: "Cancel Import?" })).toBeInTheDocument();
    expect(
      screen.getByText("This will discard invoice-100.pdf and all extracted catalogue review data. No products, pricing or inventory changes will be saved."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel Import" }));

    await waitFor(() => {
      expect(mockCancelSupplierInvoiceImport).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id);
    });
    await waitFor(() => {
      expect(mockListClinicSupplierInvoices.mock.calls.length).toBeGreaterThan(1);
    });
    expect(await screen.findByText("Import cancelled.")).toBeInTheDocument();
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View invoice-100\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel invoice-100\.pdf/ })).not.toBeInTheDocument();
  });

  it("requires supplier selection for structured catalogue files without a Supplier column", async () => {
    const { container } = renderCatalogueImportPage();

    await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
    fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));
    expect(await screen.findByLabelText(/Supplier \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Supplier \*/)).toHaveValue("");

    const file = new File(["description,unit_cost\nGloves,12.50"], "catalogue.csv", {
      type: "text/csv",
    });
    fireEvent.change(getFileInput(container), { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeDisabled();
    });

    selectSupplier(supplier.id);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));

    await waitFor(() => {
      expect(mockPreviewSupplierCatalogueImport).toHaveBeenCalledWith(supplier.id, file);
      expect(mockConfirmSupplierCatalogueImport).toHaveBeenCalledWith(supplier.id, file);
    });
    expect(mockUploadSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 imported, 0 updated/)).toBeInTheDocument();
  });

  it("groups multi-supplier CSV files without supplier preselection or invoice review routing", async () => {
    mockListSuppliers.mockResolvedValue([adamDentalSupplier, dentavisionSupplier]);
    mockPreviewSupplierCatalogueImport.mockImplementation((supplierId: string) =>
      Promise.resolve({
        supplierId,
        totalRows: 1,
        matchedRows: 1,
        unmatchedRows: 0,
        errorRows: 0,
        rows: [
          {
            rowNumber: 2,
            supplierSku: null,
            description: supplierId === adamDentalSupplier.id ? "Gloves" : "Masks",
            rawUnitCost: supplierId === adamDentalSupplier.id ? "12.50" : "8.00",
            unitCostCents: supplierId === adamDentalSupplier.id ? 1250 : 800,
            unitOfMeasure: null,
            matchedProductId: "product-1",
            matchedProductName: supplierId === adamDentalSupplier.id ? "Gloves" : "Masks",
            matchedProductSku: "SKU-1",
            matchStatus: "name",
            error: null,
          },
        ],
      }),
    );

    const { container } = renderCatalogueImportPage();
    await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
    fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));
    expect(await screen.findByLabelText(/Supplier \*/)).toBeInTheDocument();

    const file = new File(
      [[
        "Supplier,Product,Quantity,Unit Price,GST",
        "Adam Dental,Gloves,2,12.50,1.25",
        "Dentavision,Masks,5,8.00,0.80",
      ].join("\n")],
      "multi-supplier.csv",
      { type: "text/csv" },
    );
    fireEvent.change(getFileInput(container), { target: { files: [file] } });

    expect(await screen.findByText("Supplier column detected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Supplier *")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByRole("heading", { name: "Structured Supplier Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Adam Dental" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dentavision" })).toBeInTheDocument();
    expect(screen.getAllByText("Supplier Matched")).toHaveLength(2);
    expect(screen.getByText(/2 suppliers detected; 2 matched existing suppliers/)).toBeInTheDocument();
    expect(screen.getByText("Review on page")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockPreviewSupplierCatalogueImport).toHaveBeenCalledTimes(2);
    });
    expect(mockPreviewSupplierCatalogueImport).toHaveBeenCalledWith(
      adamDentalSupplier.id,
      expect.objectContaining({ name: "multi-supplier-adam-dental.csv" }),
    );
    expect(mockPreviewSupplierCatalogueImport).toHaveBeenCalledWith(
      dentavisionSupplier.id,
      expect.objectContaining({ name: "multi-supplier-dentavision.csv" }),
    );
    expect(mockConfirmSupplierCatalogueImport).not.toHaveBeenCalled();
    expect(mockUploadSupplierInvoice).not.toHaveBeenCalled();
    expect(mockGetSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
  });

  it("shows supplier creation and match options for unmatched suppliers in structured files", async () => {
    mockListSuppliers.mockResolvedValue([adamDentalSupplier]);

    const { container } = renderCatalogueImportPage();
    await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
    fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));
    expect(await screen.findByLabelText(/Supplier \*/)).toBeInTheDocument();

    const file = new File([
      "Supplier,Product,Quantity,Unit Price,GST\nDentavision,Masks,5,8.00,0.80",
    ],
      "unmatched-supplier.csv",
      { type: "text/csv" },
    );
    fireEvent.change(getFileInput(container), { target: { files: [file] } });
    await screen.findByText("Supplier column detected");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload & Process" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByRole("heading", { name: "Dentavision" })).toBeInTheDocument();
    expect(screen.getByText("Supplier Review Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Supplier" })).toBeInTheDocument();
    expect(screen.getByLabelText("Match Existing")).toBeInTheDocument();
    expect(mockPreviewSupplierCatalogueImport).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
  });

  it("normalises structured rows and extracts supplier SKU from product descriptions", async () => {
    mockListSuppliers.mockResolvedValue([adamDentalSupplier]);
    mockPreviewSupplierCatalogueImport.mockResolvedValue({
      supplierId: adamDentalSupplier.id,
      totalRows: 1,
      matchedRows: 0,
      unmatchedRows: 1,
      errorRows: 0,
      rows: [
        {
          rowNumber: 2,
          supplierSku: null,
          description: "Ozbibs Dental Bibs Blue",
          rawUnitCost: "12.50",
          unitCostCents: 1250,
          unitOfMeasure: null,
          matchedProductId: null,
          matchedProductName: null,
          matchedProductSku: null,
          matchStatus: "unmatched",
          error: null,
        },
      ],
    });

    const { container } = renderCatalogueImportPage();
    await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
    fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));

    const file = new File(
      ["Supplier,Product,Quantity,Unit Price,GST\nAdam Dental,ADA201 - Ozbibs   Dental   Bibs Blue,1 box,12.50,1.25"],
      "embedded-sku.csv",
      { type: "text/csv" },
    );
    fireEvent.change(getFileInput(container), { target: { files: [file] } });
    await screen.findByText("Supplier column detected");
    fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));

    expect(await screen.findByRole("heading", { name: "Structured Supplier Review" })).toBeInTheDocument();
    expect(screen.getByText("ADA201")).toBeInTheDocument();
    expect(screen.getByText("Ozbibs Dental Bibs Blue")).toBeInTheDocument();
    expect(screen.queryByText("ADA201 - Ozbibs Dental Bibs Blue")).not.toBeInTheDocument();
  });

  it("renders structured row actions and actual quantity and GST values", async () => {
    await renderStructuredProductReview();

    expect(screen.getAllByText("Actions").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Skip" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Create Product" }).length).toBeGreaterThan(0);
    expect(screen.getByText("2 boxes")).toBeInTheDocument();
    expect(screen.getByText("5 packs")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("0.80")).toBeInTheDocument();
    expect(screen.queryByText("Not imported")).not.toBeInTheDocument();
  });

  it("allows approving, skipping, and marking structured rows as ready to create", async () => {
    await renderStructuredProductReview();

    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[1] as HTMLElement);
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeEnabled();

    const createProductButton = screen.getAllByRole("button", { name: "Create Product" })[1] as HTMLElement;
    const selectedRow = createProductButton.closest("tr");
    expect(selectedRow).not.toBeNull();
    fireEvent.click(createProductButton);

    const selectedRowQueries = within(selectedRow as HTMLElement);
    expect(selectedRowQueries.getByText("Ready to Create")).toBeInTheDocument();
    expect(selectedRowQueries.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(selectedRowQueries.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(selectedRowQueries.queryByRole("button", { name: "Create Product" })).not.toBeInTheDocument();
    expect(screen.getByText("Creates catalogue product only. Does not change stock.")).toBeInTheDocument();
  });

  it("supports editing structured rows locally without losing the review state", async () => {
    await renderStructuredProductReview();

    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Product name for structured row 2"), {
      target: { value: "Edited Gloves" },
    });
    fireEvent.change(screen.getByLabelText("Quantity for structured row 2"), {
      target: { value: "3 cartons" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getByText("Edited Gloves")).toBeInTheDocument();
    expect(screen.getByText("3 cartons")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeDisabled();
  });

  it("imports reviewed structured rows and clears the persisted session", async () => {
    await renderStructuredProductReview();

    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "Create Product" })[1] as HTMLElement);

    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Import Reviewed Products" }));

    await waitFor(() => {
      expect(mockConfirmReviewedSupplierCatalogueImport).toHaveBeenCalledWith(adamDentalSupplier.id, {
        clinicId: TEST_CLINIC_ID,
        rows: expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 2,
            state: "Approved",
            matchedProductId: "product-gloves",
            unitCostCents: 1250,
          }),
          expect.objectContaining({
            rowNumber: 3,
            state: "Ready to Create",
            matchedProductId: null,
            unitCostCents: 800,
          }),
        ]) as unknown,
      });
    });
    expect(await screen.findByText(/Catalogue import completed/)).toBeInTheDocument();
    expect(mockConfirmSupplierCatalogueImport).not.toHaveBeenCalled();
    expect(mockUploadSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(
      Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
        .some((key) => key?.startsWith("verve.catalogueImport.structuredSession")),
    ).toBe(false);
  });

  it("bulk marks unmatched structured rows as ready to create", async () => {
    await renderStructuredProductReview();

    expect(screen.getByText("Unmatched product")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark all unmatched as Ready to Create" }));

    expect(screen.getByText("Ready to Create")).toBeInTheDocument();
    expect(screen.getByText("Creates catalogue product only. Does not change stock.")).toBeInTheDocument();
  });

  it("restores structured review sessions after navigation and clears them for a new import", async () => {
    const rendered = await renderStructuredProductReview();

    fireEvent.click(screen.getAllByRole("button", { name: "Create Product" })[1] as HTMLElement);
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
      expect(
        Array.from({ length: window.localStorage.length }, (_, index) =>
          window.localStorage.getItem(window.localStorage.key(index) ?? ""),
        ).some((value) => value?.includes("Ready to Create")),
      ).toBe(true);
    });

    rendered.unmount();
    renderCatalogueImportPage();

    expect(await screen.findByText("Restored your in-progress catalogue review.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Structured Supplier Review" })).toBeInTheDocument();
    expect(screen.getByText("Ready to Create")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New Import" }));
    await waitFor(() => {
      expect(
        Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
          .some((key) => key?.startsWith("verve.catalogueImport.structuredSession")),
      ).toBe(false);
    });
    expect(screen.queryByRole("heading", { name: "Structured Supplier Review" })).not.toBeInTheDocument();
  });

  it("routes Review Required imports to the catalogue review workspace", async () => {
    renderCatalogueImportRoutes();

    fireEvent.click(await screen.findByRole("link", { name: /Review invoice-100\.pdf/ }));

    expect(await screen.findByText("Inventory / Catalogue Import / Review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Catalogue Import" })).toHaveAttribute(
      "href",
      "/inventory/catalogue-import",
    );
    expect(mockGetSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id);
  });

  it("renders the review safety banner and inventory quantity changes as 0", async () => {
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(
      await screen.findByText("Catalogue Import does not change stock quantities."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Inventory quantity changes")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders the empty extracted line item state when no lines are available", async () => {
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(
      await screen.findByText("No extracted line items are available for review yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeDisabled();
    expect(
      screen.getByText("Import Reviewed Products becomes available after every row is Approved, Skipped, Matched, or Ready to Create."),
    ).toBeInTheDocument();
  });

  it("imports catalogue knowledge without calling inventory adjustment APIs", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [matchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Nitrile Examination Gloves Box 100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import Reviewed Products" }));

    await waitFor(() => {
      expect(mockConfirmSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id, {
        readyToCreateLineIds: [],
        skippedLineIds: [],
      });
    });
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(await screen.findByText("Catalogue imported. 0 products created and 1 price updates applied.")).toBeInTheDocument();
  });

  it("cancels an import after confirmation and returns to the import page", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [matchedLine] });
    mockListClinicSupplierInvoices
      .mockResolvedValueOnce([invoiceImport])
      .mockResolvedValueOnce([]);

    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Nitrile Examination Gloves Box 100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Import" }));

    expect(screen.getByRole("dialog", { name: "Cancel Import?" })).toBeInTheDocument();
    expect(
      screen.getByText("This will discard the uploaded invoice and all extracted catalogue review data. No products, pricing or inventory changes will be saved."),
    ).toBeInTheDocument();

    const cancelImportButtons = screen.getAllByRole("button", { name: "Cancel Import" });
    fireEvent.click(cancelImportButtons[cancelImportButtons.length - 1] as HTMLElement);

    await waitFor(() => {
      expect(mockCancelSupplierInvoiceImport).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id);
    });
    expect(await screen.findByRole("button", { name: "Upload & Process" })).toBeInTheDocument();
  });

  it("renders line actions and allows approving a line locally", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Actions")).toBeInTheDocument();
    expect(screen.getAllByText("Needs Review").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("replaces invoice line create-product action with undo after selection", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    const createProductButton = screen.getByRole("button", { name: "Create new product" });
    const selectedRow = createProductButton.closest("tr");
    expect(selectedRow).not.toBeNull();
    fireEvent.click(createProductButton);

    const selectedRowQueries = within(selectedRow as HTMLElement);
    expect(selectedRowQueries.getByText("Ready to Create")).toBeInTheDocument();
    expect(selectedRowQueries.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(selectedRowQueries.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(selectedRowQueries.queryByRole("button", { name: "Create new product" })).not.toBeInTheDocument();
  });

  it("restores invoice review decisions after leaving and returning to the review page", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    const rendered = renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    fireEvent.click(screen.getByRole("button", { name: "Create new product" }));
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
      expect(
        Array.from({ length: window.localStorage.length }, (_, index) =>
          window.localStorage.getItem(window.localStorage.key(index) ?? ""),
        ).some((value) => value?.includes("Ready to Create")),
      ).toBe(true);
    });

    rendered.unmount();
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Unknown bonding agent")).toBeInTheDocument();
    expect(screen.getByText("Ready to Create")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create new product" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("enables final import for Ready to Create rows and sends reviewed decisions", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    mockConfirmSupplierInvoice.mockResolvedValue({
      invoice: { ...invoiceImport, status: "imported", confirmedAt: "2026-07-01T03:00:00.000Z" },
      priceUpdates: 1,
      createdProducts: 1,
    } satisfies ConfirmImportResult);
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    const finalButton = screen.getByRole("button", { name: "Import Reviewed Products" });
    expect(finalButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create new product" }));
    expect(finalButton).toBeEnabled();
    fireEvent.click(finalButton);

    await waitFor(() => {
      expect(mockConfirmSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id, {
        readyToCreateLineIds: [unmatchedLine.id],
        skippedLineIds: [],
      });
    });
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(await screen.findByText("Catalogue imported. 1 products created and 1 price updates applied.")).toBeInTheDocument();
  });

  it("preserves decimal currency values when editing invoice import lines", async () => {
    const line = {
      ...unmatchedLine,
      unitPriceCents: 1670,
      taxCents: 167,
      lineTotalCents: 1837,
    };
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [line] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Unit price for line 1")).toHaveValue("16.70");
    expect(screen.getByLabelText("Unit GST for line 1")).toHaveValue("0.84");
    expect(screen.getByText(/Line GST from source:/)).toHaveTextContent("$1.67");
  });

  it.each([
    { quantity: 2, lineGstCents: 477, expectedUnitGst: "2.39" },
    { quantity: 4, lineGstCents: 400, expectedUnitGst: "1.00" },
    { quantity: 1, lineGstCents: 123, expectedUnitGst: "1.23" },
  ])(
    "shows Unit GST $expectedUnitGst when quantity is $quantity and Line GST is $lineGstCents cents",
    async ({ quantity, lineGstCents, expectedUnitGst }) => {
      const line = {
        ...unmatchedLine,
        quantity,
        taxCents: lineGstCents,
        lineTotalCents: quantity * unmatchedLine.unitPriceCents + lineGstCents,
      };
      mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [line] });
      renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

      await screen.findByText("Unknown bonding agent");
      expect(screen.getByText("Line GST from source")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));

      expect(screen.getByLabelText("Unit GST for line 1")).toHaveValue(expectedUnitGst);
      expect(screen.getByText(/Line GST from source:/)).toHaveTextContent(
        new Intl.NumberFormat("en-AU", {
          style: "currency",
          currency: "AUD",
          minimumFractionDigits: 2,
        }).format(lineGstCents / 100),
      );
    },
  );

  it("does not crash or show NaN when Unit GST cannot be normalised", async () => {
    const line = {
      ...unmatchedLine,
      quantity: Number.NaN,
      taxCents: 477,
      lineTotalCents: Number.NaN,
    };
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [line] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    expect(screen.getByText("Unit GST for catalogue: Unable to normalise")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Unit GST for line 1")).toHaveValue("");
    expect(screen.getByText("Unable to normalise Unit GST because quantity is invalid.")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("allows skipping a line locally", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    fireEvent.click(screen.getByRole("button", { name: "Reject / Skip" }));

    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
  });

  it("never renders $NaN and calculates total when safe", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("$27.50")).toBeInTheDocument();
    expect(screen.queryByText("$NaN")).not.toBeInTheDocument();
  });

  it("enables final import after all invoice rows are reviewed", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByRole("button", { name: "Import Reviewed Products" })).toBeEnabled();
    expect(mockConfirmSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(screen.getByText("Inventory quantity changes")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
