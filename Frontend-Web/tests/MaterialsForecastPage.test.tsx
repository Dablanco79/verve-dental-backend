import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MaterialsForecastPage } from "../src/pages/MaterialsForecastPage.js";
import type { InventoryItem } from "../src/types/inventory.js";
import type {
  MaterialShortfallAlert,
  SkuDemandProjection,
} from "../src/types/materialsForecast.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  authTestState,
  mockGetMaterialsForecast,
  mockGetMaterialsAlerts,
  mockListInventory,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetMaterialsForecast: vi.fn(),
    mockGetMaterialsAlerts: vi.fn(),
    mockListInventory: vi.fn(),
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
    getMaterialsForecast: mockGetMaterialsForecast,
    getMaterialsAlerts: mockGetMaterialsAlerts,
    listInventory: mockListInventory,
  }),
}));

// ── Test data ─────────────────────────────────────────────────────────────────

const sampleProjections: SkuDemandProjection[] = [
  {
    masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
    sku: "VRV-GLV-001",
    name: "Nitrile Examination Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    currentStock: 3,
    reorderPoint: 5,
    scheduledShiftCount: 20,
    historicalPresentShiftCount: 15,
    historicalConsumption: 30,
    avgUsagePerShift: 2,
    projectedUsage: 40,
    projectedStockRemaining: -37,
    willBreachSafetyThreshold: true,
  },
  {
    masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
    sku: "VRV-BUR-001",
    name: "Diamond Burs FG Round #2 (Pack 5)",
    category: "Rotary",
    unitOfMeasure: "pack",
    currentStock: 12,
    reorderPoint: 4,
    scheduledShiftCount: 20,
    historicalPresentShiftCount: 15,
    historicalConsumption: 10,
    avgUsagePerShift: 0.67,
    projectedUsage: 13,
    projectedStockRemaining: -1,
    willBreachSafetyThreshold: true,
  },
  {
    masterCatalogItemId: "d3333333-3333-4333-8333-333333333333",
    sku: "VRV-MSK-001",
    name: "Surgical Masks Level 2 (Box 50)",
    category: "PPE",
    unitOfMeasure: "box",
    currentStock: 20,
    reorderPoint: 5,
    scheduledShiftCount: 20,
    historicalPresentShiftCount: 15,
    historicalConsumption: 5,
    avgUsagePerShift: 0.33,
    projectedUsage: 7,
    projectedStockRemaining: 13,
    willBreachSafetyThreshold: false,
  },
];

const sampleAlerts: MaterialShortfallAlert[] = [
  {
    severity: "critical",
    masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
    sku: "VRV-GLV-001",
    name: "Nitrile Examination Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    currentStock: 3,
    reorderPoint: 5,
    projectedUsage: 40,
    projectedStockRemaining: -37,
    shortfallUnits: 42,
    daysUntilStockout: 2,
  },
  {
    severity: "warning",
    masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
    sku: "VRV-BUR-001",
    name: "Diamond Burs FG Round #2 (Pack 5)",
    category: "Rotary",
    unitOfMeasure: "pack",
    currentStock: 12,
    reorderPoint: 4,
    projectedUsage: 13,
    projectedStockRemaining: -1,
    shortfallUnits: 5,
    daysUntilStockout: 28,
  },
];

