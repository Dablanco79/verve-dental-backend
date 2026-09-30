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
  mockListPayRates,
  mockCreatePayRate,
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
