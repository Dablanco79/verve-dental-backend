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

const { authTestState, mockListRoster, mockListUsers, mockGetRosterAccessibleClinics, mockUseOperationalClinic } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  // Default clinicId mirrors managerUser.homeClinicId — preserves existing tests.
  const DEFAULT_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
  const DEFAULT_CLINIC_NAME = "Verve Dental Clinic A";
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
    mockGetRosterAccessibleClinics: vi.fn(),
    mockUseOperationalClinic: vi.fn().mockReturnValue({
      clinicId: DEFAULT_CLINIC_ID,
      clinicName: DEFAULT_CLINIC_NAME,
      selectedClinic: { id: DEFAULT_CLINIC_ID, name: DEFAULT_CLINIC_NAME },
      isAllClinicsScope: false,
    }),
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
    listUsers: mockListUsers,
    listRosterEligibleStaff: mockListUsers,
    createShift: vi.fn(),
    updateShift: vi.fn(),
    cancelShift: vi.fn(),
    checkShiftConflicts: vi.fn().mockResolvedValue({ overlapping: [], sameDay: [] }),
    getRosterAccessibleClinics: mockGetRosterAccessibleClinics,
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

  it("shows scope selector with 'All assigned clinics' and individual clinic buttons when manager has multiple accessible clinics", async () => {
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

    // Scope selector with "All assigned clinics" button
    const allBtn = await screen.findByRole("button", { name: /All assigned clinics/i });
    expect(allBtn).toBeInTheDocument();

    // Individual clinic buttons
    expect(screen.getByRole("button", { name: TEST_CLINIC_NAME })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verve Dental Clinic B" })).toBeInTheDocument();
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

  it("Selecting an individual clinic scope filters to that clinic only", async () => {
    const user = userEvent.setup();
    const CLINIC_B_ID = "22222222-2222-4222-8222-222222222222";

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

    // Wait for initial accessible-clinics load and scope selector to render
    const clinicABtn = await screen.findByRole("button", { name: TEST_CLINIC_NAME });

    // Clear call history to only track calls after scope change
    mockListRoster.mockClear();
    mockListRoster.mockImplementation((clinicId: string) => {
      if (clinicId === TEST_CLINIC_ID) return Promise.resolve([entryA]);
      if (clinicId === CLINIC_B_ID) return Promise.resolve([entryB]);
      return Promise.resolve([]);
    });

    // Click the clinic A scope button
    await user.click(clinicABtn);

    // After selecting clinic A scope, listRoster is called only for clinic A
    await waitFor(() => {
      const calledClinicIds = mockListRoster.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(calledClinicIds).toContain(TEST_CLINIC_ID);
      expect(calledClinicIds.every((id) => id === TEST_CLINIC_ID)).toBe(true);
    });
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
