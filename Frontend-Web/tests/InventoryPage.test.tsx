import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  mockListPurchaseOrderHeaders,
  mockCreatePurchaseOrderWithLines,
  mockAddLinesToPurchaseOrder,
  mockHandleScan,
  mockCreateProduct,
  mockListSuppliers,
  mockCreatePurchasingDraft,
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
    mockListPurchaseOrderHeaders: vi.fn(),
    mockCreatePurchaseOrderWithLines: vi.fn(),
    mockAddLinesToPurchaseOrder: vi.fn(),
    mockHandleScan: vi.fn(),
    mockCreateProduct: vi.fn(),
    mockListSuppliers: vi.fn(),
    mockCreatePurchasingDraft: vi.fn(),
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
    listPurchaseOrderHeaders: mockListPurchaseOrderHeaders,
    createPurchaseOrderWithLines: mockCreatePurchaseOrderWithLines,
    addLinesToPurchaseOrder: mockAddLinesToPurchaseOrder,
    listSuppliers: mockListSuppliers,
    handleScan: mockHandleScan,
    createProduct: mockCreateProduct,
    createPurchasingDraft: mockCreatePurchasingDraft,
    listPurchasingDrafts: vi.fn().mockResolvedValue([]),
    getPurchasingDraftDetail: vi.fn(),
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
    barcodeValue: "9301234567890",
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
    barcodeValue: "9301234567891",
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
  {
    id: "e1111111-1111-4111-8111-111111111113",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "d3333333-3333-4333-8333-333333333333",
    masterSku: "VRV-CMP-001",
    barcodeValue: "CMP-BARCODE-001",
    name: "Universal Composite Resin A2 (4g syringe)",
    category: "Restorative",
    unitOfMeasure: "syringe",
    quantityOnHand: 0,
    reorderPoint: 0,
    unitCostCents: 3299,
    unitCostOverrideCents: null,
    supplierPreference: null,
    isBelowReorderPoint: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];
const rotaryInventoryItem = sampleInventory[1] as InventoryItem;
const createdScanProduct: InventoryItem = {
  id: "e3333333-3333-4333-8333-333333333333",
  clinicId: TEST_CLINIC_ID,
  masterCatalogItemId: "d3333333-3333-4333-8333-333333333333",
  masterSku: "UNKNOWN-CODE",
  name: "New Scan Product",
  category: "PPE",
  unitOfMeasure: "pack",
  quantityOnHand: 0,
  reorderPoint: 2,
  unitCostCents: 0,
  unitCostOverrideCents: null,
  supplierPreference: "DentalCo AU",
  preferredSupplierId: "supplier-1",
  preferredSupplierName: "DentalCo AU",
  isBelowReorderPoint: true,
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
};

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
  receivedQuantity: 0,
  outstandingQuantity: 4,
  reason: "below_reorder_point",
  orderStatus: "submitted",
  createdAt: "2026-06-25T00:00:00.000Z",
};

