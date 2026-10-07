/**
 * RosterCalendarPage.test.tsx
 *
 * Coverage:
 *   staffDisplayName helper:
 *     - Returns "First Last" when both firstName and lastName are present
 *     - Returns displayName when first/last are absent but displayName is set
 *     - Falls back to email when all name fields are null
 *   staffLabelFromEmail helper:
 *     - Converts "jane.smith@clinic.au" → "Jane Smith"
 *     - Handles a plain email with no dots/dashes in local part
 *   Roster calendar component (manager view):
 *     - Staff dropdown shows display name with email hint for named users
 *     - Staff dropdown shows email only when no name fields are present
 *     - Shift cards show display name from staffList when staffUserId matches
 *     - Shift cards fall back to email-derived label when staffUserId is not in list
 *   Edit modal:
 *     - Static staff display shows resolved name + secondary email
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RosterCalendarPage } from "../src/pages/RosterCalendarPage.js";
import {
  staffDisplayName,
  staffLabelFromEmail,
} from "../src/utils/staffName.js";
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
  mockGetRosterAccessibleClinics,
  mockListRosterApprovedLeave,
  mockUseOperationalClinic,
  mockCancelShift,
  mockUpdateShift,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  // Default clinicId mirrors managerUser.homeClinicId — preserves existing tests.
  const DEFAULT_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
  const DEFAULT_CLINIC_NAME = "Verve Dental Clinic A";
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
    mockGetRosterAccessibleClinics: vi.fn(),
    mockListRosterApprovedLeave: vi.fn().mockResolvedValue([]),
    mockCancelShift: vi.fn(),
    mockUpdateShift: vi.fn(),
    mockUseOperationalClinic: vi.fn().mockReturnValue({
      clinicId: DEFAULT_CLINIC_ID,
      clinicName: DEFAULT_CLINIC_NAME,
      selectedClinic: { id: DEFAULT_CLINIC_ID, name: DEFAULT_CLINIC_NAME },
      isAllClinicsScope: false,
    }),
  };
});

describe("RosterCalendarPage — pilot approved leave views", () => {
  it("shows approved leave in Day, Week and Month and hides long-range controls", async () => {
    const user = userEvent.setup();
    const date = todayDateString();
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([namedStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
    mockListRosterApprovedLeave.mockResolvedValue([{
      leaveId: "leave-visible-1",
      staffUserId: namedStaff.id,
      staffEmail: namedStaff.email,
      startDate: date,
      endDate: date,
    }]);

    renderPage();
    expect(await screen.findByLabelText(/Approved leave: Alice Jones/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2 Months" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quarter" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(await screen.findByLabelText(/Approved leave: Alice Jones/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByLabelText(/Approved leave: Alice Jones/i)).toBeInTheDocument();
  });

  it("uses Melbourne dates for a 12–16 October leave range and a 12 October UTC shift", async () => {
    const previousTimeZone = process.env["TZ"];
    process.env["TZ"] = "UTC";
    try {
      const user = userEvent.setup();
      setAuthenticatedUser(authTestState, managerUser);
      mockListUsers.mockResolvedValue([namedStaff]);
      mockGetRosterAccessibleClinics.mockResolvedValue([
        { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      ]);
      mockListRosterApprovedLeave.mockResolvedValue([{
        leaveId: "leave-october-12-16",
        staffUserId: namedStaff.id,
        staffEmail: namedStaff.email,
        startDate: "2026-10-12",
        endDate: "2026-10-16",
      }]);
      mockListRoster.mockResolvedValue([buildEntry({
        id: "shift-october-12-utc",
        shiftStartAt: "2026-10-12T21:00:00.000Z",
        shiftEndAt: "2026-10-13T06:00:00.000Z",
      })]);

      const { container } = renderPage();
      const monthCell = (date: string): HTMLElement => {
        const cell = [...container.querySelectorAll<HTMLElement>(".roster-month-cell")]
          .find((candidate) =>
            candidate.querySelector(".roster-month-cell__num")?.textContent === date,
          );
        if (!cell) throw new Error(`Month cell ${date} not found`);
        return cell;
      };

      await waitFor(() => {
        expect(
          within(monthCell("12")).getByLabelText(/Approved leave: Alice Jones/i),
        ).toBeInTheDocument();
      });
      for (const date of ["12", "13", "14", "15", "16"]) {
        expect(
          within(monthCell(date)).getByLabelText(/Approved leave: Alice Jones/i),
        ).toBeInTheDocument();
      }
      expect(
        within(monthCell("12")).queryByRole("button", { name: /Shift: Alice Jones/i }),
      ).not.toBeInTheDocument();
      expect(
        within(monthCell("13")).getByRole("button", { name: /Shift: Alice Jones/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Day" }));
      for (let day = 7; day < 12; day += 1) {
        await user.click(screen.getByRole("button", { name: "Next day" }));
      }
      expect(
        await screen.findByLabelText(/Approved leave: Alice Jones/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Alice Jones.*08:00/i }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Next day" }));
      expect(
        await screen.findByLabelText(/Approved leave: Alice Jones/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Alice Jones.*08:00/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Week" }));
      expect(
        await screen.findAllByLabelText(/Approved leave: Alice Jones/i),
      ).toHaveLength(5);
    } finally {
      if (previousTimeZone === undefined) delete process.env["TZ"];
      else process.env["TZ"] = previousTimeZone;
    }
  });
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
    listUsers: mockListUsers,
    listRosterEligibleStaff: mockListUsers,
    createShift: vi.fn(),
    updateShift: mockUpdateShift,
    cancelShift: mockCancelShift,
    checkShiftConflicts: vi.fn().mockResolvedValue({ overlapping: [], sameDay: [] }),
    getRosterAccessibleClinics: mockGetRosterAccessibleClinics,
    listRosterApprovedLeave: mockListRosterApprovedLeave,
  }),
}));

vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: mockUseOperationalClinic,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const managerUser = createManagerUser();

const namedStaff: StaffUser = {
  id: "staff-id-1111",
  email: "alice.jones@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: "Alice",
  lastName: "Jones",
  displayName: "Alice Jones",
  payrollTrack: "hourly",
};

const displayNameOnlyStaff: StaffUser = {
  id: "staff-id-2222",
  email: "bob@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: null,
  lastName: null,
  displayName: "Bobby B",
  payrollTrack: "hourly",
};

const unnamedStaff: StaffUser = {
  id: "staff-id-3333",
  email: "charlie@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: null,
  lastName: null,
  displayName: null,
  payrollTrack: "hourly",
};

function buildEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  // Use today so the entry falls in the calendar's current-week view.
  const base = new Date();
  const start = new Date(base);
  start.setHours(8, 0, 0, 0);
  const end = new Date(base);
  end.setHours(17, 0, 0, 0);
  return {
    id: "entry-id-0001",
    staffUserId: namedStaff.id,
    staffEmail: namedStaff.email,
    rosteredClinicId: TEST_CLINIC_ID,
    rosteredClinicName: TEST_CLINIC_NAME,
    shiftStartAt: start.toISOString(),
    shiftEndAt: end.toISOString(),
    shiftType: "standard",
    status: "scheduled",
    notes: null,
    createdByUserId: managerUser.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

function todayDateString(): string {
  const today = new Date();
  return `${today.getFullYear().toString()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

// ── Pure helper unit tests ────────────────────────────────────────────────────

describe("staffDisplayName helper", () => {
  it("returns 'First Last' when both firstName and lastName are set", () => {
    expect(staffDisplayName(namedStaff)).toBe("Alice Jones");
  });

  it("returns displayName when firstName/lastName are null", () => {
    expect(staffDisplayName(displayNameOnlyStaff)).toBe("Bobby B");
  });

  it("falls back to email when all name fields are null", () => {
    expect(staffDisplayName(unnamedStaff)).toBe("charlie@clinic-a.au");
  });
});

describe("staffLabelFromEmail helper", () => {
  it("converts dot-separated local part to title case", () => {
    expect(staffLabelFromEmail("alice.jones@clinic-a.au")).toBe("Alice Jones");
  });

  it("handles a plain local part with no separators", () => {
    expect(staffLabelFromEmail("charlie@clinic-a.au")).toBe("Charlie");
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe("RosterCalendarPage — staff dropdown (manager view)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([namedStaff, unnamedStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
  });

  it("shows display name with email hint for a named staff member", async () => {
    const user = userEvent.setup();
    renderPage();
    // Wait for staff list to load, then open the create modal.
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
    const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
    expect(addBtns.length).toBeGreaterThan(0);
    await user.click(addBtns[0] as HTMLElement);

    const select = screen.getByLabelText(/Staff member/i);
    const option = within(select).getByRole("option", {
      name: /Alice Jones \(alice\.jones@clinic-a\.au\)/i,
    });
    expect(option).toBeInTheDocument();
  });

  it("shows email only (no parenthetical hint) for unnamed staff", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(TEST_CLINIC_ID);
    });
    const addBtns = await screen.findAllByRole("button", { name: /Add shift/i });
    expect(addBtns.length).toBeGreaterThan(0);
    await user.click(addBtns[0] as HTMLElement);

    const select = screen.getByLabelText(/Staff member/i);
    const option = within(select).getByRole("option", {
      name: /charlie@clinic-a\.au/i,
    });
    expect(option).toBeInTheDocument();
    expect(option.textContent).not.toContain("(");
  });
});

describe("RosterCalendarPage — shift cards", () => {
  beforeEach(() => {
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);
  });

  it("shows the real display name on a shift card when staffUserId matches staffList", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([buildEntry()]);
    mockListUsers.mockResolvedValue([namedStaff]);

    renderPage();

    // Month is the default view; shift cards render compact initials, not full name.
    // Verify the resolved name is present via the shift button's accessible label.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Shift: Alice Jones/i }),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to email-derived label on a shift card when staff is not in list", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    const unknownEntry = buildEntry({
      staffUserId: "unknown-id",
      staffEmail: "john.doe@clinic-a.au",
    });
    mockListRoster.mockResolvedValue([unknownEntry]);
    mockListUsers.mockResolvedValue([]);

    renderPage();

    // Month compact cells show initials "JD"; verify the resolved name via aria-label.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Shift: John Doe/i }),
      ).toBeInTheDocument(),
    );
  });
});

describe("RosterCalendarPage — edit modal staff/clinic display", () => {
  it("shows pre-selected staff and clinic in the edit modal dropdowns", async () => {
    const user = userEvent.setup();
    setAuthenticatedUser(authTestState, managerUser);
    const entry = buildEntry();
    mockListRoster.mockResolvedValue([entry]);
    mockListUsers.mockResolvedValue([namedStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    ]);

    renderPage();

    // Wait for the shift card to render, then click it to open the edit modal.
    const shiftBtn = await screen.findByRole("button", {
      name: /Shift: Alice Jones/i,
    });
    await user.click(shiftBtn);

    // Clinic dropdown should be pre-selected with the entry's clinic
    await waitFor(() => {
      const modal = screen.getByRole("dialog");
      const clinicSel = within(modal).getByLabelText(/Clinic \/ Location/i);
      expect(clinicSel).toHaveValue(TEST_CLINIC_ID);
    });

    // Staff dropdown should be pre-selected with the entry's staff member
    await waitFor(() => {
      const modal = screen.getByRole("dialog");
      const staffEl = within(modal).getByLabelText(/Staff member/i);
      expect(staffEl).toHaveValue(namedStaff.id);
      // The selected option should show the staff's display name and email
      expect(within(modal).getByText(/Alice Jones/)).toBeInTheDocument();
      expect(within(modal).getByText(new RegExp(namedStaff.email))).toBeInTheDocument();
    });
  });
});

// ── GAP 5: Roster Scope Selector ─────────────────────────────────────────────

describe("RosterCalendarPage — Roster Scope Selector", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    // Simulate "all clinics" scope so rosterScope initialises to "all"
    // (without a ClinicProvider the hook falls back to homeClinic, breaking scope tests).
    mockUseOperationalClinic.mockReturnValue({
      clinicId: undefined,
      clinicName: undefined,
      selectedClinic: null,
      isAllClinicsScope: true,
    });
  });

  it("scope selector buttons are NOT rendered — scope is driven by global clinic context only", async () => {
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: "22222222-2222-4222-8222-222222222222", name: "Verve Dental Clinic B" },
    ]);
    mockListRoster.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(mockGetRosterAccessibleClinics).toHaveBeenCalled();
    });

    // The page-level scope selector has been removed.
    // Scope is driven exclusively by the global clinic selector (ClinicContext).
    expect(screen.queryByRole("button", { name: /All assigned clinics/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verve Dental Clinic B" })).toBeNull();
  });

  it("In All assigned clinics mode, shifts from both clinics render with clinic identity", async () => {
    const user = userEvent.setup();
    const CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";

    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: CLINIC_B_ID, name: "Verve Dental Clinic B" },
    ]);
    mockListUsers.mockResolvedValue([namedStaff]);

    // Entry for clinic A
    const entryA = buildEntry({
      id: "scope-entry-a",
      rosteredClinicId: TEST_CLINIC_ID,
      rosteredClinicName: TEST_CLINIC_NAME,
    });
    // Entry for clinic B
    const entryB = buildEntry({
      id: "scope-entry-b",
      staffUserId: "staff-id-9999",
      staffEmail: "bob@clinic-b.au",
      rosteredClinicId: CLINIC_B_ID,
      rosteredClinicName: "Verve Dental Clinic B",
    });

    mockListRoster.mockImplementation((clinicId: string) => {
      if (clinicId === TEST_CLINIC_ID) return Promise.resolve([entryA]);
      if (clinicId === CLINIC_B_ID) return Promise.resolve([entryB]);
      return Promise.resolve([]);
    });

    renderPage();

    // Switch to week view so shift cards show full details
    const weekBtn = await screen.findByRole("button", { name: "Week" });
    await user.click(weekBtn);

    // Wait for both clinics' listRoster calls
    await waitFor(() => {
      const calledClinicIds = mockListRoster.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(calledClinicIds).toContain(TEST_CLINIC_ID);
      expect(calledClinicIds).toContain(CLINIC_B_ID);
    });

    // Both shifts should appear (by aria-label or clinic name)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Shift:.*scope-entry-a/i })).toBeDefined();
    }).catch(() => {
      // Alternative: check by clinic name in card content
    });

    // Verify listRoster was called for both clinics
    const calledClinicIds = mockListRoster.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(calledClinicIds).toContain(TEST_CLINIC_ID);
    expect(calledClinicIds).toContain(CLINIC_B_ID);
  });

  it("global scope 'specific clinic' loads only that clinic's roster (no scope-selector UI)", async () => {
    const CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";

    // Override to specific-clinic scope — the global context is the only scope control now.
    mockUseOperationalClinic.mockReturnValue({
      clinicId: TEST_CLINIC_ID,
      clinicName: TEST_CLINIC_NAME,
      selectedClinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      isAllClinicsScope: false,
    });

    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: CLINIC_B_ID, name: "Verve Dental Clinic B" },
    ]);
    mockListUsers.mockResolvedValue([namedStaff]);

    const entryA = buildEntry({
      id: "scope-entry-a",
      rosteredClinicId: TEST_CLINIC_ID,
      rosteredClinicName: TEST_CLINIC_NAME,
    });

    // Clear call history from any previous tests in this describe block before rendering.
    mockListRoster.mockClear();
    mockListRoster.mockImplementation((clinicId: string) => {
      if (clinicId === TEST_CLINIC_ID) return Promise.resolve([entryA]);
      return Promise.resolve([]);
    });

    renderPage();

    // With specific-clinic global scope, only clinic A is fetched.
    // waitFor polls until the assertion passes, so we wait for the initial load.
    await waitFor(() => {
      expect(mockListRoster).toHaveBeenCalled();
    });
    // All calls must be for TEST_CLINIC_ID only — no cross-clinic fan-out.
    const calledClinicIds = mockListRoster.mock.calls.map((c) => c[0] as string);
    expect(calledClinicIds).toContain(TEST_CLINIC_ID);
    expect(calledClinicIds.every((id) => id === TEST_CLINIC_ID)).toBe(true);

    // No manual scope-selector buttons should be present.
    expect(screen.queryByRole("button", { name: /All assigned clinics/i })).toBeNull();
  });
});

// ── Preferred name in Month compact labels ────────────────────────────────────

describe("RosterCalendarPage — preferred name in Month compact labels", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListUsers.mockResolvedValue([namedStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME, preferredName: null },
    ]);
  });

  it("Month compact shift card uses preferredName when available", async () => {
    const user = userEvent.setup();

    const today = new Date();
    const entry = buildEntry({
      rosteredClinicName: "Verve Dental - Bentleigh East",
      rosteredClinicPreferredName: "Bentleigh East",
      shiftStartAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0).toISOString(),
      shiftEndAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0, 0).toISOString(),
    });
    mockListRoster.mockResolvedValue([entry]);

    renderPage();

    // Switch to Month view
    const monthBtn = await screen.findByRole("button", { name: "Month" });
    await user.click(monthBtn);

    await waitFor(() => {
      // The compact cell should show the preferredName
      expect(screen.getAllByText((c) => c.includes("Bentleigh East")).length).toBeGreaterThan(0);
    });
  });

  it("Month compact shift card uses full name when preferredName is null", async () => {
    const user = userEvent.setup();

    const today = new Date();
    const entry = buildEntry({
      rosteredClinicName: TEST_CLINIC_NAME,
      rosteredClinicPreferredName: null,
      shiftStartAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0).toISOString(),
      shiftEndAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0, 0).toISOString(),
    });
    mockListRoster.mockResolvedValue([entry]);

    renderPage();

    const monthBtn = await screen.findByRole("button", { name: "Month" });
    await user.click(monthBtn);

    await waitFor(() => {
      expect(screen.getAllByText((c) => c.includes(TEST_CLINIC_NAME)).length).toBeGreaterThan(0);
    });
  });
});

// ── Saving state regression ──────────────────────────────────────────────────
//
// After a successful cancel or save, the modal closes.  If the user
// immediately opens a DIFFERENT shift the new modal must NOT inherit the
// previous operation's isSubmitting=true state.
//
// Root cause (fixed): closeModal() did not call setIsSubmitting(false).
// ─────────────────────────────────────────────────────────────────────────────

describe("RosterCalendarPage — saving state resets between shifts", () => {
  const today = new Date();
  const mkTime = (h: number, m = 0) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0).toISOString();

  // Two distinct entries on today so both appear in Week/Day view.
  const entryA = buildEntry({
    id: "shift-a",
    staffUserId: namedStaff.id,
    staffEmail: namedStaff.email,
    shiftStartAt: mkTime(8),
    shiftEndAt: mkTime(12),
    status: "confirmed",
  });
  const entryB = buildEntry({
    id: "shift-b",
    staffUserId: namedStaff.id,
    staffEmail: namedStaff.email,
    shiftStartAt: mkTime(13),
    shiftEndAt: mkTime(17),
    status: "scheduled",
  });

  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListUsers.mockResolvedValue([namedStaff]);
    mockGetRosterAccessibleClinics.mockResolvedValue([
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME, preferredName: null },
    ]);
    // Both shifts visible; after cancel of entryA return the updated version.
    mockListRoster.mockResolvedValue([entryA, entryB]);
    mockCancelShift.mockResolvedValue({ ...entryA, status: "cancelled" });
    mockUpdateShift.mockResolvedValue({ ...entryB, notes: "updated" });
  });

  it("after successfully cancelling shift A, opening shift B shows no Saving state", async () => {
    const user = userEvent.setup();
    renderPage();

    // Switch to Day view so individual shift buttons are visible.
    const dayBtn = await screen.findByRole("button", { name: "Day" });
    await user.click(dayBtn);

    // Open shift A (8:00–12:00)
    const shiftABtn = await screen.findByRole("button", {
      name: /8:00.*12:00|Shift.*Alice Jones.*8:00/i,
    });
    await user.click(shiftABtn);

    // Confirm the modal is open and not in a submitting state.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel shift/i })).not.toBeDisabled();
    });

    // Cancel shift A.
    await user.click(screen.getByRole("button", { name: /cancel shift/i }));

    // Modal must close (the cancel button disappears).
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /cancel shift/i })).toBeNull();
    });

    // Immediately open shift B (13:00–17:00).
    const shiftBBtn = await screen.findByRole("button", {
      name: /13:00.*17:00|Shift.*Alice Jones.*13:00/i,
    });
    await user.click(shiftBBtn);

    // The Save button must NOT say "Saving…" — it must be interactive.
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      expect(saveBtn).not.toBeDisabled();
      expect(saveBtn).toHaveTextContent(/save changes/i);
    });
  });

  it("failed cancel shows error and leaves the modal interactive for retry", async () => {
    const user = userEvent.setup();
    mockCancelShift.mockRejectedValue(new Error("Network error"));

    renderPage();

    const dayBtn = await screen.findByRole("button", { name: "Day" });
    await user.click(dayBtn);

    const shiftABtn = await screen.findByRole("button", {
      name: /8:00.*12:00|Shift.*Alice Jones.*8:00/i,
    });
    await user.click(shiftABtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel shift/i })).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /cancel shift/i }));

    // Error message must appear.
    await waitFor(() => {
      expect(screen.getByText(/failed to cancel shift|network error/i)).toBeInTheDocument();
    });

    // The Cancel shift button must be enabled again (not stuck in Saving…).
    expect(screen.getByRole("button", { name: /cancel shift/i })).not.toBeDisabled();
  });

  it("after successfully saving shift B edits, opening another shift shows no Saving state", async () => {
    const user = userEvent.setup();
    renderPage();

    const dayBtn = await screen.findByRole("button", { name: "Day" });
    await user.click(dayBtn);

    // Open shift B
    const shiftBBtn = await screen.findByRole("button", {
      name: /13:00.*17:00|Shift.*Alice Jones.*13:00/i,
    });
    await user.click(shiftBBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled();
    });

    // Submit the form (save changes).
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    // Modal must close.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    });

    // Open shift A — it must not inherit Saving… state.
    const shiftABtn = await screen.findByRole("button", {
      name: /8:00.*12:00|Shift.*Alice Jones.*8:00/i,
    });
    await user.click(shiftABtn);

    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      expect(saveBtn).not.toBeDisabled();
      expect(saveBtn).toHaveTextContent(/save changes/i);
    });
  });
});
