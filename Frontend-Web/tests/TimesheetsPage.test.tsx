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

// ── Mock api/client.ts ────────────────────────────────────────────────────────
// vi.mock is hoisted before variable declarations — use vi.hoisted to declare
// the mocks inside the hoisted block so they are available in the factory.

const {
  mockListMyTimesheets,
  mockListTimesheets,
  mockExportTimesheets,
  mockGetMyShifts,
  mockClockIn,
} = vi.hoisted(() => ({
  mockListMyTimesheets: vi.fn(),
  mockListTimesheets: vi.fn(),
  mockExportTimesheets: vi.fn(),
  // Roster fetch for today's shifts — default empty (ad-hoc mode)
  mockGetMyShifts: vi.fn().mockResolvedValue([]),
  // Clock-in — captured to assert the request payload
  mockClockIn: vi.fn(),
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
      id:              "ts-new",
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

  it("2 — no roster shifts (ad-hoc): rosterEntryId is null in clock-in request", async () => {
    // Explicitly return empty — vi.clearAllMocks() in the top-level beforeEach
    // strips the initial mockResolvedValue([]) set during vi.hoisted.
    mockGetMyShifts.mockResolvedValue([]);
    mockListMyTimesheets.mockResolvedValue([]);

    renderTimesheetsPage(makeUser("clinical_staff"));

    const clockInBtn = await screen.findByRole("button", { name: /clock in/i });
    await userEvent.click(clockInBtn);

    await waitFor(() => {
      expect(mockClockIn).toHaveBeenCalledOnce();
    });

    const [, payload] = mockClockIn.mock.calls[0] as [string, { rosterEntryId?: string | null }];
    // Ad-hoc: null or omitted
    expect(payload.rosterEntryId ?? null).toBeNull();
  });
});
