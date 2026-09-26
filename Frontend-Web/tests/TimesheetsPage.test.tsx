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

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "../src/auth/AuthContext.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import { TimesheetsPage } from "../src/pages/TimesheetsPage.js";
import type { AuthUser } from "../src/types/index.js";
import type { GeofenceLocation, TimesheetEntry } from "../src/types/payroll.js";

// ── Mock api/client.ts ────────────────────────────────────────────────────────
// vi.mock is hoisted before variable declarations — use vi.hoisted to declare
// the mocks inside the hoisted block so they are available in the factory.

const {
  mockListMyTimesheets,
  mockListTimesheets,
  mockExportTimesheets,
  mockGetMyShifts,
  mockClockIn,
  mockGetClinicCoordinates,
} = vi.hoisted(() => ({
  mockListMyTimesheets: vi.fn(),
  mockListTimesheets: vi.fn(),
  mockExportTimesheets: vi.fn(),
  // Roster fetch for today's shifts — default empty (ad-hoc mode)
  mockGetMyShifts: vi.fn().mockResolvedValue([]),
  // Clock-in — captured to assert the request payload
  mockClockIn: vi.fn(),
  // Geofence: return clinic coords at the same location as the mocked device
  // so distanceMetres ≈ 0 < 100 m → locationState "within" → no warning shown
  // → mockClockIn is called on the first button click (existing tests unchanged).
  mockGetClinicCoordinates: vi.fn().mockResolvedValue({
    clinicId: "11111111-1111-4111-8111-111111111111",
    latitude: -37.8136,
    longitude: 144.9631,
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listMyTimesheets: mockListMyTimesheets,
    listTimesheets: mockListTimesheets,
    clockIn: mockClockIn,
    clockOut: vi.fn(),
    approveTimesheet: vi.fn(),
    rejectTimesheet: vi.fn(),
    verifyCommissionAttendance: vi.fn(),
    exportTimesheets: mockExportTimesheets,
    refresh: vi.fn().mockRejectedValue(new Error("no cookie")),
    getMe: vi.fn(),
    getMyShifts: mockGetMyShifts,
    getClinicCoordinates: mockGetClinicCoordinates,
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
    firstName: null,
    lastName: null,
    displayName: null,
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

// Stub navigator.geolocation globally so the ClockWidget's geofence check
// resolves immediately with coordinates at the same position as the mocked
// clinic (distance ≈ 0 m < 100 m → locationState "within" → no warning panel
// → existing clock-in tests remain single-click without code changes).
Object.defineProperty(navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition: vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude:         -37.8136,
          longitude:        144.9631,
          accuracy:         10,
          altitude:         null,
          altitudeAccuracy: null,
          heading:          null,
          speed:            null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    }),
  },
});

// Reset mock call counts between tests so assertions don't bleed across them.
beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default resolved values stripped by clearAllMocks().
  mockGetClinicCoordinates.mockResolvedValue({
    clinicId: "11111111-1111-4111-8111-111111111111",
    latitude: -37.8136,
    longitude: 144.9631,
  });
  // Re-apply default shift result (empty = ad-hoc mode).
  mockGetMyShifts.mockResolvedValue([]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Export Hours panel — visibility and behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("TimesheetsPage — Export Hours panel", () => {
  it("renders the Export Hours section for owner_admin", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /export hours/i })).toBeInTheDocument();
    });
  });

  it("renders the Export Hours section for group_practice_manager", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /export hours/i })).toBeInTheDocument();
    });
  });

  it("does NOT render Export Hours panel for clinical_staff", async () => {
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.queryByText(/export hours/i)).not.toBeInTheDocument();
    });
  });

  it("calls exportTimesheets when the Export Hours button is clicked", async () => {
    mockListTimesheets.mockResolvedValue([]);
    mockExportTimesheets.mockResolvedValue("timesheets_2026-09-01_to_2026-09-30.xlsx");

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export hours/i })).toBeInTheDocument();
    });

    const exportButton = screen.getByRole("button", { name: /export hours/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(mockExportTimesheets).toHaveBeenCalledOnce();
    });
  });

  it("shows the downloaded filename after a successful export", async () => {
    mockListTimesheets.mockResolvedValue([]);
    mockExportTimesheets.mockResolvedValue("timesheets_2026-09-01_to_2026-09-30.xlsx");

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export hours/i })).toBeInTheDocument();
    });

    const exportButton = screen.getByRole("button", { name: /export hours/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(
        screen.getByText(/timesheets_2026-09-01_to_2026-09-30\.xlsx/i),
      ).toBeInTheDocument();
    });
  });

  it("shows an error message when the export fails", async () => {
    mockListTimesheets.mockResolvedValue([]);
    mockExportTimesheets.mockRejectedValue(new Error("Export failed. Please try again."));

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export hours/i })).toBeInTheDocument();
    });

    const exportButton = screen.getByRole("button", { name: /export hours/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("disables the export button while an export is in progress", async () => {
    mockListTimesheets.mockResolvedValue([]);
    // Never resolves — export stays in progress.
    mockExportTimesheets.mockImplementation(() => new Promise(() => undefined));

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export hours/i })).toBeInTheDocument();
    });

    const exportButton = screen.getByRole("button", { name: /export hours/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /exporting…/i })).toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Timesheet view filter bar
