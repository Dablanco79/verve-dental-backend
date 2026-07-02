import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDetailPage } from "../src/pages/ProductDetailPage.js";
import type { InventoryAdjustment, InventoryItem } from "../src/types/inventory.js";
import {
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
  mockGetInventoryItem,
  mockListAdjustments,
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
    mockGetInventoryItem: vi.fn(),
    mockListAdjustments: vi.fn(),
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
    getInventoryItem: mockGetInventoryItem,
    listAdjustments: mockListAdjustments,
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

const productWithSupplier: InventoryItem = {
  id: "e1111111-1111-4111-8111-111111111111",
  clinicId: TEST_CLINIC_ID,
  masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
  masterSku: "VRV-GLV-001",
  barcodeValue: "9301234567890",
  name: "Nitrile Examination Gloves (Box 100)",
  category: "PPE",
  stockUnit: "box",
  receivingUnit: "carton",
  unitsPerReceivingUnit: 10,
  unitOfMeasure: "box",
  quantityOnHand: 3,
  reorderPoint: 5,
  unitCostCents: 1799,
  unitCostOverrideCents: 1799,
  supplierPreference: "DentalCo AU",
  preferredSupplierId: "supplier-1",
  preferredSupplierName: "DentalCo AU",
  isBelowReorderPoint: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const stockReceivedAdjustment: InventoryAdjustment = {
  id: "a1111111-1111-4111-8111-111111111111",
  clinicId: TEST_CLINIC_ID,
  clinicInventoryItemId: productWithSupplier.id,
  masterCatalogItemId: productWithSupplier.masterCatalogItemId,
  adjustmentType: "receive",
  quantityDelta: 20,
  quantityBefore: 3,
  quantityAfter: 23,
  reason: "Stock received",
  performedByUserId: "user-1",
  performedByEmail: "daniel@example.com",
  referenceId: null,
  createdAt: "2026-06-30T01:00:00.000Z",
};

const stockAdjustment: InventoryAdjustment = {
  id: "a2222222-2222-4222-8222-222222222222",
  clinicId: TEST_CLINIC_ID,
  clinicInventoryItemId: productWithSupplier.id,
  masterCatalogItemId: productWithSupplier.masterCatalogItemId,
  adjustmentType: "manual_adjust",
  quantityDelta: -2,
  quantityBefore: 23,
  quantityAfter: 21,
  reason: "Expired stock",
  performedByUserId: "user-1",
  performedByEmail: "daniel@example.com",
  referenceId: null,
  createdAt: "2026-07-01T01:00:00.000Z",
};

function renderProductDetail(productId = productWithSupplier.id) {
  return render(
    <MemoryRouter initialEntries={[`/inventory/products/${productId}`]}>
      <Routes>
        <Route path="/inventory/products/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProductDetailPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createManagerUser());
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    mockGetInventoryItem.mockReset();
    mockGetInventoryItem.mockResolvedValue(productWithSupplier);
    mockListAdjustments.mockReset();
    mockListAdjustments.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
  });

  it("loads product detail successfully from the existing inventory API", async () => {
    renderProductDetail();

    expect(await screen.findByRole("heading", { name: productWithSupplier.name })).toBeInTheDocument();
    expect(mockGetInventoryItem).toHaveBeenCalledWith(TEST_CLINIC_ID, productWithSupplier.id);
    expect(mockListAdjustments).toHaveBeenCalledWith(TEST_CLINIC_ID, {
      itemId: productWithSupplier.id,
      limit: 100,
      offset: 0,
    });
    expect(screen.getAllByText("VRV-GLV-001")).not.toHaveLength(0);
    expect(screen.getAllByText("9301234567890")).not.toHaveLength(0);
    expect(screen.getAllByText("PPE")).not.toHaveLength(0);
    expect(screen.getAllByText("box")).not.toHaveLength(0);
  });

  it("shows Product not found when the inventory API cannot load the item", async () => {
    mockGetInventoryItem.mockRejectedValue(new Error("Not found"));

    renderProductDetail("missing-product");

    expect(await screen.findByText("Product not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Inventory" })).toHaveAttribute("href", "/inventory");
  });

  it("renders the Product Created timeline event from the product record", async () => {
    renderProductDetail();

    const timelineHeading = await screen.findByRole("heading", { name: "Product Timeline" });
    const timeline = timelineHeading.closest("section");
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByRole("heading", { name: "Product Created" })).toBeInTheDocument();
  });

  it("loads product-created timeline activity for clinical staff without adjustment history access", async () => {
    setAuthenticatedUser(authTestState, createStaffUser());

    renderProductDetail();

    const timelineHeading = await screen.findByRole("heading", { name: "Product Timeline" });
    const timeline = timelineHeading.closest("section");
    expect(timeline).not.toBeNull();
    expect(mockListAdjustments).not.toHaveBeenCalled();
    expect(within(timeline as HTMLElement).getByRole("heading", { name: "Product Created" })).toBeInTheDocument();
  });

  it("renders stock received and adjustment events from adjustment history", async () => {
    mockListAdjustments.mockResolvedValue({
      items: [stockAdjustment, stockReceivedAdjustment],
      total: 2,
      limit: 100,
      offset: 0,
    });

    renderProductDetail();

    const timelineHeading = await screen.findByRole("heading", { name: "Product Timeline" });
    const timeline = timelineHeading.closest("section");
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByRole("heading", { name: "Stock Received" })).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText("+20 boxes")).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByRole("heading", { name: "Inventory Adjustment" })).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText("-2 boxes")).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText("Expired stock")).toBeInTheDocument();
  });

  it("shows the empty timeline state when no activity exists", async () => {
    mockGetInventoryItem.mockResolvedValue({
      ...productWithSupplier,
      createdAt: "",
    });

    renderProductDetail();

    expect(
      await screen.findByText("No activity has been recorded for this product."),
    ).toBeInTheDocument();
  });

  it("displays the preferred supplier when available", async () => {
    renderProductDetail();

    const supplierCard = await screen.findByRole("heading", { name: "Supplier" });
    const card = supplierCard.closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getAllByText("DentalCo AU")).not.toHaveLength(0);
  });

  it("shows the empty supplier state when no supplier is assigned", async () => {
    mockGetInventoryItem.mockResolvedValue({
      ...productWithSupplier,
      supplierPreference: null,
      preferredSupplierId: null,
      preferredSupplierName: null,
    });

    renderProductDetail();

    expect(await screen.findAllByText("No preferred supplier assigned.")).not.toHaveLength(0);
  });

  it("renders the stock status badge using existing inventory status logic", async () => {
    renderProductDetail();

    expect(await screen.findAllByText("Low Stock")).not.toHaveLength(0);
  });

  it("renders future timeline event placeholders without fabricated data", async () => {
    renderProductDetail();

    expect(await screen.findByRole("heading", { name: "Future Timeline Events" })).toBeInTheDocument();
    for (const feature of [
      "Purchase Orders",
      "OCR",
      "Forecast",
      "Transfers",
      "Cycle Counts",
    ]) {
      const heading = screen.getByRole("heading", { name: feature });
      const card = heading.closest("article");
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText("Available in a future release.")).toBeInTheDocument();
    }
  });
});
