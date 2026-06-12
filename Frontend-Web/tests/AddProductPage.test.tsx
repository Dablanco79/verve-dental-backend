import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/auth/AuthContext.js";
import { AddProductPage } from "../src/pages/AddProductPage.js";

const { mockGetMe, mockCreateProduct } = vi.hoisted(() => ({
  mockGetMe: vi.fn(),
  mockCreateProduct: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: mockGetMe,
    listInventory: vi.fn(),
    handleScan: vi.fn(),
    createProduct: mockCreateProduct,
  }),
}));

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: vi.fn(() => "test-access-token"),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

const managerUser = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  email: "manager@clinic-a.au",
  role: "group_practice_manager" as const,
  clinicId: "11111111-1111-4111-8111-111111111111",
  clinicName: "Verve Dental Clinic A",
};

describe("AddProductPage", () => {
  it("renders the add product form for managers", async () => {
    mockGetMe.mockResolvedValue(managerUser);

    render(
      <AuthProvider>
        <MemoryRouter>
          <AddProductPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Add new product" })).toBeInTheDocument();
    expect(screen.getByLabelText("SKU")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create product" })).toBeInTheDocument();
  });

  it("submits a new product to the API", async () => {
    mockGetMe.mockResolvedValue(managerUser);
    mockCreateProduct.mockResolvedValue({
      masterItem: { sku: "VRV-ANE-001" },
      barcodeMapping: { barcodeValue: "9301234567899" },
      clinicItem: { masterSku: "VRV-ANE-001" },
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <AddProductPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await screen.findByRole("heading", { name: "Add new product" });

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
        managerUser.clinicId,
        expect.objectContaining({
          sku: "VRV-ANE-001",
          defaultUnitCostCents: 8999,
          barcodeValue: "9301234567899",
        }),
      );
    });
  });
});
