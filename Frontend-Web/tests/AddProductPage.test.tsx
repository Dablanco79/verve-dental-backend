import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddProductPage } from "../src/pages/AddProductPage.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const { authTestState, mockCreateProduct, mockListSuppliers } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return { authTestState, mockCreateProduct: vi.fn(), mockListSuppliers: vi.fn() };
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
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
    listInventory: vi.fn(),
    listSuppliers: mockListSuppliers,
    handleScan: vi.fn(),
    createProduct: mockCreateProduct,
  }),
}));

const managerUser = createManagerUser();
const activeSupplier = {
  id: "supplier-1",
  supplierName: "DentalCo AU",
  active: true,
};

describe("AddProductPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockCreateProduct.mockReset();
    mockListSuppliers.mockReset();
    mockListSuppliers.mockResolvedValue([activeSupplier]);
    setAuthenticatedUser(authTestState, managerUser);
  });

  it("renders the add product form for managers", async () => {
    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Add new product" })).toBeInTheDocument();
    expect(
      screen.getByText(
        `Create a master catalog item, barcode mapping, and clinic stock row for ${managerUser.homeClinicName}.`,
      ),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("SKU")).toBeInTheDocument();
    expect(screen.getByLabelText("Supplier")).toBeInTheDocument();
    expect(screen.getByLabelText("Stock Unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Receiving Unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Units Per Receiving Unit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create product" })).toBeInTheDocument();
    expect(mockListSuppliers).toHaveBeenCalledWith({ active: true });
  });

  it("renders an access denied panel for clinical staff", () => {
    // Override the manager set in beforeEach with a staff-level user.
    setAuthenticatedUser(authTestState, createStaffUser());

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    // The product creation form must not be reachable.
    expect(screen.queryByRole("button", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("shows a field error when product name is whitespace-only", async () => {
    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: activeSupplier.id } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "PPE" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567899" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => {
      expect(screen.getByText("Product name is required.")).toBeInTheDocument();
    });
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("shows a field error when unit cost has more than two decimal places", async () => {
    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test Product" } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: activeSupplier.id } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "PPE" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "89.999" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567899" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => {
      expect(
        screen.getByText("Unit cost can only have up to two decimal places."),
      ).toBeInTheDocument();
    });
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("submits a new product to the API", async () => {
    mockCreateProduct.mockResolvedValue({
      masterItem: { sku: "VRV-ANE-001" },
      barcodeMapping: { barcodeValue: "9301234567899" },
      clinicItem: { masterSku: "VRV-ANE-001" },
    });

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(new RegExp(managerUser.homeClinicName))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "VRV-ANE-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Dental Anaesthetic Cartridges" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: activeSupplier.id } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Pharmacy" } });
    fireEvent.change(screen.getByLabelText("Stock Unit"), { target: { value: "Box" } });
    fireEvent.change(screen.getByLabelText("Receiving Unit"), { target: { value: "Carton" } });
    fireEvent.change(screen.getByLabelText("Units Per Receiving Unit"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "89.99" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567899" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({
          sku: "VRV-ANE-001",
          name: "Dental Anaesthetic Cartridges",
          category: "Pharmacy",
          stockUnit: "Box",
          receivingUnit: "Carton",
          unitsPerReceivingUnit: 10,
          defaultUnitCostCents: 8999,
          barcodeValue: "9301234567899",
          supplierId: activeSupplier.id,
        }),
      );
    });
  });

  it("blocks product creation when no suppliers exist", async () => {
    mockListSuppliers.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No suppliers have been created yet.")).toBeInTheDocument();
    expect(screen.getByText("Please create a supplier before adding products.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("requires selecting an existing supplier", async () => {
    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test Product" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "PPE" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567899" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findByText("Supplier is required.")).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("validates units per receiving unit", async () => {
    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("SKU"), { target: { value: "VRV-TST-002" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test Product" } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: activeSupplier.id } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "PPE" } });
    fireEvent.change(screen.getByLabelText("Units Per Receiving Unit"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567800" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    expect(
      await screen.findByText("Units per receiving unit must be a positive whole number."),
    ).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("maps duplicate barcode and SKU API errors inline", async () => {
    mockCreateProduct.mockRejectedValueOnce(new Error("A product with this SKU already exists"));

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test Product" } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: activeSupplier.id } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "PPE" } });
    fireEvent.change(screen.getByLabelText("Default unit cost (AUD)"), { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Barcode value"), { target: { value: "9301234567899" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findAllByText("A product with this SKU already exists")).not.toHaveLength(0);

    mockCreateProduct.mockRejectedValueOnce(new Error("This barcode is already assigned to a product"));
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findAllByText("This barcode is already assigned to a product")).not.toHaveLength(0);
  });
});
