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
  TEST_CLINIC_B_ID,
  TEST_CLINIC_B_NAME,
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
  mockGetRosterAccessibleClinics,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
    mockCheckShiftConflicts: vi.fn(),
    mockCreateShift: vi.fn(),
    mockGetRosterAccessibleClinics: vi.fn(),
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
    getRosterAccessibleClinics: mockGetRosterAccessibleClinics,
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
  // Wait for the page to load accessible clinics and render "Add shift" buttons.
  await waitFor(() => {
    expect(mockGetRosterAccessibleClinics).toHaveBeenCalled();
  });
  const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
  await user.click(addBtns[0] as HTMLElement);

  // Wait for the form staff list to finish loading (formStaffList useEffect)
  await waitFor(() => {
    const staffSelect = screen.queryByLabelText(/Staff member/i);
    expect(staffSelect).not.toBeDisabled();
  });

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
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
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

// ── Clinic/Location dropdown in Add Shift modal ────────────────────────────────

// Minimal eligible-staff fixture — only fields returned by listRosterEligibleStaff.
const testStaff2 = {
  id: "staff-id-2222",
  email: "bob@clinic-b.au",
  firstName: "Bob",
  lastName: "Builder",
  displayName: "Bob Builder",
};

describe("RosterCalendarPage — Clinic/Location dropdown in Add Shift modal", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });
  });

  it("Clinic/Location dropdown appears in Add Shift modal when multiple clinics are accessible", async () => {
    mockListUsers.mockResolvedValue([testStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);

    const user = userEvent.setup();
    renderPage();

    // Wait for accessible clinics to load
    await waitFor(() => { expect(mockGetRosterAccessibleClinics).toHaveBeenCalled(); });

    const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
    await user.click(addBtns[0] as HTMLElement);

    // Wait for modal to open
    const modal = await screen.findByRole("dialog");

    // Clinic dropdown should be visible
    const clinicSelect = within(modal).getByLabelText(/Clinic \/ Location/i);
    expect(clinicSelect).toBeInTheDocument();

    // Both clinic names should be available as options
    const clinicNameA = TEST_CLINIC_NAME as string;
    const clinicNameB = TEST_CLINIC_B_NAME as string;
    expect(within(modal).getByText(clinicNameA)).toBeInTheDocument();
    expect(within(modal).getByText(clinicNameB)).toBeInTheDocument();
  });

  it("Changing clinic in Add Shift modal clears the staff selection", async () => {
    // Call order:
    //   1. Global staffList effect (mount, targetClinicId = TEST_CLINIC_ID)   → [testStaff]
    //   2. formStaffList effect when modal opens (clinic A)                   → [testStaff]
    //   3. formStaffList effect when clinic changes to B                      → [testStaff2]
    mockListUsers
      .mockResolvedValueOnce([testStaff])   // 1: global staffList on mount
      .mockResolvedValueOnce([testStaff])   // 2: formStaffList — modal open, clinic A
      .mockResolvedValue([testStaff2]);     // 3: formStaffList — clinic B
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => { expect(mockGetRosterAccessibleClinics).toHaveBeenCalled(); });

    const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
    await user.click(addBtns[0] as HTMLElement);

    const modal = await screen.findByRole("dialog");

    // Wait for staff to load for the initial clinic
    await waitFor(() => {
      const sel = within(modal).queryByLabelText(/Staff member/i);
      expect(sel).not.toBeDisabled();
    });

    // Select a staff member
    const staffSelect = within(modal).getByLabelText(/Staff member/i);
    await user.selectOptions(staffSelect, testStaff.id);
    expect(staffSelect).toHaveValue(testStaff.id);

    // Now change the clinic
    const clinicSelect = within(modal).getByLabelText(/Clinic \/ Location/i);
    const clinicBId = TEST_CLINIC_B_ID as string;
    await user.selectOptions(clinicSelect, clinicBId);

    // Staff selection should be cleared
    await waitFor(() => {
      expect(within(modal).getByLabelText(/Staff member/i)).toHaveValue("");
    });
  });
});

