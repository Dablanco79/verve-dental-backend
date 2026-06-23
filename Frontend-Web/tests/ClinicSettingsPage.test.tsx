/**
 * ClinicSettingsPage.test.tsx
 *
 * Coverage:
 *   - /settings/clinic  (no URL param — home-clinic view)
 *       - owner_admin can view and edit their home clinic
 *       - group_practice_manager sees the form in read-only mode
 *       - clinical_staff is redirected to /
 *   - /settings/clinics/:clinicId/edit  (URL param — any-clinic view)
 *       - owner_admin can load and edit any clinic (including non-home clinic)
 *       - group_practice_manager is redirected to /
 *       - clinical_staff is redirected to /
 *   - Successful save calls updateClinicSettings with the correct payload
 *   - Renders null when no user is authenticated
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicSettingsPage } from "../src/pages/ClinicSettingsPage.js";
import type { ClinicData } from "../src/types/clinic.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

const { authTestState, mockGetClinic, mockUpdateClinicSettings } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockGetClinic:            vi.fn(),
    mockUpdateClinicSettings: vi.fn(),
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
    getClinic:            mockGetClinic,
    updateClinicSettings: mockUpdateClinicSettings,
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const OTHER_CLINIC_ID = "22222222-2222-4222-8222-222222222222";

const homeClinic: ClinicData = {
  id: TEST_CLINIC_ID,
  name: TEST_CLINIC_NAME,
  abn: null,
  addressLine1: null,
  suburb: null,
  state: null,
  postcode: null,
  timezone: "Australia/Melbourne",
  subscriptionTier: "standard",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-06-01T10:00:00Z",
};

const otherClinic: ClinicData = {
  id: OTHER_CLINIC_ID,
  name: "Verve Dental Clinic B",
  abn: null,
  addressLine1: null,
  suburb: null,
  state: null,
  postcode: null,
  timezone: "Australia/Brisbane",
  subscriptionTier: "premium",
  isActive: true,
  createdAt: "2024-06-01T00:00:00Z",
  updatedAt: "2024-06-15T08:00:00Z",
};

// ── Render helpers ─────────────────────────────────────────────────────────────

/** Renders the page at /settings/clinic (no URL param — home clinic route). */
function renderHomeClinicRoute() {
  return render(
    <MemoryRouter initialEntries={["/settings/clinic"]}>
      <Routes>
        <Route path="/settings/clinic" element={<ClinicSettingsPage />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders the page at /settings/clinics/:clinicId/edit for the given ID. */
function renderEditClinicRoute(clinicId: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/clinics/${clinicId}/edit`]}>
      <Routes>
        <Route path="/settings/clinics/:clinicId/edit" element={<ClinicSettingsPage />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicSettingsPage — /settings/clinic (home-clinic route)", () => {
  describe("owner_admin", () => {
    beforeEach(() => {
      setAuthenticatedUser(authTestState, createAdminUser());
      mockGetClinic.mockResolvedValue(homeClinic);
    });

    it("renders the page heading", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /clinic settings/i })).toBeInTheDocument();
      });
    });

    it("loads the home clinic and populates the clinic name", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(mockGetClinic).toHaveBeenCalledWith(TEST_CLINIC_ID);
      });
      expect(
        screen.getByDisplayValue(TEST_CLINIC_NAME),
      ).toBeInTheDocument();
    });

    it("form inputs are enabled for owner_admin", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.getByDisplayValue(TEST_CLINIC_NAME)).not.toBeDisabled();
      });
    });

    it("calls updateClinicSettings with the correct clinic id on save", async () => {
      mockUpdateClinicSettings.mockResolvedValue(homeClinic);
      renderHomeClinicRoute();

      await waitFor(() => {
        expect(screen.getByDisplayValue(TEST_CLINIC_NAME)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

      await waitFor(() => {
        expect(mockUpdateClinicSettings).toHaveBeenCalledWith(
          TEST_CLINIC_ID,
          expect.objectContaining({ name: TEST_CLINIC_NAME }),
        );
      });
    });
  });

  describe("group_practice_manager", () => {
    beforeEach(() => {
      setAuthenticatedUser(authTestState, createManagerUser());
      mockGetClinic.mockResolvedValue(homeClinic);
    });

    it("renders the page (not redirected)", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /clinic settings/i })).toBeInTheDocument();
      });
    });

    it("form inputs are disabled (read-only mode)", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.getByDisplayValue(TEST_CLINIC_NAME)).toBeDisabled();
      });
    });

    it("shows the read-only notice", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.getByText(/view only/i)).toBeInTheDocument();
      });
    });

    it("does not show the Save settings button", async () => {
      renderHomeClinicRoute();
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /save settings/i })).not.toBeInTheDocument();
      });
    });
  });

  describe("clinical_staff", () => {
    it("redirects to /", () => {
      setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
      mockGetClinic.mockResolvedValue(homeClinic);

      renderHomeClinicRoute();

      expect(
        screen.queryByRole("heading", { name: /clinic settings/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicSettingsPage — /settings/clinics/:clinicId/edit (parameterised route)", () => {
  describe("owner_admin editing a non-home clinic", () => {
    beforeEach(() => {
      setAuthenticatedUser(authTestState, createAdminUser());
      mockGetClinic.mockResolvedValue(otherClinic);
    });

    it("loads the specified clinic (not home clinic)", async () => {
      renderEditClinicRoute(OTHER_CLINIC_ID);
      await waitFor(() => {
        expect(mockGetClinic).toHaveBeenCalledWith(OTHER_CLINIC_ID);
      });
    });

    it("displays the non-home clinic name in the form", async () => {
      renderEditClinicRoute(OTHER_CLINIC_ID);
      await waitFor(() => {
        expect(screen.getByDisplayValue("Verve Dental Clinic B")).toBeInTheDocument();
      });
    });

    it("form inputs are enabled for owner_admin", async () => {
      renderEditClinicRoute(OTHER_CLINIC_ID);
      await waitFor(() => {
        expect(screen.getByDisplayValue("Verve Dental Clinic B")).not.toBeDisabled();
      });
    });

    it("calls updateClinicSettings with the correct non-home clinic id on save", async () => {
      mockUpdateClinicSettings.mockResolvedValue(otherClinic);
      renderEditClinicRoute(OTHER_CLINIC_ID);

      await waitFor(() => {
        expect(screen.getByDisplayValue("Verve Dental Clinic B")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

      await waitFor(() => {
        expect(mockUpdateClinicSettings).toHaveBeenCalledWith(
          OTHER_CLINIC_ID,
          expect.objectContaining({ name: "Verve Dental Clinic B" }),
        );
      });
    });
  });

  describe("group_practice_manager", () => {
    it("is redirected to / when accessing parameterised edit route", () => {
      setAuthenticatedUser(authTestState, createManagerUser());
      mockGetClinic.mockResolvedValue(otherClinic);

      renderEditClinicRoute(OTHER_CLINIC_ID);

      expect(
        screen.queryByRole("heading", { name: /clinic settings/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  describe("clinical_staff", () => {
    it("is redirected to / when accessing parameterised edit route", () => {
      setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
      mockGetClinic.mockResolvedValue(otherClinic);

      renderEditClinicRoute(OTHER_CLINIC_ID);

      expect(
        screen.queryByRole("heading", { name: /clinic settings/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  describe("unauthenticated", () => {
    it("renders null when no user is authenticated", () => {
      clearAuthenticatedUser(authTestState);
      mockGetClinic.mockResolvedValue(otherClinic);

      const { container } = renderEditClinicRoute(OTHER_CLINIC_ID);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
