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
 *
 * Pilot Correction Sprint — Workflow 1.1 Low Stock Product Selection Blocker:
 *
 *   SPRINT TEST 1  — Multiple product selection (only selected items in payload)
 *   SPRINT TEST 2  — Select all / clear (Create button disabled with zero selection)
 *   SPRINT TEST 5  — Quantity editing recalculates line total, supplier subtotal, overall total
 *   SPRINT TEST 6  — Multi-supplier selection produces correct supplier groups in payload
 *   SPRINT TEST 7  — Unresolved supplier: resolved group proceeds, unresolved excluded
 *   SPRINT TEST 8  — All unresolved: Create PD blocked, message shown
 *   SPRINT TEST 10 — Selection persistence: edited qty preserved after deselecting another item
 *   SPRINT TEST 11 — No duplicate creation: button disabled during save
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

function renderQueue(items: InventoryItem[], initialSelectedId?: string) {
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
              initialSelectedId={initialSelectedId}
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

// ═══════════════════════════════════════════════════════════════════════════════
// PILOT CORRECTION SPRINT — Workflow 1.1 Low Stock Product Selection Blocker
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SPRINT TEST 1 — Multiple product selection ───────────────────────────────

describe("SPRINT TEST 1: Multiple product selection — only selected items in payload", () => {
  it("only includes selected items A and C in the createPurchasingDraft payload, not B", async () => {
    // Three eligible items: A and C selected, B left unchecked.
    const itemA = makeItem({
      id: "sprint1-item-a",
      name: "Product A",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const itemB = makeItem({
      id: "sprint1-item-b",
      name: "Product B",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const itemC = makeItem({
      id: "sprint1-item-c",
      name: "Product C",
      preferredSupplierId: "supplier-2",
      preferredSupplierName: "BurDirect",
      quantityOnHand: 0,
      reorderPoint: 3,
      onOrderQuantity: 0,
    });

    const pdResult = {
      purchasingDraft: {
        id: "pd-sprint1",
        clinicId: CLINIC_ID,
        draftReference: "PD-SPRINT1",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      childPos: [{ purchaseOrder: { id: "po-s1", status: "draft" }, lines: [] }],
      unresolvedGroups: [],
    };
    mockCreatePurchasingDraft.mockResolvedValue(pdResult);

    renderQueue([itemA, itemB, itemC]);

    // Select only A and C (by clicking their individual checkboxes).
    // Items are sorted alphabetically by name in the list.
    const checkboxes = await screen.findAllByRole("checkbox");
    // checkboxes[0] = select-all, checkboxes[1..n] = individual items (sorted by name: A, B, C)
    // We click A (index 1) and C (index 3).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.click(checkboxes[1]!); // Product A
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.click(checkboxes[3]!); // Product C

    // Confirm Create button is visible.
    const createBtn = await screen.findByRole("button", { name: /Create Purchasing Draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreatePurchasingDraft).toHaveBeenCalledTimes(1);
      const call = mockCreatePurchasingDraft.mock.calls[0] as unknown[];
      const body = call[1] as {
        supplierGroups: Array<{ supplierId: string; lines: Array<{ clinicInventoryItemId: string }> }>;
      };
      const allSentIds = body.supplierGroups.flatMap((g) => g.lines.map((l) => l.clinicInventoryItemId));
      expect(allSentIds).toContain("sprint1-item-a");
      expect(allSentIds).toContain("sprint1-item-c");
      expect(allSentIds).not.toContain("sprint1-item-b");
    });
  });
});

// ─── SPRINT TEST 2 — Select all / clear ──────────────────────────────────────

describe("SPRINT TEST 2: Select all / clear — Create button disabled with zero selection", () => {
  it("select all checks all eligible items", async () => {
    const items = [
      makeItem({ id: "s2-a", name: "Item A", preferredSupplierId: "supplier-1", quantityOnHand: 0, reorderPoint: 2 }),
      makeItem({ id: "s2-b", name: "Item B", preferredSupplierId: "supplier-1", quantityOnHand: 0, reorderPoint: 2 }),
    ];
    renderQueue(items);

    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    // All individual checkboxes should be checked.
    const allCbs = screen.getAllByRole("checkbox");
    const itemCbs = allCbs.filter((cb) => cb !== selectAll);
    itemCbs.forEach((cb) => { expect((cb as HTMLInputElement).checked).toBe(true); });
  });

  it("clear selection unchecks all items", async () => {
    const items = [
      makeItem({ id: "s2-c", name: "Item C", preferredSupplierId: "supplier-1", quantityOnHand: 0, reorderPoint: 2 }),
      makeItem({ id: "s2-d", name: "Item D", preferredSupplierId: "supplier-1", quantityOnHand: 0, reorderPoint: 2 }),
    ];
    renderQueue(items);

    // Select all then deselect all (clicking checked select-all again).
    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll); // select all
    fireEvent.click(selectAll); // deselect all

    // No individual checkboxes should be checked.
    const allCbs = screen.getAllByRole("checkbox");
    const itemCbs = allCbs.filter((cb) => cb !== selectAll);
    itemCbs.forEach((cb) => { expect((cb as HTMLInputElement).checked).toBe(false); });
  });

  it("Create Purchasing Draft button is not shown when no items are selected", () => {
    const item = makeItem({ id: "s2-e", preferredSupplierId: "supplier-1", quantityOnHand: 0, reorderPoint: 2 });
    renderQueue([item]);

    // No selection → Create button must be absent.
    expect(screen.queryByRole("button", { name: /Create Purchasing Draft/i })).not.toBeInTheDocument();
  });
});

// ─── SPRINT TEST 5 — Quantity editing ────────────────────────────────────────

describe("SPRINT TEST 5: Quantity editing recalculates totals and payload uses edited qty", () => {
  it("changing the order quantity updates the line total and overall total", async () => {
    // item: stock=Box, receiving=Carton, 10/Carton, $8/Box → $80/Carton
    // shortfall = 10-0-0 = 10; suggest = ceil(10/10) = 1 Carton
    // default line total = 1 × 10 × 800 = 8000 = $80.00
    const item = makeItem({
      id: "s5-item-a",
      name: "Sprint5 Item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 10,
      onOrderQuantity: 0,
    });
    renderQueue([item]);

    // Select the item.
    const cb = await screen.findByRole("checkbox", { name: "" });
    fireEvent.click(cb);

    // Default estimated line total is $80.00.
    await waitFor(() => {
      expect(screen.getAllByText(/\$80\.00/i).length).toBeGreaterThan(0);
    });

    // Change qty to 3 → line total = 3 × 10 × 800 = 24000 = $240.00.
    const qtyInput = screen.getByRole("spinbutton", { name: /Qty to order for Sprint5 Item/i });
    fireEvent.change(qtyInput, { target: { value: "3" } });

    await waitFor(() => {
      expect(screen.getAllByText(/\$240\.00/i).length).toBeGreaterThan(0);
    });

    // Overall estimated total (in group summary) also updates to $240.00.
    const overallTotal = screen.getByTestId("overall-estimated-total");
    expect(overallTotal).toHaveTextContent("$240.00");
  });

  it("payload uses edited quantity, not the suggested quantity", async () => {
    const item = makeItem({
      id: "s5-item-b",
      name: "Sprint5 Payload Item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 10,
      onOrderQuantity: 0,
    });

    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: { id: "pd-s5", clinicId: CLINIC_ID, draftReference: "PD-S5", createdByUserId: "u1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      childPos: [],
      unresolvedGroups: [],
    });

    renderQueue([item]);

    const cb = await screen.findByRole("checkbox", { name: "" });
    fireEvent.click(cb);

    const qtyInput = screen.getByRole("spinbutton", { name: /Qty to order for Sprint5 Payload Item/i });
    fireEvent.change(qtyInput, { target: { value: "5" } });

    const createBtn = screen.getByRole("button", { name: /Create Purchasing Draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      const call = mockCreatePurchasingDraft.mock.calls[0] as unknown[];
      const body = call[1] as { supplierGroups: Array<{ lines: Array<{ quantity: number }> }> };
      const sentQty = body.supplierGroups[0]?.lines[0]?.quantity;
      expect(sentQty).toBe(5);
    });
  });
});

// ─── SPRINT TEST 6 — Multi-supplier selection ─────────────────────────────────

describe("SPRINT TEST 6: Multi-supplier selection — correct groups in payload", () => {
  it("groups selected items by supplier and creates two supplier POs", async () => {
    const itemA = makeItem({
      id: "s6-adam-1",
      name: "Item A",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const itemB = makeItem({
      id: "s6-adam-2",
      name: "Item B",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const itemC = makeItem({
      id: "s6-bur-1",
      name: "Item C",
      preferredSupplierId: "supplier-2",
      preferredSupplierName: "BurDirect",
      quantityOnHand: 0,
      reorderPoint: 3,
      onOrderQuantity: 0,
    });

    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: { id: "pd-s6", clinicId: CLINIC_ID, draftReference: "PD-S6", createdByUserId: "u1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      childPos: [
        { purchaseOrder: { id: "po-s6-1", status: "draft" }, lines: [] },
        { purchaseOrder: { id: "po-s6-2", status: "draft" }, lines: [] },
      ],
      unresolvedGroups: [],
    });

    renderQueue([itemA, itemB, itemC]);

    // Select all three items.
    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    // Two supplier groups should appear in the summary.
    await waitFor(() => {
      expect(screen.getByText(/2 supplier groups/i)).toBeInTheDocument();
    });

    const createBtn = screen.getByRole("button", { name: /Create Purchasing Draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      const call = mockCreatePurchasingDraft.mock.calls[0] as unknown[];
      const body = call[1] as { supplierGroups: Array<{ supplierId: string; lines: Array<{ clinicInventoryItemId: string }> }> };
      expect(body.supplierGroups).toHaveLength(2);

      const group1 = body.supplierGroups.find((g) => g.supplierId === "supplier-1");
      const group2 = body.supplierGroups.find((g) => g.supplierId === "supplier-2");
      expect(group1).toBeDefined();
      expect(group2).toBeDefined();

      const group1Ids = (group1?.lines ?? []).map((l) => l.clinicInventoryItemId);
      expect(group1Ids).toContain("s6-adam-1");
      expect(group1Ids).toContain("s6-adam-2");

      const group2Ids = (group2?.lines ?? []).map((l) => l.clinicInventoryItemId);
      expect(group2Ids).toContain("s6-bur-1");
    });
  });
});

// ─── SPRINT TEST 7 — Unresolved supplier ─────────────────────────────────────

describe("SPRINT TEST 7: Unresolved supplier — resolved group proceeds, unresolved excluded", () => {
  it("shows Supplier required warning for no-supplier item when both types selected", async () => {
    const withSupplier = makeItem({
      id: "s7-resolved",
      name: "Resolved Item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const noSupplier = makeItem({
      id: "s7-unresolved",
      name: "Unresolved Item",
      preferredSupplierId: null,
      supplierPreference: null,
      preferredSupplierName: null,
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });

    renderQueue([withSupplier, noSupplier]);

    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    // "Supplier required" warning shown for unresolved item.
    expect(screen.getAllByTestId("supplier-required").length).toBeGreaterThan(0);

    // The no-supplier warning appears in the group summary.
    await waitFor(() => {
      expect(screen.getByTestId("no-supplier-warning")).toBeInTheDocument();
    });

    // Create button still visible for the resolved group.
    expect(screen.getByRole("button", { name: /Create Purchasing Draft/i })).toBeInTheDocument();
  });

  it("payload only includes the resolved supplier group, not the no-supplier item", async () => {
    const withSupplier = makeItem({
      id: "s7-resolved-api",
      name: "Resolved API Item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });
    const noSupplier = makeItem({
      id: "s7-unresolved-api",
      name: "Unresolved API Item",
      preferredSupplierId: null,
      supplierPreference: null,
      preferredSupplierName: null,
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });

    mockCreatePurchasingDraft.mockResolvedValue({
      purchasingDraft: { id: "pd-s7", clinicId: CLINIC_ID, draftReference: "PD-S7", createdByUserId: "u1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      childPos: [{ purchaseOrder: { id: "po-s7", status: "draft" }, lines: [] }],
      unresolvedGroups: [],
    });

    renderQueue([withSupplier, noSupplier]);

    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    const createBtn = await screen.findByRole("button", { name: /Create Purchasing Draft/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      const call = mockCreatePurchasingDraft.mock.calls[0] as unknown[];
      const body = call[1] as { supplierGroups: Array<{ supplierId: string | null; lines: Array<{ clinicInventoryItemId: string }> }> };
      // Only one supplier group (resolved).
      expect(body.supplierGroups).toHaveLength(1);
      expect(body.supplierGroups[0]?.supplierId).toBe("supplier-1");
      const sentIds = body.supplierGroups[0]?.lines.map((l) => l.clinicInventoryItemId) ?? [];
      expect(sentIds).toContain("s7-resolved-api");
      expect(sentIds).not.toContain("s7-unresolved-api");
    });
  });
});

// ─── SPRINT TEST 8 — All unresolved ──────────────────────────────────────────

describe("SPRINT TEST 8: All unresolved — Create PD blocked, clear message shown", () => {
  it("does not show Create PD button when all selected items have no supplier", async () => {
    const noSupplierA = makeItem({ id: "s8-a", name: "No Supplier A", preferredSupplierId: null, supplierPreference: null, preferredSupplierName: null, quantityOnHand: 0, reorderPoint: 2, onOrderQuantity: 0 });
    const noSupplierB = makeItem({ id: "s8-b", name: "No Supplier B", preferredSupplierId: null, supplierPreference: null, preferredSupplierName: null, quantityOnHand: 0, reorderPoint: 2, onOrderQuantity: 0 });

    renderQueue([noSupplierA, noSupplierB]);

    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Create Purchasing Draft/i })).not.toBeInTheDocument();
      expect(screen.getByText(/assign a preferred supplier/i)).toBeInTheDocument();
    });

    expect(mockCreatePurchasingDraft).not.toHaveBeenCalled();
  });
});

// ─── SPRINT TEST 10 — Selection persistence ───────────────────────────────────

describe("SPRINT TEST 10: Selection persistence — edited qty preserved after deselecting another item", () => {
  it("B remains selected with edited quantity after deselecting A", async () => {
    const itemA = makeItem({
      id: "s10-item-a",
      name: "Item A Sprint10",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 10,
      onOrderQuantity: 0,
    });
    const itemB = makeItem({
      id: "s10-item-b",
      name: "Item B Sprint10",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      stockUnit: "Box",
      receivingUnit: "Carton",
      unitsPerReceivingUnit: 10,
      unitCostCents: 800,
      quantityOnHand: 0,
      reorderPoint: 10,
      onOrderQuantity: 0,
    });

    renderQueue([itemA, itemB]);

    // Select all (A and B). Items are sorted alphabetically: A first, B second.
    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    // Edit B's quantity to 7.
    const qtyInputB = await screen.findByRole("spinbutton", { name: /Qty to order for Item B Sprint10/i });
    fireEvent.change(qtyInputB, { target: { value: "7" } });

    // Deselect A: allCbs[0]=select-all, allCbs[1]=Item A, allCbs[2]=Item B.
    const allCbs = screen.getAllByRole("checkbox");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.click(allCbs[1]!); // deselect Item A Sprint10

    // B should still be selected.
    await waitFor(() => {
      expect((allCbs[2] as HTMLInputElement).checked).toBe(true);
    });

    // B's qty input should still show 7 (selection state preserved).
    const qtyInputBAfter = screen.getByRole("spinbutton", { name: /Qty to order for Item B Sprint10/i });
    expect((qtyInputBAfter as HTMLInputElement).value).toBe("7");
  });
});

// ─── SPRINT TEST 11 — No duplicate creation ───────────────────────────────────

describe("SPRINT TEST 11: No duplicate creation — button disabled during save", () => {
  it("Create Purchasing Draft button is disabled while save is in progress", async () => {
    const item = makeItem({
      id: "s11-item",
      name: "Sprint11 Item",
      preferredSupplierId: "supplier-1",
      preferredSupplierName: "DentalCo AU",
      quantityOnHand: 0,
      reorderPoint: 2,
      onOrderQuantity: 0,
    });

    // Hang the API call so we can inspect the disabled state.
    let resolve: ((v: unknown) => void) | undefined;
    const hangingPromise = new Promise((res) => { resolve = res; });
    mockCreatePurchasingDraft.mockReturnValue(hangingPromise);

    renderQueue([item]);

    const selectAll = await screen.findByRole("checkbox", { name: /Select all eligible/i });
    fireEvent.click(selectAll);

    const createBtn = await screen.findByRole("button", { name: /Create Purchasing Draft/i });
    fireEvent.click(createBtn);

    // Button should become disabled immediately after click (isSaving guard).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Creating/i })).toBeDisabled();
    });

    // API was called exactly once.
    expect(mockCreatePurchasingDraft).toHaveBeenCalledTimes(1);

    // Resolve the hanging promise to clean up.
    resolve?.({
      purchasingDraft: { id: "pd-s11", clinicId: CLINIC_ID, draftReference: "PD-S11", createdByUserId: "u1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      childPos: [],
      unresolvedGroups: [],
    });
  });
});