// ── Edit Shift Location ───────────────────────────────────────────────────────

/**
 * Opens the edit modal for an existing shift card.
 * Shift cards in month/week view have an aria-label starting with "Shift:".
 */
async function openEditModal(
  user: ReturnType<typeof userEvent.setup>,
  entryForEdit: ReturnType<typeof buildConflictEntry>,
) {
  await waitFor(() => {
    expect(mockGetRosterAccessibleClinics).toHaveBeenCalled();
  });
  // Format the start time to match the aria-label
  const startTimeStr = new Date(entryForEdit.shiftStartAt).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const shiftBtn = await screen.findByRole("button", {
    name: new RegExp(`Shift:.*${startTimeStr}`, "i"),
  });
  await user.click(shiftBtn);
}

describe("RosterCalendarPage — Clinic/Location in Edit Shift modal", () => {
  it("Edit Shift modal shows editable Clinic/Location dropdown with current clinic pre-selected", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();

    mockListRoster.mockResolvedValue([conflictEntry]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListUsers.mockResolvedValue([testStaff]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();

    // Switch to week view so the shift card is visible
    const weekBtn = await screen.findByRole("button", { name: "Week" });
    await user.click(weekBtn);

    // Open the edit modal by clicking the shift card
    await openEditModal(user, conflictEntry);

    const modal = await screen.findByRole("dialog");

    // Clinic dropdown should be present and editable
    await waitFor(() => {
      const clinicSelect = within(modal).getByLabelText(/Clinic \/ Location/i);
      expect(clinicSelect).toBeInTheDocument();
      expect(clinicSelect.tagName).toBe("SELECT");
      expect(clinicSelect).toHaveValue(TEST_CLINIC_ID);
    });
  });

  it("Changing clinic in Edit Shift clears staff when not eligible at new clinic", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry({ staffUserId: testStaff.id });

    // Call order:
    //   1. Global staffList effect (mount)           → [testStaff]
    //   2. formStaffList effect (modal open, A)      → [testStaff]
    //   3. formStaffList effect (clinic changed to B)→ [testStaff2]
    mockListUsers
      .mockResolvedValueOnce([testStaff])   // 1: global staffList on mount
      .mockResolvedValueOnce([testStaff])   // 2: formStaffList — modal open, clinic A
      .mockResolvedValue([testStaff2]);     // 3: formStaffList — clinic B

    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();

    // Switch to week view
    const weekBtn = await screen.findByRole("button", { name: "Week" });
    await user.click(weekBtn);

    // Open edit modal
    await openEditModal(user, conflictEntry);

    const modal = await screen.findByRole("dialog");

    // Wait for staff select to load with pre-populated value
    await waitFor(() => {
      const staffSel = within(modal).getByLabelText(/Staff member/i);
      expect(staffSel).toHaveValue(testStaff.id);
    });

    // Change the clinic to clinic B
    const clinicSelect = within(modal).getByLabelText(/Clinic \/ Location/i);
    await user.selectOptions(clinicSelect, TEST_CLINIC_B_ID);

    // Staff selection should be cleared (testStaff not in clinic B list)
    await waitFor(() => {
      expect(within(modal).getByLabelText(/Staff member/i)).toHaveValue("");
    });
  });

  it("Edit Shift excludes the entry itself from conflict checking (excludeEntryId passed)", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();

    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
    mockListUsers.mockResolvedValue([testStaff]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });
    mockListRoster.mockResolvedValue([conflictEntry]);

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();

    // Open the edit modal (month view default — shift card is visible)
    await openEditModal(user, conflictEntry);

    // The conflict check fires automatically (debounced 350ms) once all form
    // fields are pre-populated from formFromEntry.
    await waitFor(
      () => {
        expect(mockCheckShiftConflicts).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ excludeEntryId: conflictEntry.id }),
        );
      },
      { timeout: 2000 },
    );
  });
});

