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
import { ClinicContext } from "../src/clinic/clinicContext.js";
import type { ClinicContextValue } from "../src/clinic/clinicContext.js";
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
  mockGetMyAttendanceClinics,
  mockClockIn,
  mockGetClinicCoordinates,
  mockApproveTimesheet,
  mockRejectTimesheet,
} = vi.hoisted(() => ({
  mockListMyTimesheets: vi.fn(),
  mockListTimesheets: vi.fn(),
  mockExportTimesheets: vi.fn(),
  // Roster fetch for today's shifts — default empty (ad-hoc mode)
  mockGetMyShifts: vi.fn().mockResolvedValue([]),
  mockGetMyAttendanceClinics: vi.fn().mockResolvedValue([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Verve Dental Clinic A",
    },
  ]),
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
  // Approve / reject — captured for bulk-action assertions.
  mockApproveTimesheet: vi.fn(),
  mockRejectTimesheet: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listMyTimesheets: mockListMyTimesheets,
    listTimesheets: mockListTimesheets,
    clockIn: mockClockIn,
    clockOut: vi.fn(),
    approveTimesheet: mockApproveTimesheet,
    rejectTimesheet: mockRejectTimesheet,
    verifyCommissionAttendance: vi.fn(),
    exportTimesheets: mockExportTimesheets,
    refresh: vi.fn().mockRejectedValue(new Error("no cookie")),
    getMe: vi.fn(),
    getMyShifts: mockGetMyShifts,
    getMyShiftsAllClinics: mockGetMyShifts,
    getMyAttendanceClinics: mockGetMyAttendanceClinics,
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
    permissions: [],
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
  mockGetMyAttendanceClinics.mockResolvedValue([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Verve Dental Clinic A",
    },
  ]);
  // Approve / reject resolve with undefined by default (enough for hook's fetch re-trigger).
  mockApproveTimesheet.mockResolvedValue(undefined);
  mockRejectTimesheet.mockResolvedValue(undefined);
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
    clockInNote: null,
    clockOutNote: null,
    generatedBy: "system_auto",
    clockInLocation: null,
    clockOutLocation: null,
    createdAt: "2026-09-21T07:02:00.000Z",
    updatedAt: "2026-09-21T15:05:00.000Z",
  };
}

