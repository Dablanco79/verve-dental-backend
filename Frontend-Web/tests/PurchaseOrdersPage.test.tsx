import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseOrdersPage } from "../src/pages/PurchaseOrdersPage.js";
import type { PurchaseOrderLine } from "../src/types/inventory.js";
import {
  createManagerUser,
  createStaffUser,
} from "./helpers/auth.js";
import { setAuthenticatedUser, type AuthTestState } from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockListPurchaseOrders,
  mockListSuppliers,
  mockCreatePurchaseOrder,
  mockCancelPurchaseOrder,
  mockSubmitPurchaseOrder,
  mockExportCsv,
} =
  vi.hoisted(() => {
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
      mockListPurchaseOrders: vi.fn(),
      mockListSuppliers: vi.fn(),
      mockCreatePurchaseOrder: vi.fn(),
      mockCancelPurchaseOrder: vi.fn(),
      mockSubmitPurchaseOrder: vi.fn(),
      mockExportCsv: vi.fn(),
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

vi.mock("../src/clinic/useSelectedClinic.js", () => ({
  useSelectedClinic: () => ({
    selectedClinic: selectedClinicState.selectedClinic,
    selectedDashboardScope: {
      ...selectedClinicState.selectedDashboardScope,
    },
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

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listPurchaseOrders: mockListPurchaseOrders,
    listSuppliers: mockListSuppliers,
    createPurchaseOrder: mockCreatePurchaseOrder,
    cancelPurchaseOrder: mockCancelPurchaseOrder,
    submitPurchaseOrder: mockSubmitPurchaseOrder,
    exportPurchaseOrdersCsv: mockExportCsv,
  }),
}));

const submittedLine: PurchaseOrderLine = {
  id: "po-line-submitted",
  draftPurchaseOrderId: "po-123",
  masterCatalogItemId: "master-1",
  masterSku: "VRV-BUR-001",
  itemName: "Diamond Burs FG Round #2 (Pack 5)",
  clinicInventoryItemId: "inventory-1",
  quantity: 4,
  receivedQuantity: 0,
  outstandingQuantity: 4,
  reason: "below_reorder_point",
  orderStatus: "submitted",
  createdAt: "2026-06-25T00:00:00.000Z",
  supplierPricing: [
    {
      supplierProductId: "supplier-product-1",
      supplierId: "supplier-1",
      supplierName: "BurDirect",
      supplierCode: "BUR",
      unitCostCents: 4599,
      supplierSku: "BUR-FG-2",
    },
  ],
  estimatedUnitCostCents: 4599,
  estimatedLineCostCents: 18396,
};

const draftLine: PurchaseOrderLine = {
  ...submittedLine,
  id: "po-line-draft",
  draftPurchaseOrderId: "po-draft-1",
  orderStatus: "draft",
};

function renderPurchaseOrdersPage(initialPath = "/purchase-orders") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<div>Home redirect</div>} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PurchaseOrdersPage", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, createManagerUser());
    mockListPurchaseOrders.mockReset();
    mockListSuppliers.mockReset();
    mockCreatePurchaseOrder.mockReset();
    mockCancelPurchaseOrder.mockReset();
    mockSubmitPurchaseOrder.mockReset();
    mockExportCsv.mockReset();
    mockListPurchaseOrders.mockResolvedValue([submittedLine]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "BurDirect", active: true },
    ]);
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: selectedClinicState.selectedClinic,
    };
  });

  it("links submitted purchase order lines to the receiving scanner", async () => {
    renderPurchaseOrdersPage();

    expect(await screen.findByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(screen.queryByText(/purchase order status does not update automatically/i)).not.toBeInTheDocument();
    expect(screen.getByText("BurDirect")).toBeInTheDocument();
    expect(screen.getByText(/\$183\.96/)).toBeInTheDocument();

    const receiveLink = screen.getByRole("link", {
      name: "Receive stock for Diamond Burs FG Round #2 (Pack 5)",
    });
    expect(receiveLink).toHaveAttribute(
      "href",
      `/inventory?mode=receive&poId=po-123`,
    );
  });

  it("filters purchase order review when opened from a low-stock inventory item", async () => {
    const otherLine: PurchaseOrderLine = {
      ...submittedLine,
      id: "po-line-other",
      masterCatalogItemId: "master-2",
      itemName: "Nitrile Gloves",
      masterSku: "VRV-GLV-001",
    };
    mockListPurchaseOrders.mockResolvedValue([submittedLine, otherLine]);

    renderPurchaseOrdersPage("/purchase-orders?item=master-1");

    expect(await screen.findByText(/Reviewing Diamond Burs FG Round/i)).toBeInTheDocument();
    expect(screen.getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(screen.queryByText("Nitrile Gloves")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filter" })).toHaveAttribute(
      "href",
      "/purchase-orders",
    );
  });

  it("shows a receive-stock confirmation after submitting a draft purchase order", async () => {
    mockListPurchaseOrders.mockResolvedValueOnce([draftLine]).mockResolvedValueOnce([
      { ...draftLine, orderStatus: "submitted" },
    ]);
    mockSubmitPurchaseOrder.mockResolvedValue({
      purchaseOrder: { id: "po-draft-1", status: "submitted", clinicId: "11111111-1111-4111-8111-111111111111", supplierId: null, notes: null, poReference: null, createdByUserId: "user-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      lines: [{ ...draftLine, orderStatus: "submitted" }],
    });

    renderPurchaseOrdersPage();

    const submitButton = await screen.findByRole("button", {
      name: "Submit purchase order for Diamond Burs FG Round #2 (Pack 5)",
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockSubmitPurchaseOrder).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        "po-draft-1",
      );
    });
    expect(await screen.findByText(/Purchase order submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Receive stock now" })).toHaveAttribute(
      "href",
      "/inventory?mode=receive&poId=po-draft-1",
    );
  });

  it("requires owner admins to select a real clinic before operational PO actions", () => {
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };

    renderPurchaseOrdersPage();

    expect(screen.getByText("Select a clinic to manage purchase orders")).toBeInTheDocument();
    expect(mockListPurchaseOrders).not.toHaveBeenCalled();
  });

  it("redirects clinical staff away from procurement workflows", () => {
    setAuthenticatedUser(authTestState, createStaffUser());

    renderPurchaseOrdersPage();

    expect(screen.getByText("Home redirect")).toBeInTheDocument();
    expect(mockListPurchaseOrders).not.toHaveBeenCalled();
  });
});