function renderInventoryPage(initialPath = "/inventory") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/purchase-orders/:poId" element={<div data-testid="po-detail-page">PO Detail</div>} />
        <Route path="/purchasing-drafts/:pdId" element={<div data-testid="purchasing-draft-page">Purchasing Draft</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getInventoryWorkspace() {
  const heading = screen.getByRole("heading", { name: "Inventory workspace" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

describe("InventoryPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListInventory.mockReset();
    mockListAdjustments.mockReset();
    mockListPurchaseOrders.mockReset();
    mockListPurchaseOrderHeaders.mockReset();
    mockCreatePurchaseOrderWithLines.mockReset();
    mockAddLinesToPurchaseOrder.mockReset();
    mockHandleScan.mockReset();
    mockCreateProduct.mockReset();
    mockListSuppliers.mockReset();
    mockCreatePurchasingDraft.mockReset();
    setAuthenticatedUser(authTestState, authUser);
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockListInventory.mockResolvedValue(sampleInventory);
    mockListAdjustments.mockResolvedValue({ items: [receiveAdjustment], total: 1, limit: 25, offset: 0 });
    mockListPurchaseOrders.mockResolvedValue([submittedPoLine]);
    mockListPurchaseOrderHeaders.mockResolvedValue([]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "DentalCo AU", active: true },
      { id: "supplier-2", supplierName: "BurDirect", active: true },
    ]);
    mockCreateProduct.mockResolvedValue({
      masterItem: {
        id: createdScanProduct.masterCatalogItemId,
        sku: createdScanProduct.masterSku,
        name: createdScanProduct.name,
      },
      barcodeMapping: {
        barcodeValue: createdScanProduct.masterSku,
        barcodeFormat: "code128",
      },
      clinicItem: createdScanProduct,
    });
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
    expect(screen.getByRole("heading", { name: "Inventory workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deduct" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan product with camera" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(await screen.findByText("VRV-GLV-001")).toBeInTheDocument();
    const workspace = getInventoryWorkspace();
    expect(within(workspace).getByText("1 low stock")).toBeInTheDocument();
    expect(within(workspace).getByText("1 out of stock")).toBeInTheDocument();
    expect(within(workspace).getByText("Low Stock")).toBeInTheDocument();
    expect(within(workspace).getByText("Healthy")).toBeInTheDocument();
    expect(within(workspace).getByText("Out of Stock")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review PO" })).not.toBeInTheDocument();
    expect(
      within(workspace).getByRole("link", { name: "Nitrile Examination Gloves (Box 100)" }),
    ).toHaveAttribute(
      "href",
      "/inventory/products/e1111111-1111-4111-8111-111111111111",
    );

    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
  });

  it("filters the inventory workspace by product name without reloading inventory", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Search products"), {
      target: { value: "composite" },
    });

    expect(within(workspace).getByText("Universal Composite Resin A2 (4g syringe)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Diamond Burs FG Round #2 (Pack 5)")).not.toBeInTheDocument();
    expect(mockListInventory).toHaveBeenCalledTimes(1);
  });

  it("filters the inventory workspace by barcode", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Search products"), {
      target: { value: "9301234567891" },
    });

    expect(within(workspace).getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Nitrile Examination Gloves (Box 100)")).not.toBeInTheDocument();
  });

  it("filters the inventory workspace by SKU", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Search products"), {
      target: { value: "VRV-GLV-001" },
    });

    expect(within(workspace).getByText("Nitrile Examination Gloves (Box 100)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Diamond Burs FG Round #2 (Pack 5)")).not.toBeInTheDocument();
  });

  it("filters the inventory workspace by supplier", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Supplier"), {
      target: { value: "BurDirect" },
    });

    expect(within(workspace).getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Nitrile Examination Gloves (Box 100)")).not.toBeInTheDocument();
  });

  it("filters the inventory workspace by category", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Category"), {
      target: { value: "Restorative" },
    });

    expect(within(workspace).getByText("Universal Composite Resin A2 (4g syringe)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Diamond Burs FG Round #2 (Pack 5)")).not.toBeInTheDocument();
  });

  it("shows the empty inventory workspace state when no products exist", async () => {
    mockListInventory.mockResolvedValue([]);

    renderInventoryPage();

    const workspace = await screen.findByRole("heading", { name: "Inventory workspace" });
    expect(workspace).toBeInTheDocument();
    expect(await screen.findByText("No products have been added yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Product" })).toHaveAttribute(
      "href",
      "/inventory/products/new",
    );
  });

  it("shows the empty search result state when filters match no products", async () => {
    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    const workspace = getInventoryWorkspace();
    fireEvent.change(within(workspace).getByLabelText("Search products"), {
      target: { value: "does not exist" },
    });

    expect(within(workspace).getByText("No products match your search.")).toBeInTheDocument();
  });

  it("shows a product summary card when the barcode field matches a known SKU", async () => {
    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "VRV-BUR-001" },
    });

    const productSummary = await screen.findByLabelText("Scanned product summary");
    expect(productSummary).toBeInTheDocument();
    expect(within(productSummary).getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
    expect(within(productSummary).getByText("Supplier: BurDirect")).toBeInTheDocument();
    expect(within(productSummary).getByText("Current stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deduct scanned product" })).toBeInTheDocument();
  });

  it("opens the create product modal when a barcode is not found", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    expect(within(dialog).getByDisplayValue("UNKNOWN-CODE")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("Product Name *")).toHaveFocus();
    expect(within(dialog).getByLabelText("Supplier *")).toBeInTheDocument();
    expect(mockHandleScan).not.toHaveBeenCalled();
  });

  it("shows inline validation errors before creating an unknown scanned product", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Product" }));

    expect(await within(dialog).findByText("Product name is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Supplier is required.")).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("creates an unknown scanned product and immediately displays it as found", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    fireEvent.change(within(dialog).getByLabelText("Product Name *"), {
      target: { value: "New Scan Product" },
    });
    fireEvent.change(within(dialog).getByLabelText("Supplier *"), { target: { value: "supplier-1" } });
    fireEvent.change(within(dialog).getByLabelText("Minimum Stock"), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Product" }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({
          sku: "UNKNOWN-CODE",
          barcodeValue: "UNKNOWN-CODE",
          name: "New Scan Product",
          supplierId: "supplier-1",
          stockUnit: "Unit",
          receivingUnit: "Box",
          unitsPerReceivingUnit: 1,
          initialQuantity: 0,
          reorderPoint: 2,
        }),
      );
    });

    expect(await screen.findByText("✅ Product Created Successfully")).toBeInTheDocument();
    const productSummary = await screen.findByLabelText("Scanned product summary");
    expect(within(productSummary).getByText("New Scan Product")).toBeInTheDocument();
    expect(within(productSummary).getByText("Supplier: DentalCo AU")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create product from scan" })).not.toBeInTheDocument();
  });

  it("shows duplicate barcode errors returned by product creation", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockCreateProduct.mockRejectedValue(new Error("This barcode is already assigned to a product"));

    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    fireEvent.change(within(dialog).getByLabelText("Product Name *"), {
      target: { value: "New Scan Product" },
    });
    fireEvent.change(within(dialog).getByLabelText("Supplier *"), { target: { value: "supplier-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Product" }));

    expect(
      await within(dialog).findByText("This barcode is already assigned to a product."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save Product" })).toBeInTheDocument();
  });

  it("blocks scanned product creation when no suppliers exist", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListSuppliers.mockResolvedValue([]);

    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    expect(within(dialog).getByText("No suppliers have been created yet.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save Product" })).toBeDisabled();
  });

  it("cancels unknown scanned product creation and returns to scanner", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    renderInventoryPage();

    await screen.findByText("VRV-BUR-001");

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    const dialog = await screen.findByRole("dialog", { name: "Create product from scan" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Create product from scan" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Barcode")).toHaveValue("");
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("shows a friendly camera error when media devices are unavailable", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    renderInventoryPage();
    await screen.findByText("VRV-BUR-001");

    fireEvent.click(screen.getByRole("button", { name: "Scan product with camera" }));

    expect(
      await screen.findByText(
        "Camera scanning is not available in this browser. Use the barcode field or a USB/Bluetooth scanner.",
      ),
    ).toBeInTheDocument();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("shows eligible low-stock items as selectable checkboxes in the purchasing queue", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    renderInventoryPage("/inventory?focus=low-stock");

    expect(await screen.findByRole("heading", { name: "Low stock purchasing queue" }))
      .toBeInTheDocument();

    // The new UI shows items with checkboxes, not "Review purchase order" links.
    // findAllByRole waits for the LowStockPurchasingQueue to finish loading (isLoading → false).
    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);

    // The item name is visible in the queue (scoped to <strong> to avoid matching the workspace table <a>).
    expect(screen.getByText("Nitrile Examination Gloves (Box 100)", { selector: "strong" })).toBeInTheDocument();

    // Select all control is visible.
    expect(screen.getByText(/Select all eligible/i)).toBeInTheDocument();
  });

  it("select-all selects all eligible low-stock items", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    renderInventoryPage("/inventory?focus=low-stock");

    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // findByRole waits for the LowStockPurchasingQueue to finish loading before clicking.
    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // All eligible item checkboxes should now be checked.
    const checkboxes = screen.getAllByRole("checkbox");
    // At least one item checkbox is checked (the select-all + item checkboxes).
    const checkedItems = checkboxes.filter((cb) => (cb as HTMLInputElement).checked);
    expect(checkedItems.length).toBeGreaterThan(0);
  });

  it("creates a Purchasing Draft from selected low-stock items and navigates to it", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // Set up an item with a preferredSupplierId so groupBySupplier works correctly.
    const eligibleWithSupplier = {
      ...sampleInventory[0],
      id: "e1111111-1111-4111-8111-111111111114",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([eligibleWithSupplier]);

    const pdId = "pd-aaaaaaaa-1111-4111-8111-000000000001";
    const createdDraftResult = {
      purchasingDraft: {
        id: pdId,
        clinicId: TEST_CLINIC_ID,
        draftReference: "PD-20260727-0001",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [
        {
          purchaseOrder: {
            id: "po-child-1",
            poReference: "PO-20260727-0001-01",
          },
          lines: [],
        },
      ],
    };
    mockCreatePurchasingDraft.mockResolvedValue(createdDraftResult);

    renderInventoryPage("/inventory?focus=low-stock");

    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // findByRole waits for the LowStockPurchasingQueue to finish loading before selecting.
    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // Click "Create Purchasing Draft (N supplier POs)".
    const createBtn = await screen.findByRole("button", { name: /create purchasing draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      const linesMatch = expect.arrayContaining([
        expect.objectContaining({ clinicInventoryItemId: eligibleWithSupplier.id }),
      ]) as unknown;
      const groupsMatch = expect.arrayContaining([
        expect.objectContaining({ supplierId: "supplier-1", lines: linesMatch }),
      ]) as unknown;
      expect(mockCreatePurchasingDraft).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({ supplierGroups: groupsMatch }),
      );
    });

    // Should navigate to the Purchasing Draft page.
    await waitFor(() => {
      expect(screen.getByTestId("purchasing-draft-page")).toBeInTheDocument();
    });
  });

  it("adds selected low-stock items to an existing draft PO", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const eligibleItem = {
      ...sampleInventory[0],
      id: "e1111111-1111-4111-8111-111111111115",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([eligibleItem]);

    const existingDraft = {
      id: "dddddddd-1111-4111-8111-000000000001",
      clinicId: TEST_CLINIC_ID,
      status: "draft",
      supplierId: "supplier-1",
      notes: null,
      poReference: "PO-EXISTING-001",
      createdByUserId: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockListPurchaseOrderHeaders.mockResolvedValue([existingDraft]);

    const updatedDetail = {
      purchaseOrder: existingDraft,
      lines: [{ id: "line-1", quantity: 2, clinicInventoryItemId: eligibleItem.id }],
    };
    mockAddLinesToPurchaseOrder.mockResolvedValue(updatedDetail);

    renderInventoryPage("/inventory?focus=low-stock");

    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // findByRole waits for the LowStockPurchasingQueue to finish loading before selecting.
    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // Open the "Add to existing PO" section.
    const addToExistingBtn = await screen.findByRole("button", { name: /add to existing draft supplier po/i });
    fireEvent.click(addToExistingBtn);

    // Should load existing draft POs.
    await waitFor(() => {
      expect(mockListPurchaseOrderHeaders).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });

    // Click the confirm button.
    const confirmBtn = await screen.findByRole("button", { name: /add selected items to this po/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const linesContaining = expect.arrayContaining([
        expect.objectContaining({ clinicInventoryItemId: eligibleItem.id }),
      ]) as Array<Record<string, unknown>>;
      expect(mockAddLinesToPurchaseOrder).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        existingDraft.id,
        expect.objectContaining({
          lines: linesContaining,
        }),
      );
    });

    // Should navigate to the existing PO's detail page.
    await waitFor(() => {
      expect(screen.getByTestId("po-detail-page")).toBeInTheDocument();
    });
  });

  it("only shows items below reorder point in the purchasing queue — others are omitted", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // Mix: one eligible (below reorder) and one healthy (above reorder).
    const eligibleItem = { ...sampleInventory[0], isBelowReorderPoint: true, name: "Low Stock Item" } as InventoryItem;
    const healthyItem = { ...sampleInventory[1], isBelowReorderPoint: false, name: "Healthy Stock Item" } as InventoryItem;
    mockListInventory.mockResolvedValue([eligibleItem, healthyItem]);

    renderInventoryPage("/inventory?focus=low-stock");

    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // The queue renders item names as <strong>. Scoping to "strong" distinguishes queue items
    // from the workspace table which renders the same name as an <a> link.
    expect(await screen.findByText("Low Stock Item", { selector: "strong" })).toBeInTheDocument();

    // Healthy item does NOT appear in the queue (it is omitted, not disabled).
    // The workspace table shows it as <a>, not <strong>, so this scoped check targets only the queue.
    expect(screen.queryByText("Healthy Stock Item", { selector: "strong" })).not.toBeInTheDocument();
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
    expect(screen.getAllByRole("link", { name: "Receive Stock" })[0]).toHaveAttribute(
      "href",
      "/inventory/receiving",
    );
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
      await screen.findByText(
        /Received VRV-BUR-001 — inventory is now 16 pack on hand\. Note: this manual\/scan-based receipt updates stock directly and is not automatically linked to a purchase order\./i,
      ),
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

  // ── Low-stock cost visibility (Issue 1 / Finding 2) ───────────────────────

  it("displays per-item estimated unit cost in the low-stock queue", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const itemWithCost = {
      ...sampleInventory[0],
      id: "cost-test-item-1",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      unitCostCents: 1899,
      stockUnit: "Box",
      quantityOnHand: 3,
      reorderPoint: 10,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([itemWithCost]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // suggestedQty = 10 - 3 - 0 = 7
    // lineCost = 1899 × 7 = 13293 cents = $132.93
    // Unit cost label: "$18.99" visible (per Box)
    const unitCostElements = await screen.findAllByText(/\$18\.99/i);
    expect(unitCostElements.length).toBeGreaterThan(0);

    // Estimated line total: $132.93
    const lineTotalElements = screen.getAllByText(/\$132\.93/i);
    expect(lineTotalElements.length).toBeGreaterThan(0);
  });

  it("displays supplier subtotal and overall estimated total in the group summary", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // Two items from two different suppliers
    const itemA = {
      ...sampleInventory[0],
      id: "cost-test-item-a",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      unitCostCents: 1000, // $10.00 per unit
      stockUnit: "Box",
      quantityOnHand: 0,
      reorderPoint: 5,
      onOrderQuantity: 0,
    } as InventoryItem;

    const itemB = {
      ...sampleInventory[1],
      id: "cost-test-item-b",
      preferredSupplierId: "supplier-2",
      preferredSupplierName: "BurDirect",
      isBelowReorderPoint: true,
      unitCostCents: 2000, // $20.00 per unit
      stockUnit: "Pack",
      quantityOnHand: 0,
      reorderPoint: 3,
      onOrderQuantity: 0,
    } as InventoryItem;

    mockListInventory.mockResolvedValue([itemA, itemB]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "DentalCo AU", active: true },
      { id: "supplier-2", supplierName: "BurDirect", active: true },
    ]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Select all eligible items
    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // itemA: suggestedQty = 5-0-0 = 5, lineCost = 1000×5 = 5000 = $50.00
    // itemB: suggestedQty = 3-0-0 = 3, lineCost = 2000×3 = 6000 = $60.00
    // overallTotal = 5000 + 6000 = 11000 = $110.00

    // Supplier subtotals appear in group summary (group list items)
    await waitFor(() => {
      expect(screen.getAllByText(/\$50\.00/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\$60\.00/i).length).toBeGreaterThan(0);
    });

    // Overall estimated total
    const overallTotal = screen.getByTestId("overall-estimated-total");
    expect(overallTotal).toHaveTextContent("$110.00");
  });

  it("recalculates overall total when selection changes", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const itemA = {
      ...sampleInventory[0],
      id: "recalc-item-a",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      unitCostCents: 1000,
      stockUnit: "Box",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    } as InventoryItem;

    const itemB = {
      ...sampleInventory[1],
      id: "recalc-item-b",
      preferredSupplierId: "supplier-2",
      preferredSupplierName: "BurDirect",
      isBelowReorderPoint: true,
      unitCostCents: 3000,
      stockUnit: "Pack",
      quantityOnHand: 0,
      reorderPoint: 1,
      onOrderQuantity: 0,
    } as InventoryItem;

    mockListInventory.mockResolvedValue([itemA, itemB]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "DentalCo AU", active: true },
      { id: "supplier-2", supplierName: "BurDirect", active: true },
    ]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Select all
    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // itemA: 2×1000 = 2000, itemB: 1×3000 = 3000 → overall $50.00
    await waitFor(() => {
      const total = screen.getByTestId("overall-estimated-total");
      expect(total).toHaveTextContent("$50.00");
    });

    // Deselect all — overall total should disappear (group summary hidden when no selection)
    fireEvent.click(selectAll);
    await waitFor(() => {
      expect(screen.queryByTestId("overall-estimated-total")).not.toBeInTheDocument();
    });
  });

  // ── Supplier-required guard (Issue 3) ─────────────────────────────────────

  it("shows 'Supplier required' warning for items without a preferred supplier", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const noSupplierItem = {
      ...sampleInventory[0],
      id: "no-supplier-item",
      preferredSupplierId: null,
      preferredSupplierName: null,
      isBelowReorderPoint: true,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([noSupplierItem]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Item must still be visible in the queue
    expect(await screen.findByText(noSupplierItem.name, { selector: "strong" })).toBeInTheDocument();

    // Supplier required warning must be visible
    expect(screen.getByTestId("supplier-required")).toBeInTheDocument();
  });

  it("excludes no-supplier items from Purchasing Draft creation (only actionable groups sent)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const withSupplier = {
      ...sampleInventory[0],
      id: "with-supplier-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      unitCostCents: 500,
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    } as InventoryItem;

    const noSupplier = {
      ...sampleInventory[1],
      id: "no-supplier-item-2",
      preferredSupplierId: null,
      preferredSupplierName: null,
      isBelowReorderPoint: true,
      unitCostCents: 300,
      quantityOnHand: 0,
      reorderPoint: 1,
      onOrderQuantity: 0,
    } as InventoryItem;

    mockListInventory.mockResolvedValue([withSupplier, noSupplier]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "DentalCo AU", active: true },
    ]);

    const pdId = "pd-supplier-guard-test";
    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: {
        id: pdId,
        clinicId: "11111111-1111-4111-8111-111111111111",
        draftReference: "PD-20260727-GUARD",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [],
    });

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // Warning about no-supplier items should be visible in the group summary
    await waitFor(() => {
      expect(screen.getByTestId("no-supplier-warning")).toBeInTheDocument();
    });

    // Create Purchasing Draft button should still be visible for the actionable group
    const createBtn = screen.getByRole("button", { name: /create purchasing draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      // API must only be called with the supplier group that HAS a supplier
      const call = mockCreatePurchasingDraft.mock.calls[0];
      const body = (call as unknown[])[1] as { supplierGroups: Array<{ supplierId: string | null }> };
      expect(body.supplierGroups).toHaveLength(1);
      expect(body.supplierGroups[0]?.supplierId).toBe("supplier-1");
    });
  });

  // ── Unit quantity safety — receiving unit conversion (Final Safety Fix) ─────

  it("1:1 — stockUnit == receivingUnit keeps quantity unchanged and cost correct", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // stockUnit = Box, receivingUnit = Box, unitsPerReceivingUnit = 1 → 1:1
    // shortfall = 5 - 0 - 0 = 5 → suggestedReceivingQty = ceil(5/1) = 5
    // costPerReceivingUnit = 800 × 1 = 800 cents = $8.00
    // lineCost = 5 × 1 × 800 = 4000 = $40.00
    const item1to1 = {
      ...sampleInventory[0],
      id: "uom-1to1-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Box",
      unitsPerReceivingUnit: 1,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 5,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item1to1]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Should show "Suggest: 5 Box" — no incoming note because same unit
    expect(await screen.findByText(/Suggest:\s*5/)).toBeInTheDocument();
    // Should NOT show an "(incoming)" note — receiving == stock
    expect(screen.queryByText(/incoming/i)).not.toBeInTheDocument();
    // Unit cost $8.00, line total $40.00
    const unitCostEls = screen.getAllByText(/\$8\.00/i);
    expect(unitCostEls.length).toBeGreaterThan(0);
    const lineTotalEls = screen.getAllByText(/\$40\.00/i);
    expect(lineTotalEls.length).toBeGreaterThan(0);
  });

  it("suggests 2 Carton when shortage is 20 Box (10 Box per Carton)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // shortfall = 20 - 0 - 0 = 20; ceil(20/10) = 2 Carton
    const item20box = {
      ...sampleInventory[0],
      id: "uom-20box-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 20,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item20box]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Must show "2 Carton", NOT "20 Carton"
    expect(await screen.findByText(/Suggest:\s*2/)).toBeInTheDocument();
    // Must show the incoming note: 20 Box incoming
    expect(screen.getByText(/20 Box incoming/i)).toBeInTheDocument();
    // Must NOT suggest 20 in the Suggest label
    expect(screen.queryByText(/Suggest:\s*20/)).not.toBeInTheDocument();
  });

  it("rounds up to 3 Carton when shortage is 21 Box (10 Box per Carton)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // shortfall = 21 - 0 - 0 = 21; ceil(21/10) = 3 Carton
    const item21box = {
      ...sampleInventory[0],
      id: "uom-21box-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 21,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item21box]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Must suggest 3 (rounded up), not 2 (truncated) or 21 (raw stock units)
    expect(await screen.findByText(/Suggest:\s*3/)).toBeInTheDocument();
    // Must show 30 Box incoming (3 Carton × 10 Box)
    expect(screen.getByText(/30 Box incoming/i)).toBeInTheDocument();
  });

  it("estimated cost: 2 Carton × 10 Box/Carton × $8/Box = $160 (NOT 2 × $8 = $16)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // 2 Carton, 10 Box/Carton, $8/Box → line total = 2 × 10 × 800 = 16000 = $160.00
    // Cost per Carton = 800 × 10 = 8000 = $80.00
    const item20box = {
      ...sampleInventory[0],
      id: "uom-cost-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 20,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item20box]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Cost per receiving unit: $80.00 (= 10 × $8)
    const costPerUnitEls = await screen.findAllByText(/\$80\.00/i);
    expect(costPerUnitEls.length).toBeGreaterThan(0);
    // Line total: $160.00 (= 2 × $80)
    const lineTotalEls = screen.getAllByText(/\$160\.00/i);
    expect(lineTotalEls.length).toBeGreaterThan(0);
    // Must NOT show the incorrect $16.00 (= 2 × $8)
    expect(screen.queryByText(/\$16\.00/i)).not.toBeInTheDocument();
  });

  it("estimated cost for rounded-up case: 3 Carton × 10 Box × $8 = $240 (NOT 21 × $8 = $168)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // 21 Box shortfall → 3 Carton ordered; 3 × 10 × 800 = 24000 = $240.00
    const item21box = {
      ...sampleInventory[0],
      id: "uom-rounded-cost-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 21,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item21box]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    // Line total: $240.00 (= 3 × 10 × $8) — actual order cost
    const lineTotalEls = await screen.findAllByText(/\$240\.00/i);
    expect(lineTotalEls.length).toBeGreaterThan(0);
    // Must NOT show $168.00 (= 21 × $8, the raw shortfall cost — wrong)
    expect(screen.queryByText(/\$168\.00/i)).not.toBeInTheDocument();
  });

  it("supplier subtotal and overall total respect receiving-unit conversion", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // itemA: 20 Box shortfall, 10 per Carton → 2 Carton @ $80/Carton = $160
    const itemA = {
      ...sampleInventory[0],
      id: "uom-subtotal-a",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 20,
      onOrderQuantity: 0,
    } as InventoryItem;

    // itemB: 6 Pack shortfall, 6 per Case → 1 Case @ $27.54/Case = $27.54
    // (unitsPerReceivingUnit=6, unitCostCents=459)
    // suggestedReceivingQty = ceil(6/6) = 1 Case
    // costPerCase = 459 × 6 = 2754 = $27.54
    // lineTotal = 1 × 6 × 459 = 2754 = $27.54
    const itemB = {
      ...sampleInventory[1],
      id: "uom-subtotal-b",
      preferredSupplierId: "supplier-2",
      preferredSupplierName: "BurDirect",
      isBelowReorderPoint: true,
      stockUnit: "Pack",
      receivingUnit: "Case",
      unitsPerReceivingUnit: 6,
      unitCostCents: 459,
      quantityOnHand: 0,
      reorderPoint: 6,
      onOrderQuantity: 0,
    } as InventoryItem;

    mockListInventory.mockResolvedValue([itemA, itemB]);
    mockListSuppliers.mockResolvedValue([
      { id: "supplier-1", supplierName: "DentalCo AU", active: true },
      { id: "supplier-2", supplierName: "BurDirect", active: true },
    ]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    // Supplier A subtotal: $160.00
    await waitFor(() => {
      expect(screen.getAllByText(/\$160\.00/i).length).toBeGreaterThan(0);
    });
    // Supplier B subtotal: $27.54
    expect(screen.getAllByText(/\$27\.54/i).length).toBeGreaterThan(0);
    // Overall: $160 + $27.54 = $187.54
    const overallTotal = screen.getByTestId("overall-estimated-total");
    expect(overallTotal).toHaveTextContent("$187.54");
  });

  it("quantity sent to createPurchasingDraft is in receiving units (2 Cartons not 20 Boxes)", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    // 20 Box shortfall, 10 per Carton → must send quantity: 2 (Cartons), not 20 (Boxes)
    const item20box = {
      ...sampleInventory[0],
      id: "uom-api-qty-item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      isBelowReorderPoint: true,
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 20,
      onOrderQuantity: 0,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([item20box]);

    const pdId = "pd-uom-api-test";
    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: {
        id: pdId,
        clinicId: TEST_CLINIC_ID,
        draftReference: "PD-20260727-UOM1",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [],
    });

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    const selectAll = await screen.findByRole("checkbox", { name: /select all eligible/i });
    fireEvent.click(selectAll);

    const createBtn = await screen.findByRole("button", { name: /create purchasing draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      const call = mockCreatePurchasingDraft.mock.calls[0];
      const body = (call as unknown[])[1] as {
        supplierGroups: Array<{ supplierId: string; lines: Array<{ quantity: number }> }>;
      };
      const sentQty = body.supplierGroups[0]?.lines[0]?.quantity;
      // Must be 2 (receiving units = Cartons), NOT 20 (stock units = Boxes)
      expect(sentQty).toBe(2);
    });
  });

  it("prevents Purchasing Draft creation when ALL selected items lack a supplier", async () => {
    setAuthenticatedUser(authTestState, managerUser);

    const noSupplierItem = {
      ...sampleInventory[0],
      id: "no-supplier-only",
      preferredSupplierId: null,
      preferredSupplierName: null,
      isBelowReorderPoint: true,
    } as InventoryItem;
    mockListInventory.mockResolvedValue([noSupplierItem]);

    renderInventoryPage("/inventory?focus=low-stock");
    await screen.findByRole("heading", { name: "Low stock purchasing queue" });

    const checkbox = await screen.findByRole("checkbox", { name: "" });
    fireEvent.click(checkbox);

    await waitFor(() => {
      // "Create Purchasing Draft" button should NOT be present
      expect(screen.queryByRole("button", { name: /create purchasing draft/i })).not.toBeInTheDocument();
      // A helpful message should appear
      expect(screen.getByText(/assign a preferred supplier/i)).toBeInTheDocument();
    });
  });
});
