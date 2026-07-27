import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseOrdersPage } from "../src/pages/PurchaseOrdersPage.js";
import type { PurchaseOrderLine, PurchasingDraft } from "../src/types/inventory.js";
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
  mockListPurchasingDrafts,
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
      mockListPurchasingDrafts: vi.fn(),
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
    listPurchasingDrafts: mockListPurchasingDrafts,
  }),
}));

// ── Mock data ────────────────────────────────────────────────────────────────

/**
 * A submitted PO line.  poReference and poSupplierId are included so the
 * document-oriented PoCard renders predictable text for assertions.
 */
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
  poReference: "PO-SUBMITTED-001",
  poSupplierId: "supplier-1",
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
  poReference: "PO-DRAFT-001",
};

function renderPurchaseOrdersPage(initialPath = "/purchase-orders") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<div>Home redirect</div>} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/purchase-orders/:poId" element={<div data-testid="po-detail-page">PO Detail</div>} />
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
    mockListPurchasingDrafts.mockReset();
    mockListPurchaseOrders.mockResolvedValue([submittedLine]);
    mockListPurchasingDrafts.mockResolvedValue([]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "BurDirect", active: true },
    ]);
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: selectedClinicState.selectedClinic,
    };
  });

  // ── Document-oriented list ────────────────────────────────────────────────

  it("shows ONE card per PO document regardless of how many product lines it contains", async () => {
    // Two lines belonging to the SAME PO
    const secondLine: PurchaseOrderLine = {
      ...submittedLine,
      id: "po-line-submitted-2",
      masterCatalogItemId: "master-2",
      itemName: "Nitrile Gloves (Box 100)",
      estimatedLineCostCents: 5000,
    };
    mockListPurchaseOrders.mockResolvedValue([submittedLine, secondLine]);

    renderPurchaseOrdersPage();

    // PO reference appears exactly once as a link
    const poReferenceLinks = await screen.findAllByRole("link", { name: "PO-SUBMITTED-001" });
    expect(poReferenceLinks).toHaveLength(1);

    // Supplier text appears once in the card
    expect(screen.getByText("BurDirect")).toBeInTheDocument();

    // Line count shows 2
    expect(screen.getByText(/2 product lines/i)).toBeInTheDocument();

    // Item names are NOT in the list view — they belong in the PO detail page
    expect(screen.queryByText("Diamond Burs FG Round #2 (Pack 5)")).not.toBeInTheDocument();
    expect(screen.queryByText("Nitrile Gloves (Box 100)")).not.toBeInTheDocument();
  });

  it("shows a standalone PO (no parent PD) exactly once in the supplier POs list", async () => {
    renderPurchaseOrdersPage();

    // The PO reference card link appears exactly once
    const links = await screen.findAllByRole("link", { name: "PO-SUBMITTED-001" });
    expect(links).toHaveLength(1);
  });

  it("shows the correct receive-stock link on a submitted PO card", async () => {
    renderPurchaseOrdersPage();

    await screen.findByText("PO-SUBMITTED-001");

    const receiveLink = screen.getByRole("link", {
      name: "Receive stock for PO-SUBMITTED-001",
    });
    expect(receiveLink).toHaveAttribute(
      "href",
      `/inventory?mode=receive&poId=po-123`,
    );
  });

  it("shows the estimated subtotal on the submitted PO card", async () => {
    renderPurchaseOrdersPage();

    await screen.findByText("PO-SUBMITTED-001");

    // $183.96 = estimatedLineCostCents (18396) displayed in the PO card
    expect(screen.getAllByText(/\$183\.96/)[0]).toBeInTheDocument();
  });

  it("filters purchase order documents when opened from a low-stock inventory item", async () => {
    // Use TWO SEPARATE POs — one containing the focused item, one not.
    const otherLine: PurchaseOrderLine = {
      ...submittedLine,
      id: "po-line-other",
      draftPurchaseOrderId: "po-other",
      masterCatalogItemId: "master-2",
      itemName: "Nitrile Gloves",
      masterSku: "VRV-GLV-001",
      poReference: "PO-OTHER-001",
    };
    mockListPurchaseOrders.mockResolvedValue([submittedLine, otherLine]);

    renderPurchaseOrdersPage("/purchase-orders?item=master-1");

    // The focus callout names the item from the first matching line
    expect(await screen.findByText(/Reviewing Diamond Burs FG Round/i)).toBeInTheDocument();

    // The PO containing the focused item is visible
    expect(screen.getByText("PO-SUBMITTED-001")).toBeInTheDocument();

    // The OTHER PO that does NOT contain master-1 is hidden
    expect(screen.queryByText("PO-OTHER-001")).not.toBeInTheDocument();

    // Clear filter link goes back to all orders
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

    // In the document-oriented view the Submit button is labelled with the PO reference
    const submitButton = await screen.findByRole("button", {
      name: "Submit PO-DRAFT-001",
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

  it("shows a child PO linked to its parent Purchasing Draft", async () => {
    const pd: PurchasingDraft = {
      id: "pd-0001",
      clinicId: "11111111-1111-4111-8111-111111111111",
      draftReference: "PD-20260727-0042",
      derivedStatus: "draft" as const,
      totalItems: 1,
      supplierCount: 1,
      childPos: [
        {
          id: "po-123",
          clinicId: "11111111-1111-4111-8111-111111111111",
          status: "submitted" as const,
          supplierId: "supplier-1",
          notes: null,
          poReference: "PO-SUBMITTED-001",
          purchasingDraftId: "pd-0001",
          createdByUserId: "user-1",
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        },
      ],
      createdByUserId: "user-1",
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    };
    mockListPurchasingDrafts.mockResolvedValue([pd]);

    renderPurchaseOrdersPage();

    // The PD section shows the draft reference (may appear in multiple places)
    const pdRefElements = await screen.findAllByText("PD-20260727-0042");
    expect(pdRefElements.length).toBeGreaterThan(0);

    // The PO card shows a link to its parent PD
    const pdLinks = screen.getAllByRole("link", { name: "PD-20260727-0042" });
    expect(pdLinks.length).toBeGreaterThan(0);

    // PO reference appears in both PD childPos list and PO card
    expect(screen.getAllByText("PO-SUBMITTED-001").length).toBeGreaterThan(0);
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

  // ── Manual PO creation ────────────────────────────────────────────────────

  it("opens the create form when 'Create PO' is clicked", async () => {
    renderPurchaseOrdersPage();
    await screen.findByText("PO-SUBMITTED-001");

    // "Create PO" is the header button; "Create PO manually" is only in the empty state.
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    expect(await screen.findByRole("heading", { name: /new purchase order/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create draft po/i })).toBeInTheDocument();
  });

  it("shows a loading state and prevents double-submission while saving", async () => {
    // Delay the response so we can assert the loading state.
    mockCreatePurchaseOrder.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    renderPurchaseOrdersPage();
    await screen.findByText("PO-SUBMITTED-001");

    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    const createBtn = await screen.findByRole("button", { name: /create draft po/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /creating…/i })).toBeDisabled();
    });
  });

  it("navigates to the PO detail page on successful manual creation", async () => {
    const newPo = {
      id: "aaaaaaaa-1111-4111-8111-000000000001",
      clinicId: "11111111-1111-4111-8111-111111111111",
      status: "draft",
      supplierId: "supplier-1",
      notes: null,
      poReference: "PO-TEST-001",
      createdByUserId: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockCreatePurchaseOrder.mockResolvedValue(newPo);

    renderPurchaseOrdersPage();
    await screen.findByText("PO-SUBMITTED-001");

    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    await screen.findByRole("heading", { name: /new purchase order/i });

    fireEvent.click(screen.getByRole("button", { name: /create draft po/i }));

    await waitFor(() => {
      expect(screen.getByTestId("po-detail-page")).toBeInTheDocument();
    });
    const anyString = expect.any(String) as string;
    expect(mockCreatePurchaseOrder).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ poReference: anyString }),
    );
  });

  it("retains form values and shows an error message on failed creation", async () => {
    mockCreatePurchaseOrder.mockRejectedValue(new Error("Supplier not found"));

    renderPurchaseOrdersPage();
    await screen.findByText("PO-SUBMITTED-001");

    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    await screen.findByRole("heading", { name: /new purchase order/i });

    // Clear the auto-generated PO reference and type a known value.
    const poRefInput = screen.getByPlaceholderText(/e\.g\. PO-/i);
    fireEvent.change(poRefInput, { target: { value: "PO-RETAIN-001" } });

    fireEvent.click(screen.getByRole("button", { name: /create draft po/i }));

    // Error message must appear.
    expect(await screen.findByRole("alert")).toHaveTextContent("Supplier not found");

    // Form must still be visible with the entered value retained.
    expect(screen.getByDisplayValue("PO-RETAIN-001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create draft po/i })).toBeInTheDocument();
  });

  it("displays a Purchasing Drafts section when drafts are returned", async () => {
    const pd = {
      id: "pd-00000000-0000-4000-8000-000000000001",
      clinicId: "11111111-1111-4111-8111-111111111111",
      draftReference: "PD-20260727-0042",
      createdByUserId: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      derivedStatus: "draft" as const,
      totalItems: 3,
      supplierCount: 2,
      childPos: [],
    };
    mockListPurchasingDrafts.mockResolvedValue([pd]);

    renderPurchaseOrdersPage();

    expect(await screen.findByText("PD-20260727-0042")).toBeInTheDocument();
  });

  it("calls listPurchasingDrafts for the selected clinic", async () => {
    renderPurchaseOrdersPage();

    await screen.findByText("PO-SUBMITTED-001");
    await waitFor(() => {
      expect(mockListPurchasingDrafts).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      );
    });
  });

  // ── Product lines belong in the detail view, not the list ─────────────────

  it("does NOT show product line details (item names, SKUs) in the PO list view", async () => {
    renderPurchaseOrdersPage();

    await screen.findByText("PO-SUBMITTED-001");

    // Item name and SKU should only be in the PO detail page, not the list
    expect(screen.queryByText("Diamond Burs FG Round #2 (Pack 5)")).not.toBeInTheDocument();
    expect(screen.queryByText("VRV-BUR-001")).not.toBeInTheDocument();
  });

  it("shows document-level actions (Submit, Cancel, Receive) once per PO, not per product line", async () => {
    // Give the PO 3 lines — all on the same PO
    const lines = [
      { ...submittedLine, id: "line-a", masterCatalogItemId: "m-a", itemName: "Item A" },
      { ...submittedLine, id: "line-b", masterCatalogItemId: "m-b", itemName: "Item B" },
      { ...submittedLine, id: "line-c", masterCatalogItemId: "m-c", itemName: "Item C" },
    ] as PurchaseOrderLine[];
    mockListPurchaseOrders.mockResolvedValue(lines);

    renderPurchaseOrdersPage();

    await screen.findByText("PO-SUBMITTED-001");

    // "Receive stock for..." link appears ONCE (at document level)
    const receiveLinks = screen.getAllByRole("link", { name: /Receive stock for PO-SUBMITTED-001/i });
    expect(receiveLinks).toHaveLength(1);
  });
});
