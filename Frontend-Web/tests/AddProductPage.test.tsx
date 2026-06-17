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

const { authTestState, mockCreateProduct } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return { authTestState, mockCreateProduct: vi.fn() };
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
    handleScan: vi.fn(),
    createProduct: mockCreateProduct,
  }),
}));

const managerUser = createManagerUser();

describe("AddProductPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockCreateProduct.mockReset();
    setAuthenticatedUser(authTestState, managerUser);
  });

  it("renders the add product form for managers", () => {
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
    expect(screen.getByLabelText("SKU")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create product" })).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "   " } });
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

    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "VRV-TST-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test Product" } });
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

    expect(screen.getByText(new RegExp(managerUser.homeClinicName))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "VRV-ANE-001" } });
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Dental Anaesthetic Cartridges" },
    });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Pharmacy" } });
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
          defaultUnitCostCents: 8999,
          barcodeValue: "9301234567899",
        }),
      );
    });
  });
});