/** Minimal staff personal ledger entry (listMyTimesheets). */
function makeMyTimesheetEntry(
  overrides: Partial<Omit<ReturnType<typeof makeSubmittedEntry>, "approvalNotes">> & {
    approvalNotes?: string | null;
  } = {},
) {
  return {
    ...makeSubmittedEntry(),
    timesheetStatus: "approved" as const,
    approvedByUserId: "manager-1",
    approvedAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
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
    clockInNote: null,
    clockOutNote: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — All Clinics scope controlled state
// ─────────────────────────────────────────────────────────────────────────────

const HOME_CLINIC    = { id: "11111111-1111-4111-8111-111111111111", name: "Verve Dental Clinic A" };
const CLINIC_B       = { id: "22222222-2222-4222-8222-222222222222", name: "Verve Dental Clinic B" };
const ROSTER_CLINIC  = { id: "33333333-3333-4333-8333-333333333333", name: "Verve Dental Clinic C (roster-only)" };

function makeClinicContext(overrides: Partial<ClinicContextValue> = {}): ClinicContextValue {
  return {
    selectedClinic: HOME_CLINIC,
    selectedDashboardScope: { type: "clinic", clinic: HOME_CLINIC },
    availableClinics: [HOME_CLINIC],
    canSwitchClinics: false,
    canSelectAllClinics: false,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
    ...overrides,
  };
}

function renderTimesheetsPageWithClinicContext(user: AuthUser, clinicCtx: ClinicContextValue) {
  return render(
    <AuthContext.Provider value={makeAuthContext(user)}>
      <ClinicContext.Provider value={clinicCtx}>
        <MemoryRouter>
          <TimesheetsPage />
        </MemoryRouter>
      </ClinicContext.Provider>
    </AuthContext.Provider>,
  );
}

describe("TimesheetsPage — All Clinics scope (Fix 1)", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("owner_admin with All Clinics selected sees controlled 'Select a clinic' state (not blank)", async () => {
    const allClinicsCtx = makeClinicContext({
      selectedClinic: null,
      selectedDashboardScope: { type: "all_clinics" },
      canSwitchClinics: true,
      canSelectAllClinics: true,
    });

    renderTimesheetsPageWithClinicContext(makeUser("owner_admin"), allClinicsCtx);

    expect(
      await screen.findByRole("heading", { name: /select a clinic to use timesheets/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/timesheets and clock in\/out are managed at clinic level/i),
    ).toBeInTheDocument();
    // Page is not blank — AppShell wraps the message
    expect(screen.queryByText(/hourly approval queue/i)).not.toBeInTheDocument();
  });

  it("owner_admin with a specific clinic selected renders the normal Timesheets page (not the 'select' guard)", async () => {
    const specificClinicCtx = makeClinicContext({
      canSwitchClinics: true,
      canSelectAllClinics: true,
    });

    renderTimesheetsPageWithClinicContext(makeUser("owner_admin"), specificClinicCtx);

    await waitFor(() => {
      expect(screen.getByText(/hourly approval queue/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("heading", { name: /select a clinic to use timesheets/i }),
    ).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — Physical Location dropdown sources (multi-clinic context)
// ─────────────────────────────────────────────────────────────────────────────

describe("TimesheetsPage — Physical Location dropdown (Fix 2 — multi-clinic context)", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockGetClinicCoordinates.mockResolvedValue({
      clinicId: HOME_CLINIC.id,
      latitude: -37.8136,
      longitude: 144.9631,
    });
  });

  it("GPM sees their home clinic in the Physical Location dropdown", async () => {
    const gpmCtx = makeClinicContext({ canSwitchClinics: true });

    renderTimesheetsPageWithClinicContext(makeUser("group_practice_manager"), gpmCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    expect(
      within(physicalSelect).getByRole("option", { name: HOME_CLINIC.name }),
    ).toBeInTheDocument();
  });

  it("can_operate alone does not add a physical attendance clinic", async () => {
    const gpmCtx = makeClinicContext({
      availableClinics: [HOME_CLINIC, CLINIC_B],
      canSwitchClinics: true,
    });

    renderTimesheetsPageWithClinicContext(makeUser("group_practice_manager"), gpmCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    expect(
      within(physicalSelect).getByRole("option", { name: HOME_CLINIC.name }),
    ).toBeInTheDocument();
    expect(
      within(physicalSelect).queryByRole("option", { name: CLINIC_B.name }),
    ).not.toBeInTheDocument();
  });

  it("can_roster adds a physical attendance clinic without operational access", async () => {
    mockGetMyAttendanceClinics.mockResolvedValue([HOME_CLINIC, ROSTER_CLINIC]);
    const gpmCtx = makeClinicContext({
      availableClinics: [HOME_CLINIC],
      canSwitchClinics: true,
    });

    renderTimesheetsPageWithClinicContext(makeUser("group_practice_manager"), gpmCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    expect(
      within(physicalSelect).getByRole("option", { name: ROSTER_CLINIC.name }),
    ).toBeInTheDocument();
  });

  it("clinical_staff unchanged — sees home clinic only when no roster shifts", async () => {
    const staffCtx = makeClinicContext(); // single home clinic

    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    expect(
      within(physicalSelect).getByRole("option", { name: HOME_CLINIC.name }),
    ).toBeInTheDocument();
    // No extra clinics
    const valueOptions = within(physicalSelect)
      .getAllByRole("option")
      .filter((o) => (o as HTMLOptionElement).value !== "");
    expect(valueOptions).toHaveLength(1);
  });

  it("shows Bentleigh, Cheltenham, and Heathmont from attendance permissions", async () => {
    const bentleigh = { ...HOME_CLINIC, name: "Verve Dental - Bentleigh East" };
    const cheltenham = { ...CLINIC_B, name: "Verve Dental - Cheltenham" };
    const heathmont = { ...ROSTER_CLINIC, name: "Verve Dental - Heathmont" };
    mockGetMyAttendanceClinics.mockResolvedValue([
      bentleigh,
      cheltenham,
      heathmont,
    ]);

    renderTimesheetsPageWithClinicContext(
      {
        ...makeUser("clinical_staff"),
        homeClinicName: bentleigh.name,
      },
      makeClinicContext({
        selectedClinic: bentleigh,
        selectedDashboardScope: { type: "clinic", clinic: bentleigh },
        availableClinics: [bentleigh],
      }),
    );

    const physicalSelect = await screen.findByRole("combobox", {
      name: /physical location/i,
    });
    expect(within(physicalSelect).getByRole("option", { name: bentleigh.name }))
      .toBeInTheDocument();
    expect(within(physicalSelect).getByRole("option", { name: cheltenham.name }))
      .toBeInTheDocument();
    expect(within(physicalSelect).getByRole("option", { name: heathmont.name }))
      .toBeInTheDocument();

    await userEvent.selectOptions(physicalSelect, cheltenham.id);
    expect(physicalSelect).toHaveValue(cheltenham.id);
    await userEvent.selectOptions(physicalSelect, heathmont.id);
    expect(physicalSelect).toHaveValue(heathmont.id);
  });

  it("owned cross-clinic shift is loaded across clinics and auto-selected", async () => {
    // When a roster shift is auto-selected, ClockWidget hides the Physical Location dropdown
    // and sends the shift's rosteredClinicId directly — the dropdown has no bearing on it.
    const rosterEntry = {
      id:                       "rrrrr-shift-fix2",
      staffUserId:              "user-1",
      staffEmail:               "user@clinic-a.au",
      rosteredClinicId:         ROSTER_CLINIC.id,
      rosteredClinicName:       ROSTER_CLINIC.name,
      rosteredClinicPreferredName: null,
      shiftStartAt:             "2026-09-28T22:00:00.000Z",
      shiftEndAt:               "2026-09-29T06:00:00.000Z",
      shiftType:                "standard",
      status:                   "confirmed",
      notes:                    null,
      createdByUserId:          "manager-1",
      createdAt:                "2026-09-28T00:00:00.000Z",
      updatedAt:                "2026-09-28T00:00:00.000Z",
    };
    mockGetMyShifts.mockResolvedValue([rosterEntry]);

    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    // Roster shift auto-selected — dropdown must not be present.
    await screen.findByText(/rostered shift:/i);
    expect(mockGetMyShifts).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("combobox", { name: /physical location/i }),
    ).not.toBeInTheDocument();
  });

  it("ad-hoc Clock In still requires an explicit Physical Location selection", async () => {
    // No roster shifts → ad-hoc mode → physical location dropdown shown.
    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    // Nothing selected yet — clicking Clock In must be blocked.
    expect((physicalSelect as HTMLSelectElement).value).toBe("");

    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toMatch(/select your physical location/i);
    });
    expect(mockClockIn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Staff Timesheet Notes — clock-in form
// ─────────────────────────────────────────────────────────────────────────────

describe("Staff Timesheet Notes — Clock In form note field", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
    // Clinic coordinates at same position as geolocation → within range → no warning panel
    mockGetClinicCoordinates.mockResolvedValue({
      clinicId: "11111111-1111-4111-8111-111111111111",
      latitude: -37.8136,
      longitude: 144.9631,
    });
  });

  it("Clock In Note textarea is visible in the clock-in form with optional label", async () => {
    renderTimesheetsPage(makeUser("clinical_staff"));

    // The note label must be present and clearly optional
    const noteLabel = await screen.findByLabelText(/clock in note/i);
    expect(noteLabel).toBeInTheDocument();
    expect(noteLabel.tagName).toBe("TEXTAREA");
    // Label text contains "(optional)"
    expect(screen.getByText(/clock in note/i).textContent).toMatch(/optional/i);
  });

  it("Clock In Note is passed in the clockIn payload when provided", async () => {
    mockClockIn.mockResolvedValue({
      id: "clocked-in-id",
      payrollType: "hourly_auto",
      timesheetStatus: "draft",
      staffUserId: "user-1",
      staffEmail: "user@clinic-a.au",
      clinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2026-09-22",
      shiftStartAt: "2026-09-22T22:00:00.000Z",
      shiftEndAt: "2026-09-23T06:00:00.000Z",
      attendanceStatus: "present",
      clockInAt: "2026-09-22T22:01:00.000Z",
      clockOutAt: null,
      breakDurationMinutes: null,
      totalHoursWorked: null,
      ordinaryHours: null,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      approvedByUserId: null,
      approvedAt: null,
      approvalNotes: null,
      commissionNote: null,
      clockInNote: "Covering at Heathmont today",
      clockOutNote: null,
      generatedBy: "user@clinic-a.au",
      clockInLocation: null,
      clockOutLocation: null,
      createdAt: "2026-09-22T22:01:00.000Z",
      updatedAt: "2026-09-22T22:01:00.000Z",
    } satisfies TimesheetEntry);

    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    // Select the physical clinic (ad-hoc mode)
    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, HOME_CLINIC.id);

    // Type a clock-in note
    const noteArea = screen.getByLabelText(/clock in note/i);
    await userEvent.type(noteArea, "Covering at Heathmont today");

    // Click Clock In
    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    // Wait for mockClockIn to be called with the note.
    // mockClockIn is called as clockIn(clinicId, payload) — two args.
    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          clockInNote: "Covering at Heathmont today",
        }),
      );
    });
  });

  it("Clock In Note is null in the payload when no note is provided", async () => {
    mockClockIn.mockResolvedValue({
      id: "clocked-in-id-2",
      payrollType: "hourly_auto",
      timesheetStatus: "draft",
      staffUserId: "user-1",
      staffEmail: "user@clinic-a.au",
      clinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2026-09-22",
      shiftStartAt: "2026-09-22T22:00:00.000Z",
      shiftEndAt: "2026-09-23T06:00:00.000Z",
      attendanceStatus: "present",
      clockInAt: "2026-09-22T22:01:00.000Z",
      clockOutAt: null,
      breakDurationMinutes: null,
      totalHoursWorked: null,
      ordinaryHours: null,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      approvedByUserId: null,
      approvedAt: null,
      approvalNotes: null,
      commissionNote: null,
      clockInNote: null,
      clockOutNote: null,
      generatedBy: "user@clinic-a.au",
      clockInLocation: null,
      clockOutLocation: null,
      createdAt: "2026-09-22T22:01:00.000Z",
      updatedAt: "2026-09-22T22:01:00.000Z",
    } satisfies TimesheetEntry);

    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    // Select physical clinic but leave note empty
    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, HOME_CLINIC.id);

    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    // mockClockIn is called as clockIn(clinicId, payload) — two args.
    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ clockInNote: null }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Staff Timesheet Notes — GeofenceWarningPanel with note (exception state)
// ─────────────────────────────────────────────────────────────────────────────

describe("Staff Timesheet Notes — GeofenceWarningPanel note required for exception", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
    // Clinic at Clinic B location (~500 m from device) → outside range → warning panel shown
    mockGetClinicCoordinates.mockResolvedValue({
      clinicId: "11111111-1111-4111-8111-111111111111",
      latitude: -37.8136,
      longitude: 144.9694, // ~500 m east of device
    });
  });

  it("GeofenceWarningPanel shows a note textarea when a location exception occurs", async () => {
    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, HOME_CLINIC.id);

    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    // GeofenceWarningPanel is shown (location check alert appears)
    await screen.findByRole("alert");
    expect(screen.getByText(/location check/i)).toBeInTheDocument();

    // The note textarea is present inside the warning panel
    const noteArea = screen.getByRole("textbox", { name: /reason/i });
    expect(noteArea).toBeInTheDocument();
  });

  it("GeofenceWarningPanel Confirm button is disabled until note is non-empty", async () => {
    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, HOME_CLINIC.id);

    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    // Warning panel shown
    await screen.findByRole("alert");

    // Confirm is disabled initially (no note provided)
    const confirmBtn = screen.getByRole("button", { name: /confirm clock in/i });
    expect(confirmBtn).toBeDisabled();

    // Type a note — Confirm should become enabled
    const noteArea = screen.getByRole("textbox", { name: /reason/i });
    await userEvent.type(noteArea, "Covering at Heathmont today");

    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  it("GeofenceWarningPanel passes note in clockIn payload on confirm", async () => {
    mockClockIn.mockResolvedValue({
      id: "clocked-with-note",
      payrollType: "hourly_auto",
      timesheetStatus: "draft",
      staffUserId: "user-1",
      staffEmail: "user@clinic-a.au",
      clinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicId: "11111111-1111-4111-8111-111111111111",
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2026-09-22",
      shiftStartAt: "2026-09-22T22:00:00.000Z",
      shiftEndAt: "2026-09-23T06:00:00.000Z",
      attendanceStatus: "present",
      clockInAt: "2026-09-22T22:01:00.000Z",
      clockOutAt: null,
      breakDurationMinutes: null,
      totalHoursWorked: null,
      ordinaryHours: null,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      approvedByUserId: null,
      approvedAt: null,
      approvalNotes: null,
      commissionNote: null,
      clockInNote: "Covering at Heathmont today",
      clockOutNote: null,
      generatedBy: "user@clinic-a.au",
      clockInLocation: null,
      clockOutLocation: null,
      createdAt: "2026-09-22T22:01:00.000Z",
      updatedAt: "2026-09-22T22:01:00.000Z",
    } satisfies TimesheetEntry);

    const staffCtx = makeClinicContext();
    renderTimesheetsPageWithClinicContext(makeUser("clinical_staff"), staffCtx);

    const physicalSelect = await screen.findByRole("combobox", { name: /physical location/i });
    await userEvent.selectOptions(physicalSelect, HOME_CLINIC.id);

    await userEvent.click(screen.getByRole("button", { name: /clock in/i }));

    // Warning panel shown — type note and confirm
    await screen.findByRole("alert");
    const noteArea = screen.getByRole("textbox", { name: /reason/i });
    await userEvent.type(noteArea, "Covering at Heathmont today");

    const confirmBtn = screen.getByRole("button", { name: /confirm clock in/i });
    await waitFor(() => { expect(confirmBtn).not.toBeDisabled(); });
    await userEvent.click(confirmBtn);

    // mockClockIn is called as clockIn(clinicId, payload) — two args.
    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ clockInNote: "Covering at Heathmont today" }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Timesheet Approval — checkboxes, bulk bar, sequential calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns two distinct submitted entries for multi-row bulk tests.
 * Each has a unique id, staffEmail, and shiftDate so table cells are
 * individually selectable via aria-label.
 */
function makeTwoSubmittedEntries() {
  const e1 = makeSubmittedEntry("bulk-entry-1");
  const e2: ReturnType<typeof makeSubmittedEntry> = {
    ...makeSubmittedEntry("bulk-entry-2"),
    staffEmail: "nurse2@clinic-a.au",
    shiftDate: "2026-09-22",
  };
  return [e1, e2] as const;
}

describe("ApprovalQueue — bulk selection checkboxes", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("each pending row has a checkbox", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    // One checkbox per entry row (not counting the Select All header checkbox)
    const rowCheckboxes = screen.getAllByRole("checkbox", {
      name: /select timesheet for/i,
    });
    expect(rowCheckboxes).toHaveLength(2);
  });

  it("header Select All checkbox exists", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: "nurse@clinic-a.au" });

    expect(
      screen.getByRole("checkbox", { name: /select all timesheets/i }),
    ).toBeInTheDocument();
  });

  it("Select All selects all visible pending rows", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const selectAll = screen.getByRole("checkbox", { name: /select all timesheets/i });
    await userEvent.click(selectAll);

    // Both row checkboxes should now be checked
    const rowBoxes = screen.getAllByRole("checkbox", { name: /select timesheet for/i });
    expect(rowBoxes[0]).toBeChecked();
    expect(rowBoxes[1]).toBeChecked();
  });

  it("clicking Select All again clears all selections (deselect all)", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const selectAll = screen.getByRole("checkbox", { name: /select all timesheets/i });
    // Select all, then click again to deselect all
    await userEvent.click(selectAll);
    await userEvent.click(selectAll);

    const rowBoxes = screen.getAllByRole("checkbox", { name: /select timesheet for/i });
    expect(rowBoxes[0]).not.toBeChecked();
    expect(rowBoxes[1]).not.toBeChecked();
  });

  it("bulk action bar is hidden when zero rows are selected", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: "nurse@clinic-a.au" });

    // No checkboxes checked → bulk bar must NOT be in the DOM
    expect(
      screen.queryByRole("region", { name: /bulk actions/i }),
    ).not.toBeInTheDocument();
  });

  it("bulk action bar appears with correct count when one row is selected", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const rowBox = screen.getByRole("checkbox", { name: /select timesheet for/i });
    await userEvent.click(rowBox);

    const bar = screen.getByRole("region", { name: /bulk actions/i });
    expect(bar).toBeInTheDocument();
    // Count span text is exactly "1 selected" — distinct from button text "Approve 1 selected"
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /approve 1 selected/i })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /reject 1 selected/i })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /clear selection/i })).toBeInTheDocument();
  });

  it("bulk action bar shows correct count for multiple selected rows", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const selectAll = screen.getByRole("checkbox", { name: /select all timesheets/i });
    await userEvent.click(selectAll);

    const bar = screen.getByRole("region", { name: /bulk actions/i });
    // Count span text is exactly "2 selected" — distinct from button text "Approve 2 selected"
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /approve 2 selected/i })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /reject 2 selected/i })).toBeInTheDocument();
  });

  it("Clear selection hides the bulk action bar", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: "nurse@clinic-a.au" });

    const rowBox = screen.getByRole("checkbox", { name: /select timesheet for/i });
    await userEvent.click(rowBox);
    expect(screen.getByRole("region", { name: /bulk actions/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /bulk actions/i })).not.toBeInTheDocument();
    });
    expect(rowBox).not.toBeChecked();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Approval — per-row notes, sequential calls, result summary
