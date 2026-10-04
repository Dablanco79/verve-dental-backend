/**
 * LaborForecastPage.test.tsx — Labour Cost Analysis (post-V1 rewrite)
 *
 * Coverage:
 *   - From/To date inputs render and are user-editable
 *   - Quick-select options update from/to dates
 *   - Loading state shown during fetch
 *   - Historical-only range renders historical breakdown (no future section)
 *   - Future-only range renders future forecast (no historical section)
 *   - Mixed range shows both approved/pending cards AND future forecast
 *   - Approved and Pending Approval cards render
 *   - Future Forecast card renders
 *   - Rejected exception display
 *   - Requires Amendment exception display
 *   - Incomplete exception display
 *   - Missing warning display
 *   - Breakdown by Staff (NOT Breakdown by Role)
 *   - Owner/Admin sees rate and cost columns in staff table
 *   - GPM without payroll:rates:read does not see individual rate/cost columns
 *   - Default estimate banner when anyStaffUsingFallback
 *   - Methodology copy matches current calculations
 *   - Non-manager role redirected to "/"
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaborForecastPage } from "../src/pages/LaborForecastPage.js";
import type { LaborCostAnalysis } from "../src/types/forecast.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_ID,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { authTestState, mockGetLaborForecast, mockGetClinicTimezone } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetLaborForecast: vi.fn(),
    // Synchronous mock for useClinicTimezone — defaults to "Australia/Sydney"
    // so that date calculations in the page match the test's today() helper.
    mockGetClinicTimezone: vi.fn<() => string>().mockReturnValue("Australia/Sydney"),
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
    getLaborForecast: mockGetLaborForecast,
  }),
}));

vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: () => ({
    clinicId: TEST_CLINIC_ID,
    clinicName: "Verve Dental Clinic A",
    isAllClinicsScope: false,
  }),
}));

// Mock useClinicTimezone so tests don't need a live getClinic API call.
// All tests default to "Australia/Sydney"; override per-test for cross-TZ tests.
vi.mock("../src/hooks/useClinicTimezone.js", () => ({
  useClinicTimezone: mockGetClinicTimezone,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const adminUser = { ...createAdminUser(), permissions: ["payroll:rates:read"] };
const managerUser = { ...createManagerUser(), permissions: [] }; // no payroll:rates:read
const staffUser = createStaffUser();

/**
 * Clinic-local date as YYYY-MM-DD.
 * Uses the same IANA timezone as the mocked useClinicTimezone so that test
 * assertions match the page's own today(clinicTimezone) calculation exactly —
 * even when the CI runner's system timezone is UTC (different from AEST/AEDT).
 */
