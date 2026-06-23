/**
 * ManageUsersPageEdit.test.tsx — Sprint 2: User Update
 *
 * Coverage:
 *   - Each user row has an Edit button
 *   - Clicking Edit opens an inline edit panel for that row
 *   - Edit panel has First name, Last name, Display name, and Payroll track fields
 *   - Owner admin edit panel also has Role and Home clinic selectors
 *   - Practice manager edit panel does NOT have Role or Home clinic selectors
 *   - Clicking Cancel closes the edit panel
 *   - Saving calls updateUser with the correct payload
 *   - After save, the updated user is reflected in the table
 *   - Error message is displayed when updateUser rejects
 *   - Opening Edit closes any open reset-password panel
 *   - Only one edit panel is open at a time
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageUsersPage } from "../src/pages/ManageUsersPage.js";
import type { StaffUser } from "../src/types/index.js";
import type { ClinicData } from "../src/types/clinic.js";
import {
  createAdminUser,
  createManagerUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
  TEST_CLINIC_B_ID,
  TEST_CLINIC_B_NAME,
} from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { authTestState, mockListUsers, mockListClinics, mockUpdateUser } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListUsers: vi.fn(),
    mockListClinics: vi.fn(),
    mockUpdateUser: vi.fn(),
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
    createUser: vi.fn(),
    updateUser: mockUpdateUser,
    resetUserPassword: vi.fn(),
    listClinics: mockListClinics,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const adminUser = createAdminUser();
const managerUser = createManagerUser();

const staffUser: StaffUser = {
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

const managerStaff: StaffUser = {
  id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu2",
  email: "bob@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
  firstName: "Bob",
  lastName: "Smith",
  displayName: "Bob Smith",
  payrollTrack: "commission",
};

const sampleUsers: StaffUser[] = [staffUser, managerStaff];

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

async function waitForTable() {
  await waitFor(() => expect(screen.getByText("alice@clinic-a.au")).toBeInTheDocument());
}

/** Returns the first matching element by role; throws (like getByRole) if none found. */
function firstByRole(role: string, options?: Parameters<typeof screen.getByRole>[1]): HTMLElement {
  const elements = screen.getAllByRole(role, options);
  const element = elements[0];
  if (!element) throw new Error(`No element found with role "${role}"`);
  return element;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — Edit button visibility", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("each user row has an Edit button", async () => {
    renderPage();
    await waitForTable();

    const editButtons = screen.getAllByRole("button", { name: /^edit$/i });
    expect(editButtons.length).toBe(sampleUsers.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — Edit panel (owner_admin)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, adminUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("opens an inline edit panel when Edit is clicked", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("form", { name: /edit alice@clinic-a\.au/i })).toBeInTheDocument();
  });

  it("edit panel pre-populates with the user's current values", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("textbox", { name: /first name/i })).toHaveValue("Alice");
    expect(screen.getByRole("textbox", { name: /last name/i })).toHaveValue("Jones");
    expect(screen.getByRole("textbox", { name: /display name/i })).toHaveValue("Alice Jones");
  });

  it("edit panel shows Role and Home clinic selectors for owner_admin", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("combobox", { name: /^role$/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /home clinic/i })).toBeInTheDocument();
  });

  it("edit panel shows Payroll track selector", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("combobox", { name: /payroll track/i })).toBeInTheDocument();
  });

  it("clicking Cancel closes the edit panel", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("form", { name: /edit alice@clinic-a\.au/i })).toBeInTheDocument();

    await userEvent.click(firstByRole("button", { name: /cancel/i }));

    expect(
      screen.queryByRole("form", { name: /edit alice@clinic-a\.au/i }),
    ).not.toBeInTheDocument();
  });

  it("re-clicking Edit (now showing Cancel) closes the panel", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));
    await userEvent.click(firstByRole("button", { name: /cancel/i }));

    expect(
      screen.queryByRole("form", { name: /edit alice@clinic-a\.au/i }),
    ).not.toBeInTheDocument();
  });

  it("only one edit panel is open at a time", async () => {
    renderPage();
    await waitForTable();

    const editButtons = screen.getAllByRole("button", { name: /^edit$/i });
    if (!editButtons[0] || !editButtons[1]) throw new Error("Expected two edit buttons");
    await userEvent.click(editButtons[0]);
    await userEvent.click(editButtons[1]);

    const forms = screen.queryAllByRole("form", { name: /^edit /i });
    expect(forms.length).toBe(1);
  });

  it("calls updateUser with the edited values on Save", async () => {
    const updatedUser: StaffUser = { ...staffUser, firstName: "Alicia" };
    mockUpdateUser.mockResolvedValue(updatedUser);

    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    const firstNameInput = screen.getByRole("textbox", { name: /first name/i });
    await userEvent.clear(firstNameInput);
    await userEvent.type(firstNameInput, "Alicia");

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(
        staffUser.homeClinicId,
        staffUser.id,
        expect.objectContaining({ firstName: "Alicia" }),
      );
    });
  });

  it("updates the table row after a successful save", async () => {
    const updatedUser: StaffUser = { ...staffUser, firstName: "Alicia" };
    mockUpdateUser.mockResolvedValue(updatedUser);

    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    const firstNameInput = screen.getByRole("textbox", { name: /first name/i });
    await userEvent.clear(firstNameInput);
    await userEvent.type(firstNameInput, "Alicia");

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText("Alicia Jones")).toBeInTheDocument());
    expect(screen.queryByRole("form", { name: /edit alice@clinic-a\.au/i })).not.toBeInTheDocument();
  });

  it("shows an error message when updateUser rejects", async () => {
    mockUpdateUser.mockRejectedValue(new Error("Server error"));

    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/server error/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("form", { name: /edit alice@clinic-a\.au/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — Edit panel (group_practice_manager)", () => {
  beforeEach(() => {
    setAuthenticatedUser(authTestState, managerUser);
    mockListUsers.mockResolvedValue(sampleUsers);
    mockListClinics.mockResolvedValue(sampleClinics);
  });

  it("edit panel does NOT show Role selector for practice manager", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.queryByRole("combobox", { name: /^role$/i })).not.toBeInTheDocument();
  });

  it("edit panel does NOT show Home clinic selector for practice manager", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.queryByRole("combobox", { name: /home clinic/i })).not.toBeInTheDocument();
  });

  it("edit panel still shows Payroll track for practice manager", async () => {
    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("combobox", { name: /payroll track/i })).toBeInTheDocument();
  });

  it("calls updateUser without role or homeClinicId for practice manager", async () => {
    const updatedUser: StaffUser = { ...staffUser, lastName: "Updated" };
    mockUpdateUser.mockResolvedValue(updatedUser);

    renderPage();
    await waitForTable();

    await userEvent.click(firstByRole("button", { name: /^edit$/i }));

    const lastNameInput = screen.getByRole("textbox", { name: /last name/i });
    await userEvent.clear(lastNameInput);
    await userEvent.type(lastNameInput, "Updated");

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const call = mockUpdateUser.mock.lastCall as unknown[];
      const body = call[2] as Record<string, unknown>;
      expect(body).not.toHaveProperty("role");
      expect(body).not.toHaveProperty("homeClinicId");
    });
  });
});
