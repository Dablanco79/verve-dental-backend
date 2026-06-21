/**
 * LoginPage.test.tsx
 *
 * Coverage:
 *   Credentials step
 *     - Renders sign-in form
 *   requiresMfaEnrollment path (the production bug being fixed)
 *     - Shows enrollment panel — not "Authentication required" — when login
 *       returns { requiresMfaEnrollment: true, enrollmentToken }
 *     - Calls setupMfa() with the enrollmentToken returned by login(), not the
 *       stale React state value (regression guard for the timing bug)
 *     - Does NOT surface "Authentication required" (regression guard)
 *     - Shows enrollment-success screen after confirmMfaEnrollment resolves
 *     - Shows inline error when setupMfa throws during enrollment loading
 *   requiresMfa path
 *     - Shows MFA verify form when login returns { requiresMfa: true }
 *   Login failure
 *     - Shows error message when login throws
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthContext } from "../src/auth/AuthContext.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import { LoginPage } from "../src/pages/LoginPage.js";
import type { AuthUser, MfaSetupData } from "../src/types/index.js";

// ── Mock qrcode (no canvas in jsdom) ─────────────────────────────────────────

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
  },
  toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_ADMIN_USER: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: "11111111-1111-4111-8111-111111111111",
  homeClinicName: "Verve Dental Clinic A",
};

const MOCK_SETUP_DATA: MfaSetupData = {
  secret: "JBSWY3DPEHPK3PXP",
  uri: "otpauth://totp/Verve%20Dental:admin%40clinic-a.au?secret=JBSWY3DPEHPK3PXP&issuer=Verve%20Dental",
};

const ENROLLMENT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.enrollment";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuthContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    isLoading: false,
    enrollmentToken: null,
    login: vi.fn().mockResolvedValue({ requiresMfa: false }),
    verifyMfa: vi.fn().mockResolvedValue(undefined),
    setupMfa: vi.fn().mockResolvedValue(MOCK_SETUP_DATA),
    confirmMfaEnrollment: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderLoginPage(ctx: AuthContextValue = makeAuthContext()) {
  return render(
    <AuthContext.Provider value={ctx}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function submitCredentials(
  email = "admin@clinic-a.au",
  password = "password123",
) {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials step
// ─────────────────────────────────────────────────────────────────────────────

describe("LoginPage — credentials step", () => {
  it("renders the sign-in form", () => {
    renderLoginPage();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requiresMfaEnrollment path — the production bug being fixed
// ─────────────────────────────────────────────────────────────────────────────

describe("LoginPage — requiresMfaEnrollment path", () => {
  function makeEnrollmentCtx(
    setupMfaImpl: AuthContextValue["setupMfa"] = vi.fn().mockResolvedValue(MOCK_SETUP_DATA),
  ): AuthContextValue {
    return makeAuthContext({
      login: vi.fn().mockResolvedValue({
        requiresMfaEnrollment: true as const,
        enrollmentToken: ENROLLMENT_TOKEN,
        user: MOCK_ADMIN_USER,
      }),
      setupMfa: setupMfaImpl,
    });
  }

  it("shows the MFA enrollment panel — not the credentials form", async () => {
    renderLoginPage(makeEnrollmentCtx());

    submitCredentials();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /enable mfa/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("calls setupMfa() with the enrollmentToken from the login response", async () => {
    const ctx = makeEnrollmentCtx();
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(ctx.setupMfa).toHaveBeenCalledWith(ENROLLMENT_TOKEN);
    });
  });

  it("does NOT show the 'Authentication required' error (regression guard)", async () => {
    // Before the fix, setupMfa() received undefined instead of the enrollment
    // token because React state hadn't flushed, falling through to
    // requireAccessToken() which threw "Authentication required".
    renderLoginPage(makeEnrollmentCtx());

    submitCredentials();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /enable mfa/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(/authentication required/i)).not.toBeInTheDocument();
  });

  it("calls confirmMfaEnrollment with the entered code and shows success", async () => {
    const ctx = makeEnrollmentCtx();
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/6-digit code/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/6-digit code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));

    await waitFor(() => {
      expect(ctx.confirmMfaEnrollment).toHaveBeenCalledWith("123456");
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /mfa enabled/i })).toBeInTheDocument();
    });
  });

  it("shows an error and resets to credentials when setupMfa throws", async () => {
    const ctx = makeEnrollmentCtx(
      vi.fn().mockRejectedValue(new Error("MFA setup failed")),
    );
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(screen.getByText(/mfa setup failed/i)).toBeInTheDocument();
    });

    // Step machine resets to credentials
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requiresMfa path
// ─────────────────────────────────────────────────────────────────────────────

describe("LoginPage — requiresMfa path", () => {
  it("shows the MFA verify form when login returns requiresMfa: true", async () => {
    const ctx = makeAuthContext({
      login: vi.fn().mockResolvedValue({
        requiresMfa: true as const,
        mfaToken: "mfa-challenge-token",
        user: MOCK_ADMIN_USER,
      }),
    });
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /verify mfa/i })).toBeInTheDocument();
    });
  });

  it("calls verifyMfa with the mfaToken and code", async () => {
    const mfaToken = "mfa-challenge-token";
    const ctx = makeAuthContext({
      login: vi.fn().mockResolvedValue({
        requiresMfa: true as const,
        mfaToken,
        user: MOCK_ADMIN_USER,
      }),
    });
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/mfa code/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/mfa code/i), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() => {
      expect(ctx.verifyMfa).toHaveBeenCalledWith(mfaToken, "654321");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login failure
// ─────────────────────────────────────────────────────────────────────────────

describe("LoginPage — login failure", () => {
  it("shows an error message when login throws", async () => {
    const ctx = makeAuthContext({
      login: vi.fn().mockRejectedValue(new Error("Invalid email or password")),
    });
    renderLoginPage(ctx);

    submitCredentials();

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });

    // Should remain on the credentials step
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});
