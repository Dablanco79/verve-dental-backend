/**
 * LaborForecastPage.test.tsx
 *
 * Coverage:
 *   - Missing-rate indicator appears when anyStaffUsingFallback is true
 *   - Missing-rate indicator absent when anyStaffUsingFallback is false
 *   - "Using default estimate" badge shown in table rows when usingFallbackForSomeStaff
 *   - "Configured" badge shown in table rows when rate is configured
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaborForecastPage } from "../src/pages/LaborForecastPage.js";
import {
  createAdminUser,
  TEST_CLINIC_ID,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { authTestState, mockGetLaborForecast } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetLaborForecast: vi.fn(),
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

// Mock useOperationalClinic to return a known clinicId
vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: () => ({
    clinicId: TEST_CLINIC_ID,
    clinicName: "Verve Dental Clinic A",
    isAllClinicsScope: false,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const adminUser = createAdminUser();

function makeForecastSummary(overrides: Partial<{
  anyStaffUsingFallback: boolean;
  usingFallbackForSomeStaff: boolean;
}> = {}) {
  const { anyStaffUsingFallback = false, usingFallbackForSomeStaff = false } = overrides;
  return {
    clinicId: TEST_CLINIC_ID,
    forecastWindowDays: 14,
    totalProjectedHours: 8,
    totalProjectedBaseCost: 400.00,
    totalProjectedOverheadCost: 60.00,
    grandTotalProjectedCost: 460.00,
    anyStaffUsingFallback,
    breakdownByRole: [
      {
        role: "standard",
        totalScheduledHours: 8,
        projectedBaseCost: 400.00,
        projectedOverheadCost: 60.00,
        totalProjectedCost: 460.00,
        usingFallbackForSomeStaff,
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

// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastPage — missing-rate indicator", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
  });

  it("shows the fallback banner when anyStaffUsingFallback is true", async () => {
    mockGetLaborForecast.mockResolvedValue(makeForecastSummary({ anyStaffUsingFallback: true }));
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/some staff shown as.*using default estimate/i),
      ).toBeInTheDocument(),
    );
  });

  it("does NOT show the fallback banner when anyStaffUsingFallback is false", async () => {
    mockGetLaborForecast.mockResolvedValue(makeForecastSummary({ anyStaffUsingFallback: false }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/standard/i)).toBeInTheDocument(),
    );

    expect(
      screen.queryByText(/some staff shown as.*using default estimate/i),
    ).not.toBeInTheDocument();
  });

  it("shows 'Using default estimate' badge in table row when usingFallbackForSomeStaff is true", async () => {
    mockGetLaborForecast.mockResolvedValue(
      makeForecastSummary({ anyStaffUsingFallback: true, usingFallbackForSomeStaff: true }),
    );
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByTitle(/at least one staff member is using the default hourly estimate/i)
      ).toBeInTheDocument(),
    );
  });

  it("shows 'Configured' badge in table row when usingFallbackForSomeStaff is false", async () => {
    mockGetLaborForecast.mockResolvedValue(
      makeForecastSummary({ anyStaffUsingFallback: false, usingFallbackForSomeStaff: false }),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/configured/i)).toBeInTheDocument(),
    );
  });
});
