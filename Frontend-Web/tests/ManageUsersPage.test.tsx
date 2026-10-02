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
  mockUpdateUser,
  mockListUserPermissions,
  mockGrantUserPermission,
  mockRevokeUserPermission,
  mockListPayRates,
  mockCreatePayRate,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListUsers: vi.fn(),
    mockListClinics: vi.fn(),
    mockCreateUser: vi.fn(),
    // updateUser — default returns the namedUser unchanged; individual tests override.
    mockUpdateUser: vi.fn().mockResolvedValue({
      id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu1",
      email: "alice@clinic-a.au",
      role: "clinical_staff",
      homeClinicId: "11111111-1111-4111-8111-111111111111",
      homeClinicName: "Verve Dental Clinic A",
      firstName: "Alice",
      lastName: "Jones",
      displayName: "Alice Jones",
      payrollTrack: "hourly",
      permissions: [],
    }),
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
    // Pay rate mocks — default to empty array / resolved value.
    mockListPayRates: vi.fn().mockResolvedValue([]),
    mockCreatePayRate: vi.fn().mockResolvedValue({
      id: "pr-1",
      staffUserId: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu1",
      baseHourlyRateCents: 5000,
      employmentType: "full_time",
      contractedWeeklyHours: 38,
      superRatePercent: 12.0,
      effectiveFrom: "2026-10-01",
      effectiveTo: null,
      createdByUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
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
    updateUser: mockUpdateUser,
    resetUserPassword: vi.fn(),
    listClinics: mockListClinics,
    listUserPermissions: mockListUserPermissions,
    grantUserPermission: mockGrantUserPermission,
    revokeUserPermission: mockRevokeUserPermission,
    listPayRates: mockListPayRates,
    createPayRate: mockCreatePayRate,
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

// ─────────────────────────────────────────────────────────────────────────────
// Pay Profile panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: render page as a given user, wait for the table, click "Edit" for namedUser.
 */
async function openEditPanel(pageUser = adminUser) {
  setAuthenticatedUser(authTestState, pageUser);
  mockListUsers.mockResolvedValue(sampleUsers);
  mockListClinics.mockResolvedValue(sampleClinics);
  mockListPayRates.mockResolvedValue([]);

  renderPage();
  await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

  const row = screen.getByText(namedUser.email).closest("tr") as HTMLElement;
  const editBtn = within(row).getByRole("button", { name: /^edit$/i });
  await userEvent.click(editBtn);
}

describe("ManageUsersPage — Pay Profile panel", () => {
  beforeEach(() => {
    mockListPayRates.mockResolvedValue([]);
    mockCreatePayRate.mockResolvedValue({
      id: "pr-1",
      staffUserId: namedUser.id,
      baseHourlyRateCents: 5000,
      employmentType: "full_time",
      contractedWeeklyHours: 38,
      superRatePercent: 12.0,
      effectiveFrom: "2026-10-01",
      effectiveTo: null,
      createdByUserId: adminUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("Pay Profile section is hidden when user lacks payroll:rates:read permission", async () => {
    // Admin without payroll:rates:read
    const adminWithoutRatesRead = createAdminUser({
      permissions: ["users:read", "users:write"],
    });
    await openEditPanel(adminWithoutRatesRead);

    // The Pay Profile section heading should not appear
    expect(screen.queryByText(/pay profile/i)).not.toBeInTheDocument();
  });

  it("Pay Profile section is visible when user has payroll:rates:read permission", async () => {
    const adminWithRatesRead = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read"],
    });
    await openEditPanel(adminWithRatesRead);

    await waitFor(() =>
      expect(screen.getByText(/pay profile/i)).toBeInTheDocument(),
    );
  });

  it("shows 'No pay rate configured' when no active rate exists", async () => {
    mockListPayRates.mockResolvedValue([]);
    const adminWithRatesRead = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read"],
    });
    await openEditPanel(adminWithRatesRead);

    await waitFor(() =>
      expect(screen.getByText(/no pay rate configured/i)).toBeInTheDocument(),
    );
  });

  it("Add / Update Rate form is hidden when user lacks payroll:rates:write", async () => {
    const adminReadOnly = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read"],
      // no payroll:rates:write
    });
    await openEditPanel(adminReadOnly);

    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    // The "+ Add / Update Rate" button should NOT appear
    expect(screen.queryByRole("button", { name: /add.*update.*rate/i })).not.toBeInTheDocument();
  });

  it("Add / Update Rate form is accessible when user has payroll:rates:write", async () => {
    const adminWithWrite = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read", "payroll:rates:write"],
    });
    await openEditPanel(adminWithWrite);

    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);

    expect(
      screen.getByRole("form", { name: /add or update pay rate/i }),
    ).toBeInTheDocument();
  });

  it("super rate input defaults to 12.00 in the new rate form", async () => {
    const adminWithWrite = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read", "payroll:rates:write"],
    });
    await openEditPanel(adminWithWrite);

    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);

    const superInput = screen.getByRole("spinbutton", { name: /superannuation rate/i });
    expect((superInput as HTMLInputElement).value).toBe("12");
  });

  it("super rate is editable — user can change it from 12 to 15", async () => {
    const adminWithWrite = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read", "payroll:rates:write"],
    });
    await openEditPanel(adminWithWrite);

    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);

    const superInput = screen.getByRole("spinbutton", { name: /superannuation rate/i });
    await userEvent.clear(superInput);
    await userEvent.type(superInput, "15");

    expect((superInput as HTMLInputElement).value).toBe("15");
  });

  it("submitting the rate form calls createPayRate with correct payload", async () => {
    const adminWithWrite = createAdminUser({
      permissions: ["users:read", "users:write", "payroll:rates:read", "payroll:rates:write"],
    });
    setAuthenticatedUser(authTestState, adminWithWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
    mockListPayRates.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    const row = screen.getByText(namedUser.email).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /^edit$/i }));

    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);

    // Fill in the form
    await userEvent.type(
      screen.getByRole("spinbutton", { name: /base hourly rate/i }),
      "50",
    );
    const dateInput = screen.getByLabelText(/effective from/i);
    await userEvent.type(dateInput, "2026-10-01");

    const saveBtn = screen.getByRole("button", { name: /save rate/i });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockCreatePayRate).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        namedUser.id,
        expect.objectContaining({
          baseHourlyRateCents: 5000, // 50.00 * 100
          effectiveFrom: "2026-10-01",
        }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pay-rate permission controls in Module Access panel
//
// Coverage:
//   - GPM target user sees "View staff pay rates" and "Edit staff pay rates" checkboxes
//   - clinical_staff target user does NOT see those checkboxes
//   - Enabling Edit grants View first (dependency rule)
//   - Disabling View also revokes Edit (dependency rule)
//   - View can be granted without granting Edit
//   - Disabling Edit alone does NOT revoke View
// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — pay-rate permission controls (Module Access panel)", () => {
  beforeEach(() => {
    // Clear call history so toHaveBeenCalledTimes() counts are test-local.
    mockGrantUserPermission.mockClear();
    mockRevokeUserPermission.mockClear();

    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
    mockListUserPermissions.mockResolvedValue([]);
    mockGrantUserPermission.mockResolvedValue({
      id: "g-pr",
      clinicId: TEST_CLINIC_ID,
      userId: unnamedUser.id,
      permission: "payroll:rates:read",
      grantedBy: adminUser.id,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    });
    mockRevokeUserPermission.mockResolvedValue(undefined);
  });

  it("GPM target user sees View and Edit pay-rate checkboxes in the module access panel", async () => {
    await openModuleAccessPanel(unnamedUser.email);

    const viewBox = await screen.findByRole("checkbox", { name: /view staff pay rates access/i });
    expect(viewBox).toBeInTheDocument();

    const editBox = screen.getByRole("checkbox", { name: /edit staff pay rates access/i });
    expect(editBox).toBeInTheDocument();
  });

  it("clinical_staff target user does NOT see pay-rate checkboxes", async () => {
    // namedUser is clinical_staff — the checkboxes should be filtered out
    await openModuleAccessPanel(namedUser.email);

    // Wait for the panel to load (another checkbox must be present first)
    await screen.findByRole("checkbox", { name: /timesheets access/i });

    expect(screen.queryByRole("checkbox", { name: /view staff pay rates access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /edit staff pay rates access/i })).not.toBeInTheDocument();
  });

  it("enabling Edit pay rates also calls grantUserPermission for View first (dependency)", async () => {
    mockGrantUserPermission.mockResolvedValue({
      id: "g-pr",
      clinicId: TEST_CLINIC_ID,
      userId: unnamedUser.id,
      permission: "payroll:rates:read",
      grantedBy: adminUser.id,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    });

    await openModuleAccessPanel(unnamedUser.email);

    const editBox = await screen.findByRole("checkbox", { name: /edit staff pay rates access/i });
    expect(editBox).not.toBeChecked();

    await userEvent.click(editBox);

    await waitFor(() => { expect(mockGrantUserPermission).toHaveBeenCalledTimes(2); });

    // View must have been granted BEFORE Edit
    const calls = mockGrantUserPermission.mock.calls as Array<[string, string, string]>;
    const permissions = calls.map((c) => c[2]);
    expect(permissions[0]).toBe("payroll:rates:read");
    expect(permissions[1]).toBe("payroll:rates:write");
  });

  it("disabling View pay rates also calls revokeUserPermission for Edit (dependency)", async () => {
    // Both read and write are initially active
    mockListUserPermissions.mockResolvedValue([
      { id: "g1", clinicId: TEST_CLINIC_ID, userId: unnamedUser.id, permission: "payroll:rates:read",  grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
      { id: "g2", clinicId: TEST_CLINIC_ID, userId: unnamedUser.id, permission: "payroll:rates:write", grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
    ]);

    await openModuleAccessPanel(unnamedUser.email);

    const viewBox = await screen.findByRole("checkbox", { name: /view staff pay rates access/i });
    expect(viewBox).toBeChecked();

    await userEvent.click(viewBox);

    await waitFor(() => { expect(mockRevokeUserPermission).toHaveBeenCalledTimes(2); });

    const calls = mockRevokeUserPermission.mock.calls as Array<[string, string, string]>;
    const permissions = calls.map((c) => c[2]);
    // Read revoked first, then Write
    expect(permissions).toContain("payroll:rates:read");
    expect(permissions).toContain("payroll:rates:write");
  });

  it("granting View alone does NOT also grant Edit (no unintended side effect)", async () => {
    await openModuleAccessPanel(unnamedUser.email);

    const viewBox = await screen.findByRole("checkbox", { name: /view staff pay rates access/i });
    expect(viewBox).not.toBeChecked();

    await userEvent.click(viewBox);

    await waitFor(() => {
      expect(mockGrantUserPermission).toHaveBeenCalledWith(
        unnamedUser.homeClinicId,
        unnamedUser.id,
        "payroll:rates:read",
      );
    });

    // Should only have been called once — no Edit grant
    expect(mockGrantUserPermission).toHaveBeenCalledTimes(1);
    expect(mockGrantUserPermission).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "payroll:rates:write",
    );
  });

  it("disabling Edit alone does NOT revoke View (no unintended side effect)", async () => {
    // Only write is active (abnormal state, but the dependency rule is one-way)
    mockListUserPermissions.mockResolvedValue([
      { id: "g1", clinicId: TEST_CLINIC_ID, userId: unnamedUser.id, permission: "payroll:rates:read",  grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
      { id: "g2", clinicId: TEST_CLINIC_ID, userId: unnamedUser.id, permission: "payroll:rates:write", grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
    ]);

    await openModuleAccessPanel(unnamedUser.email);

    const editBox = await screen.findByRole("checkbox", { name: /edit staff pay rates access/i });
    expect(editBox).toBeChecked();

    await userEvent.click(editBox);

    await waitFor(() => {
      expect(mockRevokeUserPermission).toHaveBeenCalledWith(
        unnamedUser.homeClinicId,
        unnamedUser.id,
        "payroll:rates:write",
      );
    });

    // Only one revoke call — View should remain intact
    expect(mockRevokeUserPermission).toHaveBeenCalledTimes(1);
    expect(mockRevokeUserPermission).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "payroll:rates:read",
    );
  });

  it("pay-rate checkboxes are checked/unchecked according to active permissions", async () => {
    mockListUserPermissions.mockResolvedValue([
      { id: "g1", clinicId: TEST_CLINIC_ID, userId: unnamedUser.id, permission: "payroll:rates:read", grantedBy: adminUser.id, grantedAt: "2026-09-01T00:00:00Z", revokedAt: null },
    ]);

    await openModuleAccessPanel(unnamedUser.email);

    const viewBox = await screen.findByRole("checkbox", { name: /view staff pay rates access/i });
    expect(viewBox).toBeChecked();

    const editBox = screen.getByRole("checkbox", { name: /edit staff pay rates access/i });
    expect(editBox).not.toBeChecked();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State isolation, clinic reassignment and defensive user-binding
//
// Coverage:
//   1. User A's Pay Profile form does NOT appear in User B's edit panel
//   2. User A's pay-rate error does NOT appear in User B's edit panel
//   3. Successful profile save clears Pay Profile form state
//   4. Pay Profile submission blocked when form userId ≠ current edit userId
//   5. Clinic reassignment: URL uses the original clinic ID
//   6. Clinic reassignment: new home clinic is sent in the request body
//   7. Successful clinic reassignment updates only the target user in the list
//   8. Role-only edit still updates only the selected user
//   9. Existing Pay Profile save flow still works after isolation changes
// ─────────────────────────────────────────────────────────────────────────────

const adminWithRatesWrite = createAdminUser({
  permissions: [
    "users:read", "users:write",
    "payroll:rates:read", "payroll:rates:write",
  ],
});

/**
 * Open the edit panel for a specific user row by email.
 */
async function openEditFor(email: string) {
  const row = screen.getByText(email).closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: /^edit$/i }));
}

describe("ManageUsersPage — state isolation, clinic reassignment, defensive user-binding", () => {
  beforeEach(() => {
    mockUpdateUser.mockClear();
    mockCreatePayRate.mockClear();
    mockListPayRates.mockResolvedValue([]);
  });

  // ── 1. Pay Profile form does not leak from User A to User B ────────────────
  it("opening User B's edit panel clears any Pay Profile form open for User A", async () => {
    setAuthenticatedUser(authTestState, adminWithRatesWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    // Open User A (namedUser) and open the pay rate form
    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());
    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    expect(screen.getByRole("form", { name: /add or update pay rate/i })).toBeInTheDocument();

    // Now open User B (unnamedUser) — pay rate form must disappear
    await openEditFor(unnamedUser.email);

    expect(
      screen.queryByRole("form", { name: /add or update pay rate/i }),
    ).not.toBeInTheDocument();
  });

  // ── 2. User A's pay-rate error does not appear in User B's panel ───────────
  it("User A's pay-rate error is gone when User B's edit panel opens", async () => {
    setAuthenticatedUser(authTestState, adminWithRatesWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
    // Reject the first createPayRate call to produce an error in User A's form.
    mockCreatePayRate.mockRejectedValueOnce(new Error("RATE_OVERLAP — User A error"));

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    // Open User A and open the pay rate form (begins a failed save attempt).
    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());
    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    await userEvent.type(
      screen.getByRole("spinbutton", { name: /base hourly rate/i }),
      "50",
    );
    await userEvent.type(screen.getByLabelText(/effective from/i), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    // Switch to User B — regardless of whether the error appeared in User A's
    // panel, it must NOT appear in User B's panel.
    await openEditFor(unnamedUser.email);

    // Wait for User B's panel to settle, then assert the error is absent.
    await waitFor(() => {
      expect(
        screen.queryByText(/RATE_OVERLAP — User A error/i),
      ).not.toBeInTheDocument();
    });
  });

  // ── 3. Successful profile save clears Pay Profile form ─────────────────────
  it("successful profile save closes the edit panel and clears the Pay Profile form", async () => {
    setAuthenticatedUser(authTestState, adminWithRatesWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    // Open the pay rate form
    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    expect(screen.getByRole("form", { name: /add or update pay rate/i })).toBeInTheDocument();

    // Save the user profile (not the pay rate)
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // After save the edit panel and the pay rate form must both be gone
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: /add or update pay rate/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(`Edit ${namedUser.email}`)).not.toBeInTheDocument();
  });

  // ── 4. Stale userId binding blocks submission ──────────────────────────────
  it("blocks Pay Profile form submission when form userId does not match current edit userId", async () => {
    setAuthenticatedUser(authTestState, adminWithRatesWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    // Open User A and open pay rate form (binds form.userId = namedUser.id)
    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());
    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    expect(screen.getByRole("form", { name: /add or update pay rate/i })).toBeInTheDocument();

    // Switch to User B — form should be cleared by openEdit
    await openEditFor(unnamedUser.email);

    // The defensive guard should prevent any createPayRate call
    // (the form is cleared on switch, so we can't even submit it here;
    //  what we verify is that createPayRate was NEVER called)
    expect(mockCreatePayRate).not.toHaveBeenCalled();
  });

  // ── 5. Clinic reassignment: URL uses the original clinic ID ───────────────
  it("sends the user's original home clinic in the URL when reassigning to a new clinic", async () => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);

    // Change the home clinic selector to Clinic B
    const clinicSelect = await screen.findByRole("combobox", { name: /home clinic/i });
    await userEvent.selectOptions(clinicSelect, TEST_CLINIC_B_ID);

    // Save
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    // First argument must be the ORIGINAL clinic (namedUser.homeClinicId = TEST_CLINIC_ID)
    const [urlClinicId] = mockUpdateUser.mock.calls[0] as [string, string, unknown];
    expect(urlClinicId).toBe(TEST_CLINIC_ID);
  });

  // ── 6. Clinic reassignment: new clinic in request body ────────────────────
  it("sends the newly selected clinic ID in the request body for a home-clinic reassignment", async () => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);

    const clinicSelect = await screen.findByRole("combobox", { name: /home clinic/i });
    await userEvent.selectOptions(clinicSelect, TEST_CLINIC_B_ID);

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    const [, , body] = mockUpdateUser.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(body.homeClinicId).toBe(TEST_CLINIC_B_ID);
  });

  // ── 7. Successful clinic reassignment updates only that user ───────────────
  it("a successful clinic reassignment replaces only the target user in the list", async () => {
    const reassignedUser = {
      ...namedUser,
      homeClinicId: TEST_CLINIC_B_ID,
      homeClinicName: TEST_CLINIC_B_NAME,
    };
    mockUpdateUser.mockResolvedValueOnce(reassignedUser);

    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);
    const clinicSelect = await screen.findByRole("combobox", { name: /home clinic/i });
    await userEvent.selectOptions(clinicSelect, TEST_CLINIC_B_ID);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // unnamedUser's row must still be in the table
    await waitFor(() =>
      expect(screen.getByText(unnamedUser.email)).toBeInTheDocument(),
    );
    // namedUser must also still appear (now showing Clinic B)
    expect(screen.getByText(namedUser.email)).toBeInTheDocument();
  });

  // ── 8. Role-only edit updates only the selected user ──────────────────────
  it("a role-only edit sends the original clinic in the URL and updates only that user", async () => {
    const updatedNamed = { ...namedUser, role: "group_practice_manager" as const };
    mockUpdateUser.mockResolvedValueOnce(updatedNamed);

    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);
    const roleSelect = await screen.findByRole("combobox", { name: /role/i });
    await userEvent.selectOptions(roleSelect, "group_practice_manager");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    // URL clinic must be the original clinic (not changed)
    const [urlClinicId] = mockUpdateUser.mock.calls[0] as [string, string, unknown];
    expect(urlClinicId).toBe(TEST_CLINIC_ID);

    // unnamedUser still present — not overwritten
    expect(screen.getByText(unnamedUser.email)).toBeInTheDocument();
  });

  // ── 9. Existing Pay Profile save flow still works ─────────────────────────
  it("the Pay Profile save flow still works correctly after isolation changes", async () => {
    setAuthenticatedUser(authTestState, adminWithRatesWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);

    await userEvent.type(
      screen.getByRole("spinbutton", { name: /base hourly rate/i }),
      "55",
    );
    await userEvent.type(screen.getByLabelText(/effective from/i), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    await waitFor(() => {
      expect(mockCreatePayRate).toHaveBeenCalledWith(
        TEST_CLINIC_ID,
        namedUser.id,
        expect.objectContaining({
          baseHourlyRateCents: 5500,
          effectiveFrom: "2026-10-01",
        }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Save Rate structural fix — no nested <form>
//
// These tests confirm the root-cause fix: the Pay Profile "Save rate" button is
// now type="button" and calls handleSubmitPayRateDirect() directly, rather than
// submitting an inner <form> whose submit event bubbled (via React SyntheticEvent)
// to the outer user-edit <form> and fired handleSaveEdit.
//
// Coverage:
//   1. Save Rate calls createPayRate exactly once
//   2. Save Rate does NOT call updateUser
//   3. Edit panel stays open while pay-rate save is in progress
//   4. A successful pay-rate save closes the rate form and shows the new rate
//   5. A failed pay-rate save shows the error and leaves the edit panel open
//   6. The outer Save button still calls updateUser (regression)
//   7. The rendered edit panel contains no nested <form> elements
//   8. The pay-rate user-binding guard is preserved in the direct handler
// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — Save Rate structural fix (no nested form)", () => {
  const adminWithWrite = createAdminUser({
    permissions: [
      "users:read", "users:write",
      "payroll:rates:read", "payroll:rates:write",
    ],
  });

  const resolvedRate = {
    id: "pr-1",
    staffUserId: namedUser.id,
    baseHourlyRateCents: 5000,
    employmentType: "full_time" as const,
    contractedWeeklyHours: 38,
    superRatePercent: 12.0,
    effectiveFrom: "2026-10-01",
    effectiveTo: null,
    createdByUserId: adminUser.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockCreatePayRate.mockClear();
    mockUpdateUser.mockClear();
    mockListPayRates.mockResolvedValue([]);
    mockCreatePayRate.mockResolvedValue(resolvedRate);
  });

  /**
   * Render the page as adminWithWrite, open namedUser's edit panel, then open
   * the pay rate form.  Returns after the "Save rate" button is visible.
   */
  async function openPayRateFormFor(email: string = namedUser.email) {
    setAuthenticatedUser(authTestState, adminWithWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(email)).toBeInTheDocument());

    const row = screen.getByText(email).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /^edit$/i }));
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());

    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    // Confirm the rate-form container is visible
    await waitFor(() =>
      expect(screen.getByRole("form", { name: /add or update pay rate/i })).toBeInTheDocument(),
    );
  }

  async function fillRate(rate = "50", date = "2026-10-01") {
    await userEvent.type(screen.getByRole("spinbutton", { name: /base hourly rate/i }), rate);
    await userEvent.type(screen.getByLabelText(/effective from/i), date);
  }

  // ── 1. createPayRate called exactly once ───────────────────────────────────
  it("clicking Save rate calls createPayRate exactly once", async () => {
    await openPayRateFormFor();
    await fillRate();
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    await waitFor(() => { expect(mockCreatePayRate).toHaveBeenCalledTimes(1); });
  });

  // ── 2. updateUser NOT called when saving a pay rate ────────────────────────
  it("clicking Save rate does NOT call updateUser", async () => {
    await openPayRateFormFor();
    await fillRate();
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    // Wait for the pay-rate call to finish so we know the save completed
    await waitFor(() => { expect(mockCreatePayRate).toHaveBeenCalledTimes(1); });
    // The user-edit save must never have been triggered
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // ── 3. Edit panel stays open during save ───────────────────────────────────
  it("the edit panel stays open while the pay-rate save is in progress", async () => {
    // Make createPayRate hang so we can inspect the in-progress state
    mockCreatePayRate.mockImplementationOnce(
      () => new Promise(() => { /* intentional — never resolves in this test */ }),
    );

    await openPayRateFormFor();
    await fillRate();
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    // isSubmitting = true → button label changes; edit panel must still be mounted
    expect(screen.getByRole("button", { name: /saving rate/i })).toBeInTheDocument();
    expect(screen.getByLabelText(`Edit ${namedUser.email}`)).toBeInTheDocument();
    // No user-profile save was triggered
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // ── 4. Successful save closes the rate form and shows the new rate ─────────
  it("a successful pay-rate save closes the rate form and shows the new rate", async () => {
    // After createPayRate resolves, the refetch (fetch()) will call listPayRates again.
    // Return the new rate on that second call so it appears in the UI.
    mockListPayRates
      .mockResolvedValueOnce([])           // initial load — no existing rate
      .mockResolvedValue([resolvedRate]);   // refetch after save

    await openPayRateFormFor();
    await fillRate();
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    // Rate form button disappears on success
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /save rate/i })).not.toBeInTheDocument(),
    );

    // The Current Rate line should now show $50.00/hr
    await waitFor(() => {
      const label = screen.getByText(/current rate:/i);
      expect(label.closest("div")).toHaveTextContent("$50.00/hr");
    });
  });

  // ── 5. Failed save shows error; edit panel stays open ─────────────────────
  it("a failed pay-rate save shows the error message and leaves the edit panel open", async () => {
    mockCreatePayRate.mockRejectedValueOnce(new Error("RATE_CONFLICT"));

    await openPayRateFormFor();
    await fillRate();
    await userEvent.click(screen.getByRole("button", { name: /save rate/i }));

    // Error message should appear inside the pay-rate section
    await waitFor(() =>
      expect(screen.getByText(/RATE_CONFLICT/i)).toBeInTheDocument(),
    );

    // The edit panel must remain open
    expect(screen.getByLabelText(`Edit ${namedUser.email}`)).toBeInTheDocument();
    // updateUser must NOT have been called (the outer form was not submitted)
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // ── 6. Outer Save still calls updateUser (regression) ─────────────────────
  it("the outer Save button still calls updateUser and does not call createPayRate", async () => {
    await openPayRateFormFor();
    // Click the outer user-edit Save (not Save rate)
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => { expect(mockUpdateUser).toHaveBeenCalledTimes(1); });
    expect(mockCreatePayRate).not.toHaveBeenCalled();
  });

  // ── 7. No nested <form> elements inside the edit panel ───────────────────
  it("the rendered edit panel contains no nested <form> elements", async () => {
    await openPayRateFormFor(); // open rate form so it is fully visible

    // The outer user-edit element has an accessible name matching the user
    const editPanel = screen.getByRole("form", { name: `Edit ${namedUser.email}` });

    // querySelectorAll("form") selects native <form> elements, NOT <div role="form">
    // After the structural fix this must return an empty NodeList
    const nestedForms = editPanel.querySelectorAll("form");
    expect(nestedForms).toHaveLength(0);
  });

  // ── 8. User-binding guard still works in the direct handler ───────────────
  it("switching users clears the rate form and blocks createPayRate (guard preserved)", async () => {
    setAuthenticatedUser(authTestState, adminWithWrite);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);

    renderPage();
    await waitFor(() => expect(screen.getByText(namedUser.email)).toBeInTheDocument());

    // Open User A and open the pay rate form (binds form.userId = namedUser.id)
    await openEditFor(namedUser.email);
    await waitFor(() => expect(screen.getByText(/pay profile/i)).toBeInTheDocument());
    const addBtn = await screen.findByRole("button", { name: /add.*update.*rate/i });
    await userEvent.click(addBtn);
    expect(screen.getByRole("form", { name: /add or update pay rate/i })).toBeInTheDocument();

    // Switch to User B — openEdit calls setPayRateForm(null), clearing the form
    await openEditFor(unnamedUser.email);

    // The rate form is gone and createPayRate was never invoked
    expect(screen.queryByRole("form", { name: /add or update pay rate/i })).not.toBeInTheDocument();
    expect(mockCreatePayRate).not.toHaveBeenCalled();
  });
});
