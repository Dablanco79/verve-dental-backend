import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryAdjustPage } from "../src/pages/InventoryAdjustPage.js";
import type { InventoryItem } from "../src/types/inventory.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const { authTestState, mockListInventory, mockAdjustInventory } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListInventory: vi.fn(),
    mockAdjustInventory: vi.fn(),
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
    adjustInventory: mockAdjustInventory,
    getInventoryItem: vi.fn(),
    listAdjustments: vi.fn(),
    handleScan: vi.fn(),
    createProduct: vi.fn(),
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

const sampleItems: InventoryItem[] = [
  {
    id: "item-aaa-111",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "cat-aaa-111",
    masterSku: "VRV-GLV-001",
    name: "Nitrile Examination Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    quantityOnHand: 10,
    reorderPoint: 5,
    unitCostCents: 1800,
    unitCostOverrideCents: null,
    supplierPreference: null,
    isBelowReorderPoint: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-bbb-222",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "cat-bbb-222",
    masterSku: "VRV-BUR-001",
    name: "Diamond Burs FG Round #2 (Pack 5)",
    category: "Rotary",
    unitOfMeasure: "pack",
    quantityOnHand: 3,
    reorderPoint: 4,
    unitCostCents: 4600,
    unitCostOverrideCents: null,
    supplierPreference: null,
    isBelowReorderPoint: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const managerUser = createManagerUser();
const staffUser = createStaffUser();

function renderPage(initialPath = "/inventory/adjust") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <InventoryAdjustPage />
    </MemoryRouter>,
  );
}

describe("InventoryAdjustPage — RBAC", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListInventory.mockReset();
    mockAdjustInventory.mockReset();
  });

  it("redirects clinical_staff to /inventory", () => {
    setAuthenticatedUser(authTestState, staffUser);
    mockListInventory.mockResolvedValue([]);

    renderPage();

    expect(screen.queryByRole("heading", { name: "Adjust Inventory" })).not.toBeInTheDocument();
  });

  it("renders the page for managers", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListInventory.mockResolvedValue(sampleItems);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Adjust Inventory" })).toBeInTheDocument();
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
  });
});

describe("InventoryAdjustPage — item selection", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListInventory.mockResolvedValue(sampleItems);
    mockAdjustInventory.mockReset();
  });

  it("shows all items after inventory loads", async () => {
    renderPage();

    expect(await screen.findByText("Nitrile Examination Gloves (Box 100)")).toBeInTheDocument();
    expect(screen.getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
  });

  it("filters items by search query", async () => {
    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");

    fireEvent.change(screen.getByLabelText("Search items"), {
      target: { value: "bur" },
    });

    expect(screen.queryByText("Nitrile Examination Gloves (Box 100)")).not.toBeInTheDocument();
    expect(screen.getByText("Diamond Burs FG Round #2 (Pack 5)")).toBeInTheDocument();
  });

  it("shows empty state when no items match search", async () => {
    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");

    fireEvent.change(screen.getByLabelText("Search items"), {
      target: { value: "xyzzy-no-match" },
    });

    expect(screen.getByText("No products match your search")).toBeInTheDocument();
  });

  it("advances to the form step on item click", async () => {
    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");

    fireEvent.click(screen.getByText("Nitrile Examination Gloves (Box 100)"));

    expect(await screen.findByText("Adjusting")).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity/i)).toBeInTheDocument();
  });
});

describe("InventoryAdjustPage — adjustment form", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListInventory.mockResolvedValue(sampleItems);
    mockAdjustInventory.mockReset();
  });

  async function advanceToForm() {
    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");
    fireEvent.click(screen.getByText("Nitrile Examination Gloves (Box 100)"));
    await screen.findByLabelText(/Quantity/i);
  }

  it("shows validation errors when submitting empty form", async () => {
    await advanceToForm();

    fireEvent.click(screen.getByRole("button", { name: /Review adjustment/i }));

    expect(
      await screen.findByText("Quantity must be a positive whole number."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please select a reason for this adjustment."),
    ).toBeInTheDocument();
  });

  it("shows stock preview when quantity is entered", async () => {
    await advanceToForm();

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "5" } });

    expect(await screen.findByText("Current stock")).toBeInTheDocument();
    expect(screen.getByText(/Resulting stock/i)).toBeInTheDocument();
    expect(screen.getByText(/15 box/i)).toBeInTheDocument();
  });

  it("calculates decrease delta correctly in preview", async () => {
    await advanceToForm();

    fireEvent.click(screen.getByLabelText("Decrease stock"));
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });

    expect(await screen.findByText(/Resulting stock/i)).toBeInTheDocument();
    expect(screen.getByText(/7 box/i)).toBeInTheDocument();
  });

  it("advances to confirm step with valid form data", async () => {
    await advanceToForm();

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "Stock received" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Review adjustment/i }));

    expect(await screen.findByRole("heading", { name: "Confirm adjustment" })).toBeInTheDocument();
    expect(screen.getByText("Stock received")).toBeInTheDocument();
  });
});

