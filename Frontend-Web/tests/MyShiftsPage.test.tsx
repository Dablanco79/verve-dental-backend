/**
 * MyShiftsPage.test.tsx
 *
 * Coverage:
 *   View toggle:
 *     - Renders List and Calendar toggle buttons
 *     - Calendar mode renders Month and Week sub-selector
 *     - Month/Week switch works
 *     - List view is the default (no Month/Week buttons until Calendar is selected)
 *   List view clinic display:
 *     - Shows clinic location for a home-clinic shift (regression: Bentleigh → no blank location)
 *     - Shows clinic location for a cross-clinic shift
 *   Calendar view cross-clinic:
 *     - Cross-clinic clinic name appears in Week calendar view
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyShiftsPage } from "../src/pages/MyShiftsPage.js";
import {
  createStaffUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
  TEST_CLINIC_B_NAME,
  TEST_CLINIC_B_ID,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";
import type { RosterEntry } from "../src/types/roster.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { authTestState, mockGetMyShiftsAllClinics } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetMyShiftsAllClinics: vi.fn(),
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
    getMyShiftsAllClinics: mockGetMyShiftsAllClinics,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const staffUser = createStaffUser();

/** Builds a RosterEntry whose shift falls on TODAY so it appears in the
 *  current week/month calendar cell regardless of timezone. */
function buildTodayEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  const today = new Date();
  const start = new Date(today);
  start.setHours(8, 0, 0, 0);
  const end = new Date(today);
  end.setHours(17, 0, 0, 0);

  return {
    id: "entry-001",
    staffUserId: staffUser.id,
    staffEmail: staffUser.email,
    rosteredClinicId: "11111111-1111-4111-8111-111111111111",
    rosteredClinicName: TEST_CLINIC_NAME,
    shiftStartAt: start.toISOString(),
    shiftEndAt: end.toISOString(),
    shiftType: "standard",
    status: "scheduled",
    notes: null,
    createdByUserId: "admin-id",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MyShiftsPage />
    </MemoryRouter>,
  );
}

// ── View toggle tests ─────────────────────────────────────────────────────────

describe("MyShiftsPage — view toggle", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, staffUser);
    mockGetMyShiftsAllClinics.mockResolvedValue([]);
  });

  it("renders List and Calendar toggle buttons", async () => {
    renderPage();
    // Both toggle buttons should be visible from the start
    expect(await screen.findByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
  });

  it("does NOT show Month/Week sub-selector while in List mode (default)", async () => {
    renderPage();
    await screen.findByRole("button", { name: "List" }); // wait for mount
    // Month/Week buttons should not exist in List mode
    expect(screen.queryByRole("button", { name: "Month" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Week" })).not.toBeInTheDocument();
  });

  it("shows Month and Week sub-selector after switching to Calendar mode", async () => {
    const user = userEvent.setup();
    renderPage();
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);
    expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument();
  });

  it("Month button is active by default when Calendar mode is entered", async () => {
    const user = userEvent.setup();
    renderPage();
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);
    const monthBtn = screen.getByRole("button", { name: "Month" });
    expect(monthBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switching to Week mode marks Week as active", async () => {
    const user = userEvent.setup();
    renderPage();
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);
    const weekBtn = screen.getByRole("button", { name: "Week" });
    await user.click(weekBtn);
    expect(weekBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "false");
  });
});

// ── List view clinic display ──────────────────────────────────────────────────

describe("MyShiftsPage — List view shows clinic for all shifts", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, staffUser);
  });

  it("shows clinic name for a home-clinic shift (not hidden behind a cross-clinic guard)", async () => {
    mockGetMyShiftsAllClinics.mockResolvedValue([buildTodayEntry()]);
    renderPage();
    // The location line must always appear, even for the home clinic.
    const locationEl = await screen.findByText(
      (content) => content.includes(TEST_CLINIC_NAME),
    );
    expect(locationEl).toBeInTheDocument();
  });

  it("shows clinic name for a cross-clinic shift", async () => {
    mockGetMyShiftsAllClinics.mockResolvedValue([
      buildTodayEntry({
        id: "entry-cross",
        rosteredClinicId: TEST_CLINIC_B_ID,
        rosteredClinicName: TEST_CLINIC_B_NAME,
      }),
    ]);
    renderPage();
    const locationEl = await screen.findByText(
      (content) => content.includes(TEST_CLINIC_B_NAME),
    );
    expect(locationEl).toBeInTheDocument();
  });
});

// ── Calendar cross-clinic names ───────────────────────────────────────────────

