import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustmentHistoryPage } from "../src/pages/AdjustmentHistoryPage.js";
import type { InventoryAdjustment } from "../src/types/inventory.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const { authTestState, mockListAdjustments } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
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
    listAdjustments: mockListAdjustments,
    listInventory: vi.fn().mockResolvedValue([]),
    adjustInventory: vi.fn(),
    getInventoryItem: vi.fn(),
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

const managerUser = createManagerUser();
const staffUser = createStaffUser();

const sampleAdjustments: InventoryAdjustment[] = [
  {
    id: "adj-001",
    clinicId: TEST_CLINIC_ID,
    clinicInventoryItemId: "item-aaa-111",
    masterCatalogItemId: "cat-aaa-111",
    adjustmentType: "manual_adjust",
    quantityDelta: 10,
    quantityBefore: 5,
    quantityAfter: 15,
    reason: "Stock received — Shipment #101",
    performedByUserId: "user-mgr-001",
    performedByEmail: "manager@clinic-a.au",
    referenceId: null,
    createdAt: "2026-06-18T10:00:00.000Z",
  },
  {
    id: "adj-002",
    clinicId: TEST_CLINIC_ID,
    clinicInventoryItemId: "item-bbb-222",
    masterCatalogItemId: "cat-bbb-222",
    adjustmentType: "manual_adjust",
    quantityDelta: -3,
    quantityBefore: 8,
    quantityAfter: 5,
    reason: "Damaged stock",
    performedByUserId: "user-mgr-001",
    performedByEmail: "manager@clinic-a.au",
    referenceId: null,
    createdAt: "2026-06-17T14:00:00.000Z",
  },
  {
    id: "adj-003",
    clinicId: TEST_CLINIC_ID,
    clinicInventoryItemId: "item-aaa-111",
    masterCatalogItemId: "cat-aaa-111",
    adjustmentType: "scan_deduct",
    quantityDelta: -1,
    quantityBefore: 15,
    quantityAfter: 14,
    reason: null,
    performedByUserId: "user-staff-001",
    performedByEmail: "staff@clinic-a.au",
    referenceId: null,
    createdAt: "2026-06-16T09:30:00.000Z",
  },
];

const mockPage = {
  items: sampleAdjustments,
  total: sampleAdjustments.length,
  limit: 200,
  offset: 0,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AdjustmentHistoryPage />
    </MemoryRouter>,
  );
}

describe("AdjustmentHistoryPage — RBAC", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListAdjustments.mockReset();
  });

  it("redirects clinical_staff away from the history page", () => {
    setAuthenticatedUser(authTestState, staffUser);
    mockListAdjustments.mockResolvedValue(mockPage);

    renderPage();

    expect(screen.queryByRole("heading", { name: "Adjustment History" })).not.toBeInTheDocument();
  });

  it("renders the page for managers", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockResolvedValue(mockPage);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Adjustment History" })).toBeInTheDocument();
  });
});

describe("AdjustmentHistoryPage — loading and error states", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockReset();
  });

  it("shows a loading message while fetching", () => {
    mockListAdjustments.mockImplementation(() => new Promise(() => undefined));
    renderPage();

    expect(screen.getByText("Loading adjustment history…")).toBeInTheDocument();
  });

  it("shows an error message when the API fails", async () => {
    mockListAdjustments.mockRejectedValue(new Error("Network error"));
    renderPage();

    expect(await screen.findByText(/Network error/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows empty state when no adjustments match filters", async () => {
    mockListAdjustments.mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    renderPage();

    expect(await screen.findByText("No adjustments found")).toBeInTheDocument();
  });
});

describe("AdjustmentHistoryPage — data display", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockResolvedValue(mockPage);
  });

  it("renders all adjustments in the table", async () => {
    renderPage();

    await screen.findByRole("table");
    const rows = screen.getAllByRole("row");
    // header row + 3 data rows
    expect(rows).toHaveLength(4);
  });

  it("shows the adjustment type labels", async () => {
    renderPage();
    await screen.findByRole("table");

    expect(screen.getAllByText("Manual adjust")).toHaveLength(2);
    expect(screen.getByText("Scan deduct")).toBeInTheDocument();
  });

  it("shows positive delta for increases", async () => {
    renderPage();
    await screen.findByRole("table");

    expect(screen.getByText("+10")).toBeInTheDocument();
  });

  it("shows negative delta for decreases", async () => {
    renderPage();
    await screen.findByRole("table");

    expect(screen.getAllByText(/−3|-3/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows em-dash when reason is null", async () => {
    renderPage();
    await screen.findByRole("table");

    const rows = screen.getAllByRole("row");
    const scanRow = rows.find((r) => r.textContent.includes("Scan deduct"));
    if (!scanRow) throw new Error("Expected a row with 'Scan deduct' to be in the document");
    expect(within(scanRow).getByText("—")).toBeInTheDocument();
  });

  it("calls listAdjustments with the correct clinic ID", async () => {
    renderPage();
    await screen.findByRole("table");

    expect(mockListAdjustments).toHaveBeenCalledWith(
      TEST_CLINIC_ID,
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
  });
});

describe("AdjustmentHistoryPage — client-side filtering", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockResolvedValue(mockPage);
  });

  it("filters by search text", async () => {
    renderPage();
    await screen.findByRole("table");

    fireEvent.change(screen.getByPlaceholderText(/Product name or notes/i), {
      target: { value: "Damaged" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1 match
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText("Damaged stock")).toBeInTheDocument();
    expect(within(table).queryByText(/Stock received/i)).not.toBeInTheDocument();
  });

  it("filters by reason dropdown", async () => {
    renderPage();
    await screen.findByRole("table");

    fireEvent.change(screen.getByRole("combobox", { name: /Reason/i }), {
      target: { value: "Damaged stock" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
  });

  it("clears filters on Clear button click", async () => {
    renderPage();
    await screen.findByRole("table");

    fireEvent.change(screen.getByPlaceholderText(/Product name or notes/i), {
      target: { value: "Damaged" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(4);
    });
  });
});

describe("AdjustmentHistoryPage — pagination", () => {
  it("shows pagination summary when records exist", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockResolvedValue(mockPage);

    renderPage();
    await screen.findByRole("table");

    expect(screen.getByText(/1–3 of 3 adjustments/i)).toBeInTheDocument();
  });

  it("Previous page button is disabled on first page", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListAdjustments.mockResolvedValue(mockPage);

    renderPage();
    await screen.findByRole("table");

    const prevBtn = screen.getByRole("button", { name: /Previous page/i });
    expect(prevBtn).toBeDisabled();
  });
});