describe("InventoryAdjustPage — confirm and submit", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListInventory.mockResolvedValue(sampleItems);
    mockAdjustInventory.mockReset();
  });

  async function advanceToConfirm() {
    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");
    fireEvent.click(screen.getByText("Nitrile Examination Gloves (Box 100)"));
    await screen.findByLabelText(/Quantity/i);

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "Stock received" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review adjustment/i }));
    await screen.findByRole("heading", { name: "Confirm adjustment" });
  }

  it("calls adjustInventory with correct payload on confirm", async () => {
    mockAdjustInventory.mockResolvedValue({
      item: { ...sampleItems[0], quantityOnHand: 15 },
      adjustment: {
        id: "adj-test-001",
        clinicId: TEST_CLINIC_ID,
        clinicInventoryItemId: "item-aaa-111",
        masterCatalogItemId: "cat-aaa-111",
        adjustmentType: "manual_adjust",
        quantityDelta: 5,
        quantityBefore: 10,
        quantityAfter: 15,
        reason: "Stock received",
        performedByUserId: managerUser.id,
        performedByEmail: managerUser.email,
        referenceId: null,
        createdAt: "2026-06-19T09:00:00.000Z",
      },
    });

    await advanceToConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Confirm adjustment/i }));

    await waitFor(() => {
      expect(mockAdjustInventory).toHaveBeenCalledWith(TEST_CLINIC_ID, {
        itemId: "item-aaa-111",
        quantityDelta: 5,
        reason: "Stock received",
      });
    });
  });

  it("shows success notice after successful adjustment", async () => {
    mockAdjustInventory.mockResolvedValue({
      item: { ...sampleItems[0], quantityOnHand: 15 },
      adjustment: {
        id: "adj-test-001",
        clinicId: TEST_CLINIC_ID,
        clinicInventoryItemId: "item-aaa-111",
        masterCatalogItemId: "cat-aaa-111",
        adjustmentType: "manual_adjust",
        quantityDelta: 5,
        quantityBefore: 10,
        quantityAfter: 15,
        reason: "Stock received",
        performedByUserId: managerUser.id,
        performedByEmail: managerUser.email,
        referenceId: null,
        createdAt: "2026-06-19T09:00:00.000Z",
      },
    });

    await advanceToConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Confirm adjustment/i }));

    expect(
      await screen.findByText(/\+5 box added to Nitrile Examination Gloves/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Make another adjustment")).toBeInTheDocument();
  });

  it("shows error message when adjustment API call fails", async () => {
    mockAdjustInventory.mockRejectedValue(new Error("Insufficient stock"));

    await advanceToConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Confirm adjustment/i }));

    expect(await screen.findByText("Insufficient stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm adjustment/i })).toBeInTheDocument();
  });

  it("appends notes to reason string when notes are provided", async () => {
    mockAdjustInventory.mockResolvedValue({
      item: { ...sampleItems[0], quantityOnHand: 15 },
      adjustment: {
        id: "adj-test-002",
        clinicId: TEST_CLINIC_ID,
        clinicInventoryItemId: "item-aaa-111",
        masterCatalogItemId: "cat-aaa-111",
        adjustmentType: "manual_adjust",
        quantityDelta: 5,
        quantityBefore: 10,
        quantityAfter: 15,
        reason: "Stock received — Batch #ABC123",
        performedByUserId: managerUser.id,
        performedByEmail: managerUser.email,
        referenceId: null,
        createdAt: "2026-06-19T09:00:00.000Z",
      },
    });

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");
    fireEvent.click(screen.getByText("Nitrile Examination Gloves (Box 100)"));
    await screen.findByLabelText(/Quantity/i);

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "Stock received" },
    });
    fireEvent.change(screen.getByLabelText(/Notes/i), {
      target: { value: "Batch #ABC123" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Review adjustment/i }));
    await screen.findByRole("heading", { name: "Confirm adjustment" });
    fireEvent.click(screen.getByRole("button", { name: /Confirm adjustment/i }));

    await waitFor(() => {
      expect(mockAdjustInventory).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        expect.objectContaining({ reason: "Stock received — Batch #ABC123" }),
      );
    });
  });

  it("can go back from confirm to form step", async () => {
    await advanceToConfirm();

    fireEvent.click(screen.getByRole("button", { name: /← Edit/i }));

    expect(await screen.findByLabelText(/Quantity/i)).toBeInTheDocument();
  });
});

describe("InventoryAdjustPage — done step reset", () => {
  it("resets to select step when 'Make another adjustment' is clicked", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListInventory.mockResolvedValue(sampleItems);
    mockAdjustInventory.mockResolvedValue({
      item: { ...sampleItems[0], quantityOnHand: 15 },
      adjustment: {
        id: "adj-reset-001",
        clinicId: TEST_CLINIC_ID,
        clinicInventoryItemId: "item-aaa-111",
        masterCatalogItemId: "cat-aaa-111",
        adjustmentType: "manual_adjust",
        quantityDelta: 5,
        quantityBefore: 10,
        quantityAfter: 15,
        reason: "Stock received",
        performedByUserId: managerUser.id,
        performedByEmail: managerUser.email,
        referenceId: null,
        createdAt: "2026-06-19T09:00:00.000Z",
      },
    });

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Box 100)");
    fireEvent.click(screen.getByText("Nitrile Examination Gloves (Box 100)"));
    await screen.findByLabelText(/Quantity/i);

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Stock received" } });
    fireEvent.click(screen.getByRole("button", { name: /Review adjustment/i }));
    await screen.findByRole("heading", { name: "Confirm adjustment" });
    fireEvent.click(screen.getByRole("button", { name: /Confirm adjustment/i }));
    await screen.findByText(/Make another adjustment/i);

    fireEvent.click(screen.getByText("Make another adjustment"));

    expect(await screen.findByLabelText("Search items")).toBeInTheDocument();

    const list = screen.getByRole("listbox");
    expect(within(list).getByText("Nitrile Examination Gloves (Box 100)")).toBeInTheDocument();
  });
});
