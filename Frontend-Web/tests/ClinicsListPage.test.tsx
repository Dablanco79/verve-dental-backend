/**
 * ClinicsListPage.test.tsx
 *
 * Coverage:
 *   - Loading state shows the loading message while listClinics() is in flight
 *   - Renders clinic rows (name, timezone label, active / inactive status)
 *   - Shows "Manage" link for the user's home clinic; "Home clinic only" for others
 *   - Shows "Add clinic" button linking to /settings/clinics/new
 *   - Shows "No clinics found" when the list is empty
 *   - Shows an error message when listClinics() rejects
 *   - Redirects group_practice_manager and clinical_staff to /
 *   - Renders null when no user is authenticated
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicsListPage } from "../src/pages/ClinicsListPage.js";
import type { ClinicData } from "../src/types/clinic.js";
import {
  createStaffUser,
  createManagerUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  clearAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Mocks (hoisted so vi.mock factories can reference them) ────────────────────

const { authTestState, mockListClinics } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return { authTestState, mockListClinics: vi.fn() };
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
    listClinics: mockListClinics,
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SECOND_CLINIC_ID = "22222222-2222-4222-8222-222222222222";

const adminUser = createStaffUser({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
});

const sampleClinics: ClinicData[] = [
  {
    id: TEST_CLINIC_ID,
    name: "Verve Dental Clinic A",
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Melbourne",
    subscriptionTier: "standard",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: SECOND_CLINIC_ID,
    name: "Verve Dental Clinic B",
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Brisbane",
    subscriptionTier: "premium",
    isActive: false,
    createdAt: "2024-06-01T00:00:00Z",
    updatedAt: "2024-06-01T00:00:00Z",
  },
];

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <ClinicsListPage />
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicsListPage — loading state", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListClinics.mockImplementation(() => new Promise(() => { /* intentional hang */ }));
  });

  it("shows the loading message while the request is in flight", () => {
    renderPage();
    expect(screen.getByText(/loading clinics…/i)).toBeInTheDocument();
  });

  it("renders the page heading immediately", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /clinics/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicsListPage — successful load", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("renders a row for each clinic", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Verve Dental Clinic A")).toBeInTheDocument();
    });

    expect(screen.getByText("Verve Dental Clinic B")).toBeInTheDocument();
  });

  it("shows the timezone label for each clinic", async () => {
    renderPage();

    await waitFor(() => {
      // Australia/Melbourne → "Melbourne (AEST/AEDT)"
      expect(screen.getByText(/melbourne \(aest\/aedt\)/i)).toBeInTheDocument();
    });

    // Australia/Brisbane → "Brisbane (AEST)"
    expect(screen.getByText(/brisbane \(aest\)/i)).toBeInTheDocument();
  });

  it("shows Active badge for active clinic and Inactive for inactive clinic", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows a Manage link for the user's home clinic", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /manage/i })).toBeInTheDocument();
    });
  });

  it("shows 'Home clinic only' label for clinics that are not the home clinic", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/home clinic only/i)).toBeInTheDocument();
    });
  });

  it("shows the clinic count in the subtitle", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/2 clinics/i)).toBeInTheDocument();
    });
  });

  it("renders the Add clinic button linking to /settings/clinics/new", async () => {
    renderPage();

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /add clinic/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/settings/clinics/new");
    });
  });

  it("shows 'No clinics found' when listClinics returns an empty array", async () => {
    mockListClinics.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no clinics found/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicsListPage — error handling", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
  });

  it("shows the error message when listClinics() rejects", async () => {
    mockListClinics.mockRejectedValue(new Error("Network failure"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });
  });

  it("shows a fallback message for a non-Error rejection", async () => {
    mockListClinics.mockRejectedValue("string rejection");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/unable to load clinics/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ClinicsListPage — access control", () => {
  it("redirects group_practice_manager to /", () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    mockListClinics.mockResolvedValue([]);

    renderPage();

    expect(
      screen.queryByRole("heading", { name: /clinics/i }),
    ).not.toBeInTheDocument();
  });

  it("redirects clinical_staff to /", () => {
    setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
    mockListClinics.mockResolvedValue([]);

    renderPage();

    expect(
      screen.queryByRole("heading", { name: /clinics/i }),
    ).not.toBeInTheDocument();
  });

  it("renders null when no user is authenticated", () => {
    clearAuthenticatedUser(authTestState);
    mockListClinics.mockResolvedValue([]);

    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});
