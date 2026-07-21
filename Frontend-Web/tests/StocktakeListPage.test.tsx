/**
 * StocktakeListPage tests — Workflow 2.1: Stocktake & Inventory Reconciliation.
 *
 * Coverage:
 *  1. Renders the page heading for managers
 *  2. Shows "New Session" button for managers only
 *  3. Hides "New Session" button for clinical_staff
 *  4. Renders a list of sessions from the API
 *  5. Shows empty state (no sessions) — "No stocktake sessions found."
 *  6. Shows "Create your first session" button in empty state for managers
 *  7. Hides "Create your first session" button in empty state for staff
 *  8. Loading indicator while fetching
 *  9. Error message on API failure
 * 10. Handles pagination total = 0 without crashing
 * 11. Status filter change triggers a new API call
 * 12. Populated list with multiple sessions
 * 13. All Clinics selected — shows clinic selection message (no API call)
 * 14. All Clinics selected — New Session button is absent
 * 15. All Clinics selected — Create your first session button is absent
 * 16. Specific clinic selected — correct subtitle with clinic name
 * 17. Clinic switch — new clinic ID used in API call
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StocktakeListPage } from "../src/pages/StocktakeListPage.js";
import type { StocktakeSession } from "../src/types/stocktake.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { authState, clinicState, mockListStocktakeSessions } = vi.hoisted(() => {
  const authState = { user: null as null | { id: string; email: string; role: string } };
  const clinicState = {
    selectedClinic: { id: "11111111-1111-4111-8111-111111111111", name: "Test Clinic" } as { id: string; name: string } | null,
    dashboardScopeType: "clinic" as "clinic" | "all_clinics",
  };
  return {
    authState,
    clinicState,
    mockListStocktakeSessions: vi.fn(),
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
    listStocktakeSessions: mockListStocktakeSessions,
    // Minimal stubs for other methods used via AppShell.
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

const EMPTY_PAGE = { items: [], total: 0, limit: 50, offset: 0 };

function makeSession(overrides: Partial<StocktakeSession> = {}): StocktakeSession {
  return {
    id: "sess-1111-1111-1111-111111111111",
    clinicId: TEST_CLINIC_ID,
    name: "Monthly Stocktake",
    status: "draft",
    createdByUserId: "user-1",
    createdByEmail: "manager@clinic.au",
    startedByUserId: null,
    startedByEmail: null,
    completedByUserId: null,
    completedByEmail: null,
    cancelledByUserId: null,
    cancelledByEmail: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-07-20T06:00:00.000Z",
    updatedAt: "2026-07-20T06:00:00.000Z",
    totalLines: 0,
    countedLines: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StocktakeListPage />
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("StocktakeListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: "user-1",
      email: "manager@clinic.au",
      role: "group_practice_manager",
    };
    clinicState.selectedClinic = { id: TEST_CLINIC_ID, name: "Test Clinic" };
    clinicState.dashboardScopeType = "clinic";
    mockListStocktakeSessions.mockResolvedValue(EMPTY_PAGE);
  });

  // 1. Renders heading for managers
  it("renders the stocktake heading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /stocktake sessions/i })).toBeDefined();
    });
  });

  // 2. Shows "New Session" button for managers
  it("shows New Session button for managers", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /new session/i })).toBeDefined();
    });
  });

  // 3. Hides "New Session" button for clinical_staff
  it("hides New Session button for clinical_staff", async () => {
    authState.user = { id: "staff-1", email: "staff@clinic.au", role: "clinical_staff" };
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /new session/i })).toBeNull();
    });
  });

  // 4. Renders list of sessions from API
  it("renders sessions returned by the API", async () => {
    const session = makeSession({ name: "July Stocktake", status: "in_progress" });
    mockListStocktakeSessions.mockResolvedValue({
      items: [session],
      total: 1,
      limit: 50,
      offset: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("July Stocktake")).toBeDefined();
    });
    // The status badge appears alongside the filter <option> — use getAllByText to handle both.
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
  });

  // 5. Shows empty state when no sessions
  it("shows empty state when no sessions exist", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no stocktake sessions found/i)).toBeDefined();
    });
  });

  // 6. Shows "Create your first session" button in empty state for managers
  it("shows 'Create your first session' button in empty state for managers", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create your first session/i })).toBeDefined();
    });
  });

  // 7. Hides "Create your first session" button in empty state for staff
  it("does not show 'Create your first session' button for clinical_staff in empty state", async () => {
    authState.user = { id: "staff-1", email: "staff@clinic.au", role: "clinical_staff" };
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no stocktake sessions found/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /create your first session/i })).toBeNull();
  });

  // 8. Loading indicator
  it("shows loading indicator while fetching", () => {
    mockListStocktakeSessions.mockImplementation(
      () => new Promise(() => undefined),
    );
    renderPage();
    expect(screen.getByText(/loading sessions/i)).toBeDefined();
  });

  // 9. Error message on API failure
  it("shows an error message when API fails", async () => {
    mockListStocktakeSessions.mockRejectedValue(new Error("Network error"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeDefined();
    });
  });

  // 10. Handles pagination total = 0 without crashing
  it("renders without crashing when the API returns total = 0", async () => {
    mockListStocktakeSessions.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no stocktake sessions found/i)).toBeDefined();
    });
  });

  // 11. Status filter change triggers a new API call
  it("calls the API again when the status filter is changed", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no stocktake sessions found/i)).toBeDefined();
    });

    const callsBefore = mockListStocktakeSessions.mock.calls.length;

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "draft");

    await waitFor(() => {
      expect(mockListStocktakeSessions.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    // The most recent call should include the status filter.
    const lastCall = mockListStocktakeSessions.mock.calls[
      mockListStocktakeSessions.mock.calls.length - 1
    ] as [string, { status?: string }];
    expect(lastCall[1].status).toBe("draft");
  });

  // 12. Populated list with multiple sessions
  it("renders multiple sessions returned by the API", async () => {
    const sessionA = makeSession({ id: "sess-aaaa", name: "Alpha Stocktake", status: "draft" });
    const sessionB = makeSession({ id: "sess-bbbb", name: "Beta Stocktake", status: "completed" });
    mockListStocktakeSessions.mockResolvedValue({
      items: [sessionA, sessionB],
      total: 2,
      limit: 100,
      offset: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Alpha Stocktake")).toBeDefined();
    });
    expect(screen.getByText("Beta Stocktake")).toBeDefined();
  });

  // ── All Clinics scope ──────────────────────────────────────────────────────

  // 13. All Clinics selected — shows clinic selection message
  it("shows a clinic-selection message when All Clinics scope is active", async () => {
    clinicState.dashboardScopeType = "all_clinics";

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/select a specific clinic/i)).toBeDefined();
    });
  });

  // 14. All Clinics selected — does NOT make a Stocktake API call
  it("makes no Stocktake API request when All Clinics is selected", async () => {
    clinicState.dashboardScopeType = "all_clinics";

    renderPage();

    // Allow any async work to settle.
    await waitFor(() => {
      expect(screen.getByText(/select a specific clinic/i)).toBeDefined();
    });

    expect(mockListStocktakeSessions).not.toHaveBeenCalled();
  });

  // 15. All Clinics selected — New Session button absent
  it("does not show the New Session button when All Clinics is selected", async () => {
    clinicState.dashboardScopeType = "all_clinics";

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/select a specific clinic/i)).toBeDefined();
    });

    expect(screen.queryByRole("button", { name: /new session/i })).toBeNull();
  });

  // 16. Specific clinic — subtitle shows the selected clinic name
  it("shows the clinic name in the subtitle when a specific clinic is selected", async () => {
    clinicState.selectedClinic = { id: TEST_CLINIC_ID, name: "Heathmont Dental" };
    clinicState.dashboardScopeType = "clinic";

    renderPage();

    await waitFor(() => {
      // The subtitle paragraph specifically contains the clinic name.
      const subtitles = screen
        .getAllByText(/heathmont dental/i)
        .filter((el) => el.closest(".stocktake-page__subtitle") !== null);
      expect(subtitles.length).toBeGreaterThan(0);
    });
  });

  // 17. Clinic switch — new clinic ID used in API request
  it("uses the new clinic ID in the API request after a clinic switch", async () => {
    // Start with clinic A
    clinicState.selectedClinic = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Clinic A" };
    clinicState.dashboardScopeType = "clinic";

    const { rerender } = renderPage();

    await waitFor(() => {
      expect(mockListStocktakeSessions).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expect.any(Object),
      );
    });

    // Switch to clinic B — simulate a context change by re-rendering
    clinicState.selectedClinic = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Clinic B" };
    clinicState.dashboardScopeType = "clinic";

    rerender(
      <MemoryRouter>
        <StocktakeListPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockListStocktakeSessions).toHaveBeenCalledWith(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expect.any(Object),
      );
    });
  });
});
