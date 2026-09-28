import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicProvider } from "../src/clinic/ClinicProvider.js";
import { AppShell } from "../src/components/layout/AppShell.js";
import type { ClinicData } from "../src/types/clinic.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_B_ID,
  TEST_CLINIC_B_NAME,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import { setAuthenticatedUser, type AuthTestState } from "./helpers/mockUseAuth.js";

const { authTestState, mockListClinics, mockGetMyOperationalClinics, mockLogout } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListClinics: vi.fn(),
    // GPM path: returns just the home clinic (single operational clinic → no selector shown)
    mockGetMyOperationalClinics: vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Verve Dental Clinic A",
        timezone: "Australia/Sydney",
        subscriptionTier: "standard",
        isActive: true,
      },
    ]),
    mockLogout: vi.fn(),
  };
});

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: authTestState.user,
    isLoading: authTestState.isLoading,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: mockLogout,
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listClinics: mockListClinics,
    getMyOperationalClinics: mockGetMyOperationalClinics,
  }),
}));

function clinic(overrides: Partial<ClinicData>): ClinicData {
  return {
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderShell(): void {
  render(
    <ClinicProvider>
      <MemoryRouter>
        <AppShell>
          <div>Shell content</div>
        </AppShell>
      </MemoryRouter>
    </ClinicProvider>,
  );
}

describe("AppShell navigation and clinic scope", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockListClinics.mockReset();
    mockLogout.mockReset();
  });

  it("shows an owner_admin clinic selector and persists the selected clinic", async () => {
    const owner = createAdminUser();
    setAuthenticatedUser(authTestState, owner);
    mockListClinics.mockResolvedValue([
      clinic({ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME }),
      clinic({ id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME }),
    ]);

    renderShell();

    const selector = await screen.findByRole("combobox", { name: "Clinic scope" });
    expect(selector).toHaveValue("all_clinics");
    // Both the header selector and the drawer selector render the same options in JSDOM
    // (CSS display:none is not applied); use getAllByRole to handle both.
    expect(screen.getAllByRole("option", { name: "All Clinics" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Daily Hub" })).toBeInTheDocument();
    expect(screen.getByText("Procurement")).toBeInTheDocument();

    await userEvent.selectOptions(selector, TEST_CLINIC_B_ID);

    expect(selector).toHaveValue(TEST_CLINIC_B_ID);
    expect(window.localStorage.getItem(`verve:selectedClinicId:${owner.id}`)).toBe(
      TEST_CLINIC_B_ID,
    );
    expect(window.localStorage.getItem(`verve:dashboardScope:${owner.id}`)).toBe(
      `clinic:${TEST_CLINIC_B_ID}`,
    );
  });

  it("restores a persisted owner_admin clinic selection when it is still available", async () => {
    const owner = createAdminUser();
    window.localStorage.setItem(`verve:selectedClinicId:${owner.id}`, TEST_CLINIC_B_ID);
    window.localStorage.setItem(`verve:dashboardScope:${owner.id}`, `clinic:${TEST_CLINIC_B_ID}`);
    setAuthenticatedUser(authTestState, owner);
    mockListClinics.mockResolvedValue([
      clinic({ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME }),
      clinic({ id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME }),
    ]);

    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Clinic scope" })).toHaveValue(
        TEST_CLINIC_B_ID,
      );
    });
  });

  it("allows owner_admin to return to the all-clinics dashboard scope", async () => {
    const owner = createAdminUser();
    window.localStorage.setItem(`verve:dashboardScope:${owner.id}`, `clinic:${TEST_CLINIC_B_ID}`);
    setAuthenticatedUser(authTestState, owner);
    mockListClinics.mockResolvedValue([
      clinic({ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME }),
      clinic({ id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME }),
    ]);

    renderShell();

    const selector = await screen.findByRole("combobox", { name: "Clinic scope" });
    await userEvent.selectOptions(selector, "all_clinics");

    expect(selector).toHaveValue("all_clinics");
    expect(window.localStorage.getItem(`verve:dashboardScope:${owner.id}`)).toBe("all_clinics");
  });

  it("shows a fixed home clinic for group_practice_manager with one operational clinic (no cross-clinic switching)", async () => {
    setAuthenticatedUser(authTestState, createManagerUser());

    renderShell();

    // Use findAllByText — the clinic label only appears after getMyOperationalClinics
    // resolves AND React commits the selectedClinic state update.  A plain
    // waitFor(() => expect(called)) only guarantees the API was invoked; it does
    // NOT guarantee the async Promise resolution and React re-render have
    // completed.  findAllByText properly waits for the DOM to contain the text.
    const clinicLabels = await screen.findAllByText(TEST_CLINIC_NAME);
    expect(clinicLabels.length).toBeGreaterThan(0);

    // No clinic-scope combobox — single operational clinic means no switching.
    expect(screen.queryByRole("combobox", { name: "Clinic scope" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Daily Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Purchase Orders" })).toBeInTheDocument();
    // Suppliers nav label includes invoice discoverability
    expect(screen.getByRole("link", { name: "Suppliers & Invoices" })).toBeInTheDocument();
    expect(mockListClinics).not.toHaveBeenCalled();
  });

  it("keeps clinical_staff navigation simple", () => {
    setAuthenticatedUser(authTestState, createStaffUser());

    renderShell();

    expect(screen.getByRole("link", { name: "Daily Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Roster" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Shifts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timesheets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leave" })).toBeInTheDocument();
    // Suppliers & Invoices are not visible to clinical_staff
    expect(screen.queryByRole("link", { name: "Suppliers & Invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Suppliers" })).not.toBeInTheDocument();
    // Purchase Orders not visible to clinical_staff
    expect(screen.queryByRole("link", { name: "Purchase Orders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Clinic scope" })).not.toBeInTheDocument();
    // Master Products is catalogue ADMINISTRATION — must NEVER appear for clinical_staff,
    // even when module:inventory is granted.
    expect(screen.queryByRole("link", { name: "Master Products" })).not.toBeInTheDocument();
  });
});

// ─── Module-permission-based navigation tests ────────────────────────────────
//
// These tests verify that the sidebar respects both role-based guards and the
// explicit module:* grants baked into the user's token at login time.
//
// Test users are created with the `permissions` field reflecting what the JWT
// would contain after issueTokens() (DEFAULT_PERMISSIONS[role] ∪ explicit grants).
// AuthProvider.persistSession now decodes the JWT to set these correctly; the
// tests below exercise the AppShell rendering against those user states.

describe("AppShell — module-permission-based navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // owner_admin path: ClinicProvider calls listClinics()
    mockListClinics.mockReset().mockResolvedValue([
      clinic({ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME }),
    ]);
    // GPM/clinical_staff path: ClinicProvider calls getMyOperationalClinics()
    mockGetMyOperationalClinics.mockReset().mockResolvedValue([
      {
        id: TEST_CLINIC_ID,
        name: TEST_CLINIC_NAME,
        timezone: "Australia/Sydney",
        subscriptionTier: "standard",
        isActive: true,
      },
    ]);
  });

  // ── Clinical Staff + module:inventory ──────────────────────────────────────

  it("clinical_staff with module:inventory sees Inventory nav link", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({ permissions: ["inventory:read", "module:inventory"] }),
    );
    renderShell();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    // No manager-only items
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Master Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Catalogue Import" })).not.toBeInTheDocument();
  });

  it("clinical_staff WITHOUT module:inventory does not see Inventory nav link", () => {
    setAuthenticatedUser(
      authTestState,
      // Only role-default perms — no module grants
      createStaffUser({ permissions: ["inventory:read", "roster:read", "timesheets:read"] }),
    );
    renderShell();
    expect(screen.queryByRole("link", { name: "Inventory" })).not.toBeInTheDocument();
  });

  // ── Clinical Staff + module:timesheets ─────────────────────────────────────

  it("clinical_staff with module:timesheets sees Timesheets nav link", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({ permissions: ["timesheets:read", "module:timesheets"] }),
    );
    renderShell();
    expect(screen.getByRole("link", { name: "Timesheets" })).toBeInTheDocument();
  });

  it("clinical_staff WITHOUT module:timesheets does not see Timesheets nav link", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({ permissions: ["timesheets:read"] }),
    );
    renderShell();
    expect(screen.queryByRole("link", { name: "Timesheets" })).not.toBeInTheDocument();
  });

  // ── Clinical Staff + module:roster ─────────────────────────────────────────

  it("clinical_staff with module:roster sees Roster and My Shifts nav links", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({ permissions: ["roster:read", "module:roster"] }),
    );
    renderShell();
    expect(screen.getByRole("link", { name: "Roster" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Shifts" })).toBeInTheDocument();
  });

  it("clinical_staff WITHOUT module:roster does not see Roster or My Shifts", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({ permissions: ["roster:read"] }),
    );
    renderShell();
    expect(screen.queryByRole("link", { name: "Roster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My Shifts" })).not.toBeInTheDocument();
  });

  // ── Clinical Staff with multiple grants — no manager-only items ────────────

  it("clinical_staff with module:inventory + module:timesheets + module:roster does not see manager-only nav items", () => {
    setAuthenticatedUser(
      authTestState,
      createStaffUser({
        permissions: [
          "inventory:read", "roster:read", "timesheets:read",
          "module:inventory", "module:timesheets", "module:roster",
        ],
      }),
    );
    renderShell();
    // Granted operational modules are visible
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timesheets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Roster" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Shifts" })).toBeInTheDocument();
    // Manager-only catalogue/admin items must NOT appear
    expect(screen.queryByRole("link", { name: "Master Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Catalogue Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Master Product Library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Suppliers & Invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Purchase Orders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  // ── Master Products — admin/manager gate ───────────────────────────────────

  it("Master Products link is visible to owner_admin", () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderShell();
    expect(screen.getByRole("link", { name: "Master Products" })).toBeInTheDocument();
  });

  it("Master Products link is visible to group_practice_manager", () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    renderShell();
    expect(screen.getByRole("link", { name: "Master Products" })).toBeInTheDocument();
  });

  it("Master Products link is hidden from clinical_staff even with module:inventory", () => {
    setAuthenticatedUser(
      authTestState,
      // Full module:inventory grant — Master Products must still be hidden
      createStaffUser({ permissions: ["inventory:read", "module:inventory"] }),
    );
    renderShell();
    expect(screen.queryByRole("link", { name: "Master Products" })).not.toBeInTheDocument();
    // Operational Inventory IS visible
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
  });

  // ── Owner/Admin full navigation ────────────────────────────────────────────

  it("owner_admin sees full navigation including admin-only sections", () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderShell();
    expect(screen.getByRole("link", { name: "Daily Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Master Products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Purchase Orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timesheets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Roster" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Shifts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
  });

  // ── GPM navigation ─────────────────────────────────────────────────────────

  it("group_practice_manager sees operational and admin nav items from their grants", () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    renderShell();
    expect(screen.getByRole("link", { name: "Daily Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Purchase Orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Suppliers & Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Master Products" })).toBeInTheDocument();
    // No clinic-scope selector for single-operational-clinic GPM
    expect(screen.queryByRole("combobox", { name: "Clinic scope" })).not.toBeInTheDocument();
  });
});