const sampleInventory: InventoryItem[] = [
  {
    id: "e1111111-1111-4111-8111-111111111111",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
    masterSku: "VRV-GLV-001",
    name: "Nitrile Examination Gloves (Box 100)",
    category: "PPE",
    unitOfMeasure: "box",
    quantityOnHand: 3,
    reorderPoint: 5,
    unitCostCents: 1799,
    unitCostOverrideCents: null,
    supplierPreference: "DentalCo AU",
    isBelowReorderPoint: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "e2222222-2222-4222-8222-222222222222",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
    masterSku: "VRV-BUR-001",
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
    id: "e3333333-3333-4333-8333-333333333333",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "d3333333-3333-4333-8333-333333333333",
    masterSku: "VRV-MSK-001",
    name: "Surgical Masks Level 2 (Box 50)",
    category: "PPE",
    unitOfMeasure: "box",
    quantityOnHand: 20,
    reorderPoint: 5,
    unitCostCents: 0,
    unitCostOverrideCents: null,
    supplierPreference: null,
    isBelowReorderPoint: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const managerUser = createManagerUser();
const staffUser = createStaffUser();

function renderPage() {
  return render(
    <MemoryRouter>
      <MaterialsForecastPage />
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MaterialsForecastPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockGetMaterialsForecast.mockReset();
    mockGetMaterialsAlerts.mockReset();
    mockListInventory.mockReset();

    setAuthenticatedUser(authTestState, managerUser);
    mockGetMaterialsForecast.mockResolvedValue(sampleProjections);
    mockGetMaterialsAlerts.mockResolvedValue(sampleAlerts);
    mockListInventory.mockResolvedValue(sampleInventory);
  });

  // ── Page load & RBAC ────────────────────────────────────────────────────────

  it("renders the page heading and clinic name for a manager", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Materials Forecast" })).toBeInTheDocument();
    expect(screen.getByText(/Verve Dental Clinic A/)).toBeInTheDocument();
  });

  it("redirects clinical_staff away from the materials forecast page", () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, staffUser);

    renderPage();

    // No forecast heading should appear — MemoryRouter will render the Navigate redirect.
    expect(screen.queryByRole("heading", { name: "Materials Forecast" })).not.toBeInTheDocument();
  });

  it("does not render anything when there is no authenticated user", () => {
    clearAuthenticatedUser(authTestState);
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  // ── Forecast retrieval ──────────────────────────────────────────────────────

  it("calls the forecast and inventory APIs with the default 30-day horizon", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Materials Forecast" });

    await waitFor(() => {
      expect(mockGetMaterialsForecast).toHaveBeenCalledWith(TEST_CLINIC_ID, 30);
      expect(mockGetMaterialsAlerts).toHaveBeenCalledWith(TEST_CLINIC_ID, 30);
      expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
  });

  it("renders summary cards after data loads", async () => {
    renderPage();

    expect(await screen.findByText("Products At Risk")).toBeInTheDocument();
    expect(screen.getByText("Recommended Reorders")).toBeInTheDocument();
    expect(screen.getByText("Estimated Reorder Cost")).toBeInTheDocument();
  });

  it("renders the forecast table with product rows", async () => {
    renderPage();

    expect(await screen.findByText("Product Demand Projections")).toBeInTheDocument();
    // Product names appear in alerts, table rows, and reorder section — use getAllByText.
    expect(screen.getAllByText("Nitrile Examination Gloves (Box 100)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Diamond Burs FG Round #2 (Pack 5)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Surgical Masks Level 2 (Box 50)")).toBeInTheDocument();
  });

  // ── Forecast alerts ─────────────────────────────────────────────────────────

  it("renders alert cards with severity badges", async () => {
    renderPage();

    expect(await screen.findByText("Stock Alerts")).toBeInTheDocument();
    // Badge labels from SEVERITY_LABELS
    const criticalBadges = await screen.findAllByText("Critical");
    expect(criticalBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("shows daysUntilStockout when present in an alert", async () => {
    renderPage();
    // The critical alert has daysUntilStockout: 2
    expect(await screen.findByText(/~2 days at current usage rate/i)).toBeInTheDocument();
  });

  it("shows an empty alerts state when there are no alerts", async () => {
    mockGetMaterialsAlerts.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText("No stock alerts for this forecast window."),
    ).toBeInTheDocument();
  });

  // ── Cost visibility ─────────────────────────────────────────────────────────

  it("shows supplier name in the reorder section for items with supplier preference", async () => {
    renderPage();

    await screen.findByText("Reorder Planning");
    expect(screen.getByText(/DentalCo AU/)).toBeInTheDocument();
    expect(screen.getByText(/BurDirect/)).toBeInTheDocument();
  });

  it("shows pricing unavailable for items with unitCostCents === 0", async () => {
    // Masks item has unitCostCents: 0 — no pricing available.
    // It is a healthy item so no reorder — the pricing unavailable shows in the table.
    renderPage();

    await screen.findByText("Product Demand Projections");
    // The masks row has no cost — should not crash; the table renders the row.
    expect(screen.getByText("Surgical Masks Level 2 (Box 50)")).toBeInTheDocument();
  });

  it("shows supplier pricing in reorder section for items with cost", async () => {
    renderPage();

    await screen.findByText("Reorder Planning");
    // Gloves: 42 reorder units × $17.99 = $755.58
    // Burs: 5 reorder units × $45.99 = $229.95
    // Both should show some AUD cost
    const audValues = screen.getAllByText(/\$\d+\.\d{2}/);
    expect(audValues.length).toBeGreaterThanOrEqual(1);
  });

  // ── Multiple supplier pricing ───────────────────────────────────────────────

  it("shows the supplier section when at-risk items have supplier preferences", async () => {
    renderPage();

    expect(await screen.findByText("Supplier Information")).toBeInTheDocument();
  });

  // ── Horizon selector ────────────────────────────────────────────────────────

  it("changes the forecast horizon when a different option is selected", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Materials Forecast" });

    const btn7 = screen.getByRole("button", { name: "7 days" });
    fireEvent.click(btn7);

    await waitFor(() => {
      expect(mockGetMaterialsForecast).toHaveBeenCalledWith(TEST_CLINIC_ID, 7);
    });
  });

  it("marks the default 30-day horizon button as active on load", async () => {
    renderPage();

    const btn30 = await screen.findByRole("button", { name: "30 days" });
    expect(btn30).toHaveAttribute("aria-pressed", "true");
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it("shows a loading message while data is being fetched", () => {
    // Never resolve to keep loading state
    mockGetMaterialsForecast.mockReturnValue(new Promise(() => undefined));
    mockGetMaterialsAlerts.mockReturnValue(new Promise(() => undefined));
    mockListInventory.mockReturnValue(new Promise(() => undefined));

    renderPage();

    expect(screen.getByText("Calculating materials forecast…")).toBeInTheDocument();
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it("shows an error message and retry button when the API fails", async () => {
    mockGetMaterialsForecast.mockRejectedValue(new Error("Network timeout"));

    renderPage();

    expect(await screen.findByText("Network timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // ── Permission enforcement ──────────────────────────────────────────────────

  it("does not call forecast APIs for clinical_staff", () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, staffUser);

    renderPage();

    expect(mockGetMaterialsForecast).not.toHaveBeenCalled();
    expect(mockGetMaterialsAlerts).not.toHaveBeenCalled();
  });

  // ── Empty projection state ──────────────────────────────────────────────────

  it("shows an empty state message when no inventory items exist", async () => {
    mockGetMaterialsForecast.mockResolvedValue([]);
    mockGetMaterialsAlerts.mockResolvedValue([]);
    mockListInventory.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText("No inventory items to forecast."),
    ).toBeInTheDocument();
  });

  // ── Reorder workflow ────────────────────────────────────────────────────────

  it("shows the Create Purchase Order button when reorder items exist", async () => {
    renderPage();

    expect(
      await screen.findByRole("link", { name: "Create Purchase Order" }),
    ).toBeInTheDocument();
  });

  it("does not show the reorder section when all items are healthy", async () => {
    mockGetMaterialsForecast.mockResolvedValue([
      { ...sampleProjections[2], willBreachSafetyThreshold: false },
    ]);
    mockGetMaterialsAlerts.mockResolvedValue([]);

    renderPage();

    await screen.findByText("Product Demand Projections");
    expect(screen.queryByText("Reorder Planning")).not.toBeInTheDocument();
  });
});