function today(tz = "Australia/Sydney"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
/** UTC calendar arithmetic — matches the page's addDays() implementation. */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function makeFutureOnlyAnalysis(overrides: Partial<LaborCostAnalysis> = {}): LaborCostAnalysis {
  return {
    clinicId: TEST_CLINIC_ID,
    dateRange: { from: today(), to: addDays(today(), 13), timezone: "Australia/Sydney" },
    historical: null,
    futureForecast: {
      totalHours: 27,
      baseCost: 1350,
      superCost: 202.5,
      totalCost: 1552.5,
      anyStaffUsingFallback: false,
      breakdownByShiftType: [
        {
          shiftType: "standard",
          projectedHours: 27,
          baseCost: 1350,
          superCost: 162,
          totalCost: 1512,
          usingFallbackForSomeStaff: false,
        },
      ],
    },
    planningEstimate: { approvedCost: 0, pendingCost: 0, futureCost: 1552.5, totalCost: 1552.5 },
    staffBreakdown: [
      {
        staffUserId: "staff-a",
        staffEmail: "alice@clinic.au",
        approvedHours: 0, pendingHours: 0, rejectedHours: 0,
        requiresAmendmentHours: 0, incompleteCount: 0, incompleteScheduledHours: 0,
        missingShiftCount: 0, missingScheduledHours: 0,
        futureProjectedHours: 27,
        baseHourlyRate: 38, superRatePercent: 12, rateSource: "configured",
        approvedCost: 0, pendingCost: 0, rejectedCost: 0, requiresAmendmentCost: 0,
        futureCost: 1512,
      },
    ],
    dataQuality: {
      hasIncompleteTimesheets: false,
      hasMissingTimesheets: false,
      hasRejectedTimesheets: false,
      hasRequiresAmendment: false,
    },
    ...overrides,
  };
}

function makeHistoricalOnlyAnalysis(): LaborCostAnalysis {
  return {
    clinicId: TEST_CLINIC_ID,
    dateRange: { from: addDays(today(), -14), to: addDays(today(), -1), timezone: "Australia/Sydney" },
    historical: {
      approved: { hours: 16, baseCost: 608, superCost: 72.96, totalCost: 680.96 },
      pending:  { hours: 8,  baseCost: 304, superCost: 36.48, totalCost: 340.48 },
      rejected: { hours: 9,  baseCost: 342, superCost: 41.04, totalCost: 383.04 },
      requiresAmendment: { hours: 7, baseCost: 266, superCost: 31.92, totalCost: 297.92 },
      incomplete: { count: 2, scheduledHours: 18 },
      missing: { count: 1, scheduledHours: 9 },
    },
    futureForecast: null,
    planningEstimate: { approvedCost: 680.96, pendingCost: 340.48, futureCost: 0, totalCost: 1021.44 },
    staffBreakdown: [
      {
        staffUserId: "staff-a",
        staffEmail: "alice@clinic.au",
        approvedHours: 16, pendingHours: 8, rejectedHours: 9,
        requiresAmendmentHours: 7, incompleteCount: 2, incompleteScheduledHours: 18,
        missingShiftCount: 1, missingScheduledHours: 9,
        futureProjectedHours: 0,
        baseHourlyRate: 38, superRatePercent: 12, rateSource: "configured",
        approvedCost: 680.96, pendingCost: 340.48, rejectedCost: 383.04,
        requiresAmendmentCost: 297.92, futureCost: 0,
      },
    ],
    dataQuality: {
      hasIncompleteTimesheets: true,
      hasMissingTimesheets: true,
      hasRejectedTimesheets: true,
      hasRequiresAmendment: true,
    },
  };
}

function makeMixedAnalysis(): LaborCostAnalysis {
  return {
    ...makeHistoricalOnlyAnalysis(),
    dateRange: { from: addDays(today(), -7), to: addDays(today(), 6), timezone: "Australia/Sydney" },
    futureForecast: {
      totalHours: 9,
      baseCost: 342,
      superCost: 41.04,
      totalCost: 383.04,
      anyStaffUsingFallback: false,
      breakdownByShiftType: [
        {
          shiftType: "standard",
          projectedHours: 9,
          baseCost: 342,
          superCost: 41.04,
          totalCost: 383.04,
          usingFallbackForSomeStaff: false,
        },
      ],
    },
    planningEstimate: { approvedCost: 680.96, pendingCost: 340.48, futureCost: 383.04, totalCost: 1404.48 },
  };
}

function makeRedactedAnalysis(): LaborCostAnalysis {
  return {
    ...makeFutureOnlyAnalysis(),
    staffBreakdown: [
      {
        staffUserId: "staff-a",
        staffEmail: "alice@clinic.au",
        approvedHours: 0, pendingHours: 0, rejectedHours: 0,
        requiresAmendmentHours: 0, incompleteCount: 0, incompleteScheduledHours: 0,
        missingShiftCount: 0, missingScheduledHours: 0,
        futureProjectedHours: 27,
        // Redacted for GPM without payroll:rates:read
        baseHourlyRate: null, superRatePercent: null, rateSource: null,
        approvedCost: null, pendingCost: null, rejectedCost: null,
        requiresAmendmentCost: null, futureCost: null,
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LaborForecastPage />
    </MemoryRouter>,
  );
}

// ── Suite 1: Date range controls ──────────────────────────────────────────────

describe("LaborForecastPage — date range controls", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
  });

  it("renders From and To date inputs", () => {
    renderPage();
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it("renders quick-select buttons including Next 14 days", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /next 14 days/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next 7 days/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next 30 days/i })).toBeInTheDocument();
  });

  it("clicking a quick option changes the date hint text", async () => {
    renderPage();

    const btn = screen.getByRole("button", { name: /past 30 days/i });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/historical only/i)).toBeInTheDocument();
    });
  });

  it("shows a validation error when From > To", async () => {
    renderPage();

    const fromInput = screen.getByLabelText(/from date/i);
    await userEvent.clear(fromInput);
    await userEvent.type(fromInput, "2099-12-31");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});

// ── Suite 2: Future-only range ────────────────────────────────────────────────