// ─────────────────────────────────────────────────────────────────────────────

describe("ApprovalQueue — per-row approver comment", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("each selected row shows its own Approver Comment textarea", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    // Select both rows
    const selectAll = screen.getByRole("checkbox", { name: /select all timesheets/i });
    await userEvent.click(selectAll);

    // Each selected row gets its own note textarea via the label
    const noteAreas = screen.getAllByLabelText(/approver comment/i);
    expect(noteAreas).toHaveLength(2);
  });

  it("typing in one row's approver comment does not affect the other row", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const selectAll = screen.getByRole("checkbox", { name: /select all timesheets/i });
    await userEvent.click(selectAll);

    const [note1, note2] = screen.getAllByLabelText(/approver comment/i);
    if (!note1 || !note2) throw new Error("Expected two note textareas");

    await userEvent.type(note1, "Great shift");

    // note1 has the text, note2 is still empty
    expect(note1).toHaveValue("Great shift");
    expect(note2).toHaveValue("");
  });

  it("deselecting a row removes its approver comment textarea", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    const rowBox = screen.getByRole("checkbox", { name: /select timesheet for/i });
    await userEvent.click(rowBox); // select
    expect(screen.getAllByLabelText(/approver comment/i)).toHaveLength(1);

    await userEvent.click(rowBox); // deselect
    await waitFor(() => {
      expect(screen.queryAllByLabelText(/approver comment/i)).toHaveLength(0);
    });
  });
});

