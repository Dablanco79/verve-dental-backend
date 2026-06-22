/**
 * CreateClinicPage.test.tsx
 *
 * Coverage:
 *   - Renders the create-clinic form for owner_admin
 *   - Validates name (required, min 3 characters)
 *   - Validates ABN format
 *   - Validates postcode format
 *   - Calls createClinic() with name + timezone on submit (no optional fields)
 *   - Calls updateClinicSettings() with optional fields when they are filled in
 *   - Does NOT call updateClinicSettings() when only name + timezone are provided
 *   - Shows the error message when createClinic() rejects
 *   - Navigates to /settings/clinics after successful creation
 *   - Redirects group_practice_manager and clinical_staff to /
 *   - Renders null when no user is authenticated
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateClinicPage } from "../src/pages/CreateClinicPage.js";
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

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

const { authTestState, mockCreateClinic, mockUpdateClinicSettings } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockCreateClinic:         vi.fn(),
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
    createClinic:         mockCreateClinic,
    updateClinicSettings: mockUpdateClinicSettings,
  }),
}));

// Intercept useNavigate so we can assert on navigation without a real router.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

const NEW_CLINIC_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const createdClinic: ClinicData = {
  id: NEW_CLINIC_ID,
  name: "Verve Dental Clinic B",
  abn: null,
  addressLine1: null,
  suburb: null,
  state: null,
  postcode: null,
  timezone: "Australia/Melbourne",
  subscriptionTier: "standard",
  isActive: true,
  createdAt: "2024-06-01T00:00:00Z",
  updatedAt: "2024-06-01T00:00:00Z",
};

const adminUser = createStaffUser({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
});

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateClinicPage />
    </MemoryRouter>,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fillName(value: string) {
  const input = screen.getByRole("textbox", { name: /clinic name/i });
  fireEvent.change(input, { target: { value } });
}

function submitForm() {
  const btn = screen.getByRole("button", { name: /create clinic/i });
  fireEvent.click(btn);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — render", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockCreateClinic.mockReset();
    mockUpdateClinicSettings.mockReset();
    mockNavigate.mockReset();
  });

  it("renders the page heading", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /add new clinic/i })).toBeInTheDocument();
  });

  it("renders all form fields", () => {
    renderPage();
    expect(screen.getByRole("textbox", { name: /clinic name/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /australian business number/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /street address/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /suburb/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /postcode/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /timezone/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /state/i })).toBeInTheDocument();
  });

  it("renders the Create clinic submit button", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /create clinic/i })).toBeInTheDocument();
  });

  it("renders the Back to clinics link", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /back to clinics/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — validation", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockCreateClinic.mockReset();
  });

  it("shows a validation error when name is empty", async () => {
    renderPage();
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/clinic name must be at least 3 characters/i)).toBeInTheDocument();
    });

    expect(mockCreateClinic).not.toHaveBeenCalled();
  });

  it("shows a validation error when name is fewer than 3 characters", async () => {
    renderPage();
    fillName("AB");
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/clinic name must be at least 3 characters/i)).toBeInTheDocument();
    });
  });

  it("shows a validation error when ABN is invalid", async () => {
    renderPage();
    fillName("Valid Clinic Name");
    const abnInput = screen.getByRole("textbox", { name: /australian business number/i });
    fireEvent.change(abnInput, { target: { value: "123" } });
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/abn must be 9–11 digits/i)).toBeInTheDocument();
    });

    expect(mockCreateClinic).not.toHaveBeenCalled();
  });

  it("shows a validation error when postcode is not 4 digits", async () => {
    renderPage();
    fillName("Valid Clinic Name");
    const postcodeInput = screen.getByRole("textbox", { name: /postcode/i });
    fireEvent.change(postcodeInput, { target: { value: "200" } });
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/postcode must be exactly 4 digits/i)).toBeInTheDocument();
    });

    expect(mockCreateClinic).not.toHaveBeenCalled();
  });

  it("clears a field error when the user starts typing", async () => {
    renderPage();
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/clinic name must be at least 3 characters/i)).toBeInTheDocument();
    });

    fillName("Updated");

    await waitFor(() => {
      expect(screen.queryByText(/clinic name must be at least 3 characters/i)).not.toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — successful create (name + timezone only)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockCreateClinic.mockReset();
    mockUpdateClinicSettings.mockReset();
    mockNavigate.mockReset();
    mockCreateClinic.mockResolvedValue(createdClinic);
    mockUpdateClinicSettings.mockResolvedValue(createdClinic);
    mockNavigate.mockResolvedValue(undefined);
  });

  it("calls createClinic() with name and timezone when no optional fields are filled", async () => {
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(mockCreateClinic).toHaveBeenCalledWith({
        name:     "Verve Dental Clinic B",
        timezone: "Australia/Melbourne",
      });
    });
  });

  it("does NOT call updateClinicSettings() when no optional fields are provided", async () => {
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(mockCreateClinic).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateClinicSettings).not.toHaveBeenCalled();
  });

  it("navigates to /settings/clinics after successful creation", async () => {
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/settings/clinics");
    });
  });

  it("disables the submit button while submitting", async () => {
    // Never resolve so the button stays in the submitting state.
    mockCreateClinic.mockImplementation(() => new Promise(() => { /* hang */ }));
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /creating…/i })).toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — successful create with optional fields", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockCreateClinic.mockReset();
    mockUpdateClinicSettings.mockReset();
    mockNavigate.mockReset();
    mockCreateClinic.mockResolvedValue(createdClinic);
    mockUpdateClinicSettings.mockResolvedValue(createdClinic);
    mockNavigate.mockResolvedValue(undefined);
  });

  it("calls updateClinicSettings() with optional fields when they are provided", async () => {
    renderPage();
    fillName("Verve Dental Clinic B");

    fireEvent.change(
      screen.getByRole("textbox", { name: /australian business number/i }),
      { target: { value: "12345678901" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /street address/i }),
      { target: { value: "Level 2, 99 Collins Street" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /suburb/i }),
      { target: { value: "Melbourne" } },
    );

    submitForm();

    await waitFor(() => {
      expect(mockUpdateClinicSettings).toHaveBeenCalledWith(
        NEW_CLINIC_ID,
        expect.objectContaining({
          abn:         "12345678901",
          addressLine1: "Level 2, 99 Collins Street",
          suburb:      "Melbourne",
        }),
      );
    });
  });

  it("strips spaces from ABN before passing to updateClinicSettings()", async () => {
    renderPage();
    fillName("Verve Dental Clinic B");
    fireEvent.change(
      screen.getByRole("textbox", { name: /australian business number/i }),
      { target: { value: "12 345 678 901" } },
    );
    submitForm();

    await waitFor(() => {
      expect(mockUpdateClinicSettings).toHaveBeenCalledWith(
        NEW_CLINIC_ID,
        expect.objectContaining({ abn: "12345678901" }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — error handling", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockCreateClinic.mockReset();
    mockNavigate.mockReset();
  });

  it("shows the error message when createClinic() rejects", async () => {
    mockCreateClinic.mockRejectedValue(new Error("Internal server error"));
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("re-enables the submit button after a failed submission", async () => {
    mockCreateClinic.mockRejectedValue(new Error("Network error"));
    renderPage();
    fillName("Verve Dental Clinic B");
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create clinic/i })).not.toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CreateClinicPage — access control", () => {
  it("redirects group_practice_manager to /", () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    renderPage();

    expect(
      screen.queryByRole("heading", { name: /add new clinic/i }),
    ).not.toBeInTheDocument();
  });

  it("redirects clinical_staff to /", () => {
    setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
    renderPage();

    expect(
      screen.queryByRole("heading", { name: /add new clinic/i }),
    ).not.toBeInTheDocument();
  });

  it("renders null when no user is authenticated", () => {
    clearAuthenticatedUser(authTestState);

    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});
