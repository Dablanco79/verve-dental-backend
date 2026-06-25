import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierDetailPage } from "../src/pages/SupplierDetailPage.js";
import type { Supplier, SupplierInvoice, SupplierProduct } from "../src/types/supplier.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const SUPPLIER_ID = "sup-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const {
  authTestState,
  mockGetSupplier,
  mockGetSupplierCatalogue,
  mockListClinicSupplierInvoices,
  mockUpdateSupplier,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetSupplier: vi.fn(),
    mockGetSupplierCatalogue: vi.fn(),
    mockListClinicSupplierInvoices: vi.fn(),
    mockUpdateSupplier: vi.fn(),
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
    getSupplier: mockGetSupplier,
    getSupplierCatalogue: mockGetSupplierCatalogue,
    listClinicSupplierInvoices: mockListClinicSupplierInvoices,
    updateSupplier: mockUpdateSupplier,
    listSuppliers: vi.fn(),
    createSupplier: vi.fn(),
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

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

const sampleSupplier: Supplier = {
  id: SUPPLIER_ID,
  supplierName: "DentalCo Australia",
  supplierCode: "DCO",
  contactName: "Jane Smith",
  email: "orders@dentalco.com.au",
  phone: "1800 123 456",
  website: "https://dentalco.com.au",
  abn: null,
  address: null,
  notes: "Preferred supplier for rotary instruments.",
  active: true,
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  ...supplierMetaDefaults,
};

const sampleCatalogue: SupplierProduct[] = [
  {
    id: "cat-1111",
    supplierId: SUPPLIER_ID,
    productId: "prod-1111",
    supplierSku: "DCO-GLV-L",
    supplierDescription: "Nitrile Gloves Large",
    unitCostCents: 1550,
    unitOfMeasure: "box",
    active: true,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  },
];

const sampleInvoices: SupplierInvoice[] = [
  {
    id: "inv-aaaa",
    clinicId: TEST_CLINIC_ID,
    supplierId: SUPPLIER_ID,
    supplierNameRaw: "DentalCo Australia",
    invoiceNumber: "DCO-2026-0042",
    invoiceDate: "2026-06-10",
    dueDate: "2026-07-10",
    status: "confirmed",
    subtotalCents: 25000,
    taxCents: 2500,
    totalCents: 27500,
    currency: "AUD",
    ocrProvider: "claude",
    ocrConfidence: 97,
    originalFilename: "dco-invoice-0042.pdf",
    fileMimeType: "application/pdf",
    importedByUserId: "user-1",
    importedByEmail: "manager@clinic-a.au",
    confirmedByUserId: "user-1",
    confirmedAt: "2026-06-11T00:00:00.000Z",
    voidedByUserId: null,
    voidedAt: null,
    notes: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  },
];

function renderDetailPage(supplierId: string = SUPPLIER_ID) {
  return render(
    <MemoryRouter initialEntries={[`/suppliers/${supplierId}`]}>
      <Routes>
        <Route path="/suppliers/:supplierId" element={<SupplierDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SupplierDetailPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockGetSupplier.mockReset();
    mockGetSupplierCatalogue.mockReset();
    mockListClinicSupplierInvoices.mockReset();
    mockUpdateSupplier.mockReset();

    setAuthenticatedUser(authTestState, createManagerUser());
    mockGetSupplier.mockResolvedValue(sampleSupplier);
    mockGetSupplierCatalogue.mockResolvedValue(sampleCatalogue);
    mockListClinicSupplierInvoices.mockResolvedValue(sampleInvoices);
  });

  // ── Core rendering ───────────────────────────────────────────────────────────

  it("shows loading state then renders supplier name in heading", async () => {
    renderDetailPage();

    expect(screen.getByText("Loading supplier…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "DentalCo Australia" })).toBeInTheDocument();
  });

  it("renders Supplier Overview section with all fields", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByText("Supplier Overview")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("orders@dentalco.com.au")).toBeInTheDocument();
    expect(screen.getByText("1800 123 456")).toBeInTheDocument();
    expect(screen.getByText("https://dentalco.com.au")).toBeInTheDocument();
    expect(screen.getByText("Preferred supplier for rotary instruments.")).toBeInTheDocument();
    expect(screen.getByText("DCO")).toBeInTheDocument();
  });

  it("renders active status badge", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    const activeBadges = screen.getAllByText("Active");
    expect(activeBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Supplier Products section with catalogue items", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(await screen.findByText("Supplier Products")).toBeInTheDocument();
    expect(await screen.findByText("DCO-GLV-L")).toBeInTheDocument();
    expect(screen.getByText("Nitrile Gloves Large")).toBeInTheDocument();
  });

  it("renders Recent Invoices section with invoice data", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(await screen.findByText("Recent Invoices")).toBeInTheDocument();
    expect(await screen.findByText("DCO-2026-0042")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("renders Current Price Records placeholder section", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(await screen.findByText("Current Price Records")).toBeInTheDocument();
    expect(screen.getByText("Price history coming soon")).toBeInTheDocument();
  });

  it("renders Back to Suppliers navigation link", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    const backLink = screen.getByRole("link", { name: /back to suppliers/i });
    expect(backLink).toHaveAttribute("href", "/suppliers");
  });

  it("shows empty state when catalogue has no products", async () => {
    mockGetSupplierCatalogue.mockResolvedValue([]);
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });
    await screen.findByText("Supplier Products");

    await waitFor(() => {
      expect(screen.getByText("No products linked")).toBeInTheDocument();
    });
  });

  it("shows empty state when supplier has no invoices", async () => {
    mockListClinicSupplierInvoices.mockResolvedValue([]);
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });
    await screen.findByText("Recent Invoices");

    await waitFor(() => {
      expect(screen.getByText("No invoices found")).toBeInTheDocument();
    });
  });

  it("shows error state when supplier cannot be loaded", async () => {
    mockGetSupplier.mockRejectedValue(new Error("Supplier not found"));
    renderDetailPage();

    expect(await screen.findByText("Supplier not found")).toBeInTheDocument();
  });

  it("calls getSupplier with the correct supplierId from URL", async () => {
    renderDetailPage(SUPPLIER_ID);

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(mockGetSupplier).toHaveBeenCalledWith(SUPPLIER_ID);
  });

  it("calls getSupplierCatalogue and listClinicSupplierInvoices after supplier loads", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });
    await screen.findByText("DCO-GLV-L");

    expect(mockGetSupplierCatalogue).toHaveBeenCalledWith(SUPPLIER_ID);
    expect(mockListClinicSupplierInvoices).toHaveBeenCalledWith(
      TEST_CLINIC_ID,
      expect.objectContaining({ supplierId: SUPPLIER_ID }),
    );
  });

  it("does not call APIs when user is not authenticated", async () => {
    clearAuthenticatedUser(authTestState);
    renderDetailPage();

    await waitFor(() => {
      expect(screen.queryByText("Loading supplier…")).not.toBeInTheDocument();
    });

    expect(mockGetSupplier).not.toHaveBeenCalled();
  });

  // ── Edit supplier ────────────────────────────────────────────────────────────

  it("shows Edit Supplier button for manager role", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Edit Supplier" })).toBeInTheDocument();
  });

  it("hides Edit Supplier button for clinical_staff", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());

    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.queryByRole("button", { name: "Edit Supplier" })).not.toBeInTheDocument();
  });

  it("opens the edit modal when Edit Supplier is clicked", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Edit Supplier" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Check for the modal heading (h2), not the action button with same label
    expect(screen.getByRole("heading", { name: "Edit Supplier" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("DentalCo Australia")).toBeInTheDocument();
  });

  it("updates the page heading after a successful edit", async () => {
    const user = userEvent.setup();
    const updated: Supplier = { ...sampleSupplier, supplierName: "DentalCo Pty Ltd" };
    mockUpdateSupplier.mockResolvedValue(updated);

    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Edit Supplier" }));

    const nameInput = screen.getByDisplayValue("DentalCo Australia");
    await user.clear(nameInput);
    await user.type(nameInput, "DentalCo Pty Ltd");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateSupplier).toHaveBeenCalledWith(
        SUPPLIER_ID,
        expect.objectContaining({ supplierName: "DentalCo Pty Ltd" }),
      );
    });

    expect(await screen.findByRole("heading", { name: "DentalCo Pty Ltd" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Deactivate / reactivate ──────────────────────────────────────────────────

  it("shows Deactivate Supplier button for active supplier (manager)", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Deactivate Supplier" })).toBeInTheDocument();
  });

  it("shows Reactivate Supplier button for inactive supplier (manager)", async () => {
    mockGetSupplier.mockResolvedValue({ ...sampleSupplier, active: false });

    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.getByRole("button", { name: "Reactivate Supplier" })).toBeInTheDocument();
  });

  it("hides deactivate/reactivate buttons for clinical_staff", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());

    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.queryByRole("button", { name: "Deactivate Supplier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivate Supplier" })).not.toBeInTheDocument();
  });

  it("opens confirmation dialog when Deactivate Supplier is clicked", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Deactivate Supplier" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Check for the modal heading (h2), not the action button with the same label
    expect(screen.getByRole("heading", { name: "Deactivate Supplier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, Deactivate" })).toBeInTheDocument();
  });

  it("calls updateSupplier with active=false and the action button changes to Reactivate on confirm", async () => {
    const user = userEvent.setup();
    const deactivated: Supplier = { ...sampleSupplier, active: false };
    mockUpdateSupplier.mockResolvedValue(deactivated);

    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Deactivate Supplier" }));
    await user.click(screen.getByRole("button", { name: "Yes, Deactivate" }));

    await waitFor(() => {
      expect(mockUpdateSupplier).toHaveBeenCalledWith(SUPPLIER_ID, { active: false });
    });

    // After deactivation, the status toggle button switches to "Reactivate Supplier"
    // confirming that supplier state updated to active=false.
    await screen.findByRole("button", { name: "Reactivate Supplier" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses confirm dialog without API call when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    await user.click(screen.getByRole("button", { name: "Deactivate Supplier" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateSupplier).not.toHaveBeenCalled();
  });

  // ── Delete ───────────────────────────────────────────────────────────────────

  it("never shows a Delete button — hard delete is not supported by the backend", async () => {
    renderDetailPage();

    await screen.findByRole("heading", { name: "DentalCo Australia" });

    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
