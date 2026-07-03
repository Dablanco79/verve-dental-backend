/**
 * Sprint 4C — Cookie-Only tests
 *
 * Verifies that:
 *   - login stores only the access token (refresh token never in response body)
 *   - MFA verify stores only the access token
 *   - session restore uses cookie-based refresh (no refreshToken in body)
 *   - logout does not send a refreshToken and clears only the access token
 */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useContext } from "react";

import { AuthProvider } from "../src/auth/AuthProvider.js";
import { AuthContext } from "../src/auth/AuthContext.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import type { AuthSession, AuthUser } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any `import` that references them
// ---------------------------------------------------------------------------

const {
  mockGetAccessToken,
  mockSetAccessToken,
  mockClearAccessToken,
  mockLogin,
  mockVerifyMfa,
  mockRefresh,
  mockLogout,
  mockGetMe,
} = vi.hoisted(() => {
  return {
    mockGetAccessToken: vi.fn(() => null as string | null),
    mockSetAccessToken: vi.fn(),
    mockClearAccessToken: vi.fn(),
    mockLogin: vi.fn(),
    mockVerifyMfa: vi.fn(),
    mockRefresh: vi.fn(),
    mockLogout: vi.fn(),
    mockGetMe: vi.fn(),
  };
});

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: mockGetAccessToken,
  setAccessToken: mockSetAccessToken,
  clearAccessToken: mockClearAccessToken,
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getHealth: vi.fn(),
    login: mockLogin,
    verifyMfa: mockVerifyMfa,
    refresh: mockRefresh,
    logout: mockLogout,
    getMe: mockGetMe,
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: "11111111-1111-4111-8111-111111111111",
  homeClinicName: "Verve Dental Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

const SESSION: AuthSession = {
  accessToken: "access-token-abc",
  expiresIn: 900,
  user: ADMIN_USER,
};

const MFA_TOKEN = "mfa-interim-token";

// ---------------------------------------------------------------------------
// Helper component — exposes AuthContext values for assertion
// ---------------------------------------------------------------------------

let capturedContext: AuthContextValue | null = null;

function ContextCapture() {
  capturedContext = useContext(AuthContext);
  return null;
}

