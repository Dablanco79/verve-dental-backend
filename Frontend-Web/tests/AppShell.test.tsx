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

    // GPM fetches operational clinics; when only one is returned the selector is not shown.
    await waitFor(() => {
      expect(mockGetMyOperationalClinics).toHaveBeenCalled();
    });

    expect(screen.queryByRole("combobox", { name: "Clinic scope" })).not.toBeInTheDocument();
    expect(screen.getAllByText(TEST_CLINIC_NAME).length).toBeGreaterThan(0);
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
  });
});