describe("ApprovalQueue — bulk approval flow", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("bulk approval calls approveTimesheet once per selected row with that row's individual comment", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    // Select both rows
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));

    // Type a unique note for e1; leave e2 blank
    const [note1] = screen.getAllByLabelText(/approver comment/i);
    if (!note1) throw new Error("Expected note textarea for first row");
    await userEvent.type(note1, "Approved — all looks good");

    // Open bulk approve confirmation
    await userEvent.click(screen.getByRole("button", { name: /approve 2 selected/i }));
    expect(
      screen.getByRole("region", { name: /confirm bulk approval/i }),
    ).toBeInTheDocument();

    // Confirm
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockApproveTimesheet).toHaveBeenCalledTimes(2);
    });

    // e1 sent with its note; e2 sent with null (blank note → null)
    expect(mockApproveTimesheet).toHaveBeenCalledWith(
      expect.any(String),
      "bulk-entry-1",
      { approvalNotes: "Approved — all looks good" },
    );
    expect(mockApproveTimesheet).toHaveBeenCalledWith(
      expect.any(String),
      "bulk-entry-2",
      { approvalNotes: null },
    );
  });

  it("bulk approval works when all approver comments are left blank (silent approval)", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    await userEvent.click(screen.getByRole("checkbox", { name: /select timesheet for/i }));
    // Note left blank intentionally
    await userEvent.click(screen.getByRole("button", { name: /approve 1 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockApproveTimesheet).toHaveBeenCalledTimes(1);
    });
    expect(mockApproveTimesheet).toHaveBeenCalledWith(
      expect.any(String),
      "bulk-entry-1",
      { approvalNotes: null },
    );
  });

  it("bulk approval shows confirmation panel with correct count before executing", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 2 selected/i }));

    const panel = screen.getByRole("region", { name: /confirm bulk approval/i });
    // Confirmation text must mention the count
    expect(panel.textContent).toMatch(/approve 2 selected timesheets/i);
    // approveTimesheet must NOT have been called yet
    expect(mockApproveTimesheet).not.toHaveBeenCalled();
  });

  it("Cancel on confirmation panel returns to the bulk action bar without calling approve", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select timesheet for/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 1 selected/i }));

    expect(screen.getByRole("region", { name: /confirm bulk approval/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /confirm bulk approval/i })).not.toBeInTheDocument();
    });
    // Back to the bulk bar; approveTimesheet never called
    expect(screen.getByRole("region", { name: /bulk actions/i })).toBeInTheDocument();
    expect(mockApproveTimesheet).not.toHaveBeenCalled();
  });

  it("bulk approval result summary shows approved count after success", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select timesheet for/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 1 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByRole("status").textContent).toMatch(/1 approved/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Rejection — validation, sequential calls, partial failure
// ─────────────────────────────────────────────────────────────────────────────

describe("ApprovalQueue — bulk rejection flow", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("bulk rejection is blocked when any selected row has no rejection reason", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    // Select both, type a note only for e1
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    const [note1] = screen.getAllByLabelText(/approver comment/i);
    if (!note1) throw new Error("Expected note textarea");
    await userEvent.type(note1, "Clock times don't add up");

    // Click Reject — e2 has no note → should be blocked
    await userEvent.click(screen.getByRole("button", { name: /reject 2 selected/i }));

    // Bar-level alert shown; no confirmation panel; rejectTimesheet NOT called
    // (Two role="alert" elements appear: the bar message + per-row error — use text query to be precise)
    await waitFor(() => {
      expect(
        screen.getByText(/add a rejection reason to each selected timesheet before continuing/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("region", { name: /confirm bulk rejection/i })).not.toBeInTheDocument();
    expect(mockRejectTimesheet).not.toHaveBeenCalled();
  });

  it("row-level error is shown when that row is missing a rejection reason", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    // Select both, leave e2 note empty
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    const [note1] = screen.getAllByLabelText(/approver comment/i);
    if (!note1) throw new Error("Expected note textarea");
    await userEvent.type(note1, "Clock times incorrect");

    await userEvent.click(screen.getByRole("button", { name: /reject 2 selected/i }));

    // Row-level alert for the missing entry
    await waitFor(() => {
      expect(
        screen.getByText(/a rejection reason is required for this timesheet/i),
      ).toBeInTheDocument();
    });
  });

  it("typing a note for a missing row clears its error highlight", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    const [note1, note2] = screen.getAllByLabelText(/approver comment/i);
    if (!note1 || !note2) throw new Error("Expected two note textareas");
    await userEvent.type(note1, "Missing clock-out");

    // Trigger validation
    await userEvent.click(screen.getByRole("button", { name: /reject 2 selected/i }));
    await screen.findByText(/a rejection reason is required for this timesheet/i);

    // Now fix e2's note
    await userEvent.type(note2, "Unauthorised absence");

    // Row error should disappear
    await waitFor(() => {
      expect(
        screen.queryByText(/a rejection reason is required for this timesheet/i),
      ).not.toBeInTheDocument();
    });
  });

  it("bulk rejection succeeds when every selected row has a non-empty reason", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    const [note1, note2] = screen.getAllByLabelText(/approver comment/i);
    if (!note1 || !note2) throw new Error("Expected two note textareas");

    await userEvent.type(note1, "Clock-in time incorrect");
    await userEvent.type(note2, "Unauthorised absence");

    await userEvent.click(screen.getByRole("button", { name: /reject 2 selected/i }));

    // Confirmation panel
    const panel = screen.getByRole("region", { name: /confirm bulk rejection/i });
    expect(panel.textContent).toMatch(/reject 2 selected timesheets/i);

    await userEvent.click(within(panel).getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockRejectTimesheet).toHaveBeenCalledTimes(2);
    });

    expect(mockRejectTimesheet).toHaveBeenCalledWith(
      expect.any(String),
      "bulk-entry-1",
      { approvalNotes: "Clock-in time incorrect" },
    );
    expect(mockRejectTimesheet).toHaveBeenCalledWith(
      expect.any(String),
      "bulk-entry-2",
      { approvalNotes: "Unauthorised absence" },
    );
  });

  it("bulk rejection result summary shows rejected count", async () => {
    const [e1] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });

    await userEvent.click(screen.getByRole("checkbox", { name: /select timesheet for/i }));
    const [note1] = screen.getAllByLabelText(/approver comment/i);
    if (!note1) throw new Error("Expected note textarea");
    await userEvent.type(note1, "Clock times don't match roster");

    await userEvent.click(screen.getByRole("button", { name: /reject 1 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByRole("status").textContent).toMatch(/1 rejected/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk — partial failure handling
// ─────────────────────────────────────────────────────────────────────────────

describe("ApprovalQueue — partial failure handling", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("partial batch success: summary shows approved count and failed count", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    // e1 succeeds, e2 fails
    mockApproveTimesheet
      .mockResolvedValueOnce(undefined)               // e1 → success
      .mockRejectedValueOnce(new Error("Already approved")); // e2 → failure

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 2 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockApproveTimesheet).toHaveBeenCalledTimes(2);
    });

    // Summary must mention both outcomes
    const summary = await screen.findByRole("status");
    expect(summary.textContent).toMatch(/1 approved/i);
    expect(summary.textContent).toMatch(/1 failed/i);
  });

  it("failed rows remain selected after partial batch; successful rows are deselected", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    // e1 succeeds, e2 fails
    mockApproveTimesheet
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Conflict"));

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 2 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockApproveTimesheet).toHaveBeenCalledTimes(2);
    });

    // e2's checkbox remains checked (failed); e1's is unchecked (succeeded)
    const e1Box = screen.getByRole("checkbox", {
      name: new RegExp(`select timesheet for ${e1.staffEmail}`, "i"),
    });
    const e2Box = screen.getByRole("checkbox", {
      name: new RegExp(`select timesheet for ${e2.staffEmail}`, "i"),
    });

    await waitFor(() => {
      expect(e1Box).not.toBeChecked();
      expect(e2Box).toBeChecked();
    });
  });

  it("do not stop entire batch after first failure — all selected IDs are attempted", async () => {
    const [e1, e2] = makeTwoSubmittedEntries();
    mockListTimesheets.mockResolvedValue([e1, e2]);

    // e1 fails, e2 succeeds
    mockApproveTimesheet
      .mockRejectedValueOnce(new Error("Conflict"))
      .mockResolvedValueOnce(undefined);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: e1.staffEmail });
    await userEvent.click(screen.getByRole("checkbox", { name: /select all timesheets/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve 2 selected/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    // Both calls must have been attempted
    await waitFor(() => {
      expect(mockApproveTimesheet).toHaveBeenCalledTimes(2);
    });
    // Both e1 AND e2 were attempted
    expect(mockApproveTimesheet).toHaveBeenCalledWith(
      expect.any(String), "bulk-entry-1", expect.any(Object),
    );
    expect(mockApproveTimesheet).toHaveBeenCalledWith(
      expect.any(String), "bulk-entry-2", expect.any(Object),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Individual Approve / Reject preserved alongside bulk
// ─────────────────────────────────────────────────────────────────────────────

describe("ApprovalQueue — individual actions preserved alongside bulk checkboxes", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
  });

  it("individual Approve button still opens the inline approval form", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    const emailCell = await screen.findByRole("cell", { name: "nurse@clinic-a.au" });
    const entryRow = emailCell.closest("tr");
    if (!entryRow) throw new Error("Expected entry row");

    await userEvent.click(within(entryRow).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/approval note \(optional\)/i),
      ).toBeInTheDocument();
    });
  });

  it("individual Reject button still opens the inline rejection form", async () => {
    mockListTimesheets.mockResolvedValue([makeSubmittedEntry()]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    const emailCell = await screen.findByRole("cell", { name: "nurse@clinic-a.au" });
    const entryRow = emailCell.closest("tr");
    if (!entryRow) throw new Error("Expected entry row");

    await userEvent.click(within(entryRow).getByRole("button", { name: /^reject$/i }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/rejection reason \(required\)/i),
      ).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Staff Timesheet Notes — Manager table columns
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MyLedger — staff can see manager's Approval / Rejection Note
// ─────────────────────────────────────────────────────────────────────────────

describe("MyLedger — Approval / Rejection Note column", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListTimesheets.mockResolvedValue([]);
  });

  it("staff My Timesheets table shows an 'Approval / Rejection Note' column header", async () => {
    // Seed a real entry so the table (and its <th>) renders instead of the empty-state message
    const entry = makeMyTimesheetEntry({ approvalNotes: null });
    mockListMyTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await screen.findByRole("columnheader", { name: /approval \/ rejection note/i });
  });

  it("staff sees manager's approvalNotes when the entry has one", async () => {
    const entry = makeMyTimesheetEntry({
      approvalNotes: "Great attendance — approved.",
    });
    mockListMyTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    await screen.findByText("Great attendance — approved.");
  });

  it("entries with no manager note render as — in the Approval / Rejection Note column", async () => {
    const entry = makeMyTimesheetEntry({ approvalNotes: null });
    mockListMyTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    // The "—" placeholder
    await screen.findByText("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Staff Timesheet Notes — Manager table columns
// ─────────────────────────────────────────────────────────────────────────────

describe("Staff Timesheet Notes — Manager table Staff Note column", () => {
  beforeEach(() => {
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);
    mockGetClinicCoordinates.mockResolvedValue({
      clinicId: "11111111-1111-4111-8111-111111111111",
      latitude: -37.8136,
      longitude: 144.9631,
    });
  });

  it("ApprovalQueue shows a 'Staff Note' column header", async () => {
    const entry = makeGeofenceEntry({ timesheetStatus: "submitted" });
    mockListTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getByRole("columnheader", { name: /staff note/i })).toBeInTheDocument();
  });

  it("ApprovalQueue shows the clockInNote in the Staff Note cell", async () => {
    const entry: TimesheetEntry = {
      ...makeGeofenceEntry({ timesheetStatus: "submitted" }),
      clockInNote: "Covering at Heathmont today",
      clockOutNote: null,
    };
    mockListTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getByText("Covering at Heathmont today")).toBeInTheDocument();
  });

  it("ReviewedTimesheets shows a 'Staff Note' column header in the Approved tab", async () => {
    const entry = makeGeofenceEntry({ timesheetStatus: "approved" });
    mockListTimesheets.mockResolvedValue([entry]);

    renderTimesheetsPage(makeUser("group_practice_manager"));

    // Switch to Approved tab
    const approvedTab = await screen.findByRole("button", { name: /^approved/i });
    await userEvent.click(approvedTab);

    await screen.findByRole("cell", { name: entry.staffEmail });
    expect(screen.getByRole("columnheader", { name: /staff note/i })).toBeInTheDocument();
  });
});
