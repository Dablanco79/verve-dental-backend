/**
 * LowStockPurchasingQueue.test.tsx
 *
 * Tests for unresolved Purchasing Draft product display.
 *
 * Required tests (per Final Pre-Pilot UX Polish spec):
 *
 *   TEST 1 — Partial Purchasing Draft: resolved products summary shown
 *   TEST 2 — Product names rendered for unresolved items
 *   TEST 3 — SKU rendered when available
 *   TEST 4 — Reason displayed per unresolved item
 *   TEST 5 — Multiple unresolved products display correctly
 *   TEST 6 — No unresolved products → warning panel not displayed
 *
 * Regression tests from BLOCKER 2 (preserved):
 *   — PD reference is navigable
 *   — All-unresolved: no Create PD button, no API call
 *   — Fully resolved: navigates to PD page
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LowStockPurchasingQueue } from "../src/components/purchasing/LowStockPurchasingQueue.js";
import type { InventoryItem, UnresolvedSupplierGroupItem } from "../src/types/inventory.js";
import type { Supplier } from "../src/types/supplier.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockCreatePurchasingDraft, mockListPurchaseOrderHeaders } = vi.hoisted(() => ({
  mockCreatePurchasingDraft: vi.fn(),
  mockListPurchaseOrderHeaders: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    createPurchasingDraft: mockCreatePurchasingDraft,
    listPurchaseOrderHeaders: mockListPurchaseOrderHeaders,
  }),
}));

vi.mock("../src/config/index.js", () => ({
  loadConfig: () => ({ apiUrl: "http://test" }),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";

let itemCounter = 0;
function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  itemCounter += 1;
  return {
    id: `item-${String(itemCounter)}`,
    clinicId: CLINIC_ID,
    masterCatalogItemId: `cat-${String(itemCounter)}`,
    masterSku: "VRV-GLV-001",
    name: "Nitrile Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    stockUnit: "Box",
    receivingUnit: "Carton",
    unitsPerReceivingUnit: 10,
    quantityOnHand: 2,
    reorderPoint: 5,
    unitCostCents: 1899,
    unitCostOverrideCents: null,
    supplierPreference: "DentalCo AU",
    preferredSupplierId: "supplier-1",
    preferredSupplierName: "DentalCo AU",
    isBelowReorderPoint: true,
    inDraftQuantity: 0,
    onOrderQuantity: 0,
    activePurchasingDocuments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const makeSupplier = (id: string, name: string): Supplier => ({
  id,
  supplierName: name,
  supplierCode: null,
  contactName: null,
  email: null,
  phone: null,
  website: null,
  abn: null,
  address: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  legalName: null,
  tradingName: null,
  countryCode: "AU",
  currencyCode: "AUD",
  industryCategory: null,
  healthcareSubcategory: null,
  supplierCategory: null,
  verified: false,
  apiAvailable: false,
  catalogueAvailable: false,
  livePricing: false,
  onlineOrdering: false,
  preferredCommMethod: null,
  logoStorageKey: null,
  createdByClinicId: null,
  isPublic: false,
});

const suppliersData: Supplier[] = [
  makeSupplier("supplier-1", "DentalCo AU"),
  makeSupplier("supplier-2", "BurDirect"),
];

/** Build a fully-enriched UnresolvedSupplierGroupItem (new format). */
function makeUnresolvedItem(overrides: Partial<UnresolvedSupplierGroupItem> = {}): UnresolvedSupplierGroupItem {
  return {
    masterCatalogItemId: "cat-unresolved-001",
    clinicInventoryItemId: "inv-unresolved-001",
    productName: "Prophy Paste Mint",
    sku: "PPM-001",
    reason: "No supplier relationship configured.",
    ...overrides,
  };
}

function renderQueue(items: InventoryItem[]) {
  return render(
    <MemoryRouter initialEntries={["/inventory"]}>
      <Routes>
        <Route
          path="/inventory"
          element={
            <LowStockPurchasingQueue
              clinicId={CLINIC_ID}
              items={items}
              suppliers={suppliersData}
              isLoading={false}
            />
          }
        />
        <Route
          path="/purchasing-drafts/:pdId"
          element={<div data-testid="pd-page">Purchasing Draft</div>}
        />
        <Route
          path="/inventory/products/:productId"
          element={<div data-testid="product-detail-page">Product Detail</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function selectAllAndCreateDraft() {
  const selectAllCheckbox = screen.getByLabelText(/Select all eligible/i);
  fireEvent.click(selectAllCheckbox);
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Create Purchasing Draft/i })).not.toBeNull();
  });
  fireEvent.click(screen.getByRole("button", { name: /Create Purchasing Draft/i }));
}

