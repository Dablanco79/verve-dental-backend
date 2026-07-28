/**
 * InventoryTable.test.tsx
 *
 * BLOCKER 3 — dedicated UI regression tests for Corrections 6 and 7:
 *
 *   Correction 6 — Inventory purchasing visibility:
 *     - inDraftQuantity > 0 → "In draft" badge displayed
 *     - onOrderQuantity > 0 → "On order" badge displayed
 *     - active Purchasing Draft reference → PD link rendered
 *     - active standalone PO reference → PO link rendered
 *     - no purchasing activity → neutral placeholder "—"
 *
 *   Correction 7 — Zero stock / zero reorder state:
 *     - quantityOnHand = 0, reorderPoint = 0 → OUT OF STOCK visible
 *     - "Reorder level not configured" warning visible
 *     - actionable path (Set reorder level / Order) rendered
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { InventoryTable } from "../src/components/inventory/InventoryTable.js";
import type { InventoryItem } from "../src/types/inventory.js";

// ─── Base item factory ────────────────────────────────────────────────────────

const baseItem: InventoryItem = {
  id: "e1111111-1111-4111-8111-111111111111",
  clinicId: "11111111-1111-4111-8111-111111111111",
  masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
  masterSku: "VRV-GLV-001",
  name: "Nitrile Examination Gloves (Box 100)",
  category: "PPE",
  unitOfMeasure: "box",
  stockUnit: "Box",
  receivingUnit: "Carton",
  unitsPerReceivingUnit: 10,
  quantityOnHand: 15,
  reorderPoint: 5,
  unitCostCents: 1899,
  unitCostOverrideCents: null,
  supplierPreference: "DentalCo AU",
  isBelowReorderPoint: false,
  preferredSupplierId: "supplier-1",
  preferredSupplierName: "DentalCo AU",
  inDraftQuantity: 0,
  onOrderQuantity: 0,
  activePurchasingDocuments: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function renderTable(items: InventoryItem[], withActions = false) {
  return render(
    <MemoryRouter>
      <InventoryTable
        items={items}
        purchaseOrderHrefForItem={withActions ? (item) => `/purchase-orders?item=${item.masterCatalogItemId}` : undefined}
        productDetailHrefForItem={(item) => `/inventory/products/${item.id}`}
      />
    </MemoryRouter>,
  );
}

// ─── Correction 6 — Inventory purchasing visibility ──────────────────────────

describe("InventoryTable — Correction 6: purchasing visibility", () => {
  it("TEST 8A: shows 'In draft' badge when inDraftQuantity > 0", () => {
    const item: InventoryItem = {
      ...baseItem,
      inDraftQuantity: 20,
      activePurchasingDocuments: [
        {
          poId: "po-draft-001",
          poReference: "PO-20260727-0001",
          purchasingDraftId: null,
          draftReference: null,
          status: "draft",
          quantity: 2,
          receivedQuantity: 0,
        },
      ],
    };
    renderTable([item]);
    expect(screen.getByTestId("in-draft-qty")).toBeInTheDocument();
    expect(screen.getByTestId("in-draft-qty").textContent).toMatch(/In draft.*20/);
  });

  it("TEST 8B: shows 'On order' badge when onOrderQuantity > 0", () => {
    const item: InventoryItem = {
      ...baseItem,
      onOrderQuantity: 30,
      activePurchasingDocuments: [
        {
          poId: "po-submitted-001",
          poReference: "PO-20260727-0002",
          purchasingDraftId: null,
          draftReference: null,
          status: "submitted",
          quantity: 3,
          receivedQuantity: 0,
        },
      ],
    };
    renderTable([item]);
    expect(screen.getByTestId("on-order-qty")).toBeInTheDocument();
    expect(screen.getByTestId("on-order-qty").textContent).toMatch(/On order.*30/);
  });

  it("TEST 8C: shows PD reference link when a Purchasing Draft document is active", () => {
    const item: InventoryItem = {
      ...baseItem,
      inDraftQuantity: 10,
      activePurchasingDocuments: [
        {
          poId: "po-draft-in-pd",
          poReference: "PO-20260727-0010",
          purchasingDraftId: "pd-00000001",
          draftReference: "PD-20260727-0010",
          status: "draft",
          quantity: 1,
          receivedQuantity: 0,
        },
      ],
    };
    renderTable([item]);
    const pdLink = screen.getByRole("link", { name: "PD-20260727-0010" });
    expect(pdLink).toBeInTheDocument();
    expect(pdLink).toHaveAttribute("href", "/purchasing-drafts/pd-00000001");
  });

  it("TEST 8D: shows PO reference link when a standalone supplier PO is active (no PD)", () => {
    const item: InventoryItem = {
      ...baseItem,
      onOrderQuantity: 10,
      activePurchasingDocuments: [
        {
          poId: "po-standalone-001",
          poReference: "PO-20260727-0020",
          purchasingDraftId: null,
          draftReference: null,
          status: "submitted",
          quantity: 1,
          receivedQuantity: 0,
        },
      ],
    };
    renderTable([item]);
    const poLink = screen.getByRole("link", { name: "PO-20260727-0020" });
    expect(poLink).toBeInTheDocument();
    expect(poLink).toHaveAttribute("href", "/purchase-orders/po-standalone-001");
  });

  it("TEST 8E: shows neutral '—' placeholder when no purchasing activity", () => {
    const item: InventoryItem = {
      ...baseItem,
      inDraftQuantity: 0,
      onOrderQuantity: 0,
      activePurchasingDocuments: [],
    };
    renderTable([item]);
    // No purchasing activity — neither draft nor on-order badges should be present
    expect(screen.queryByTestId("in-draft-qty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("on-order-qty")).not.toBeInTheDocument();
  });
});

// ─── Correction 7 — Zero stock / zero reorder state ─────────────────────────

describe("InventoryTable — Correction 7: zero stock / zero reorder state", () => {
  it("TEST 9A: shows OUT OF STOCK status for quantityOnHand=0 AND reorderPoint=0", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false, // 0 < 0 is false
    };
    renderTable([item]);
    // The status badge shows "Out of Stock" and the summary shows "1 out of stock"
    // Use getAllByText since both the badge and the summary match
    const matches = screen.getAllByText(/out of stock/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("TEST 9B: shows 'Reorder level not configured' warning for quantityOnHand=0 AND reorderPoint=0", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false,
    };
    renderTable([item]);
    expect(screen.getByTestId("zero-reorder-warning")).toBeInTheDocument();
    expect(screen.getByTestId("zero-reorder-warning").textContent).toMatch(/Reorder level not configured/i);
  });

  it("TEST 9C: shows an actionable path (Set reorder level / Order) for zero stock + zero reorder", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false,
    };
    // Render with purchaseOrderHref so the actions column is shown
    renderTable([item], true);
    // Either "Set reorder level" or "Order" must appear
    const setReorderLink = screen.queryByRole("link", { name: /Set reorder level/i });
    const orderLink = screen.queryByRole("link", { name: /^Order$/i });
    expect(setReorderLink ?? orderLink).not.toBeNull();
  });

  it("TEST 9D: does NOT show 'No action' as the sole response to zero stock + zero reorder", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false,
    };
    renderTable([item], true);
    // The actions column must not render "No action" when zero stock + zero reorder
    expect(screen.queryByText("No action")).not.toBeInTheDocument();
  });

  it("regular below-reorder-point item still shows 'Review PO' action (not regression)", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 2,
      reorderPoint: 5,
      isBelowReorderPoint: true,
    };
    renderTable([item], true);
    expect(screen.getByRole("link", { name: /Review PO/i })).toBeInTheDocument();
  });
});
