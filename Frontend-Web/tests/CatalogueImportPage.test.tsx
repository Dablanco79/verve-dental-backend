import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogueImportPage } from "../src/pages/CatalogueImportPage.js";
import type { Supplier, SupplierInvoice } from "../src/types/supplier.js";
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
  mockAdjustInventory,
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
    mockAdjustInventory: vi.fn(),
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
    adjustInventory: mockAdjustInventory,
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

function renderCatalogueImportPage() {
  return render(
    <MemoryRouter initialEntries={["/inventory/catalogue-import"]}>
      <CatalogueImportPage />
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
    mockAdjustInventory.mockReset();
    mockListSuppliers.mockResolvedValue([supplier]);
    mockListClinicSupplierInvoices.mockResolvedValue([invoiceImport]);
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

    expect(await screen.findByText("invoice-100.pdf")).toBeInTheDocument();
    expect(screen.getByText("DentalCo AU")).toBeInTheDocument();
    expect(screen.getByText("Review Required")).toBeInTheDocument();
  });

  it("imports structured catalogue files without adjusting inventory", async () => {
    const { container } = renderCatalogueImportPage();

    await screen.findByText("invoice-100.pdf");
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
});