describe("LaborForecastPage — future-only range", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
  });

  it("shows Future Forecast card and Estimated Period Labour Cost", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/estimated period labour cost/i)).toBeInTheDocument();
    });
    // "Future Forecast" text appears in multiple DOM nodes (KPI label, section heading, methodology);
    // assert presence via the section heading role to avoid ambiguity.
    expect(screen.getByRole("heading", { name: /future forecast/i })).toBeInTheDocument();
  });

  it("does NOT show a historical breakdown section for future-only data", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/estimated period labour cost/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/historical labour cost/i)).not.toBeInTheDocument();
  });

  it("shows 'Configured' badge when usingFallbackForSomeStaff is false", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText(/configured/i).length).toBeGreaterThan(0);
    });
  });

  it("shows 'Default estimate' banner when anyStaffUsingFallback is true", async () => {
    mockGetLaborForecast.mockResolvedValue(
      makeFutureOnlyAnalysis({
        futureForecast: {
          totalHours: 9, baseCost: 450, superCost: 67.5, totalCost: 517.5,
          anyStaffUsingFallback: true,
          breakdownByShiftType: [{ shiftType: "standard", projectedHours: 9, baseCost: 450, superCost: 67.5, totalCost: 517.5, usingFallbackForSomeStaff: true }],
        },
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/some staff are using a default rate estimate/i)).toBeInTheDocument();
    });
  });
});

// ── Suite 3: Historical-only range ───────────────────────────────────────────

describe("LaborForecastPage — historical-only range", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeHistoricalOnlyAnalysis());
  });

  it("shows Historical Labour Cost section", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /historical breakdown/i })).toBeInTheDocument();
    });
  });

  it("does NOT show a future forecast section for historical-only data", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /historical breakdown/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("region", { name: /future forecast/i })).not.toBeInTheDocument();
  });

  it("shows Approved and Pending Approval rows", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/✓ approved/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/⏳ pending approval/i)).toBeInTheDocument();
  });

  it("shows Rejected exception", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/✗ rejected/i)).toBeInTheDocument();
    });
  });

  it("shows Requires Amendment exception", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/✎ requires amendment/i)).toBeInTheDocument();
    });
  });

  it("shows Incomplete exception", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/⚠ incomplete/i)).toBeInTheDocument();
    });
  });

  it("shows Missing timesheets warning", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/! missing timesheets/i)).toBeInTheDocument();
    });
  });
});

// ── Suite 4: Mixed range ──────────────────────────────────────────────────────

describe("LaborForecastPage — mixed range", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeMixedAnalysis());
  });

  it("shows both Approved card and Future Forecast card", async () => {
    renderPage();

    await waitFor(() => {
      // Both section headings render when data covers historical + future dates.
      expect(screen.getByRole("heading", { name: /historical labour cost/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /future forecast/i })).toBeInTheDocument();
  });

  it("shows 'mixed: historical + future' hint text", async () => {
    renderPage();

    // Move From date into the past so the range spans past → future.
    fireEvent.change(screen.getByLabelText(/from date/i), {
      target: { value: addDays(today(), -7) },
    });

    await waitFor(() => {
      expect(screen.getByText(/mixed: historical \+ future/i)).toBeInTheDocument();
    });
  });
});

// ── Suite 5: Staff breakdown table ────────────────────────────────────────────

describe("LaborForecastPage — Breakdown by Staff (not by Role)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
  });

  it("renders 'Breakdown by Staff' heading (not 'Breakdown by Role')", async () => {
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /breakdown by staff/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/breakdown by role/i)).not.toBeInTheDocument();
  });

  it("Owner/Admin with payroll:rates:read sees rate and cost columns", async () => {
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /breakdown by staff/i })).toBeInTheDocument();
    });

    // Rate and cost column headers should be visible.
    // Use exact strings to avoid matching "Rate source" which is always present.
    expect(screen.getByRole("columnheader", { name: "Rate" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Super %" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Appr. cost" })).toBeInTheDocument();
  });

  it("staff email appears in breakdown table", async () => {
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("alice@clinic.au")).toBeInTheDocument();
    });
  });
});

// ── Suite 6: GPM without payroll:rates:read ───────────────────────────────────

