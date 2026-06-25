import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuppliersPage } from "../src/pages/SuppliersPage.js";
import type { Supplier, SupplierInvoice } from "../src/types/supplier.js";
import { createAdminUser, createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const {
  authTestState,
  mockListSuppliers,
  mockCreateSupplier,
  mockUpdateSupplier,
  mockListClinicSupplierInvoices,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListSuppliers: vi.fn(),
    mockCreateSupplier: vi.fn(),
    mockUpdateSupplier: vi.fn(),
    mockListClinicSupplierInvoices: vi.fn(),
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
    createSupplier: mockCreateSupplier,
    updateSupplier: mockUpdateSupplier,
    listClinicSupplierInvoices: mockListClinicSupplierInvoices,
    getSupplierCatalogue: vi.fn(),
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

const dentalCo: Supplier = {
  id: "sup-1111-1111-1111-111111111111",
  supplierName: "DentalCo Australia",
  supplierCode: "DCO",
  contactName: "Jane Smith",
  email: "orders@dentalco.com.au",
  phone: "1800 123 456",
  website: null,
  abn: null,
  address: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...supplierMetaDefaults,
};

const burDirect: Supplier = {
  id: "sup-2222-2222-2222-222222222222",
  supplierName: "BurDirect",
  supplierCode: null,
  contactName: null,
  email: null,
  phone: null,
  website: null,
  abn: null,
  address: null,
  notes: null,
  active: false,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...supplierMetaDefaults,
};

const sampleSuppliers: Supplier[] = [dentalCo, burDirect];

const samplePendingInvoices: SupplierInvoice[] = [
  {
    id: "inv-1111-1111-1111-111111111111",
    clinicId: TEST_CLINIC_ID,
    supplierId: "sup-1111-1111-1111-111111111111",
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
];

function renderSuppliersPage() {
  return render(
    <MemoryRouter>
      <SuppliersPage />
    </MemoryRouter>,
  );
}

describe("SuppliersPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListSuppliers.mockReset();
    mockCreateSupplier.mockReset();
    mockUpdateSupplier.mockReset();
    mockListClinicSupplierInvoices.mockReset();

    setAuthenticatedUser(authTestState, createManagerUser());
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    mockListClinicSupplierInvoices.mockResolvedValue(samplePendingInvoices);
  });

  // ── List rendering ───────────────────────────────────────────────────────────

  it("shows loading state then renders the suppliers table", async () => {
    renderSuppliersPage();

    expect(screen.getByText("Loading suppliers…")).toBeInTheDocument();

    expect(await screen.findByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
  });

  it("renders KPI bar with correct totals", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const allStats = screen.getAllByRole("term");
    const labels = allStats.map((el) => el.textContent);
    expect(labels).toContain("Total Suppliers");
    expect(labels).toContain("Active Suppliers");
    expect(labels).toContain("Pending OCR Imports");
  });

  it("displays supplier status badges", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const activeBadges = screen.getAllByText("Active");
    const inactiveBadges = screen.getAllByText("Inactive");
    expect(activeBadges.length).toBeGreaterThanOrEqual(1);
    expect(inactiveBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("filters suppliers by search term", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const searchInput = screen.getByPlaceholderText("Supplier name, contact or email…");
    await user.type(searchInput, "Bur");

    expect(screen.getByText("BurDirect")).toBeInTheDocument();
    expect(screen.queryByText("DentalCo Australia")).not.toBeInTheDocument();
  });

  it("filters suppliers by active status", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const statusSelect = screen.getByDisplayValue("All");
    await user.selectOptions(statusSelect, "active");

    expect(screen.getByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.queryByText("BurDirect")).not.toBeInTheDocument();
  });

  it("shows empty state when no suppliers match search", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const searchInput = screen.getByPlaceholderText("Supplier name, contact or email…");
    await user.type(searchInput, "XYZ NonExistent");

    expect(screen.getByText("No suppliers found")).toBeInTheDocument();
  });

  it("shows error message when API call fails", async () => {
    mockListSuppliers.mockRejectedValue(new Error("Network error"));
    renderSuppliersPage();

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("does not call API when user is not authenticated", async () => {
    clearAuthenticatedUser(authTestState);
    renderSuppliersPage();

    await waitFor(() => {
      expect(screen.queryByText("Loading suppliers…")).not.toBeInTheDocument();
    });

    expect(mockListSuppliers).not.toHaveBeenCalled();
  });

  it("shows View link for each supplier that navigates to detail page", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const viewLinks = screen.getAllByRole("link", { name: "View" });
    expect(viewLinks).toHaveLength(2);
    expect(viewLinks[0]).toHaveAttribute("href", `/suppliers/sup-1111-1111-1111-111111111111`);
  });

  // ── Create supplier ──────────────────────────────────────────────────────────

  it("shows New Supplier button for manager role", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.getByRole("button", { name: "+ New Supplier" })).toBeInTheDocument();
  });

  it("hides New Supplier button for clinical_staff role", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.queryByRole("button", { name: "+ New Supplier" })).not.toBeInTheDocument();
  });

  it("creates a new supplier and adds it to the list", async () => {
    const user = userEvent.setup();
    const newSupplier: Supplier = {
      id: "sup-new",
      supplierName: "New Supplier Co",
      supplierCode: null,
      contactName: null,
      email: null,
      phone: null,
      website: null,
      abn: null,
      address: null,
      notes: null,
      active: true,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      ...supplierMetaDefaults,
    };
    mockCreateSupplier.mockResolvedValue(newSupplier);

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    await user.click(screen.getByRole("button", { name: "+ New Supplier" }));

    const nameInput = screen.getByPlaceholderText("e.g. DentalCo Australia");
    await user.type(nameInput, "New Supplier Co");

    await user.click(screen.getByRole("button", { name: "Create Supplier" }));

    await waitFor(() => {
      expect(mockCreateSupplier).toHaveBeenCalledWith(
        expect.objectContaining({ supplierName: "New Supplier Co" }),
      );
    });

    expect(await screen.findByText("New Supplier Co")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows admin user can also create suppliers", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createAdminUser());

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.getByRole("button", { name: "+ New Supplier" })).toBeInTheDocument();
  });

  // ── Edit supplier ────────────────────────────────────────────────────────────

  it("shows Edit button for manager/admin but not for clinical_staff", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const editBtns = screen.getAllByRole("button", { name: "Edit" });
    expect(editBtns.length).toBeGreaterThanOrEqual(1);

    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());
  });

  it("hides Edit buttons for clinical_staff", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("opens the Edit modal when Edit button is clicked", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const [firstEditBtn] = screen.getAllByRole("button", { name: "Edit" });
    if (!firstEditBtn) throw new Error("Expected at least one Edit button");
    await user.click(firstEditBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/close modal/i)).toBeInTheDocument();
    expect(screen.getByText("Edit Supplier")).toBeInTheDocument();
  });

  it("pre-populates the edit form with the supplier's current values", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const [firstEditBtn] = screen.getAllByRole("button", { name: "Edit" });
    if (!firstEditBtn) throw new Error("Expected at least one Edit button");
    await user.click(firstEditBtn);

    const nameInput = screen.getByDisplayValue("DentalCo Australia");
    expect(nameInput).toBeInTheDocument();
    expect(screen.getByDisplayValue("DCO")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jane Smith")).toBeInTheDocument();
  });

  it("submits updated supplier values and updates the list", async () => {
    const user = userEvent.setup();
    const updatedSupplier: Supplier = {
      ...dentalCo,
      supplierName: "DentalCo Pty Ltd",
      contactName: "Bob Jones",
    };
    mockUpdateSupplier.mockResolvedValue(updatedSupplier);

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const [firstEditBtn] = screen.getAllByRole("button", { name: "Edit" });
    if (!firstEditBtn) throw new Error("Expected at least one Edit button");
    await user.click(firstEditBtn);

    const nameInput = screen.getByDisplayValue("DentalCo Australia");
    await user.clear(nameInput);
    await user.type(nameInput, "DentalCo Pty Ltd");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateSupplier).toHaveBeenCalledWith(
        "sup-1111-1111-1111-111111111111",
        expect.objectContaining({ supplierName: "DentalCo Pty Ltd" }),
      );
    });

    expect(await screen.findByText("DentalCo Pty Ltd")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows validation error if supplier name is cleared in edit form", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    const [firstEditBtn] = screen.getAllByRole("button", { name: "Edit" });
    if (!firstEditBtn) throw new Error("Expected at least one Edit button");
    await user.click(firstEditBtn);

    const nameInput = screen.getByDisplayValue("DentalCo Australia");
    await user.clear(nameInput);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Supplier name is required.")).toBeInTheDocument();
    expect(mockUpdateSupplier).not.toHaveBeenCalled();
  });

  // ── Deactivate / reactivate ──────────────────────────────────────────────────

  it("shows Deactivate button for active suppliers (manager)", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows Reactivate button for inactive suppliers (manager)", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("hides Deactivate/Reactivate buttons for clinical_staff", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivate" })).not.toBeInTheDocument();
  });

  it("opens a confirmation dialog when Deactivate is clicked", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Deactivate Supplier")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, Deactivate" })).toBeInTheDocument();
  });

  it("calls updateSupplier with active=false and updates the list on confirm", async () => {
    const user = userEvent.setup();
    const deactivated: Supplier = { ...dentalCo, active: false };
    mockUpdateSupplier.mockResolvedValue(deactivated);

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    await user.click(screen.getByRole("button", { name: "Yes, Deactivate" }));

    await waitFor(() => {
      expect(mockUpdateSupplier).toHaveBeenCalledWith(
        "sup-1111-1111-1111-111111111111",
        { active: false },
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls updateSupplier with active=true on reactivate confirm", async () => {
    const user = userEvent.setup();
    const reactivated: Supplier = { ...burDirect, active: true };
    mockUpdateSupplier.mockResolvedValue(reactivated);

    renderSuppliersPage();

    await screen.findByText("BurDirect");

    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    await user.click(screen.getByRole("button", { name: "Yes, Reactivate" }));

    await waitFor(() => {
      expect(mockUpdateSupplier).toHaveBeenCalledWith(
        "sup-2222-2222-2222-222222222222",
        { active: true },
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses confirmation dialog without calling API when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateSupplier).not.toHaveBeenCalled();
  });

  // ── Delete ───────────────────────────────────────────────────────────────────

  it("never shows a Delete button — hard delete is not supported by the backend", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
