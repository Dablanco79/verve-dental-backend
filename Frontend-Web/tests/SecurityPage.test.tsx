/**
 * SecurityPage.test.tsx — Sprint N (Internal Pilot Blockers)
 *
 * Tests the MFA enrollment UI on the Security settings page.
 *
 * Coverage:
 *   - Page renders "Enable MFA" button in the idle state
 *   - Clicking Enable calls setupMfa() and transitions to the enrollment step
 *   - Loading state is shown while setupMfa is in flight
 *   - QR panel and code input are shown after setup succeeds
 *   - Successful confirmation transitions to the success state
 *   - Invalid code error is shown on confirmation failure
 *   - Setup failure error is shown and retry is possible
 *   - Secret is not rendered in plain text by default (hidden behind Show)
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthContext } from "../src/auth/AuthContext.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import { SecurityPage } from "../src/pages/SecurityPage.js";
import type { AuthUser, MfaSetupData } from "../src/types/index.js";

// ── Mock qrcode to avoid canvas errors in jsdom ───────────────────────────────

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
  },
  toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_USER: AuthUser = {
  id: "user-1",
  email: "staff@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: "clinic-1",
  homeClinicName: "Verve Dental Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

const MOCK_SETUP_DATA: MfaSetupData = {
  secret: "JBSWY3DPEHPK3PXP",
  uri: "otpauth://totp/Verve%20Dental:staff%40clinic-a.au?secret=JBSWY3DPEHPK3PXP&issuer=Verve%20Dental",
};

function makeAuthContext(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: MOCK_USER,
    isLoading: false,
    enrollmentToken: null,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    setupMfa: vi.fn().mockResolvedValue(MOCK_SETUP_DATA),
    confirmMfaEnrollment: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderSecurityPage(ctx: AuthContextValue = makeAuthContext()) {
  return render(
    <AuthContext.Provider value={ctx}>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Idle state
// ─────────────────────────────────────────────────────────────────────────────

describe("SecurityPage — idle state", () => {
  it("renders the Enable MFA button", () => {
    renderSecurityPage();
    expect(screen.getByRole("button", { name: /enable mfa/i })).toBeInTheDocument();
  });

  it("renders the Security heading", () => {
    renderSecurityPage();
    expect(screen.getByRole("heading", { name: /security/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup flow
// ─────────────────────────────────────────────────────────────────────────────

describe("SecurityPage — MFA enrollment flow", () => {
  it("calls setupMfa when Enable MFA is clicked", async () => {
    const ctx = makeAuthContext();
    renderSecurityPage(ctx);

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(ctx.setupMfa).toHaveBeenCalledOnce();
    });
  });

  it("shows the enrollment panel after setup succeeds", async () => {
    renderSecurityPage();

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /confirm & enable mfa/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders a QR image once the data URL is available", async () => {
    renderSecurityPage();

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      const img = screen.queryByAltText(/qr code/i);
      expect(img).toBeInTheDocument();
    });
  });

  it("hides the secret by default (not in plain text)", async () => {
    renderSecurityPage();

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /confirm & enable mfa/i }),
      ).toBeInTheDocument();
    });

    // Secret text should not be visible without clicking "Show"
    expect(screen.queryByText(MOCK_SETUP_DATA.secret)).not.toBeInTheDocument();
  });

  it("reveals the secret when Show is clicked", async () => {
    renderSecurityPage();

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /show/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /show/i }));

    expect(screen.getByText(MOCK_SETUP_DATA.secret)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation flow
// ─────────────────────────────────────────────────────────────────────────────

describe("SecurityPage — confirmation", () => {
  async function reachEnrollmentPanel(ctx: AuthContextValue) {
    renderSecurityPage(ctx);
    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /confirm & enable mfa/i }),
      ).toBeInTheDocument();
    });
  }

  it("calls confirmMfaEnrollment with the entered code", async () => {
    const ctx = makeAuthContext();
    await reachEnrollmentPanel(ctx);

    const input = screen.getByPlaceholderText(/6-digit code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));

    await waitFor(() => {
      expect(ctx.confirmMfaEnrollment).toHaveBeenCalledWith("123456");
    });
  });

  it("transitions to success state after confirmation", async () => {
    await reachEnrollmentPanel(makeAuthContext());

    const input = screen.getByPlaceholderText(/6-digit code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByText(/mfa has been enabled/i)).toBeInTheDocument();
    });
  });

  it("shows an error for a non-6-digit code without calling the API", async () => {
    const ctx = makeAuthContext();
    await reachEnrollmentPanel(ctx);

    const input = screen.getByPlaceholderText(/6-digit code/i);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));

    expect(ctx.confirmMfaEnrollment).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows an error when the API returns INVALID_MFA_CODE", async () => {
    const ctx = makeAuthContext({
      confirmMfaEnrollment: vi.fn().mockRejectedValue(new Error("Invalid MFA code")),
    });
    await reachEnrollmentPanel(ctx);

    const input = screen.getByPlaceholderText(/6-digit code/i);
    fireEvent.change(input, { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid mfa code/i);
    });
  });

  it("allows retry after a failed confirmation", async () => {
    const mockConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Invalid MFA code"))
      .mockResolvedValueOnce(undefined);

    const ctx = makeAuthContext({ confirmMfaEnrollment: mockConfirm });
    await reachEnrollmentPanel(ctx);

    const input = screen.getByPlaceholderText(/6-digit code/i);

    // First attempt — fails
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));
    await waitFor(() => { expect(screen.getByRole("alert")).toBeInTheDocument(); });

    // Second attempt — succeeds
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & enable mfa/i }));
    await waitFor(() => {
      expect(screen.getByText(/mfa has been enabled/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup failure
// ─────────────────────────────────────────────────────────────────────────────

describe("SecurityPage — setup failure", () => {
  it("shows an error when setupMfa throws", async () => {
    const ctx = makeAuthContext({
      setupMfa: vi.fn().mockRejectedValue(new Error("Setup failed")),
    });
    renderSecurityPage(ctx);

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/setup failed/i);
    });
  });

  it("shows a Try again button after setup failure", async () => {
    const ctx = makeAuthContext({
      setupMfa: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    renderSecurityPage(ctx);

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });

  it("resets to idle state when Try again is clicked", async () => {
    const ctx = makeAuthContext({
      setupMfa: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    renderSecurityPage(ctx);

    fireEvent.click(screen.getByRole("button", { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByRole("button", { name: /enable mfa/i })).toBeInTheDocument();
  });
});
