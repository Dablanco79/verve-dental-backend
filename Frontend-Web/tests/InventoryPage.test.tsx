import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryPage } from "../src/pages/InventoryPage.js";
import type { InventoryItem } from "../src/types/inventory.js";
import { createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const { authTestState, mockListInventory, mockHandleScan } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return { authTestState, mockListInventory: vi.fn(), mockHandleScan: vi.fn() };
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
    listInventory: mockListInventory,
    handleScan: mockHandleScan,
    createProduct: vi.fn(),
  }),
}));

const sampleInventory: InventoryItem[] = [
  {
    id: "e1111111-1111-4111-8111-111111111111",
    clinicId: TEST_CLINIC_ID,
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
    clinicId: TEST_CLINIC_ID,
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

const authUser = createStaffUser();

function renderInventoryPage() {
  return render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListInventory.mockReset();
    mockHandleScan.mockReset();
    setAuthenticatedUser(authTestState, authUser);
    mockListInventory.mockResolvedValue(sampleInventory);
  });

  it("clears the loading state immediately when no user is authenticated", async () => {
    // Override the beforeEach user setup — simulate an unauthenticated render.
    clearAuthenticatedUser(authTestState);

    renderInventoryPage();

    // The loading spinner must disappear once loadInventory detects !user.
    // Without the fix, isLoading would remain true indefinitely.
    await waitFor(() => {
      expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument();
    });

    // The API must never be called when there is no authenticated user.
    expect(mockListInventory).not.toHaveBeenCalled();
  });

  it("renders stock table and manual scan form when inventory loads", async () => {
    renderInventoryPage();

    expect(await screen.findByRole("heading", { name: "Scanner" })).toBeInTheDocument();
    expect(
      screen.getByText(`${authUser.homeClinicName} — scan to deduct or receive stock`),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock on hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deduct" })).toBeInTheDocument();
    expect(await screen.findByText("VRV-GLV-001")).toBeInTheDocument();
    expect(screen.getByText("1 below reorder point")).toBeInTheDocument();
    expect(screen.getAllByText("Low stock")).toHaveLength(1);

    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
  });

  it("submits a barcode scan and shows a success notice", async () => {
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

    expect(
      await screen.findByText(`${authUser.homeClinicName} — scan to deduct or receive stock`),
    ).toBeInTheDocument();
    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deduct" }));

    await waitFor(() => {
      expect(mockHandleScan).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
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
