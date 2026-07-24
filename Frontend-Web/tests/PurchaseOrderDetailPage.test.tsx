/**
 * PurchaseOrderDetailPage.test.tsx
 *
 * Tests for the new PO detail/edit page.
 * Covers:
 *   - Shows PO header fields (supplier, reference, notes)
 *   - Shows order lines with ordered/received/outstanding quantities
 *   - Edit header controls visible for draft PO
 *   - Add product button visible for draft PO
 *   - Edit / Remove buttons visible for draft PO lines
 *   - Read-only display for submitted / received / cancelled POs
 *   - Cancellation confirmation dialog
 *   - Submit button disabled when no supplier or no lines
 *   - Navigate to receive stock from submitted PO
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseOrderDetailPage } from "../src/pages/PurchaseOrderDetailPage.js";
import type { PurchaseOrder, PurchaseOrderLine } from "../src/types/inventory.js";
import {
  createManagerUser,
} from "./helpers/auth.js";
import { setAuthenticatedUser, type AuthTestState } from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockGetPurchaseOrderDetail,
  mockListSuppliers,
  mockListInventory,
  mockUpdatePurchaseOrder,
  mockAddPoLine,
  mockUpdatePoLine,
  mockRemovePoLine,
  mockSubmitPurchaseOrder,
  mockCancelPurchaseOrder,
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
    mockGetPurchaseOrderDetail: vi.fn(),
    mockListSuppliers: vi.fn(),
    mockListInventory: vi.fn(),
    mockUpdatePurchaseOrder: vi.fn(),
    mockAddPoLine: vi.fn(),
    mockUpdatePoLine: vi.fn(),
    mockRemovePoLine: vi.fn(),
    mockSubmitPurchaseOrder: vi.fn(),
    mockCancelPurchaseOrder: vi.fn(),
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

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getPurchaseOrderDetail: mockGetPurchaseOrderDetail,
    listSuppliers: mockListSuppliers,
    listInventory: mockListInventory,
    updatePurchaseOrder: mockUpdatePurchaseOrder,
    addPoLine: mockAddPoLine,
    updatePoLine: mockUpdatePoLine,
    removePoLine: mockRemovePoLine,
    submitPurchaseOrder: mockSubmitPurchaseOrder,
    cancelPurchaseOrder: mockCancelPurchaseOrder,
  }),
}));

const DRAFT_PO: PurchaseOrder = {
  id: "po-detail-1",
  clinicId: "11111111-1111-4111-8111-111111111111",
  status: "draft",
  supplierId: "supplier-1",
  notes: "Urgent restocking",
  poReference: "PO-20260724-0001",
  createdByUserId: "user-1",
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z",
};

const DRAFT_LINE: PurchaseOrderLine = {
  id: "line-1",
  draftPurchaseOrderId: "po-detail-1",
  masterCatalogItemId: "master-1",
  masterSku: "VRV-BUR-001",
  itemName: "Diamond Burs",
  clinicInventoryItemId: "inv-1",
  quantity: 10,
  receivedQuantity: 0,
  outstandingQuantity: 10,
  reason: "manual",
  orderStatus: "draft",
  createdAt: "2026-07-24T00:00:00.000Z",
};

const SUBMITTED_PO: PurchaseOrder = { ...DRAFT_PO, status: "submitted" };
const PARTIAL_LINE: PurchaseOrderLine = {
  ...DRAFT_LINE,
  orderStatus: "partially_received",
  receivedQuantity: 4,
  outstandingQuantity: 6,
};

function renderDetailPage(poId = "po-detail-1") {
  return render(
    <MemoryRouter initialEntries={[`/purchase-orders/${poId}`]}>
      <Routes>
        <Route path="/purchase-orders/:poId" element={<PurchaseOrderDetailPage />} />
        <Route path="/purchase-orders" element={<div>Back to POs</div>} />
        <Route path="/inventory" element={<div>Inventory receive page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PurchaseOrderDetailPage", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, createManagerUser());
    mockGetPurchaseOrderDetail.mockReset();
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "BurDirect", active: true },
    ]);
    mockListInventory.mockResolvedValue([]);
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: DRAFT_PO,
      lines: [DRAFT_LINE],
    });
  });

  it("displays PO reference, notes, and status badge", async () => {
    renderDetailPage();
    // Reference appears in both the H2 title and the header detail row — at least one must exist.
    expect((await screen.findAllByText(/PO-20260724-0001/)).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("Urgent restocking")).toBeInTheDocument();
    expect(await screen.findByText("Draft")).toBeInTheDocument();
  });

  it("shows supplier name resolved from supplier list", async () => {
    renderDetailPage();
    expect(await screen.findByText("BurDirect")).toBeInTheDocument();
  });

  it("shows ordered, received, outstanding columns for submitted PO lines", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: SUBMITTED_PO,
      lines: [PARTIAL_LINE],
    });
    renderDetailPage();
    expect(await screen.findByText("Ordered")).toBeInTheDocument();
    // The column header is "Received" (not "Previously received").
    expect(await screen.findByText("Received")).toBeInTheDocument();
    expect(await screen.findByText("Outstanding")).toBeInTheDocument();
    expect(await screen.findByText("4")).toBeInTheDocument(); // receivedQuantity
    expect(await screen.findByText("6")).toBeInTheDocument(); // outstandingQuantity
  });

  it("shows Edit header button for draft PO", async () => {
    renderDetailPage();
    expect(await screen.findByRole("button", { name: /Edit header/i })).toBeInTheDocument();
  });

  it("shows Add product button for draft PO", async () => {
    renderDetailPage();
    expect(await screen.findByRole("button", { name: /\+ Add product/i })).toBeInTheDocument();
  });

  it("shows Edit and Remove buttons for draft PO lines", async () => {
    renderDetailPage();
    expect(await screen.findByRole("button", { name: /^Edit$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Remove$/i })).toBeInTheDocument();
  });

  it("shows Submit PO button for draft PO with supplier and lines", async () => {
    renderDetailPage();
    expect(await screen.findByRole("button", { name: /Submit PO/i })).toBeInTheDocument();
  });

  it("Submit PO button is disabled when no supplier is set", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: { ...DRAFT_PO, supplierId: null },
      lines: [DRAFT_LINE],
    });
    renderDetailPage();
    const btn = await screen.findByRole("button", { name: /Submit PO/i });
    expect(btn).toBeDisabled();
  });

  it("Submit PO button is disabled when no lines exist", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: DRAFT_PO,
      lines: [],
    });
    renderDetailPage();
    const btn = await screen.findByRole("button", { name: /Submit PO/i });
    expect(btn).toBeDisabled();
  });

  it("shows cancellation confirmation dialog when Cancel PO clicked", async () => {
    renderDetailPage();
    const cancelBtn = await screen.findByRole("button", { name: /Cancel PO/i });
    fireEvent.click(cancelBtn);
    expect(await screen.findByText(/Cancel this purchase order/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yes, cancel PO/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keep PO/i })).toBeInTheDocument();
  });

  it("hides Edit header button for submitted PO (read-only)", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: SUBMITTED_PO,
      lines: [PARTIAL_LINE],
    });
    renderDetailPage();
    await screen.findByText("Diamond Burs"); // wait for load
    expect(screen.queryByRole("button", { name: /Edit header/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\+ Add product/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove$/i })).not.toBeInTheDocument();
  });

  it("shows Receive stock link for submitted PO", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: SUBMITTED_PO,
      lines: [PARTIAL_LINE],
    });
    renderDetailPage();
    const link = await screen.findByRole("link", { name: /Receive stock/i });
    expect(link).toHaveAttribute("href", "/inventory?mode=receive&poId=po-detail-1");
  });

  it("shows fully received message for received PO", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: { ...DRAFT_PO, status: "received" },
      lines: [{ ...DRAFT_LINE, orderStatus: "received", receivedQuantity: 10, outstandingQuantity: 0 }],
    });
    renderDetailPage();
    expect(await screen.findByText(/fully received/i)).toBeInTheDocument();
  });

  it("shows cancelled message for cancelled PO", async () => {
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: { ...DRAFT_PO, status: "cancelled" },
      lines: [DRAFT_LINE],
    });
    renderDetailPage();
    expect(await screen.findByText(/was cancelled/i)).toBeInTheDocument();
  });

  it("removes line after Remove button click", async () => {
    mockRemovePoLine.mockResolvedValue(undefined);
    mockGetPurchaseOrderDetail
      .mockResolvedValueOnce({ purchaseOrder: DRAFT_PO, lines: [DRAFT_LINE] })
      .mockResolvedValueOnce({ purchaseOrder: DRAFT_PO, lines: [] });
    renderDetailPage();
    const removeBtn = await screen.findByRole("button", { name: /^Remove$/i });
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(mockRemovePoLine).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        "po-detail-1",
        "line-1",
      );
    });
  });
});

// ─── Disclaimer removal test ──────────────────────────────────────────────────

describe("PurchaseOrderDetailPage — no operational disclaimer", () => {
  it("does not show the obsolete disclaimer text anywhere on the PO detail page", async () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    mockGetPurchaseOrderDetail.mockResolvedValue({
      purchaseOrder: DRAFT_PO,
      lines: [DRAFT_LINE],
    });
    renderDetailPage();
    await screen.findByText("Diamond Burs");
    expect(screen.queryByText(/does not update automatically/i)).not.toBeInTheDocument();
  });
});
