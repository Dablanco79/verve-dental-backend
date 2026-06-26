import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryPage } from "../src/pages/InventoryPage.js";
import type {
  InventoryAdjustment,
  InventoryItem,
  PurchaseOrderLine,
} from "../src/types/inventory.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockListInventory,
  mockListAdjustments,
  mockListPurchaseOrders,
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
    mockListInventory: vi.fn(),
    mockListAdjustments: vi.fn(),
    mockListPurchaseOrders: vi.fn(),
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
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
    listInventory: mockListInventory,
    listAdjustments: mockListAdjustments,
    listPurchaseOrders: mockListPurchaseOrders,
    handleScan: mockHandleScan,
    createProduct: vi.fn(),
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
const rotaryInventoryItem = sampleInventory[1] as InventoryItem;

const authUser = createStaffUser();
const managerUser = createManagerUser();

const receiveAdjustment: InventoryAdjustment = {
  id: "adj-receive-1",
  clinicId: TEST_CLINIC_ID,
  clinicInventoryItemId: rotaryInventoryItem.id,
  masterCatalogItemId: rotaryInventoryItem.masterCatalogItemId,
  adjustmentType: "receive",
  quantityDelta: 5,
  quantityBefore: 7,
  quantityAfter: 12,
  reason: "PO-123",
  performedByUserId: "manager-1",
  performedByEmail: "manager@clinic.test",
  referenceId: "9301234567891",
  createdAt: new Date().toISOString(),
};

const submittedPoLine: PurchaseOrderLine = {
  id: "po-line-1",
  draftPurchaseOrderId: "po-123",
  masterCatalogItemId: rotaryInventoryItem.masterCatalogItemId,
  masterSku: "VRV-BUR-001",
  itemName: "Diamond Burs FG Round #2 (Pack 5)",
  clinicInventoryItemId: rotaryInventoryItem.id,
  quantity: 4,
  reason: "below_reorder_point",
  orderStatus: "submitted",
  createdAt: "2026-06-25T00:00:00.000Z",
};

function renderInventoryPage(initialPath = "/inventory") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <InventoryPage />
    </MemoryRouter>,
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListInventory.mockReset();
    mockListAdjustments.mockReset();
    mockListPurchaseOrders.mockReset();
    mockHandleScan.mockReset();
    setAuthenticatedUser(authTestState, authUser);
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockListInventory.mockResolvedValue(sampleInventory);
    mockListAdjustments.mockResolvedValue({ items: [receiveAdjustment], total: 1, limit: 25, offset: 0 });
    mockListPurchaseOrders.mockResolvedValue([submittedPoLine]);
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
      screen.getByText(`${authUser.homeClinicName} — scan to deduct stock`),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock on hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deduct" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(await screen.findByText("VRV-GLV-001")).toBeInTheDocument();
    expect(screen.getByText("1 below reorder point")).toBeInTheDocument();
    expect(screen.getAllByText("Low stock")).toHaveLength(1);

    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
  });

  it("submits a barcode scan and shows a success notice", async () => {
    mockHandleScan.mockResolvedValue({
      mode: "deduct",
      item: {
        ...rotaryInventoryItem,
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
      await screen.findByText(`${authUser.homeClinicName} — scan to deduct stock`),
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

  it("allows a manager to receive stock from a direct receiving link", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockHandleScan.mockResolvedValue({
      mode: "receive",
      item: {
        ...rotaryInventoryItem,
        quantityOnHand: 16,
      },
      adjustment: {
        ...receiveAdjustment,
        id: "adj-receive-2",
        quantityAfter: 16,
      },
      barcode: {
        detectedFormat: "ean13",
        lookupKey: "9301234567891",
        mapping: {
          id: "barcode-1",
          masterCatalogItemId: rotaryInventoryItem.masterCatalogItemId,
          barcodeValue: "9301234567891",
          barcodeFormat: "ean13",
          isPrimary: true,
        },
      },
      draftPoLineAdded: false,
      draftPoLine: null,
    });

    renderInventoryPage("/inventory?mode=receive&reference=po-123");

    expect(await screen.findByRole("heading", { name: "Receiving workflow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("po-123")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));

    await waitFor(() => {
      expect(mockHandleScan).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({
          barcodeValue: "9301234567891",
          quantity: 1,
          mode: "receive",
          reason: "po-123",
        }),
      );
    });

    expect(
      await screen.findByText(/Received VRV-BUR-001 — now 16 pack on hand/i),
    ).toBeInTheDocument();
  });

  it("does not expose the receiving workflow to clinical staff", async () => {
    renderInventoryPage("/inventory?mode=receive");

    await screen.findByText(`${authUser.homeClinicName} — scan to deduct stock`);

    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Receiving workflow" })).not.toBeInTheDocument();
  });

  it("blocks receiving while owner admin scope is All Clinics", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };

    renderInventoryPage("/inventory?mode=receive");

    expect(
      await screen.findByText("Inventory actions require a specific clinic"),
    ).toBeInTheDocument();
    expect(screen.getByText("Select a clinic to receive stock")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();
    expect(mockListInventory).not.toHaveBeenCalled();
  });
});