// ─────────────────────────────────────────────────────────────────────────────

describe("TimesheetsPage — Timesheet view filter bar", () => {
  it("renders Pending / Approved / Rejected / All filter buttons for managers", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^pending/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^approved/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^rejected/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^all/i })).toBeInTheDocument();
    });
  });

  it("defaults to Pending view — shows Hourly Approval Queue heading", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("switching to Approved view shows Approved Timesheets heading", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^approved/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /^approved/i }));

    await waitFor(() => {
      expect(screen.getByText(/approved timesheets/i)).toBeInTheDocument();
      expect(screen.queryByText(/hourly approval queue/i)).not.toBeInTheDocument();
    });
  });

  it("switching to All view shows All Timesheets heading", async () => {
    mockListTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^all/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /^all/i }));

    await waitFor(() => {
      expect(screen.getByText(/all timesheets/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval notes inline form
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal submitted timesheet entry fixture. */
function makeSubmittedEntry(id = "entry-1") {
  return {
    id,
    payrollType: "hourly_auto",
    staffUserId: "staff-1",
    staffEmail: "nurse@clinic-a.au",
    clinicId: "11111111-1111-4111-8111-111111111111",
    rosteredClinicId: "11111111-1111-4111-8111-111111111111",
    rosteredClinicName: "Verve Dental Clinic A",
    rosterEntryId: null,
    shiftDate: "2026-09-21",
    shiftStartAt: "2026-09-21T07:00:00.000Z",
    shiftEndAt: "2026-09-21T15:00:00.000Z",
    attendanceStatus: "present",
    clockInAt: "2026-09-21T07:02:00.000Z",
    clockOutAt: "2026-09-21T15:05:00.000Z",
    breakDurationMinutes: 30,
    totalHoursWorked: 7.55,
    ordinaryHours: 7.55,
    overtime15xHours: 0,
    overtime2xHours: 0,
    overtimeCustomHours: 0,
    timesheetStatus: "submitted",
    approvedByUserId: null,
    approvedAt: null,
    approvalNotes: null,
    commissionNote: null,
    generatedBy: "system_auto",
    clockInLocation: null,
    clockOutLocation: null,
    createdAt: "2026-09-21T07:02:00.000Z",
    updatedAt: "2026-09-21T15:05:00.000Z",
  };
}

describe("TimesheetsPage — Approval notes inline form", () => {
  it("clicking Approve opens inline approval form with optional notes textarea", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    // Use role="cell" to find the staff email cell — avoids matching the <option>
    // element of the same text rendered inside the Export staff selector.
    const emailCell = await screen.findByRole("cell", { name: "nurse@clinic-a.au" });
    const entryRow = emailCell.closest("tr");
    if (!entryRow) throw new Error("Expected timesheet entry row");

    // Click the Approve button scoped to this row.
    await userEvent.click(within(entryRow).getByRole("button", { name: /^approve$/i }));

    // The inline approval form should appear (unique elements on the page).
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/approval note \(optional\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /confirm approval/i }),
      ).toBeInTheDocument();
    });
  });

  it("confirms a silent approval (no notes) — form closes on Confirm Approval", async () => {
    // The module-level approveTimesheet mock (vi.fn()) returns undefined which
    // resolves successfully when awaited — sufficient to test the close behaviour.
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("owner_admin"));

    // Scope via role="cell" to avoid matching the <option> in the export selector.
    const emailCell2 = await screen.findByRole("cell", { name: "nurse@clinic-a.au" });
    const entryRow2 = emailCell2.closest("tr");
    if (!entryRow2) throw new Error("Expected timesheet entry row");

    await userEvent.click(within(entryRow2).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm approval/i })).toBeInTheDocument();
    });

    // Click Confirm Approval without entering any note.
    await userEvent.click(screen.getByRole("button", { name: /confirm approval/i }));

    // The inline form should close (notes textarea disappears).
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(/approval note \(optional\)/i),
      ).not.toBeInTheDocument();
    });
  });

  it("Cancel button closes the inline approval form without submitting", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    // Scope via role="cell" to avoid matching the <option> in the export selector.
    const emailCell3 = await screen.findByRole("cell", { name: "nurse@clinic-a.au" });
    const entryRow3 = emailCell3.closest("tr");
    if (!entryRow3) throw new Error("Expected timesheet entry row");

    await userEvent.click(within(entryRow3).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm approval/i })).toBeInTheDocument();
    });

    // Cancel closes the inline form — scope to the expanded row to avoid
    // matching any other Cancel button that might exist on the page.
    const expandedRow = entryRow3.nextElementSibling;
    if (!expandedRow) throw new Error("Expected expanded inline form row");
    await userEvent.click(within(expandedRow as HTMLElement).getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(/approval note \(optional\)/i),
      ).not.toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix A regression — roster-linked clock-in sends exact rosterEntryId
