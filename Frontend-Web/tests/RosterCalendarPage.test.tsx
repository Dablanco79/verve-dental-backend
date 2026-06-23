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

const { authTestState, mockListRoster, mockListUsers } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListRoster: vi.fn(),
    mockListUsers: vi.fn(),
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
    createShift: vi.fn(),
    updateShift: vi.fn(),
    cancelShift: vi.fn(),
  }),
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
  it("shows the real display name on a shift card when staffUserId matches staffList", async () => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListRoster.mockResolvedValue([buildEntry()]);
    mockListUsers.mockResolvedValue([namedStaff]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alice Jones")).toBeInTheDocument(),
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

    await waitFor(() =>
      expect(screen.getByText("John Doe")).toBeInTheDocument(),
    );
  });
});

describe("RosterCalendarPage — edit modal static staff display", () => {
  it("shows resolved name and secondary email when an existing shift is opened", async () => {
    const user = userEvent.setup();
    setAuthenticatedUser(authTestState, managerUser);
    const entry = buildEntry();
    mockListRoster.mockResolvedValue([entry]);
    mockListUsers.mockResolvedValue([namedStaff]);

    const { container } = renderPage();

    // Wait for the shift card to render, then click it to open the edit modal.
    const shiftBtn = await screen.findByRole("button", {
      name: /Shift: Alice Jones/i,
    });
    await user.click(shiftBtn);

    // The modal's static-value span shows the name; the secondary span shows email.
    await waitFor(() => {
      const staticValue = container.querySelector(".roster-form__static-value");
      expect(staticValue).toBeInTheDocument();
      expect(staticValue?.textContent).toContain("Alice Jones");
      const secondary = container.querySelector(".roster-form__static-secondary");
      expect(secondary?.textContent).toBe(namedStaff.email);
    });
  });
});
