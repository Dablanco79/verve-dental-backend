/**
 * RosterCalendarConflict.test.tsx
 *
 * Focused regression tests for the conflict-detection UI in the Add Shift modal.
 *
 * Coverage:
 *   - Overlapping shifts → RED conflict banner shown, Save button disabled
 *   - Same-day non-overlapping shifts → AMBER warning banner, Save stays enabled
 *   - No conflicts → no banner rendered
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RosterCalendarPage } from "../src/pages/RosterCalendarPage.js";
import type { StaffUser } from "../src/types/index.js";
import type { RosterEntry } from "../src/types/roster.js";
import {
  createManagerUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  authTestState,
  mockListRoster,
  mockListUsers,
  mockCheckShiftConflicts,
  mockCreateShift,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
    mockCheckShiftConflicts: vi.fn(),
    mockCreateShift: vi.fn(),
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
    listRoster: mockListRoster,
    listRosterEligibleStaff: mockListUsers,
    createShift: mockCreateShift,
    updateShift: vi.fn(),
    cancelShift: vi.fn(),
    checkShiftConflicts: mockCheckShiftConflicts,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const managerUser = createManagerUser();

const testStaff: StaffUser = {
  id: "staff-id-1111",
  email: "alice@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: "Alice",
  lastName: "Test",
  displayName: "Alice Test",
  payrollTrack: "hourly",
};

function buildConflictEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  const today = new Date();
  const start = new Date(today);
  start.setHours(8, 0, 0, 0);
  const end = new Date(today);
  end.setHours(17, 0, 0, 0);
  return {
    id: "conflict-entry-001",
    staffUserId: testStaff.id,
    staffEmail: testStaff.email,
    rosteredClinicId: TEST_CLINIC_ID,
    rosteredClinicName: TEST_CLINIC_NAME,
    shiftStartAt: start.toISOString(),
    shiftEndAt: end.toISOString(),
    shiftType: "standard",
    status: "scheduled",
    notes: null,
    createdByUserId: managerUser.id,
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RosterCalendarPage />
    </MemoryRouter>,
  );
}

/** Open the Add Shift modal and fill in all required form fields.
 *  The conflict debounce (350 ms) will fire after the last field is set. */
async function openAndFillModal(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the page to load staff list and render "Add shift" buttons.
  await waitFor(() => {
    expect(mockListUsers).toHaveBeenCalled();
  });
  const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
  await user.click(addBtns[0] as HTMLElement);

  // Staff selector
  const staffSelect = screen.getByLabelText(/Staff member/i);
  await user.selectOptions(staffSelect, testStaff.id);

  // Date — use today's date so buildIso produces a valid ISO string
  const today = new Date();
  const yyyy = today.getFullYear().toString();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateValue = `${yyyy}-${mm}-${dd}`;

  const dateInput = screen.getByLabelText(/^Date$/i);
  // For date inputs userEvent needs the value set directly via type or fill
  await user.clear(dateInput);
  await user.type(dateInput, dateValue);

  // Start and end times
  const startInput = screen.getByLabelText(/Start time/i);
  await user.clear(startInput);
  await user.type(startInput, "09:00");

  const endInput = screen.getByLabelText(/End time/i);
  await user.clear(endInput);
  await user.type(endInput, "17:00");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RosterCalendarPage — conflict banner (overlapping shifts)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([testStaff]);
  });

  it("shows RED conflict banner and disables Save when overlapping shifts are found", async () => {
    const user = userEvent.setup();
    const conflicting = buildConflictEntry();
    mockCheckShiftConflicts.mockResolvedValue({
      overlapping: [conflicting],
      sameDay: [],
    });

    renderPage();
    await openAndFillModal(user);

    // Wait for the debounce (350 ms) to fire and the API response to arrive.
    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/Roster conflict detected/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Save button must be disabled when there are overlapping conflicts.
    // The modal's submit button is inside the dialog; use `within` to avoid
    // matching the grid's "+ Add shift" buttons.
    const modal = screen.getByRole("dialog");
    const saveBtn = within(modal).getByRole("button", { name: /Add shift/i });
    expect(saveBtn).toBeDisabled();
  });

  it("shows AMBER same-day banner and keeps Save enabled when shifts are same-day but non-overlapping", async () => {
    const user = userEvent.setup();
    const sameDayEntry = buildConflictEntry({ id: "same-day-entry" });
    mockCheckShiftConflicts.mockResolvedValue({
      overlapping: [],
      sameDay: [sameDayEntry],
    });

    renderPage();
    await openAndFillModal(user);

    await waitFor(
      () => {
        // The AMBER banner text is rendered inside a <strong> element.
        expect(screen.getByText(/Same-day shift notice/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Save must remain ENABLED for same-day-only warnings.
    const modal = screen.getByRole("dialog");
    const saveBtn = within(modal).getByRole("button", { name: /Add shift/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("renders no conflict banner when no conflicts are detected", async () => {
    const user = userEvent.setup();
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    renderPage();
    await openAndFillModal(user);

    await waitFor(
      () => {
        expect(mockCheckShiftConflicts).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Roster conflict detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Same-day shift notice/i)).not.toBeInTheDocument();

    const modal = screen.getByRole("dialog");
    const saveBtn = within(modal).getByRole("button", { name: /Add shift/i });
    expect(saveBtn).not.toBeDisabled();
  });
});
