/**
 * ManageUsersPage.test.tsx — Sprint 1: User Identity + Module Access panel
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
 *
 *   Module Access panel (owner_admin only):
 *   - Clinical Staff with 3 seeded grants renders correct checkboxes
 *   - User with zero grants renders all modules unchecked (no crash)
 *   - Granting a module calls grantUserPermission and checks the box
 *   - Revoking a module calls revokeUserPermission and unchecks the box
 *   - Failed listUserPermissions shows a controlled error state (no crash)
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

const {
  authTestState,
  mockListUsers,
  mockListClinics,
  mockCreateUser,
  mockListUserPermissions,
  mockGrantUserPermission,
  mockRevokeUserPermission,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListUsers: vi.fn(),
    mockListClinics: vi.fn(),
    mockCreateUser: vi.fn(),
    // Permission mocks — default to returning a flat empty array (correct shape).
    // Individual tests override as needed.
    mockListUserPermissions: vi.fn().mockResolvedValue([]),
    mockGrantUserPermission: vi.fn().mockResolvedValue({
      id: "g1",
      clinicId: "c1",
      userId: "u1",
      permission: "module:timesheets",
      grantedBy: "admin",
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    }),
    mockRevokeUserPermission: vi.fn().mockResolvedValue(undefined),
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
    listUsers: mockListUsers,
    createUser: mockCreateUser,
    resetUserPassword: vi.fn(),
    listClinics: mockListClinics,
    listUserPermissions: mockListUserPermissions,
    grantUserPermission: mockGrantUserPermission,
    revokeUserPermission: mockRevokeUserPermission,
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
  payrollTrack: "hourly",
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
  payrollTrack: "hourly",
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
    preferredName: null,
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
    preferredName: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Module Access panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: render page as admin, wait for the table, return the "Module access"
 * button for the given user's row.
 */
async function openModuleAccessPanel(targetEmail: string) {
  renderPage();
  await waitFor(() => expect(screen.getByText(targetEmail)).toBeInTheDocument());
  const row = screen.getByText(targetEmail).closest("tr") as HTMLElement;
  const btn = within(row).getByRole("button", { name: /module access/i });
  await userEvent.click(btn);
  return btn;
}

describe("ManageUsersPage — Module Access panel", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
    // Reset permission mocks to clean defaults before each test
    mockListUserPermissions.mockResolvedValue([]);
    mockGrantUserPermission.mockResolvedValue({
      id: "g1",
      clinicId: TEST_CLINIC_ID,
      userId: namedUser.id,
      permission: "module:timesheets",
      grantedBy: adminUser.id,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    });
    mockRevokeUserPermission.mockResolvedValue(undefined);
  });

  it("renders all module checkboxes unchecked when the user has zero grants (no crash)", async () => {
    // API returns [] — correct shape, no grants
    mockListUserPermissions.mockResolvedValue([]);

    await openModuleAccessPanel(namedUser.email);

    // Wait for the panel to finish loading (loading spinner disappears) by
    // looking for the checkboxes themselves.  Using findByRole avoids a
    // getByText multi-match on "Module access" because Bob's row still shows
    // a "Module access" button alongside Alice's now-visible panel heading.
    const timesheetsBox = await screen.findByRole("checkbox", { name: /timesheets access/i });
    expect(timesheetsBox).not.toBeChecked();

    const inventoryBox = screen.getByRole("checkbox", { name: /inventory access/i });
    expect(inventoryBox).not.toBeChecked();

    // Panel aria-label confirms it rendered correctly
    expect(screen.getByLabelText(`Module access for ${namedUser.email}`)).toBeInTheDocument();
  });

  it("renders 3 seeded grants checked for a clinical_staff user", async () => {
    // Simulate the backend returning timesheets, roster, leave as active grants
    // (the 3 production initial grants for clinical_staff)
    mockListUserPermissions.mockResolvedValue([
      { id: "g1", clinicId: TEST_CLINIC_ID, userId: namedUser.id, permission: "module:timesheets", grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
      { id: "g2", clinicId: TEST_CLINIC_ID, userId: namedUser.id, permission: "module:roster",     grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
      { id: "g3", clinicId: TEST_CLINIC_ID, userId: namedUser.id, permission: "module:leave",      grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
    ]);

    await openModuleAccessPanel(namedUser.email);

    const timesheetsBox = await screen.findByRole("checkbox", { name: /timesheets access/i });
    expect(timesheetsBox).toBeChecked();

    const rosterBox = screen.getByRole("checkbox", { name: /roster access/i });
    expect(rosterBox).toBeChecked();

    const leaveBox = screen.getByRole("checkbox", { name: /leave access/i });
    expect(leaveBox).toBeChecked();

    // Modules not granted should be unchecked
    const inventoryBox = screen.getByRole("checkbox", { name: /inventory access/i });
    expect(inventoryBox).not.toBeChecked();
    const procurementBox = screen.getByRole("checkbox", { name: /procurement access/i });
    expect(procurementBox).not.toBeChecked();
  });

  it("granting a module calls grantUserPermission and checks the box", async () => {
    // Start with no grants
    mockListUserPermissions.mockResolvedValue([]);
    mockGrantUserPermission.mockResolvedValue({
      id: "g-new",
      clinicId: TEST_CLINIC_ID,
      userId: namedUser.id,
      permission: "module:inventory",
      grantedBy: adminUser.id,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    });

    await openModuleAccessPanel(namedUser.email);

    const inventoryBox = await screen.findByRole("checkbox", { name: /inventory access/i });
    expect(inventoryBox).not.toBeChecked();

    await userEvent.click(inventoryBox);

    await waitFor(() => {
      expect(mockGrantUserPermission).toHaveBeenCalledWith(
        namedUser.homeClinicId,
        namedUser.id,
        "module:inventory",
      );
    });

    // Checkbox should now be checked (optimistic UI update)
    await waitFor(() => expect(inventoryBox).toBeChecked());
  });

  it("revoking a module calls revokeUserPermission and unchecks the box", async () => {
    // Start with inventory granted
    mockListUserPermissions.mockResolvedValue([
      { id: "g1", clinicId: TEST_CLINIC_ID, userId: namedUser.id, permission: "module:inventory", grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
    ]);

    await openModuleAccessPanel(namedUser.email);

    const inventoryBox = await screen.findByRole("checkbox", { name: /inventory access/i });
    expect(inventoryBox).toBeChecked();

    await userEvent.click(inventoryBox);

    await waitFor(() => {
      expect(mockRevokeUserPermission).toHaveBeenCalledWith(
        namedUser.homeClinicId,
        namedUser.id,
        "module:inventory",
      );
    });

    await waitFor(() => expect(inventoryBox).not.toBeChecked());
  });

  it("shows a controlled error state when listUserPermissions rejects (no crash)", async () => {
    mockListUserPermissions.mockRejectedValue(new Error("Permission load failed"));

    await openModuleAccessPanel(namedUser.email);

    // Should show an error message, not crash the whole page
    await waitFor(() =>
      expect(screen.getByText(/permission load failed/i)).toBeInTheDocument(),
    );

    // The rest of the table should still be visible
    expect(screen.getByText(namedUser.email)).toBeInTheDocument();
  });
});