describe("MyShiftsPage — Calendar shows cross-clinic names", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, staffUser);
  });

  it("displays cross-clinic clinic name in the Week calendar view", async () => {
    const user = userEvent.setup();
    mockGetMyShiftsAllClinics.mockResolvedValue([
      buildTodayEntry({
        id: "entry-cross-cal",
        rosteredClinicId: TEST_CLINIC_B_ID,
        rosteredClinicName: TEST_CLINIC_B_NAME,
      }),
    ]);
    renderPage();

    // Switch to Calendar mode
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);

    // Switch to Week view so the full clinic name is shown (month view truncates)
    const weekBtn = screen.getByRole("button", { name: "Week" });
    await user.click(weekBtn);

    // Week view renders the full clinic name on each shift card (as "📍 Clinic B Name")
    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes(TEST_CLINIC_B_NAME)),
      ).toBeInTheDocument();
    });
  });

  it("Week calendar shows cross-clinic shifts from all clinics", async () => {
    const user = userEvent.setup();
    mockGetMyShiftsAllClinics.mockResolvedValue([
      buildTodayEntry({ id: "entry-a", rosteredClinicName: TEST_CLINIC_NAME }),
      buildTodayEntry({
        id: "entry-b",
        rosteredClinicId: TEST_CLINIC_B_ID,
        rosteredClinicName: TEST_CLINIC_B_NAME,
      }),
    ]);
    renderPage();

    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);
    const weekBtn = screen.getByRole("button", { name: "Week" });
    await user.click(weekBtn);

    await waitFor(() => {
      // Multiple elements may contain the clinic name (e.g. page subtitle + week card).
      // Use getAllByText and check at least one is present.
      const clinicAEls = screen.getAllByText((content) => content.includes(TEST_CLINIC_NAME));
      expect(clinicAEls.length).toBeGreaterThan(0);
      const clinicBEls = screen.getAllByText((content) => content.includes(TEST_CLINIC_B_NAME));
      expect(clinicBEls.length).toBeGreaterThan(0);
    });
  });

  it("Home clinic shift and cross-clinic shift both display clinic name", async () => {
    mockGetMyShiftsAllClinics.mockResolvedValue([
      buildTodayEntry({ id: "entry-home", rosteredClinicName: TEST_CLINIC_NAME }),
      buildTodayEntry({
        id: "entry-other",
        rosteredClinicId: TEST_CLINIC_B_ID,
        rosteredClinicName: TEST_CLINIC_B_NAME,
      }),
    ]);
    renderPage();

    // In list view both clinic names should appear
    const clinicAEl = await screen.findByText(
      (content) => content.includes(TEST_CLINIC_NAME),
    );
    expect(clinicAEl).toBeInTheDocument();

    const clinicBEl = await screen.findByText(
      (content) => content.includes(TEST_CLINIC_B_NAME),
    );
    expect(clinicBEl).toBeInTheDocument();
  });
});

// ── GAP 2: Month calendar cross-clinic visibility ─────────────────────────────

describe("MyShiftsPage — Month calendar cross-clinic visibility", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, staffUser);
  });

  it("Month calendar shows shifts from Bentleigh East, Heathmont and Cheltenham all on the same view", async () => {
    const user = userEvent.setup();

    // Place the three entries on different days so they each get their own
    // calendar cell (the month view caps visible entries to 2 per day).
    const year = new Date().getFullYear();
    const month = new Date().getMonth();
    const makeShiftDates = (day: number) => ({
      shiftStartAt: new Date(year, month, day, 8, 0, 0, 0).toISOString(),
      shiftEndAt: new Date(year, month, day, 17, 0, 0, 0).toISOString(),
    });

    mockGetMyShiftsAllClinics.mockResolvedValue([
      buildTodayEntry({
        id: "entry-bentleigh",
        rosteredClinicName: "Bentleigh East",
        rosteredClinicId: TEST_CLINIC_ID,
        ...makeShiftDates(3),
      }),
      buildTodayEntry({
        id: "entry-heathmont",
        rosteredClinicName: "Heathmont",
        rosteredClinicId: TEST_CLINIC_B_ID,
        ...makeShiftDates(10),
      }),
      buildTodayEntry({
        id: "entry-cheltenham",
        rosteredClinicName: "Cheltenham",
        rosteredClinicId: "33333333-3333-4333-8333-333333333333",
        ...makeShiftDates(20),
      }),
    ]);

    renderPage();

    // Switch to Calendar mode — Month is the default sub-view
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);

    // All three clinic names should appear in the month grid
    await waitFor(() => {
      expect(
        screen.getAllByText((content) => content.includes("Bentleigh East")).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText((content) => content.includes("Heathmont")).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText((content) => content.includes("Cheltenham")).length,
      ).toBeGreaterThan(0);
    });
  });
});

// ── Calendar anchor navigation ────────────────────────────────────────────────

describe("MyShiftsPage — Calendar reloads on anchor navigation", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, staffUser);
  });

  it("Month calendar reloads data when anchor date changes", async () => {
    const user = userEvent.setup();
    mockGetMyShiftsAllClinics.mockResolvedValue([]);
    renderPage();

    // Switch to Calendar → Month
    const calBtn = await screen.findByRole("button", { name: "Calendar" });
    await user.click(calBtn);
    // Should have been called at least once on mount and again on calendar switch
    const callCountAfterCalendar = mockGetMyShiftsAllClinics.mock.calls.length;

    // Navigate to next month
    const nextBtn = screen.getByRole("button", { name: /Next month/i });
    await user.click(nextBtn);

    // Data should reload for the new month range
    await waitFor(() => {
      expect(mockGetMyShiftsAllClinics.mock.calls.length).toBeGreaterThan(callCountAfterCalendar);
    });
  });
});
