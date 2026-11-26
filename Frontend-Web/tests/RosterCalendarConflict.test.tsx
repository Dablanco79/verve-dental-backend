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

import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import {
  currentRosterCalendarDate,
  rosterFixtureInstant,
  rosterShiftAccessibleName,
} from "./helpers/rosterTime.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  authTestState,
  mockListRoster,
  mockListUsers,
  mockCheckShiftConflicts,
  mockCreateShift,
  mockUpdateShift,
  mockGetRosterAccessibleClinics,
  mockListRosterApprovedLeave,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
    mockCheckShiftConflicts: vi.fn(),
    mockCreateShift: vi.fn(),
    mockUpdateShift: vi.fn(),
    mockGetRosterAccessibleClinics: vi.fn(),
    mockListRosterApprovedLeave: vi.fn().mockResolvedValue([]),
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
    updateShift: mockUpdateShift,
    cancelShift: vi.fn(),
    checkShiftConflicts: mockCheckShiftConflicts,
    getRosterAccessibleClinics: mockGetRosterAccessibleClinics,
    listRosterApprovedLeave: mockListRosterApprovedLeave,
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
  const rosterDate = currentRosterCalendarDate();
  const now = new Date();
  return {
    id: "conflict-entry-001",
    staffUserId: testStaff.id,
    staffEmail: testStaff.email,
    rosteredClinicId: TEST_CLINIC_ID,
    rosteredClinicName: TEST_CLINIC_NAME,
    shiftStartAt: rosterFixtureInstant(rosterDate, "08:00"),
    shiftEndAt: rosterFixtureInstant(rosterDate, "17:00"),
    shiftType: "standard",
    status: "scheduled",
    notes: null,
    createdByUserId: managerUser.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
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

  // Date — use the authoritative Melbourne roster date.
  const dateValue = currentRosterCalendarDate();

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
    mockListRosterApprovedLeave.mockResolvedValue([]);
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

  it("shows approved leave as blocking and disables Save", async () => {
    const user = userEvent.setup();
    mockCheckShiftConflicts.mockResolvedValue({
      overlapping: [],
      sameDay: [],
      approvedLeave: [{
        leaveId: "leave-1",
        staffUserId: testStaff.id,
        staffEmail: testStaff.email,
        startDate: "2026-10-07",
        endDate: "2026-10-07",
      }],
    });

    renderPage();
    await openAndFillModal(user);

    expect(await screen.findByText(/Approved leave conflict/i)).toBeInTheDocument();
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByRole("button", { name: /Add shift/i })).toBeDisabled();
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
    mockListRosterApprovedLeave.mockResolvedValue([]);
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

describe("RosterCalendarPage — eligible staff loading states", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([]);
    mockListRosterApprovedLeave.mockResolvedValue([]);
    mockCheckShiftConflicts.mockResolvedValue({
      overlapping: [],
      sameDay: [],
    });
    mockCreateShift.mockResolvedValue(buildConflictEntry());
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListUsers.mockResolvedValue([testStaff]);
  });

  async function openAddShiftModal(user: ReturnType<typeof userEvent.setup>) {
    const addButtons = await screen.findAllByRole("button", {
      name: /Add shift/i,
    });
    await user.click(addButtons[0] as HTMLElement);
    return screen.findByRole("dialog", { name: "Add shift" });
  }

  it("displays eligible employees after a successful response", async () => {
    const user = userEvent.setup();
    renderPage();
    const modal = await openAddShiftModal(user);

    expect(
      await within(modal).findByRole("option", { name: /Alice Test/i }),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Add Shift employee selection and conflict preview behaviour", async () => {
    const user = userEvent.setup();
    renderPage();
    const modal = await openAddShiftModal(user);
    const staffSelect = await within(modal).findByLabelText(/Staff member/i);

    await user.selectOptions(staffSelect, testStaff.id);

    expect(staffSelect).toHaveValue(testStaff.id);
    await waitFor(
      () => {
        expect(mockCheckShiftConflicts).toHaveBeenCalledWith(
          TEST_CLINIC_ID,
          expect.objectContaining({ staffUserId: testStaff.id }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("displays a distinct empty state after a successful empty response", async () => {
    mockListUsers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    const modal = await openAddShiftModal(user);

    expect(
      await within(modal).findByRole("option", {
        name: "No eligible employees",
      }),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("displays an API error instead of an empty staff state", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
    mockListUsers.mockRejectedValue(new Error("Network unavailable"));

    const modal = await openAddShiftModal(user);

    expect(await within(modal).findByRole("alert")).toHaveTextContent(
      "Unable to load eligible employees. Please try again.",
    );
    expect(
      within(modal).queryByRole("option", { name: "No eligible employees" }),
    ).not.toBeInTheDocument();
  });

  it("retries a failed eligible-staff request and clears the error", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
    mockListUsers
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce([testStaff]);

    const modal = await openAddShiftModal(user);
    await user.click(await within(modal).findByRole("button", { name: "Retry" }));

    expect(
      await within(modal).findByRole("option", { name: /Alice Test/i }),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an older staff response after the clinic changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });

    let resolveClinicA:
      | ((staff: typeof testStaff[]) => void)
      | undefined;
    const clinicAResponse = new Promise<typeof testStaff[]>((resolve) => {
      resolveClinicA = resolve;
    });
    mockListUsers.mockImplementation((requestedClinicId: string) =>
      requestedClinicId === TEST_CLINIC_B_ID
        ? Promise.resolve([testStaff2])
        : clinicAResponse,
    );

    const modal = await openAddShiftModal(user);
    await user.selectOptions(
      within(modal).getByLabelText(/Clinic \/ Location/i),
      TEST_CLINIC_B_ID,
    );
    expect(
      await within(modal).findByRole("option", { name: /Bob Builder/i }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveClinicA?.([testStaff]);
      await clinicAResponse;
    });

    expect(
      within(modal).queryByRole("option", { name: /Alice Test/i }),
    ).not.toBeInTheDocument();
    expect(
      within(modal).getByRole("option", { name: /Bob Builder/i }),
    ).toBeInTheDocument();
  });

  it("blocks shift submission while eligible staff loading has failed", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
    mockListUsers.mockRejectedValue(new Error("Network unavailable"));

    const modal = await openAddShiftModal(user);
    await within(modal).findByRole("alert");
    const submit = within(modal).getByRole("button", { name: "Add shift" });

    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mockCreateShift).not.toHaveBeenCalled();
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
  const shiftBtn = await screen.findByRole("button", {
    name: rosterShiftAccessibleName(
      testStaff.displayName ?? testStaff.email,
      entryForEdit.shiftStartAt,
      entryForEdit.shiftEndAt,
    ),
  });
  await user.click(shiftBtn);
}

describe("RosterCalendarPage — Clinic/Location in Edit Shift modal", () => {
  beforeEach(() => {
    mockCheckShiftConflicts.mockClear();
    mockUpdateShift.mockClear();
  });

  it("retains the original employee as immutable edit-shift context", async () => {
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
    expect(within(modal).queryByLabelText(/Staff member/i)).not.toBeInTheDocument();
    expect(within(modal).getByText("Alice Test")).toBeInTheDocument();
    expect(within(modal).getByText(testStaff.email)).toBeInTheDocument();
  });

  it("preserves the original employee when moving an edit to an eligible clinic", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry({ staffUserId: testStaff.id });
    mockListUsers.mockResolvedValue([testStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });
    mockUpdateShift.mockResolvedValue({
      ...conflictEntry,
      rosteredClinicId: TEST_CLINIC_B_ID,
      rosteredClinicName: TEST_CLINIC_B_NAME,
    });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();
    await openEditModal(user, conflictEntry);
    const modal = await screen.findByRole("dialog");
    const clinicSelect = within(modal).getByLabelText(/Clinic \/ Location/i);
    await user.selectOptions(clinicSelect, TEST_CLINIC_B_ID);

    await waitFor(() => {
      expect(within(modal).queryByRole("alert")).not.toBeInTheDocument();
      expect(
        within(modal).getByRole("button", { name: "Save changes" }),
      ).not.toBeDisabled();
    });
    expect(within(modal).getByText("Alice Test")).toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(mockUpdateShift).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        conflictEntry.id,
        expect.objectContaining({ rosteredClinicId: TEST_CLINIC_B_ID }),
      );
    });
    const updatePayload = mockUpdateShift.mock.calls[0]?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).not.toHaveProperty("staffUserId");
  });

  it("blocks save when the original employee is ineligible at the destination", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();
    mockListUsers.mockImplementation((clinicId: string) =>
      Promise.resolve(
        clinicId === TEST_CLINIC_B_ID ? [testStaff2] : [testStaff],
      ),
    );
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();
    await openEditModal(user, conflictEntry);
    const modal = await screen.findByRole("dialog");
    await user.selectOptions(
      within(modal).getByLabelText(/Clinic \/ Location/i),
      TEST_CLINIC_B_ID,
    );

    expect(await within(modal).findByRole("alert")).toHaveTextContent(
      "This employee is not eligible to be rostered at the selected clinic.",
    );
    expect(
      within(modal).getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    expect(within(modal).getByText("Alice Test")).toBeInTheDocument();
    expect(mockUpdateShift).not.toHaveBeenCalled();
  });

  it("checks edit conflicts for the original employee after a clinic move", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();
    mockListUsers.mockResolvedValue([testStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();
    await openEditModal(user, conflictEntry);
    const modal = await screen.findByRole("dialog");
    mockCheckShiftConflicts.mockClear();
    await user.selectOptions(
      within(modal).getByLabelText(/Clinic \/ Location/i),
      TEST_CLINIC_B_ID,
    );

    await waitFor(
      () => {
        expect(mockCheckShiftConflicts).toHaveBeenCalledWith(
          TEST_CLINIC_B_ID,
          expect.objectContaining({
            staffUserId: conflictEntry.staffUserId,
            excludeEntryId: conflictEntry.id,
          }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("preserves the edited employee when eligible-staff loading fails", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();
    mockListUsers.mockResolvedValueOnce([testStaff]).mockRejectedValue(
      new Error("Network unavailable"),
    );
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();
    await openEditModal(user, conflictEntry);
    const modal = await screen.findByRole("dialog");

    expect(await within(modal).findByRole("alert")).toHaveTextContent(
      "Unable to load eligible employees. Please try again.",
    );
    expect(within(modal).getByText("Alice Test")).toBeInTheDocument();
    expect(
      within(modal).getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
  });

  it("ignores stale clinic eligibility without changing the edited employee", async () => {
    const user = userEvent.setup();
    const conflictEntry = buildConflictEntry();
    mockListUsers.mockResolvedValue([testStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ]);
    mockListRoster.mockResolvedValue([conflictEntry]);
    mockCheckShiftConflicts.mockResolvedValue({ overlapping: [], sameDay: [] });

    setAuthenticatedUser(authTestState, managerUser);
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });

    let resolveClinicA:
      | ((staff: typeof testStaff[]) => void)
      | undefined;
    const staleClinicAResponse = new Promise<typeof testStaff[]>((resolve) => {
      resolveClinicA = resolve;
    });
    mockListUsers.mockImplementation((clinicId: string) =>
      clinicId === TEST_CLINIC_B_ID
        ? Promise.resolve([testStaff])
        : staleClinicAResponse,
    );

    await openEditModal(user, conflictEntry);
    const modal = await screen.findByRole("dialog");
    await user.selectOptions(
      within(modal).getByLabelText(/Clinic \/ Location/i),
      TEST_CLINIC_B_ID,
    );
    await waitFor(() => {
      expect(
        within(modal).getByRole("button", { name: "Save changes" }),
      ).not.toBeDisabled();
    });

    await act(async () => {
      resolveClinicA?.([]);
      await staleClinicAResponse;
    });

    expect(within(modal).getByText("Alice Test")).toBeInTheDocument();
    expect(within(modal).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(modal).getByRole("button", { name: "Save changes" }),
    ).not.toBeDisabled();
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

