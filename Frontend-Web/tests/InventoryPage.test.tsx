import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/auth/AuthContext.js";
import { InventoryPage } from "../src/pages/InventoryPage.js";

const { mockListInventory, mockHandleScan, mockGetMe } = vi.hoisted(() => ({
  mockListInventory: vi.fn(),
  mockHandleScan: vi.fn(),
  mockGetMe: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: mockGetMe,
    listInventory: mockListInventory,
    handleScan: mockHandleScan,
  }),
}));

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: vi.fn(() => "test-access-token"),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

const sampleInventory = [
  {
    id: "e1111111-1111-4111-8111-111111111111",
    clinicId: "11111111-1111-4111-8111-111111111111",
    masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
    masterSku: "VRV-GLV-001",
    name: "Nitrile Examination Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    quantityOnHand: 3,
    reorderPoint: 5,
    unitCostCents: 1799,
    unitCostOverrideCents: 1799,
    supplierPreference: "DentalCo AU",
    isBelowReorderPoint: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "e1111111-1111-4111-8111-111111111112",
    clinicId: "11111111-1111-4111-8111-111111111111",
    masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
    masterSku: "VRV-BUR-001",
    name: "Diamond Burs FG Round #2 (Pack 5)",
    category: "Rotary",
    unitOfMeasure: "pack",
    quantityOnHand: 12,
    reorderPoint: 4,
    unitCostCents: 4599,
    unitCostOverrideCents: null,
    supplierPreference: "BurDirect",
    isBelowReorderPoint: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

function renderInventoryPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const authUser = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "staff@clinic-a.au",
  role: "clinical_staff" as const,
  clinicId: "11111111-1111-4111-8111-111111111111",
  clinicName: "Verve Dental Clinic A",
};

describe("InventoryPage", () => {
  it("renders stock table and manual scan form when inventory loads", async () => {
    mockGetMe.mockResolvedValue(authUser);
    mockListInventory.mockResolvedValue(sampleInventory);

    renderInventoryPage();

    expect(await screen.findByRole("heading", { name: "Scanner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock on hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deduct" })).toBeInTheDocument();
    expect(await screen.findByText("VRV-GLV-001")).toBeInTheDocument();
    expect(screen.getByText("1 below reorder point")).toBeInTheDocument();
    expect(screen.getAllByText("Low stock")).toHaveLength(1);
  });

  it("submits a barcode scan and shows a success notice", async () => {
    mockGetMe.mockResolvedValue(authUser);
    mockListInventory.mockResolvedValue(sampleInventory);
    mockHandleScan.mockResolvedValue({
      mode: "deduct",
      item: {
        ...sampleInventory[1],
        quantityOnHand: 11,
      },
      adjustment: {
        id: "adj-1",
        adjustmentType: "scan_deduct",
        quantityDelta: -1,
      },
      barcode: {
        detectedFormat: "ean13",
        lookupKey: "9301234567891",
        mapping: {
          id: "barcode-1",
          barcodeFormat: "ean13",
          barcodeValue: "9301234567891",
        },
      },
      draftPoLineAdded: false,
      draftPoLine: null,
    });

    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deduct" }));

    await waitFor(() => {
      expect(mockHandleScan).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        expect.objectContaining({
          barcodeValue: "9301234567891",
          quantity: 1,
          mode: "deduct",
        }),
      );
    });

    expect(
      await screen.findByText(/Deducted VRV-BUR-001 — 11 pack on hand/i),
    ).toBeInTheDocument();
  });
});