/** Builds a standard partial PD API response with the given unresolved items. */
function makePartialPdResponse(unresolvedItems: UnresolvedSupplierGroupItem[]) {
  return {
    purchasingDraft: {
      id: "pd-partial-001",
      clinicId: CLINIC_ID,
      draftReference: "PD-20260728-0001",
      createdByUserId: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    childPos: [{ purchaseOrder: { id: "po-001", status: "draft" }, lines: [] }],
    unresolvedGroups: [
      {
        supplierName: "No supplier assigned",
        lineCount: unresolvedItems.length,
        items: unresolvedItems,
      },
    ],
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreatePurchasingDraft.mockReset();
  mockListPurchaseOrderHeaders.mockReset();
});

// ─── TEST 1 — Partial Purchasing Draft: resolved products summary shown ───────

describe("TEST 1: Partial Purchasing Draft — resolved products summary", () => {
  it("shows 'Purchasing Draft created successfully' and the resolved product count", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([makeUnresolvedItem()]),
    );

    await selectAllAndCreateDraft();

    expect(await screen.findByTestId("draft-created-result")).toBeInTheDocument();
    // "Purchasing Draft created successfully." heading
    expect(screen.getByText(/Purchasing Draft created successfully/i)).toBeInTheDocument();
    // Shows resolved count — 1 child PO = 1 product resolved
    expect(screen.getByText(/1 product was added to supplier purchase orders/i)).toBeInTheDocument();
  });

  it("shows the PD reference as a navigable link to the purchasing draft", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue({
      ...makePartialPdResponse([makeUnresolvedItem()]),
      purchasingDraft: {
        id: "pd-0000042",
        clinicId: CLINIC_ID,
        draftReference: "PD-20260728-0042",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    await selectAllAndCreateDraft();

    const pdLink = await screen.findByTestId("draft-created-link");
    expect(pdLink).toBeInTheDocument();
    expect(pdLink.textContent).toBe("PD-20260728-0042");
    expect(pdLink).toHaveAttribute("href", "/purchasing-drafts/pd-0000042");
  });
});

// ─── TEST 2 — Product names rendered ─────────────────────────────────────────

describe("TEST 2: Product names rendered for unresolved items", () => {
  it("renders the product name for each unresolved item", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({ productName: "Prophy Paste Mint", sku: "PPM-001" }),
      ]),
    );

    await selectAllAndCreateDraft();

    expect(await screen.findByText("Prophy Paste Mint")).toBeInTheDocument();
  });

  it("product name is rendered as a link to the product detail page", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({
          productName: "Etch Gel 37%",
          clinicInventoryItemId: "inv-etch-gel",
        }),
      ]),
    );

    await selectAllAndCreateDraft();

    const link = await screen.findByTestId("unresolved-product-link");
    expect(link.textContent).toBe("Etch Gel 37%");
    expect(link).toHaveAttribute("href", "/inventory/products/inv-etch-gel");
  });
});

// ─── TEST 3 — SKU rendered when available ────────────────────────────────────

describe("TEST 3: SKU rendered when available", () => {
  it("renders the SKU when an unresolved item has a SKU", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({ productName: "Prophy Paste Mint", sku: "PPM-001" }),
      ]),
    );

    await selectAllAndCreateDraft();

    const skuEl = await screen.findByTestId("unresolved-product-sku");
    expect(skuEl).toBeInTheDocument();
    expect(skuEl.textContent).toMatch(/PPM-001/);
  });

  it("does not render a SKU element when sku is null", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({ sku: null }),
      ]),
    );

    await selectAllAndCreateDraft();

    await screen.findByTestId("unresolved-groups-notice");
    expect(screen.queryByTestId("unresolved-product-sku")).not.toBeInTheDocument();
  });
});

// ─── TEST 4 — Reason displayed ───────────────────────────────────────────────

