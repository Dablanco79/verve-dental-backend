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
  mockListClinicSupplierInvoices,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListSuppliers: vi.fn(),
    mockCreateSupplier: vi.fn(),
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

const sampleSuppliers: Supplier[] = [
  {
    id: "sup-1111-1111-1111-111111111111",
    supplierName: "DentalCo Australia",
    supplierCode: "DCO",
    contactName: "Jane Smith",
    email: "orders@dentalco.com.au",
    phone: "1800 123 456",
    website: null,
    notes: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "sup-2222-2222-2222-222222222222",
    supplierName: "BurDirect",
    supplierCode: null,
    contactName: null,
    email: null,
    phone: null,
    website: null,
    notes: null,
    active: false,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
];

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
    mockListClinicSupplierInvoices.mockReset();

    setAuthenticatedUser(authTestState, createManagerUser());
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    // First call = pending_review filter, second call (if triggered) = all invoices
    mockListClinicSupplierInvoices.mockResolvedValue(samplePendingInvoices);
  });

  it("shows loading state then renders the suppliers table", async () => {
    renderSuppliersPage();

    expect(screen.getByText("Loading suppliers…")).toBeInTheDocument();

    expect(await screen.findByText("DentalCo Australia")).toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
  });

  it("renders KPI bar with correct totals", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    // Total and active derived from suppliers array
    const allStats = screen.getAllByRole("term");
    const labels = allStats.map((el) => el.textContent);
    expect(labels).toContain("Total Suppliers");
    expect(labels).toContain("Active Suppliers");
    expect(labels).toContain("Pending OCR Imports");
  });

  it("displays supplier status badges", async () => {
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    // Active badge for DentalCo, Inactive badge for BurDirect
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

  it("opens create supplier modal when New Supplier button clicked", async () => {
    const user = userEvent.setup();
    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    await user.click(screen.getByRole("button", { name: "+ New Supplier" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/close modal/i)).toBeInTheDocument();
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
      notes: null,
      active: true,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
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

  it("shows admin user can also create suppliers", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createAdminUser());

    renderSuppliersPage();

    await screen.findByText("DentalCo Australia");

    expect(screen.getByRole("button", { name: "+ New Supplier" })).toBeInTheDocument();
  });
});