// ─────────────────────────────────────────────────────────────────────────────
//
// Before Fix A, ClockWidget never sent rosterEntryId in the clock-in request,
// so the backend's findByRosterEntry() / activateClockIn() path was bypassed
// on every roster-linked clock-in.
//
// Fix A wires today's roster entries from /roster/me into ClockWidget.
// When a single shift exists the widget auto-selects it and sends:
//   { rosterEntryId: <id>, shiftStartAt, shiftEndAt }
// so the backend can activate the pre-fill instead of creating a duplicate row.

describe("ClockWidget — Fix A regression (rosterEntryId wired through)", () => {
  const CLINIC_ID  = "11111111-1111-4111-8111-111111111111";
  const ROSTER_ID  = "rrrrrrr1-r1r1-4r1r-8r1r-r1r1r1r1r1r1";
  const SHIFT_START = "2026-09-23T22:00:00.000Z";
  const SHIFT_END   = "2026-09-24T06:00:00.000Z";

  function makeRosterEntry() {
    return {
      id:                       ROSTER_ID,
      staffUserId:              "user-1",
      staffEmail:               "user@clinic-a.au",
      rosteredClinicId:         CLINIC_ID,
      rosteredClinicName:       "Verve Dental Clinic A",
      rosteredClinicPreferredName: null,
      shiftStartAt:             SHIFT_START,
      shiftEndAt:               SHIFT_END,
      shiftType:                "standard",
      status:                   "confirmed",
      notes:                    null,
      createdByUserId:          "manager-1",
      createdAt:                "2026-09-20T00:00:00.000Z",
      updatedAt:                "2026-09-20T00:00:00.000Z",
    };
  }

  beforeEach(() => {
    // Reset per-suite mocks before each test so captured calls and mock
    // implementations don't bleed from one test into the next.
    // The top-level beforeEach already calls vi.clearAllMocks(); these
    // re-establish the default return values that clearAllMocks() stripped.
    mockGetMyShifts.mockResolvedValue([]);
    mockClockIn.mockResolvedValue({
      id:               "ts-new",
      clinicId:         CLINIC_ID,
      rosteredClinicId: CLINIC_ID,
      shiftDate:        "2026-09-24",
      shiftStartAt:     SHIFT_START,
      shiftEndAt:       SHIFT_END,
      clockInAt:        new Date().toISOString(),
      clockOutAt:       null,
      staffUserId:      "user-1",
      payrollType:      "hourly_auto",
      timesheetStatus:  "draft",
      totalHoursWorked: null,
      clockInLocation:  null,
      clockOutLocation: null,
    });
  });

  it("1 — single rostered shift: clock-in request includes the exact rosterEntryId", async () => {
    // One shift today → widget auto-selects it.
    mockGetMyShifts.mockResolvedValue([makeRosterEntry()]);
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    // Wait for the widget to render and the shift to be fetched.
    const clockInBtn = await screen.findByRole("button", { name: /clock in/i });

    await userEvent.click(clockInBtn);

    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledOnce();
    });

    // The payload must include the exact roster entry ID.
    const [, payload] = mockClockIn.mock.calls[0] as [string, { rosterEntryId?: string | null }];
    expect(payload.rosterEntryId).toBe(ROSTER_ID);
  });

  it("2 — no roster shifts (ad-hoc): rosterEntryId is null, physicalClinicId is sent", async () => {
    // Explicitly return empty — vi.clearAllMocks() in the top-level beforeEach
    // strips the initial mockResolvedValue([]) set during vi.hoisted.
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    // In ad-hoc mode, a "Physical location" dropdown must be selected first
    // before Clock In is available. Wait for the dropdown to appear.
    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    // Select the home clinic (the only available clinic in ad-hoc mode).
    await userEvent.selectOptions(physicalSelect, "11111111-1111-4111-8111-111111111111");

    const clockInBtn = await screen.findByRole("button", { name: /clock in/i });
    await userEvent.click(clockInBtn);

    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledOnce();
    });

    const [, payload] = mockClockIn.mock.calls[0] as [string, { rosterEntryId?: string | null; physicalClinicId?: string | null }];
    // Ad-hoc: rosterEntryId null, physicalClinicId = selected clinic
    expect(payload.rosterEntryId ?? null).toBeNull();
    expect(payload.physicalClinicId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// All-roles personal timekeeping — ClockWidget visibility
// ─────────────────────────────────────────────────────────────────────────────
//
// Every active role must see the Clock In / Out widget on the Timesheets page.
// Managers and admins retain their existing approval/export capabilities AND
// gain a personal Clock In / Clock Out section at the top of the page.

describe("TimesheetsPage — all-roles personal timekeeping", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
  });

  it("clinical_staff sees the Today's Session clock widget", async () => {
    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clock in/i })).toBeInTheDocument();
  });

  it("group_practice_manager sees the Today's Session clock widget", async () => {
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clock in/i })).toBeInTheDocument();
  });

  it("owner_admin sees the Today's Session clock widget", async () => {
    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clock in/i })).toBeInTheDocument();
  });

  it("group_practice_manager still sees the approval queue (manager capability preserved)", async () => {
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("owner_admin still sees the approval queue (manager capability preserved)", async () => {
    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("group_practice_manager sees both personal clock widget AND approval queue on same page", async () => {
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("owner_admin sees both personal clock widget AND approval queue on same page", async () => {
    renderTimesheetsPage(makeUser("owner_admin"));

    await waitFor(() => {
      expect(screen.getByText(/today.s session/i)).toBeInTheDocument();
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
  });

  it("group_practice_manager clock-in sends a request (widget is functional)", async () => {
    mockClockIn.mockResolvedValue({
      id:               "ts-mgr",
      clinicId:         "11111111-1111-4111-8111-111111111111",
      rosteredClinicId: "11111111-1111-4111-8111-111111111111",
      shiftDate:        "2026-09-23",
      shiftStartAt:     "2026-09-23T22:00:00.000Z",
      shiftEndAt:       "2026-09-24T06:00:00.000Z",
      clockInAt:        new Date().toISOString(),
      clockOutAt:       null,
      staffUserId:      "user-mgr",
      payrollType:      "hourly_auto",
      timesheetStatus:  "draft",
      totalHoursWorked: null,
      clockInLocation:  null,
      clockOutLocation: null,
    });

    renderTimesheetsPage(makeUser("group_practice_manager"));

    // Ad-hoc mode requires selecting a physical location first.
    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, "11111111-1111-4111-8111-111111111111");

    const clockInBtn = await screen.findByRole("button", { name: /clock in/i });
    await userEvent.click(clockInBtn);

    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledOnce();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ad-hoc Physical Location selector — Item 1
// ─────────────────────────────────────────────────────────────────────────────

describe("ClockWidget — ad-hoc physical location selector", () => {
  const CLINIC_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockClockIn.mockResolvedValue({
      id:               "ts-adhoc",
      clinicId:         CLINIC_ID,
      rosteredClinicId: CLINIC_ID,
      shiftDate:        "2026-09-26",
      shiftStartAt:     "2026-09-26T22:00:00.000Z",
      shiftEndAt:       "2026-09-27T06:00:00.000Z",
      clockInAt:        new Date().toISOString(),
      clockOutAt:       null,
      staffUserId:      "user-1",
      payrollType:      "hourly_auto",
      timesheetStatus:  "draft",
      totalHoursWorked: null,
      clockInLocation:  null,
      clockOutLocation: null,
    });
  });

  it("shows the Physical location dropdown in ad-hoc mode (no roster shifts)", async () => {
    renderTimesheetsPage(makeUser("clinical_staff"));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /physical location/i })).toBeInTheDocument();
    });
  });

  it("Clock In is blocked when no physical location is selected — shows inline error", async () => {
    renderTimesheetsPage(makeUser("clinical_staff"));

    // The dropdown is present but nothing is selected yet.
    await screen.findByRole("combobox", { name: /physical location/i });

    // Click Clock In without selecting a location.
    const clockInBtn = screen.getByRole("button", { name: /clock in/i });
    await userEvent.click(clockInBtn);

    // Error message should appear; mockClockIn must NOT have been called.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toMatch(/select your physical location/i);
    });
    expect(mockClockIn).not.toHaveBeenCalled();
  });

  it("Clock In proceeds after selecting a physical location", async () => {
    renderTimesheetsPage(makeUser("clinical_staff"));

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, CLINIC_ID);

    const clockInBtn = screen.getByRole("button", { name: /clock in/i });
    await userEvent.click(clockInBtn);

    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledOnce();
    });

    // physicalClinicId should be passed in the payload
    const [, payload] = mockClockIn.mock.calls[0] as [string, { physicalClinicId?: string | null }];
    expect(payload.physicalClinicId).toBe(CLINIC_ID);
  });

  it("Physical location dropdown NOT shown when a roster shift is auto-selected", async () => {
    const rosterEntry = {
      id:                       "rrrrr-shift-1",
      staffUserId:              "user-1",
      staffEmail:               "user@clinic-a.au",
      rosteredClinicId:         CLINIC_ID,
      rosteredClinicName:       "Verve Dental Clinic A",
      rosteredClinicPreferredName: null,
      shiftStartAt:             "2026-09-26T22:00:00.000Z",
      shiftEndAt:               "2026-09-27T06:00:00.000Z",
      shiftType:                "standard",
      status:                   "confirmed",
      notes:                    null,
      createdByUserId:          "manager-1",
      createdAt:                "2026-09-26T00:00:00.000Z",
      updatedAt:                "2026-09-26T00:00:00.000Z",
    };
    mockGetMyShifts.mockResolvedValue([rosterEntry]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    // Wait for the widget to auto-select the single shift — the "Rostered shift:"
    // info paragraph only renders once selectedShift state is set (via useEffect).
    // This is the authoritative signal that the effect has fired and the ad-hoc
    // branch (which renders the physical location dropdown) is no longer active.
    await screen.findByText(/rostered shift:/i);

    // When a shift is auto-selected, the Physical location dropdown must NOT appear.
    expect(screen.queryByRole("combobox", { name: /physical location/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalQueue — geofence location states
// ─────────────────────────────────────────────────────────────────────────────

function makeGeofenceEntry(overrides: Partial<{
  clockInLocation: GeofenceLocation | null;
  clockOutLocation: GeofenceLocation | null;
  timesheetStatus: TimesheetEntry["timesheetStatus"];
}>): TimesheetEntry {
  return {
    id: "geo-entry-" + Math.random().toString(36).slice(2),
    payrollType: "hourly_auto",
    staffUserId: "user-geo-1",
    staffEmail: "geo.staff@clinic-a.au",
    clinicId: "11111111-1111-4111-8111-111111111111",
    rosteredClinicId: "11111111-1111-4111-8111-111111111111",
    rosteredClinicName: "Verve Dental Clinic A",
    rosterEntryId: null,
    shiftDate: "2026-09-23",
    shiftStartAt: "2026-09-23T22:00:00.000Z",
    shiftEndAt: "2026-09-24T06:00:00.000Z",
    attendanceStatus: "present",
    clockInAt: "2026-09-23T22:05:00.000Z",
    clockOutAt: "2026-09-24T06:02:00.000Z",
    breakDurationMinutes: 30,
    totalHoursWorked: 7.95,
    ordinaryHours: 7.95,
    overtime15xHours: 0,
    overtime2xHours: 0,
    overtimeCustomHours: 0,
    timesheetStatus: "submitted",
    approvedByUserId: null,
    approvedAt: null,
    approvalNotes: null,
    commissionNote: null,
    generatedBy: "system_auto",
    clockInLocation: null,
    clockOutLocation: null,
    createdAt: "2026-09-23T22:05:00.000Z",
    updatedAt: "2026-09-24T06:02:00.000Z",
    ...overrides,
  };
}

const withinRangeLoc = (): GeofenceLocation => ({
  lat: -37.8136,
  lng: 144.9631,
  accuracyMetres: 12,
  targetClinicId: "11111111-1111-4111-8111-111111111111",
  distanceMetres: 38,
  withinRange: true,
  locationState: "within",
});

const outsideRangeLoc = (): GeofenceLocation => ({
  lat: -37.8136,
  lng: 144.9694,
  accuracyMetres: 20,
  targetClinicId: "11111111-1111-4111-8111-111111111111",
  distanceMetres: 436,
  withinRange: false,
  locationState: "outside",
});

const deniedLoc = (): GeofenceLocation => ({
  lat: null,
  lng: null,
  accuracyMetres: null,
  targetClinicId: "11111111-1111-4111-8111-111111111111",
  distanceMetres: null,
  withinRange: null,
  locationState: "denied",
});

const unavailableLoc = (): GeofenceLocation => ({
  lat: null,
  lng: null,
  accuracyMetres: null,
  targetClinicId: "11111111-1111-4111-8111-111111111111",
  distanceMetres: null,
  withinRange: null,
  locationState: "unavailable",
});

describe("ApprovalQueue — geofence location states", () => {
  it("within-range clock-in and clock-out shows Location verified badges (no exception badge)", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: withinRangeLoc(),
      clockOutLocation: withinRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    // "Location verified" badge should appear (from TsLocationBadge for within-range)
    expect(screen.getAllByText(/location verified/i).length).toBeGreaterThanOrEqual(1);
    // No exception badge
    expect(screen.queryByText(/location exception/i)).toBeNull();
  });

  it("outside-range clock-in shows Location exception badge", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: outsideRangeLoc(),
      clockOutLocation: withinRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getAllByText(/location exception/i).length).toBeGreaterThanOrEqual(1);
  });

  it("outside-range clock-out shows Location exception badge", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: withinRangeLoc(),
      clockOutLocation: outsideRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getAllByText(/location exception/i).length).toBeGreaterThanOrEqual(1);
  });

  it("denied location is visible to approver", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: deniedLoc(),
      clockOutLocation: withinRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    // The denied badge text appears somewhere in the rendered output
    expect(screen.getAllByText(/permission not granted/i).length).toBeGreaterThanOrEqual(1);
  });

  it("unavailable location is visible to approver", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: unavailableLoc(),
      clockOutLocation: null,
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getAllByText(/location unavailable/i).length).toBeGreaterThanOrEqual(1);
  });

  it("historical null location shows 'Not recorded' rather than an error", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: null,
      clockOutLocation: null,
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    // GeofenceSummaryCell renders "Not recorded" when both locations are null
    expect(screen.getAllByText(/not recorded/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/location exception/i)).toBeNull();
  });

  it("location exception does not prevent approval — Approve button still present", async () => {
    const entry = makeGeofenceEntry({
      clockInLocation: outsideRangeLoc(),
      clockOutLocation: outsideRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    const emailCell = await screen.findByRole("cell", { name: entry.staffEmail });
    const entryRow = emailCell.closest("tr");
    if (!entryRow) throw new Error("Expected timesheet entry row");

    expect(screen.getAllByText(/location exception/i).length).toBeGreaterThanOrEqual(1);
    // Approve button still rendered and enabled — scoped to the entry row
    const approveBtn = within(entryRow).getByRole("button", { name: /^approve$/i });
    expect(approveBtn).toBeInTheDocument();
    expect(approveBtn).not.toBeDisabled();
  });

  it("location information remains visible after approval (reviewed tab shows geofence state)", async () => {
    // Approved entry — timesheetStatus = "approved"
    const entry = makeGeofenceEntry({
      timesheetStatus: "approved" as const,
      clockInLocation: outsideRangeLoc(),
      clockOutLocation: withinRangeLoc(),
    });
    mockListTimesheets.mockResolvedValue([entry]);
    mockListMyTimesheets.mockResolvedValue([]);
    renderTimesheetsPage(makeUser("group_practice_manager"));

    // Click "Approved" tab to see reviewed timesheets
    const approvedTab = await screen.findByRole("button", { name: /^approved/i });
    await userEvent.click(approvedTab);

    await screen.findByRole("cell", { name: entry.staffEmail });
    // Location exception still visible on the approved tab
    expect(screen.getAllByText(/location exception/i).length).toBeGreaterThanOrEqual(1);
  });
});
