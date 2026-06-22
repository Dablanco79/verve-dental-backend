/**
 * ManageUsersPage.test.tsx
 *
 * Coverage:
 *   - Shows "Loading accounts…" while the request is in flight
 *   - Renders the user table when listUsers() resolves successfully
 *   - Displays an error message when listUsers() rejects (including timeout)
 *   - Displays a timeout error message when the request is aborted
 *   - Redirects non-manager roles to home ("/")
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageUsersPage } from "../src/pages/ManageUsersPage.js";
import type { StaffUser } from "../src/types/index.js";
import { createStaffUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";
import {
  setAuthenticatedUser,
  clearAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

// ── Shared mocks (hoisted so vi.mock factories can reference them) ─────────────

const { authTestState, mockListUsers } = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return { authTestState, mockListUsers: vi.fn() };
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
    resetUserPassword: vi.fn(),
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const adminUser = createStaffUser({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: TEST_CLINIC_ID,
  homeClinicName: TEST_CLINIC_NAME,
});

const sampleUsers: StaffUser[] = [
  {
    id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu1",
    email: "alice@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
  },
  {
    id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuu2",
    email: "bob@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: TEST_CLINIC_ID,
    homeClinicName: TEST_CLINIC_NAME,
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
    // Never resolves — simulates a hanging request
    mockListUsers.mockImplementation(() => new Promise(() => { /* intentional hang */ }));
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
  });

  it("renders the staff accounts table with user rows", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("alice@clinic-a.au")).toBeInTheDocument();
    });

    expect(screen.getByText("bob@clinic-a.au")).toBeInTheDocument();
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
  });

  it("displays the error message when listUsers() rejects", async () => {
    mockListUsers.mockRejectedValue(new Error("Internal server error"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
    });

    // Loading message must be gone once the error is shown
    expect(screen.queryByText(/loading accounts/i)).not.toBeInTheDocument();
  });

  it("displays the timeout error message when the request is aborted", async () => {
    mockListUsers.mockRejectedValue(new Error("Request timed out. Please try again."));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
    });
  });

  it("shows a fallback message when the rejection has no message", async () => {
    mockListUsers.mockRejectedValue("non-error rejection");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/unable to load users/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ManageUsersPage — access control", () => {
  it("redirects clinical_staff to home", () => {
    setAuthenticatedUser(authTestState, createStaffUser({ role: "clinical_staff" }));
    mockListUsers.mockResolvedValue([]);

    renderPage();

    // Navigate redirect renders nothing from ManageUsersPage — the heading
    // should not be present after redirect.
    expect(screen.queryByRole("heading", { name: /manage staff accounts/i })).not.toBeInTheDocument();
  });

  it("renders null when no user is authenticated", () => {
    clearAuthenticatedUser(authTestState);
    mockListUsers.mockResolvedValue([]);

    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});
