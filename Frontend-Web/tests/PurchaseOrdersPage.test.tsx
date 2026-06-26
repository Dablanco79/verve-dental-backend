import { render, screen } from "@testing-library/react";
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
    };
    return {
      authTestState,
      selectedClinicState,
      mockListPurchaseOrders: vi.fn(),
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
      type: "clinic",
      clinic: selectedClinicState.selectedClinic,
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
  reason: "below_reorder_point",
  orderStatus: "submitted",
  createdAt: "2026-06-25T00:00:00.000Z",
};

function renderPurchaseOrdersPage() {
  return render(
    <MemoryRouter initialEntries={["/purchase-orders"]}>
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
    mockSubmitPurchaseOrder.mockReset();
    mockExportCsv.mockReset();
    mockListPurchaseOrders.mockResolvedValue([submittedLine]);
  });

  it("links submitted purchase order lines to the receiving scanner", async () => {
    renderPurchaseOrdersPage();

    expect(await screen.findByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(screen.getByText(/purchase order status remains unchanged/i)).toBeInTheDocument();

    const receiveLink = screen.getByRole("link", {
      name: "Receive stock for Diamond Burs FG Round #2 (Pack 5)",
    });
    expect(receiveLink).toHaveAttribute(
      "href",
      "/inventory?mode=receive&reference=po-123",
    );
  });

  it("redirects clinical staff away from procurement workflows", () => {
    setAuthenticatedUser(authTestState, createStaffUser());

    renderPurchaseOrdersPage();

    expect(screen.getByText("Home redirect")).toBeInTheDocument();
    expect(mockListPurchaseOrders).not.toHaveBeenCalled();
  });
});
