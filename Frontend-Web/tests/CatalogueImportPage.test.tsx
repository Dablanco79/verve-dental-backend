import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  mockUploadSupplierInvoice,
  mockGetSupplierInvoice,
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
    mockUploadSupplierInvoice: vi.fn(),
    mockGetSupplierInvoice: vi.fn(),
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
    uploadSupplierInvoice: mockUploadSupplierInvoice,
    getSupplierInvoice: mockGetSupplierInvoice,
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

describe("CatalogueImportPage", () => {
  beforeEach(() => {
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
    mockUploadSupplierInvoice.mockReset();
    mockGetSupplierInvoice.mockReset();
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
  });

  it("renders import sources, disabled future cards, and previous imports", async () => {
    renderCatalogueImportPage();

    expect(await screen.findByRole("heading", { name: "Catalogue Import" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Supplier Invoice \(PDF\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Supplier Catalogue \(PDF\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Excel \(\.xlsx\)/ })).toBeInTheDocument();
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
  });

  it("imports structured catalogue files without adjusting inventory", async () => {
    const { container } = renderCatalogueImportPage();

    await screen.findByRole("link", { name: /Review invoice-100\.pdf/ });
    fireEvent.click(screen.getByRole("radio", { name: /^CSV/ }));
    expect(await screen.findByLabelText("Supplier *")).toBeInTheDocument();

    const file = new File(["description,unit_cost\nGloves,12.50"], "catalogue.csv", {
      type: "text/csv",
    });
    fireEvent.change(getFileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload & Process" }));

    await waitFor(() => {
      expect(mockPreviewSupplierCatalogueImport).toHaveBeenCalledWith(supplier.id, file);
      expect(mockConfirmSupplierCatalogueImport).toHaveBeenCalledWith(supplier.id, file);
    });
    expect(mockUploadSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 imported, 0 updated/)).toBeInTheDocument();
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
    expect(screen.getByText("Inventory quantity changes")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders the empty extracted line item state when no lines are available", async () => {
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(
      await screen.findByText("No extracted line items are available for review yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Catalogue" })).toBeDisabled();
    expect(
      screen.getByText("Import confirmation will be available after matching rules are completed."),
    ).toBeInTheDocument();
  });

  it("imports catalogue knowledge without calling inventory adjustment APIs", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [matchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Nitrile Examination Gloves Box 100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import Catalogue" }));

    await waitFor(() => {
      expect(mockConfirmSupplierInvoice).toHaveBeenCalledWith(TEST_CLINIC_ID, invoiceImport.id);
    });
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(await screen.findByText("Catalogue imported. 1 price updates applied.")).toBeInTheDocument();
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
    expect(await screen.findByText("Import cancelled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload & Process" })).toBeInTheDocument();
  });

  it("renders line actions and allows approving a line locally", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    expect(await screen.findByText("Actions")).toBeInTheDocument();
    expect(screen.getAllByText("Review Required").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
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

  it("keeps Import Catalogue guarded for unpersisted line decisions", async () => {
    mockGetSupplierInvoice.mockResolvedValue({ invoice: invoiceImport, lines: [unmatchedLine] });
    renderCatalogueImportRoutes("/inventory/catalogue-import/invoice-1/review");

    await screen.findByText("Unknown bonding agent");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByRole("button", { name: "Import Catalogue" })).toBeDisabled();
    expect(mockConfirmSupplierInvoice).not.toHaveBeenCalled();
    expect(mockAdjustInventory).not.toHaveBeenCalled();
    expect(mockHandleScan).not.toHaveBeenCalled();
    expect(screen.getByText("Inventory quantity changes")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
