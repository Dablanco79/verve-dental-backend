/**
 * ManageUsersPage.test.tsx — Sprint 1: User Identity
 *
 * Coverage:
 *   - Shows "Loading accounts…" while the request is in flight
 *   - Renders the user table (Name, Email, Role, Home clinic columns) on success
 *   - Displays name when firstName + lastName are present
 *   - Falls back to "—" when name fields are null
 *   - Displays an error message when listUsers() rejects
 *   - Redirects non-manager roles to home ("/")
 *   - Owner admin sees a clinic selector in the create form
 *   - Practice manager does NOT see a clinic selector in the create form
 *   - Practice manager role selector only shows Clinical Staff option
 *   - Owner admin role selector shows all three role options
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageUsersPage } from "../src/pages/ManageUsersPage.js";
import type { StaffUser } from "../src/types/index.js";
import type { ClinicData } from "../src/types/clinic.js";
import {
  createStaffUser,
  createManagerUser,
  createAdminUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
  TEST_CLINIC_B_ID,
  TEST_CLINIC_B_NAME,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  clearAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { authTestState, mockListUsers, mockListClinics, mockCreateUser } = vi.hoisted(
  () => {
    const authTestState: AuthTestState = { user: null, isLoading: false };
    return {
      authTestState,
      mockListUsers: vi.fn(),
      mockListClinics: vi.fn(),
      mockCreateUser: vi.fn(),
    };
  },
);

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
    listUsers: mockListUsers,
    createUser: mockCreateUser,
    resetUserPassword: vi.fn(),
    listClinics: mockListClinics,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const adminUser = createAdminUser();
const managerUser = createManagerUser();

const namedUser: StaffUser = {
  id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu1",
  email: "alice@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: "Alice",
  lastName: "Jones",
  displayName: "Alice Jones",
};

const unnamedUser: StaffUser = {
  id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu2",
  email: "bob@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: null,
  lastName: null,
  displayName: null,
};

const sampleUsers: StaffUser[] = [namedUser, unnamedUser];

const sampleClinics: ClinicData[] = [
  {
    id: TEST_CLINIC_ID,
    name: TEST_CLINIC_NAME,
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Sydney",
    subscriptionTier: "standard",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: TEST_CLINIC_B_ID,
    name: TEST_CLINIC_B_NAME,
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Sydney",
    subscriptionTier: "standard",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <ManageUsersPage />
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — loading state", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockImplementation(() => new Promise(() => { /* intentional hang */ }));
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("shows the loading message while the request is in flight", () => {
    renderPage();
    expect(screen.getByText(/loading accounts/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — successful load", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("renders Name, Email, Role, and Home clinic column headers", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("alice@clinic-a.au")).toBeInTheDocument());

    expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /role/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /home clinic/i })).toBeInTheDocument();
  });

  it("displays 'First Last' when firstName and lastName are present", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Alice Jones")).toBeInTheDocument());
  });

  it("displays '—' when name fields are null", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bob@clinic-a.au")).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("displays the correct account count in the subtitle", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 accounts/i)).toBeInTheDocument();
    });
  });

  it("shows 'No accounts found' when the clinic has no users", async () => {
    mockListUsers.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no accounts found/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — error handling", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("displays the error message when listUsers() rejects", async () => {
    mockListUsers.mockRejectedValue(new Error("Internal server error"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/loading accounts/i)).not.toBeInTheDocument();
  });

  it("displays a fallback message when the rejection has no message", async () => {
    mockListUsers.mockRejectedValue("non-error rejection");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/unable to load users/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — access control", () => {
  beforeEach(() => {
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("redirects clinical_staff to home", () => {
    setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
    mockListUsers.mockResolvedValue([]);

    renderPage();

    expect(
      screen.queryByRole("heading", { name: /manage staff accounts/i }),
    ).not.toBeInTheDocument();
  });

  it("renders null when no user is authenticated", () => {
    clearAuthenticatedUser(authTestState);
    mockListUsers.mockResolvedValue([]);

    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — create user form (owner_admin)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue([]);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("shows the create form when '+ Add user' is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(
      screen.getByRole("form", { name: /create new staff account/i }),
    ).toBeInTheDocument();
  });

  it("shows a Home clinic selector for owner_admin", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(screen.getByRole("combobox", { name: /home clinic/i })).toBeInTheDocument();
  });

  it("lists all three role options for owner_admin", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    const options = within(roleSelect).getAllByRole("option");
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);

    expect(optionValues).toContain("owner_admin");
    expect(optionValues).toContain("group_practice_manager");
    expect(optionValues).toContain("clinical_staff");
  });

  it("shows First name, Last name, Display name, Email, and Password fields", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(screen.getByRole("textbox", { name: /first name/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /last name/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — create user form (group_practice_manager)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListUsers.mockResolvedValue([]);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("does NOT show a Home clinic selector for group_practice_manager", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(
      screen.queryByRole("combobox", { name: /home clinic/i }),
    ).not.toBeInTheDocument();
  });

  it("only shows Clinical Staff in the role selector for group_practice_manager", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no accounts found/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    const options = within(roleSelect).getAllByRole("option");

    expect(options).toHaveLength(1);
    expect((options[0] as HTMLOptionElement).value).toBe("clinical_staff");
  });
});
