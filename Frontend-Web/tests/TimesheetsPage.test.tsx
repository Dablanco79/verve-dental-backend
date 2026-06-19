/**
 * TimesheetsPage.test.tsx — Sprint N (Internal Pilot Blockers)
 *
 * Verifies role-aware timesheet fetching in useTimesheets:
 *   - clinical_staff calls listMyTimesheets (GET /timesheets/me)
 *   - managers call listTimesheets (GET /timesheets)
 *   - loading state is shown while fetching
 *   - empty state is shown when no entries are returned
 *   - error state is shown on fetch failure
 *   - manager approval queue is rendered for managers
 *   - clock widget is rendered for clinical_staff
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "../src/auth/AuthContext.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import { TimesheetsPage } from "../src/pages/TimesheetsPage.js";
import type { AuthUser } from "../src/types/index.js";

// ── Mock api/client.ts ────────────────────────────────────────────────────────
// vi.mock is hoisted before variable declarations — use vi.hoisted to declare
// the mocks inside the hoisted block so they are available in the factory.

const { mockListMyTimesheets, mockListTimesheets } = vi.hoisted(() => ({
  mockListMyTimesheets: vi.fn(),
  mockListTimesheets: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listMyTimesheets: mockListMyTimesheets,
    listTimesheets: mockListTimesheets,
    clockIn: vi.fn(),
    clockOut: vi.fn(),
    approveTimesheet: vi.fn(),
    rejectTimesheet: vi.fn(),
    verifyCommissionAttendance: vi.fn(),
    refresh: vi.fn().mockRejectedValue(new Error("no cookie")),
    getMe: vi.fn(),
  }),
}));

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: vi.fn(() => "mock-token"),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeUser(role: AuthUser["role"]): AuthUser {
  return {
    id: "user-1",
    email: "user@clinic-a.au",
    role,
    homeClinicId: "11111111-1111-4111-8111-111111111111",
    homeClinicName: "Verve Dental Clinic A",
  };
}

function makeAuthContext(user: AuthUser): AuthContextValue {
  return {
    user,
    isLoading: false,
    enrollmentToken: null,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    setupMfa: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
    logout: vi.fn(),
  };
}

function renderTimesheetsPage(user: AuthUser) {
  return render(
    <AuthContext.Provider value={makeAuthContext(user)}>
      <MemoryRouter>
        <TimesheetsPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

// Reset mock call counts between tests so assertions don't bleed across them.
beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Role-aware API routing
// ─────────────────────────────────────────────────────────────────────────────

describe("useTimesheets — API routing", () => {
  it("clinical_staff calls listMyTimesheets (not listTimesheets)", async () => {
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(mockListMyTimesheets).toHaveBeenCalledOnce();
    });
    expect(mockListTimesheets).not.toHaveBeenCalled();
  });

  it("group_practice_manager calls listTimesheets (not listMyTimesheets)", async () => {
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(mockListTimesheets).toHaveBeenCalledOnce();
    });
    expect(mockListMyTimesheets).not.toHaveBeenCalled();
  });

  it("owner_admin calls listTimesheets (not listMyTimesheets)", async () => {
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(mockListTimesheets).toHaveBeenCalledOnce();
    });
    expect(mockListMyTimesheets).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX states
// ─────────────────────────────────────────────────────────────────────────────

describe("TimesheetsPage — UX states", () => {
  it("shows a loading indicator while fetching", () => {
    // Never resolves during this test — stays loading
    mockListMyTimesheets.mockImplementation(() => new Promise(() => undefined));

    renderTimesheetsPage(makeUser("clinical_staff"));

    expect(screen.getByText(/loading timesheets/i)).toBeInTheDocument();
  });

  it("shows the clock widget for clinical_staff", async () => {
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
    });
  });

  it("shows an empty ledger message when staff has no entries", async () => {
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(
        screen.getByText(/no timesheet entries found/i),
      ).toBeInTheDocument();
    });
  });

  it("shows the approval queue heading for managers", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("shows an error alert when the fetch fails for staff", async () => {
    mockListMyTimesheets.mockRejectedValue(new Error("Unable to load timesheets"));

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows an error alert when the fetch fails for managers", async () => {
    mockListTimesheets.mockRejectedValue(new Error("Unable to load timesheets"));

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager cannot approve via staff view (RBAC guard in hook)
// ─────────────────────────────────────────────────────────────────────────────

describe("TimesheetsPage — RBAC enforcement", () => {
  it("clinical_staff sees clock widget, not approval queue", async () => {
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.queryByText(/approval queue/i)).not.toBeInTheDocument();
    });
  });

  it("manager sees approval queue, not clock widget", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.queryByText(/start shift/i)).not.toBeInTheDocument();
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });
});