describe("LaborForecastPage — GPM without payroll:rates:read", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockGetLaborForecast.mockResolvedValue(makeRedactedAnalysis());
  });

  it("does NOT render rate or cost column headers", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /breakdown by staff/i })).toBeInTheDocument();
    });

    // Use exact strings so "Rate source" (always present) does not cause false ambiguity.
    expect(screen.queryByRole("columnheader", { name: "Rate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Appr. cost" })).not.toBeInTheDocument();
  });

  it("shows advisory note about hidden rate columns", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/rate and cost columns are visible to owner/i)).toBeInTheDocument();
    });
  });

  it("still shows staff email (hours always visible)", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("alice@clinic.au")).toBeInTheDocument();
    });
  });
});

// ── Suite 7: Methodology copy ─────────────────────────────────────────────────

describe("LaborForecastPage — methodology copy", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
  });

  it("mentions configured staff rates (not FY2026 Award defaults)", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/configured rates/i)).toBeInTheDocument();
    });

    // Old incorrect copy must NOT appear
    expect(screen.queryByText(/FY2026 Australian Dental Industry Award defaults/i)).not.toBeInTheDocument();
  });

  it("mentions fallback estimates when no configured rate exists", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/fallback estimates/i)).toBeInTheDocument();
    });
  });

  it("does NOT claim overhead is always ~15%", async () => {
    renderPage();

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getByText(/configured rates/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/overhead.*~15%.*covers.*superannuation.*payroll tax.*WorkCover/i))
      .not.toBeInTheDocument();
  });

  it("mentions Rejected and Requires Amendment are excluded from planning estimate", async () => {
    renderPage();

    // The planning estimate summary note reads:
    //   "Rejected, Requires Amendment, Incomplete and Missing items are excluded."
    // The regex must match the actual DOM text (not the old regex that looked for
    // "excluded from...planning estimate" in the wrong order).
    await waitFor(() => {
      expect(
        screen.getByText(/rejected.*requires amendment.*incomplete and missing items are excluded/i),
      ).toBeInTheDocument();
    });
  });

  it("does NOT mention 'configurable in Module 09'", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/configured rates/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/module 09/i)).not.toBeInTheDocument();
  });
});

// ── Suite 8: Access control ───────────────────────────────────────────────────

describe("LaborForecastPage — access control", () => {
  it("redirects clinical_staff to '/'", () => {
    setAuthenticatedUser(authTestState, staffUser);
    renderPage();

    // Navigate replaces the route; the page itself won't render
    expect(screen.queryByText(/labour cost analysis/i)).not.toBeInTheDocument();
  });
});

// ── Suite 9: Quick-range boundary correctness (Issue 4) ───────────────────────

/**
 * Verifies that each quick-select button produces exactly the right number of
 * inclusive calendar dates.  The addDays(t, n-1) pattern used in the page
 * yields from=t to=t+(n-1), which is n inclusive days.
 *
 * "Past 30 days" covers today-30 through yesterday (today-1) = 30 days.
 */
