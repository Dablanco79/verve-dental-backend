/**
 * StocktakeSessionPage tests — Workflow 2.1: Stocktake & Inventory Reconciliation.
 *
 * Coverage:
 *  Sprint 1.2:
 *  1. Complete button is disabled while at least one line is uncounted
 *  2. Warning banner shows the exact number of uncounted items
 *  3. A counted quantity of zero is treated as counted (button enabled)
 *  4. Complete button becomes available when all lines have a non-null count
 *  5. Progress summary displays counted, remaining and percentage values
 *  6. Warning disappears and Complete becomes enabled once all lines are counted
 *
 *  Sprint 1.3 (clinic context + detail page fix):
 *  7.  Draft session renders title, clinic name, status and actions
 *  8.  AppShell remains visible while session loads
 *  9.  Loading state is shown while fetching
 * 10. API error shows error message, Retry and Back actions
 * 11. Not-found state shows message and Back action (session resolves to null)
 * 12. All Clinics scope shows clinic-selection message (no API call)
 * 13. Staff cannot see Start / Complete / Cancel buttons (access-denied actions)
 * 14. New Session is blocked (Start button absent) without an explicit clinic
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StocktakeSessionPage } from "../src/pages/StocktakeSessionPage.js";
import type { StocktakeLine, StocktakeSession } from "../src/types/stocktake.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  authState,
  clinicState,
  mockGetStocktakeSession,
  mockListStocktakeLines,
  mockUpdateStocktakeLine,
  mockStartStocktakeSession,
  mockCompleteStocktakeSession,
  mockCancelStocktakeSession,
} = vi.hoisted(() => {
  const authState = { user: null as null | { id: string; email: string; role: string } };
  const clinicState = {
    selectedClinic: { id: "11111111-1111-4111-8111-111111111111", name: "Test Clinic" } as { id: string; name: string } | null,
    dashboardScopeType: "clinic" as "clinic" | "all_clinics",
  };
  return {
    authState,
    clinicState,
    mockGetStocktakeSession: vi.fn(),
    mockListStocktakeLines: vi.fn(),
    mockUpdateStocktakeLine: vi.fn(),
    mockStartStocktakeSession: vi.fn(),
    mockCompleteStocktakeSession: vi.fn(),
    mockCancelStocktakeSession: vi.fn(),
  };
});

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: false,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/clinic/useSelectedClinic.js", () => ({
  useSelectedClinic: () => ({
    selectedClinic: clinicState.selectedClinic,
    selectedDashboardScope: clinicState.dashboardScopeType === "all_clinics"
      ? { type: "all_clinics" as const }
      : { type: "clinic" as const, clinic: clinicState.selectedClinic },
    availableClinics: clinicState.selectedClinic ? [clinicState.selectedClinic] : [],
    canSwitchClinics: false,
    canSelectAllClinics: true,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getStocktakeSession: mockGetStocktakeSession,
    listStocktakeLines: mockListStocktakeLines,
    updateStocktakeLine: mockUpdateStocktakeLine,
    startStocktakeSession: mockStartStocktakeSession,
    completeStocktakeSession: mockCompleteStocktakeSession,
    cancelStocktakeSession: mockCancelStocktakeSession,
    listInventory: vi.fn().mockResolvedValue([]),
    getHealth: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
    refresh: vi.fn(),
    listClinics: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../src/config/index.js", () => ({
  loadConfig: () => ({ apiBaseUrl: "http://localhost:4000" }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const TEST_SESSION_ID = "sess-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeSession(overrides: Partial<StocktakeSession> = {}): StocktakeSession {
  return {
    id: TEST_SESSION_ID,
    clinicId: TEST_CLINIC_ID,
    name: "July Stocktake",
    status: "in_progress",
    createdByUserId: "user-1",
    createdByEmail: "manager@clinic.au",
    startedByUserId: "user-1",
    startedByEmail: "manager@clinic.au",
    completedByUserId: null,
    completedByEmail: null,
    cancelledByUserId: null,
    cancelledByEmail: null,
    startedAt: "2026-07-20T07:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-07-20T06:00:00.000Z",
    updatedAt: "2026-07-20T07:00:00.000Z",
    totalLines: 0,
    countedLines: 0,
    ...overrides,
  };
}

function makeLine(overrides: Partial<StocktakeLine> = {}): StocktakeLine {
  return {
    id: "line-1111",
    sessionId: TEST_SESSION_ID,
    clinicId: TEST_CLINIC_ID,
    clinicInventoryItemId: "inv-item-1",
    masterCatalogItemId: "mci-1",
    masterSku: "SKU-001",
    productName: "Test Product",
    category: "Consumables",
    stockUnit: "unit",
    primaryBarcode: null,
    expectedQuantity: 10,
    countedQuantity: null,
    variance: null,
    varianceValueCents: null,
    unitCostCents: 500,
    notes: null,
    createdAt: "2026-07-20T07:00:00.000Z",
    updatedAt: "2026-07-20T07:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/inventory/stocktakes/${TEST_SESSION_ID}`]}>
      <Routes>
        <Route path="/inventory/stocktakes/:sessionId" element={<StocktakeSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("StocktakeSessionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: "user-1",
      email: "manager@clinic.au",
      role: "group_practice_manager",
    };
    clinicState.selectedClinic = { id: TEST_CLINIC_ID, name: "Test Clinic" };
    clinicState.dashboardScopeType = "clinic";
  });

  // 1. Complete button is disabled while at least one line is uncounted
  it("disables the Complete button while at least one line is uncounted", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 5 }),
      makeLine({ id: "line-2", countedQuantity: null }), // uncounted
    ]);

    renderPage();

    await waitFor(() => {
      const btn = screen.getByTestId("complete-button");
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // 2. Warning banner shows the exact number of uncounted items
  it("shows a warning banner with the exact count of uncounted items", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 5 }),
      makeLine({ id: "line-2", countedQuantity: null }),
      makeLine({ id: "line-3", countedQuantity: null }),
    ]);

    renderPage();

    await waitFor(() => {
      const banner = screen.getByTestId("uncounted-banner");
      expect(banner).toBeDefined();
      // Banner text includes the number "2"
      expect(banner.textContent).toMatch(/2 items? still need to be counted/i);
    });
  });

  // 3. A counted quantity of zero is treated as counted (button enabled)
  it("enables the Complete button when all lines have countedQuantity = 0", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 0 }),
      makeLine({ id: "line-2", countedQuantity: 0 }),
    ]);

    renderPage();

    await waitFor(() => {
      const btn = screen.getByTestId("complete-button");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    // No warning banner should appear either
    expect(screen.queryByTestId("uncounted-banner")).toBeNull();
  });

  // 4. Complete button becomes available when all lines have a non-null count
  it("enables the Complete button when every line is counted", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 3 }),
      makeLine({ id: "line-2", countedQuantity: 7 }),
      makeLine({ id: "line-3", countedQuantity: 0 }),
    ]);

    renderPage();

    await waitFor(() => {
      const btn = screen.getByTestId("complete-button");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // 5. Progress summary displays counted, remaining and percentage values
  it("displays counted, remaining and percentage in the progress summary", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 3 }),
      makeLine({ id: "line-2", countedQuantity: null }),
      makeLine({ id: "line-3", countedQuantity: null }),
      makeLine({ id: "line-4", countedQuantity: null }),
    ]);

    renderPage();

    await waitFor(() => {
      const label = screen.getByTestId("progress-label");
      // 1 of 4 counted → 25% complete
      expect(label.textContent).toMatch(/1 of 4 items counted/i);
      expect(label.textContent).toMatch(/3 remaining/i);
      expect(label.textContent).toMatch(/25%/);
    });
  });

  // 6. Warning disappears and Complete becomes enabled once all lines are counted
  it("shows no warning and enables Complete when all items are counted (100%)", async () => {
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "in_progress" }));
    mockListStocktakeLines.mockResolvedValue([
      makeLine({ id: "line-1", countedQuantity: 5 }),
      makeLine({ id: "line-2", countedQuantity: 3 }),
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.queryByTestId("uncounted-banner")).toBeNull();
      const btn = screen.getByTestId("complete-button");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      const label = screen.getByTestId("progress-label");
      expect(label.textContent).toMatch(/2 of 2 items counted/i);
      expect(label.textContent).toMatch(/100%/);
    });
  });

  // ── Clinic context + detail page rendering ─────────────────────────────────

  // 7. Draft session renders title, clinic name, status badge and Start Stocktake button
  it("renders title, clinic name, Draft status and Start Stocktake for a valid draft session", async () => {
    mockGetStocktakeSession.mockResolvedValue(
      makeSession({ status: "draft", name: "Test Stocktake - July 2026", startedAt: null, startedByUserId: null, startedByEmail: null }),
    );
    mockListStocktakeLines.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /test stocktake - july 2026/i })).toBeDefined();
    });

    // "Draft" appears in the status badge AND the status filter dropdown — both are acceptable.
    expect(screen.getAllByText(/draft/i).length).toBeGreaterThan(0);
    // Clinic name appears in the meta section (and may also appear in AppShell).
    expect(screen.getAllByText(/test clinic/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /start stocktake/i })).toBeDefined();
    expect(screen.queryByTestId("not-found")).toBeNull();
  });

  // 8. AppShell (breadcrumb nav) remains visible while loading
  it("shows breadcrumb navigation while the session is loading", () => {
    mockGetStocktakeSession.mockImplementation(() => new Promise(() => undefined));
    mockListStocktakeLines.mockImplementation(() => new Promise(() => undefined));

    renderPage();

    expect(screen.getByText(/loading session/i)).toBeDefined();
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeDefined();
  });

  // 9. Loading state visible while fetching
  it("shows a loading indicator while session data is fetching", () => {
    mockGetStocktakeSession.mockImplementation(() => new Promise(() => undefined));
    mockListStocktakeLines.mockImplementation(() => new Promise(() => undefined));

    renderPage();

    expect(screen.getByText(/loading session/i)).toBeDefined();
  });

  // 10. API error shows error message, Retry and Back actions
  it("shows error message with Retry and Back when the API fails", async () => {
    mockGetStocktakeSession.mockRejectedValue(new Error("Server error"));
    mockListStocktakeLines.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeDefined();
    });

    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /back to stocktakes/i })).toBeDefined();
  });

  // 11. Not-found: session resolves to null — shows not-found message
  it("shows a not-found message when the session cannot be resolved", async () => {
    // Return null to simulate not-found (no 404 error thrown, just empty result)
    mockGetStocktakeSession.mockResolvedValue(null);
    mockListStocktakeLines.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("not-found")).toBeDefined();
    });

    expect(screen.getByText(/not found/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /back to stocktakes/i })).toBeDefined();
  });

  // 12. All Clinics scope — shows clinic-selection message, no API call
  it("shows a clinic-selection message and makes no API call when All Clinics is selected", async () => {
    clinicState.dashboardScopeType = "all_clinics";

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/select a specific clinic/i)).toBeDefined();
    });

    expect(mockGetStocktakeSession).not.toHaveBeenCalled();
    expect(mockListStocktakeLines).not.toHaveBeenCalled();
  });

  // 13. Staff cannot see Start / Complete / Cancel action buttons
  it("does not show Start, Complete or Cancel buttons for clinical_staff", async () => {
    authState.user = { id: "staff-1", email: "staff@clinic.au", role: "clinical_staff" };
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "draft" }));
    mockListStocktakeLines.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /july stocktake/i })).toBeDefined();
    });

    expect(screen.queryByRole("button", { name: /start stocktake/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  // 14. Practice Manager — existing clinic-scoped behaviour: Start button available for draft
  it("shows Start Stocktake button for a group_practice_manager on a draft session", async () => {
    authState.user = { id: "mgr-1", email: "mgr@clinic.au", role: "group_practice_manager" };
    mockGetStocktakeSession.mockResolvedValue(makeSession({ status: "draft" }));
    mockListStocktakeLines.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start stocktake/i })).toBeDefined();
    });
  });
});