describe("TEST 4: Reason displayed per unresolved item", () => {
  it("renders the reason text for each unresolved item", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({ reason: "No supplier relationship configured." }),
      ]),
    );

    await selectAllAndCreateDraft();

    const reasonEl = await screen.findByTestId("unresolved-product-reason");
    expect(reasonEl).toBeInTheDocument();
    expect(reasonEl.textContent).toMatch(/No supplier relationship configured/i);
  });
});

// ─── TEST 5 — Multiple unresolved products display correctly ──────────────────

describe("TEST 5: Multiple unresolved products display correctly", () => {
  it("renders one list item per unresolved product when multiple exist", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({
          masterCatalogItemId: "cat-u-1",
          clinicInventoryItemId: "inv-u-1",
          productName: "Prophy Paste Mint",
          sku: "PPM-001",
        }),
        makeUnresolvedItem({
          masterCatalogItemId: "cat-u-2",
          clinicInventoryItemId: "inv-u-2",
          productName: "Etch Gel 37%",
          sku: "EG-210",
        }),
      ]),
    );

    await selectAllAndCreateDraft();

    const items = await screen.findAllByTestId("unresolved-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Prophy Paste Mint")).toBeInTheDocument();
    expect(screen.getByText("Etch Gel 37%")).toBeInTheDocument();
    expect(screen.getByText(/PPM-001/)).toBeInTheDocument();
    expect(screen.getByText(/EG-210/)).toBeInTheDocument();
  });

  it("shows the correct total count in the header when multiple unresolved products exist", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    mockCreatePurchasingDraft.mockResolvedValue(
      makePartialPdResponse([
        makeUnresolvedItem({ masterCatalogItemId: "cat-u-1", clinicInventoryItemId: "inv-u-1", productName: "Product A", sku: "A-001" }),
        makeUnresolvedItem({ masterCatalogItemId: "cat-u-2", clinicInventoryItemId: "inv-u-2", productName: "Product B", sku: "B-002" }),
      ]),
    );

    await selectAllAndCreateDraft();

    await screen.findByTestId("unresolved-groups-notice");
    // "The following 2 products require supplier assignment before they can be ordered:"
    expect(screen.getByText(/2 products require/i)).toBeInTheDocument();
  });
});

// ─── TEST 6 — No unresolved products → warning panel not displayed ───────────

describe("TEST 6: No unresolved products — warning panel not shown", () => {
  it("does not render the unresolved-groups-notice when unresolvedGroups is empty", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    // Fully resolved — unresolvedGroups is empty
    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: {
        id: "pd-fully-resolved",
        clinicId: CLINIC_ID,
        draftReference: "PD-20260728-9999",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [{ purchaseOrder: { id: "po-001", status: "draft" }, lines: [] }],
      unresolvedGroups: [],
    });

    await selectAllAndCreateDraft();

    // Fully resolved → navigates to PD page; inline result not shown
    expect(await screen.findByTestId("pd-page")).toBeInTheDocument();
    expect(screen.queryByTestId("unresolved-groups-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("draft-created-result")).not.toBeInTheDocument();
  });

  it("does not render unresolved-groups-notice when unresolvedGroups is absent from response", async () => {
    const resolvedItem = makeItem({ preferredSupplierId: "supplier-1" });
    renderQueue([resolvedItem]);

    // API response with no unresolvedGroups field at all (legacy/minimal response)
    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: {
        id: "pd-minimal",
        clinicId: CLINIC_ID,
        draftReference: "PD-20260728-0000",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [{ purchaseOrder: { id: "po-001", status: "draft" }, lines: [] }],
      // unresolvedGroups absent
    });

    await selectAllAndCreateDraft();

    expect(await screen.findByTestId("pd-page")).toBeInTheDocument();
    expect(screen.queryByTestId("unresolved-groups-notice")).not.toBeInTheDocument();
  });
});

// ─── Regression: all-unresolved / navigable PD / no create button ────────────

describe("Regression — previously tested behaviours", () => {
  it("does not show Create Purchasing Draft button and makes no API call when all items lack a supplier", async () => {
    const noSupplierItem = makeItem({
      preferredSupplierId: null,
      supplierPreference: null,
    });
    renderQueue([noSupplierItem]);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Create Purchasing Draft/i }),
      ).not.toBeInTheDocument();
    });
    expect(mockCreatePurchasingDraft).not.toHaveBeenCalled();
  });
});