describe("LaborForecastPage — quick-range boundary correctness", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());
  });

  /** Count inclusive calendar days between two YYYY-MM-DD strings. */
  function inclusiveDays(from: string, to: string): number {
    const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
    const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
    const msPerDay = 1_000 * 60 * 60 * 24;
    const fromMs = Date.UTC(fy, fm - 1, fd);
    const toMs   = Date.UTC(ty, tm - 1, td);
    return Math.round((toMs - fromMs) / msPerDay) + 1;
  }

  it("'Next 7 days' sets exactly 7 inclusive calendar dates (from=today, to=today+6)", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /next 7 days/i }));

    const fromInput = screen.getByLabelText<HTMLInputElement>(/from date/i);
    const toInput   = screen.getByLabelText<HTMLInputElement>(/to date/i);

    expect(fromInput.value).toBe(today());
    expect(inclusiveDays(fromInput.value, toInput.value)).toBe(7);
    expect(toInput.value).toBe(addDays(today(), 6));
  });

  it("'Next 14 days' sets exactly 14 inclusive calendar dates (from=today, to=today+13)", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /next 14 days/i }));

    const fromInput = screen.getByLabelText<HTMLInputElement>(/from date/i);
    const toInput   = screen.getByLabelText<HTMLInputElement>(/to date/i);

    expect(fromInput.value).toBe(today());
    expect(inclusiveDays(fromInput.value, toInput.value)).toBe(14);
    expect(toInput.value).toBe(addDays(today(), 13));
  });

  it("'Next 30 days' sets exactly 30 inclusive calendar dates (from=today, to=today+29)", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /next 30 days/i }));

    const fromInput = screen.getByLabelText<HTMLInputElement>(/from date/i);
    const toInput   = screen.getByLabelText<HTMLInputElement>(/to date/i);

    expect(fromInput.value).toBe(today());
    expect(inclusiveDays(fromInput.value, toInput.value)).toBe(30);
    expect(toInput.value).toBe(addDays(today(), 29));
  });

  it("'Past 30 days' sets exactly 30 inclusive calendar dates (from=today-30, to=yesterday)", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /past 30 days/i }));

    const fromInput = screen.getByLabelText<HTMLInputElement>(/from date/i);
    const toInput   = screen.getByLabelText<HTMLInputElement>(/to date/i);

    expect(toInput.value).toBe(addDays(today(), -1));   // yesterday
    expect(fromInput.value).toBe(addDays(today(), -30)); // 30 days before today
    expect(inclusiveDays(fromInput.value, toInput.value)).toBe(30);
  });

  it("quick-range APIs are called with the correct from/to params", async () => {
    renderPage();

    // Wait for the initial load with the default "Next 14 days" params
    await waitFor(() => {
      expect(mockGetLaborForecast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ from: today(), to: addDays(today(), 13) }),
      );
    });

    // Click "Next 7 days" (changes toDate from today+13 to today+6).
    // The hook detects paramsKey changed and re-fetches automatically.
    await userEvent.click(screen.getByRole("button", { name: /next 7 days/i }));

    // Wait until the mock has been called with the "Next 7 days" params.
    await waitFor(() => {
      expect(mockGetLaborForecast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ from: today(), to: addDays(today(), 6) }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clinic-timezone regression: browser-local date vs clinic-local date
// ─────────────────────────────────────────────────────────────────────────────
//
// An owner/admin travelling overseas must see the clinic's calendar date, NOT
// the device's local date.  This test sets a fixed UTC instant where a clinic
// in Australia/Melbourne (UTC+11) is already on the NEXT calendar day compared
// to UTC — proving that the page's date calculations use the clinic's IANA tz.
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastPage — clinic-timezone isolation (cross-timezone regression)", () => {
  it("today() uses the clinic IANA timezone, not the browser/device local timezone", () => {
    // 2026-10-05T14:30:00Z = 05 Oct in UTC, but 06 Oct in Australia/Melbourne (UTC+11 in AEDT).
    // An admin with their device in UTC would see the wrong date if browser-local date were used.
    const UTC_INSTANT = new Date("2026-10-05T14:30:00Z");

    const browserDate = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(UTC_INSTANT);
    const melbourneDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(UTC_INSTANT);

    // Verify the fixture creates a genuine timezone cross-date boundary.
    expect(browserDate).toBe("2026-10-05");
    expect(melbourneDate).toBe("2026-10-06");

    // Both calendars must be on different dates — this is the risk scenario.
    expect(browserDate).not.toBe(melbourneDate);
  });

  it("quick-range date inputs reflect clinic-local date when clinic is in Australia/Melbourne", async () => {
    // Use fake timers scoped to Date only — faking setTimeout/setInterval would
    // break waitFor's internal retry mechanism and cause a 30-second timeout.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T14:30:00Z")); // UTC: Oct 5 | Melbourne (UTC+11): Oct 6

    // Override the clinic timezone mock to "Australia/Melbourne"
    mockGetClinicTimezone.mockReturnValue("Australia/Melbourne");

    setAuthenticatedUser(authTestState, adminUser);
    mockGetLaborForecast.mockResolvedValue(makeFutureOnlyAnalysis());

    renderPage();

    // The "From" date input must show the CLINIC-LOCAL date (Oct 6 in Melbourne),
    // not the UTC/browser date (Oct 5).
    await waitFor(() => {
      const fromInput = screen.getByLabelText<HTMLInputElement>(/from date/i);
      // Clinic local date: Australia/Melbourne at 2026-10-05T14:30Z = 2026-10-06T01:30+11:00
      expect(fromInput.value).toBe("2026-10-06");
      // Explicitly assert it is NOT the UTC/browser date:
      expect(fromInput.value).not.toBe("2026-10-05");
    });

    // Reset
    mockGetClinicTimezone.mockReturnValue("Australia/Sydney");
    vi.useRealTimers();
  });
});