function renderWithAuth() {
  return render(
    <AuthProvider>
      <ContextCapture />
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sprint 4B — Cookie Migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedContext = null;
    mockGetAccessToken.mockReturnValue(null);
    // Default: no valid refresh cookie → refresh rejects
    mockRefresh.mockRejectedValue(new Error("No refresh cookie"));
  });

  // Helper that narrows capturedContext without a non-null assertion
  const ctx = () => capturedContext as AuthContextValue;

  describe("login flow", () => {
    it("stores only the access token — refresh token is never persisted", async () => {
      mockLogin.mockResolvedValue({
        requiresMfa: false,
        ...SESSION,
      });

      renderWithAuth();

      await waitFor(() => { expect(capturedContext).not.toBeNull(); });
      // Wait for restoreSession to finish
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      await act(async () => {
        await ctx().login(ADMIN_USER.email, "password123");
      });

      // Access token must be stored
      expect(mockSetAccessToken).toHaveBeenCalledWith(SESSION.accessToken);
      // Only one call to setAccessToken
      expect(mockSetAccessToken).toHaveBeenCalledTimes(1);
      // User must be set in context
      expect(ctx().user).toEqual(ADMIN_USER);
    });

    it("returns requiresMfa:true without storing tokens when MFA is required", async () => {
      mockLogin.mockResolvedValue({
        requiresMfa: true,
        mfaToken: MFA_TOKEN,
        user: ADMIN_USER,
      });

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      let result:
        | { requiresMfa: true; mfaToken: string }
        | { requiresMfaEnrollment: true }
        | { requiresMfa: false }
        | undefined;
      await act(async () => {
        result = await ctx().login(ADMIN_USER.email, "password123");
      });

      expect(result).toEqual({ requiresMfa: true, mfaToken: MFA_TOKEN });
      // No tokens stored yet — MFA step pending
      expect(mockSetAccessToken).not.toHaveBeenCalled();
    });
  });

  describe("MFA verify flow", () => {
    it("stores only the access token after MFA verification — refresh token not persisted", async () => {
      mockVerifyMfa.mockResolvedValue(SESSION);

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      await act(async () => {
        await ctx().verifyMfa(MFA_TOKEN, "000000");
      });

      expect(mockVerifyMfa).toHaveBeenCalledWith(MFA_TOKEN, "000000");
      expect(mockSetAccessToken).toHaveBeenCalledWith(SESSION.accessToken);
      expect(mockSetAccessToken).toHaveBeenCalledTimes(1);
      expect(ctx().user).toEqual(ADMIN_USER);
    });
  });

  describe("session restore — cookie-based refresh", () => {
    it("restores session via HttpOnly cookie when no access token is stored", async () => {
      mockGetAccessToken.mockReturnValue(null);
      mockRefresh.mockResolvedValue(SESSION);

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      // refresh() must have been called — and with NO arguments (relies on cookie)
      expect(mockRefresh).toHaveBeenCalledWith();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      // Body should not contain refreshToken — verified by call args (no args passed)
      expect(mockRefresh).toHaveBeenCalledWith(/* nothing */);
      // Access token from response must be persisted
      expect(mockSetAccessToken).toHaveBeenCalledWith(SESSION.accessToken);
      // User must be set
      expect(ctx().user).toEqual(ADMIN_USER);
    });

    it("leaves user as null when no access token and no valid cookie", async () => {
      mockGetAccessToken.mockReturnValue(null);
      mockRefresh.mockRejectedValue(new Error("401 Unauthorized"));

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockSetAccessToken).not.toHaveBeenCalled();
      expect(ctx().user).toBeNull();
    });

    it("silently refreshes when the stored access token is expired but the refresh cookie is valid", async () => {
      mockGetAccessToken.mockReturnValue("expired-access-token");
      mockGetMe.mockRejectedValue(new Error("Invalid or expired access token"));
      mockRefresh.mockResolvedValue(SESSION);

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      expect(mockGetMe).toHaveBeenCalledWith("expired-access-token");
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockSetAccessToken).toHaveBeenCalledWith(SESSION.accessToken);
      expect(mockClearAccessToken).toHaveBeenCalledTimes(1);
      expect(ctx().user).toEqual(ADMIN_USER);
    });
  });

  describe("logout flow", () => {
    it("clears only the access token and calls logout with no refreshToken argument", async () => {
      mockGetAccessToken.mockReturnValue(SESSION.accessToken);
      mockGetMe.mockResolvedValue(ADMIN_USER);
      mockLogout.mockResolvedValue(undefined);

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });
      await waitFor(() => { expect(ctx().user).toEqual(ADMIN_USER); });

      await act(async () => {
        await ctx().logout();
      });

      // logout() called with no arguments — relies on HttpOnly cookie
      expect(mockLogout).toHaveBeenCalledWith(/* nothing */);
      expect(mockLogout).toHaveBeenCalledTimes(1);
      // Access token cleared
      expect(mockClearAccessToken).toHaveBeenCalledTimes(1);
      // User unset
      expect(ctx().user).toBeNull();
    });

    it("clears access token even when logout API call fails", async () => {
      mockGetAccessToken.mockReturnValue(SESSION.accessToken);
      mockGetMe.mockResolvedValue(ADMIN_USER);
      mockLogout.mockRejectedValue(new Error("Network error"));

      renderWithAuth();
      await waitFor(() => { expect(ctx().isLoading).toBe(false); });

      // logout() re-throws the API error but the finally block still runs
      await act(async () => {
        try {
          await ctx().logout();
        } catch {
          // expected — API call failed; finally block must still clean up
        }
      });

      expect(mockClearAccessToken).toHaveBeenCalledTimes(1);
      expect(ctx().user).toBeNull();
    });
  });
});
