import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryReceivingPage } from "../src/pages/InventoryReceivingPage.js";
import type { InventoryItem } from "../src/types/inventory.js";
import type { Supplier } from "../src/types/supplier.js";
import { createManagerUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockListInventory,
  mockListSuppliers,
  mockReceiveInventory,
  mockReceiveSupplierInvoice,
  mockGetSupplierInvoice,
  mockCreateProduct,
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
    mockListSuppliers: vi.fn(),
    mockReceiveInventory: vi.fn(),
    mockReceiveSupplierInvoice: vi.fn(),
    mockGetSupplierInvoice: vi.fn(),
    mockCreateProduct: vi.fn(),
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
    listInventory: mockListInventory,
    listSuppliers: mockListSuppliers,
    receiveInventory: mockReceiveInventory,
    receiveSupplierInvoice: mockReceiveSupplierInvoice,
    getSupplierInvoice: mockGetSupplierInvoice,
    createProduct: mockCreateProduct,
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

const supplier = {
  id: "supplier-1",
  supplierName: "DentalCo AU",
  active: true,
} as Supplier;

const burItem: InventoryItem = {
  id: "item-bur",
  clinicId: TEST_CLINIC_ID,
  masterCatalogItemId: "master-bur",
  masterSku: "VRV-BUR-001",
  barcodeValue: "9301234567891",
  name: "Diamond Burs FG Round #2 (Pack 5)",
  category: "Rotary",
  stockUnit: "Pack",
  receivingUnit: "Case",
  unitsPerReceivingUnit: 6,
  unitOfMeasure: "pack",
  quantityOnHand: 12,
  reorderPoint: 4,
  unitCostCents: 4599,
  unitCostOverrideCents: null,
  supplierPreference: "DentalCo AU",
  preferredSupplierId: supplier.id,
  preferredSupplierName: supplier.supplierName,
  isBelowReorderPoint: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const gloveItem: InventoryItem = {
  id: "item-glove",
  clinicId: TEST_CLINIC_ID,
  masterCatalogItemId: "master-glove",
  masterSku: "VRV-GLV-001",
  barcodeValue: "9301234567890",
  name: "Nitrile Examination Gloves (Box 100)",
  category: "PPE",
  stockUnit: "Box",
  receivingUnit: "Carton",
  unitsPerReceivingUnit: 10,
  unitOfMeasure: "box",
  quantityOnHand: 3,
  reorderPoint: 5,
  unitCostCents: 1799,
  unitCostOverrideCents: null,
  supplierPreference: "DentalCo AU",
  preferredSupplierId: supplier.id,
  preferredSupplierName: supplier.supplierName,
  isBelowReorderPoint: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const createdProduct: InventoryItem = {
  ...gloveItem,
  id: "item-created",
  masterCatalogItemId: "master-created",
  masterSku: "UNKNOWN-CODE",
  barcodeValue: "UNKNOWN-CODE",
  name: "New Receiving Product",
  quantityOnHand: 0,
  stockUnit: "Unit",
  receivingUnit: "Box",
  unitsPerReceivingUnit: 1,
  unitOfMeasure: "Unit",
};

function renderReceivingPage() {
  return render(
    <MemoryRouter initialEntries={["/inventory/receiving"]}>
      <InventoryReceivingPage />
    </MemoryRouter>,
  );
}

function getQuantityReceivedInput(index: number): HTMLElement {
  const input = screen.getAllByLabelText(/Quantity received/)[index];
  if (!input) {
    throw new Error(`Quantity received input at index ${String(index)} was not found`);
  }
  return input;
}

describe("InventoryReceivingPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createManagerUser());
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockListInventory.mockReset();
    mockListSuppliers.mockReset();
    mockReceiveInventory.mockReset();
    mockCreateProduct.mockReset();
    mockListInventory.mockResolvedValue([burItem, gloveItem]);
    mockListSuppliers.mockResolvedValue([supplier]);
    mockReceiveInventory.mockResolvedValue({
      item: { ...burItem, quantityOnHand: 15 },
      adjustment: {
        id: "adj-1",
        clinicId: TEST_CLINIC_ID,
        clinicInventoryItemId: burItem.id,
        masterCatalogItemId: burItem.masterCatalogItemId,
        adjustmentType: "receive",
        quantityDelta: 3,
        quantityBefore: 12,
        quantityAfter: 15,
        reason: "Stock received",
        performedByUserId: "manager-1",
        performedByEmail: "manager@clinic.test",
        referenceId: null,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    });
    mockCreateProduct.mockResolvedValue({
      masterItem: {
        id: createdProduct.masterCatalogItemId,
        sku: createdProduct.masterSku,
        name: createdProduct.name,
      },
      barcodeMapping: {
        barcodeValue: createdProduct.masterSku,
        barcodeFormat: "code128",
      },
      clinicItem: createdProduct,
    });
  });

  it("renders the supplier dropdown and receiving controls", async () => {
    renderReceivingPage();

    expect(await screen.findByRole("heading", { name: "Receive Stock" })).toBeInTheDocument();
    expect(screen.getByLabelText("Supplier *")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DentalCo AU" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice/reference number")).toBeInTheDocument();
    expect(screen.getByLabelText("Barcode")).toBeInTheDocument();
    expect(screen.getByLabelText("Product search/select")).toBeInTheDocument();
  });

  it("shows the no suppliers empty state", async () => {
    mockListSuppliers.mockResolvedValue([]);

    renderReceivingPage();

    expect(await screen.findByText("No suppliers have been created yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Please create a supplier before receiving stock."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create supplier" })).toHaveAttribute(
      "href",
      "/suppliers",
    );
  });

  it("adds a product by search/select", async () => {
    renderReceivingPage();

    await screen.findByText("Diamond Burs FG Round #2 (Pack 5)");
    fireEvent.change(screen.getByLabelText("Product search/select"), {
      target: { value: "gloves" },
    });
    fireEvent.change(getQuantityReceivedInput(1), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Nitrile Examination Gloves/i }));

    expect(screen.getByText("Receiving line items")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity received for Nitrile Examination Gloves (Box 100)"))
      .toHaveValue(4);
    expect(screen.getByText("40 Box")).toBeInTheDocument();
    expect(screen.getByText("43 Box")).toBeInTheDocument();
  });

  it("adds a product by barcode", async () => {
    renderReceivingPage();

    await screen.findByText("Diamond Burs FG Round #2 (Pack 5)");
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });

    const productCard = await screen.findByLabelText("Product found");
    expect(within(productCard).getByText("VRV-BUR-001")).toBeInTheDocument();
    expect(within(productCard).getByText("9301234567891")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));

    expect(screen.getByLabelText("Quantity received for Diamond Burs FG Round #2 (Pack 5)"))
      .toHaveValue(1);
    expect(screen.getByText("6 Pack")).toBeInTheDocument();
    expect(screen.getByText("18 Pack")).toBeInTheDocument();
  });

  it("creates an unknown barcode product and continues receiving", async () => {
    renderReceivingPage();

    await screen.findByLabelText("Supplier *");
    fireEvent.change(screen.getByLabelText("Supplier *"), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "UNKNOWN-CODE" },
    });

    expect(await screen.findByText("Unknown barcode")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Product Name *"), {
      target: { value: "New Receiving Product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({
          sku: "UNKNOWN-CODE",
          barcodeValue: "UNKNOWN-CODE",
          stockUnit: "Unit",
          receivingUnit: "Box",
          unitsPerReceivingUnit: 1,
          supplierId: supplier.id,
        }),
      );
    });
    expect(await screen.findByLabelText("Product found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));
    expect(screen.getByLabelText("Quantity received for New Receiving Product")).toHaveValue(1);
  });

  it("validates quantities and blocks finishing with no items", async () => {
    renderReceivingPage();

    await screen.findByLabelText("Supplier *");
    fireEvent.click(screen.getByRole("button", { name: "Finish receiving" }));
    expect(await screen.findByText("Supplier is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Supplier *"), { target: { value: supplier.id } });
    fireEvent.click(screen.getByRole("button", { name: "Finish receiving" }));
    expect(
      await screen.findByText("Add at least one received item before finishing."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });
    await screen.findByLabelText("Product found");
    fireEvent.change(getQuantityReceivedInput(0), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));
    expect(await screen.findByText("Quantity must be a positive whole number.")).toBeInTheDocument();
  });

  it("finishes receiving and applies stock increases", async () => {
    renderReceivingPage();

    await screen.findByLabelText("Supplier *");
    fireEvent.change(screen.getByLabelText("Supplier *"), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText("Invoice/reference number"), {
      target: { value: "INV-1024" },
    });
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "9301234567891" },
    });
    await screen.findByLabelText("Product found");
    fireEvent.change(getQuantityReceivedInput(0), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish receiving" }));

    await waitFor(() => {
      expect(mockReceiveInventory).toHaveBeenCalledTimes(1);
    });
    const adjustCalls = mockReceiveInventory.mock.calls as unknown as Array<
      [string, { itemId: string; quantityDelta: number; reason?: string }]
    >;
    const firstAdjustCall = adjustCalls[0];
    if (!firstAdjustCall) {
      throw new Error("Expected inventory adjustment to be called");
    }
    expect(firstAdjustCall[0]).toBe(TEST_CLINIC_ID);
    expect(firstAdjustCall[1]).toEqual(
      expect.objectContaining({
        itemId: burItem.id,
          quantityDelta: 18,
      }),
    );
    expect(firstAdjustCall[1].reason).toContain("Reference: INV-1024");
    expect(await screen.findByText("Stock received successfully.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive another delivery" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Inventory" })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });
});

// ── Invoice-linked receiving ───────────────────────────────────────────────────

const INVOICE_ID = "inv-aaaa-1111-4000-8000-000000000001";

const sampleInvoice = {
  id: INVOICE_ID,
  clinicId: TEST_CLINIC_ID,
  supplierId: "supplier-1",
  supplierNameRaw: "DentalCo AU",
  invoiceNumber: "INV-TEST-001",
  invoiceDate: "2026-07-01",
  dueDate: null,
  status: "imported",
  subtotalCents: 10000,
  taxCents: 1000,
  totalCents: 11000,
  currency: "AUD",
  ocrProvider: "stub",
  ocrConfidence: 95,
  originalFilename: "invoice.pdf",
  fileMimeType: "application/pdf",
  importedByUserId: "user-1",
  importedByEmail: "admin@clinic.com",
  confirmedByUserId: "user-1",
  confirmedAt: "2026-07-02T00:00:00.000Z",
  voidedByUserId: null,
  voidedAt: null,
  receivedAt: null,
  receivedByUserId: null,
  receivedReference: null,
  notes: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
};

describe("InventoryReceivingPage — invoice-linked receiving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthenticatedUser(authTestState, createManagerUser());
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockListInventory.mockResolvedValue([burItem, gloveItem]);
    mockListSuppliers.mockResolvedValue([supplier]);
    mockGetSupplierInvoice.mockResolvedValue({ invoice: sampleInvoice, lines: [] });
  });

  it("8. Correct invoiceId is submitted when receiving against an invoice", async () => {
    mockReceiveSupplierInvoice.mockResolvedValue({
      invoice: { ...sampleInvoice, receivedAt: "2026-07-21T10:00:00.000Z" },
      adjustments: [],
      receivedAt: "2026-07-21T10:00:00.000Z",
      receivedBy: "admin@clinic.com",
    });

    render(
      <MemoryRouter initialEntries={[`/inventory/receive?invoiceId=${INVOICE_ID}`]}>
        <InventoryReceivingPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText("Supplier *");
    fireEvent.change(screen.getByLabelText("Supplier *"), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: burItem.barcodeValue ?? burItem.masterSku },
    });
    await screen.findByLabelText("Product found");
    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish receiving" }));

    await waitFor(() => {
      expect(mockReceiveSupplierInvoice).toHaveBeenCalledTimes(1);
    });
    const calls = mockReceiveSupplierInvoice.mock.calls as unknown as Array<
      [string, string, { lines: unknown[]; receivedReference: unknown }]
    >;
    const firstCall = calls[0];
    expect(firstCall?.[0]).toBe(TEST_CLINIC_ID);
    expect(firstCall?.[1]).toBe(INVOICE_ID);
    expect(firstCall?.[2].lines).toHaveLength(1);
    expect(await screen.findByText("Stock received successfully.")).toBeInTheDocument();
  });

  it("4. Duplicate receive conflict shows clear message", async () => {
    // After a 409 conflict the page reloads the invoice (which now has receivedAt set)
    // and transitions to the full-page "already received" guard — which is the clearest
    // possible duplicate-receiving message.
    const alreadyReceivedError = new Error(
      "This invoice has already been received. Receiving cannot be repeated.",
    );
    mockReceiveSupplierInvoice.mockRejectedValue(alreadyReceivedError);
    mockGetSupplierInvoice
      .mockResolvedValueOnce({ invoice: sampleInvoice, lines: [] })
      .mockResolvedValue({
        invoice: { ...sampleInvoice, receivedAt: "2026-07-21T08:00:00.000Z" },
        lines: [],
      });

    render(
      <MemoryRouter initialEntries={[`/inventory/receive?invoiceId=${INVOICE_ID}`]}>
        <InventoryReceivingPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText("Supplier *");
    fireEvent.change(screen.getByLabelText("Supplier *"), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: burItem.barcodeValue ?? burItem.masterSku },
    });
    await screen.findByLabelText("Product found");
    fireEvent.click(screen.getByRole("button", { name: "Add received item" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish receiving" }));

    // The page transitions to the full-page "already received" guard — this IS the clear
    // conflict message. The "Finish receiving" button disappears (duplicate is blocked).
    expect(
      await screen.findByText("This invoice has already been received."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish receiving" })).not.toBeInTheDocument();
  });

  it("1. Already-received invoice shows received state and disables flow", async () => {
    const receivedInvoice = {
      ...sampleInvoice,
      receivedAt: "2026-07-21T08:00:00.000Z",
    };
    mockGetSupplierInvoice.mockResolvedValue({ invoice: receivedInvoice, lines: [] });

    render(
      <MemoryRouter initialEntries={[`/inventory/receive?invoiceId=${INVOICE_ID}`]}>
        <InventoryReceivingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("This invoice has already been received.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish receiving" })).not.toBeInTheDocument();
  });

  it("6. All Clinics scope shows clinic-selection message", async () => {
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };

    render(
      <MemoryRouter initialEntries={[`/inventory/receive?invoiceId=${INVOICE_ID}`]}>
        <InventoryReceivingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Select a clinic to receive stock")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish receiving" })).not.toBeInTheDocument();
  });
});
