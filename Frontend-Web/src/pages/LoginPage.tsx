import { useState, type SubmitEvent } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { MfaEnrollmentPanel } from "../components/MfaEnrollmentPanel.js";
import { AppShell } from "../components/layout/AppShell.js";
import type { MfaSetupData } from "../types/index.js";

// ── Step machine ──────────────────────────────────────────────────────────────

type LoginStep =
  | { step: "credentials" }
  | { step: "mfa_verify"; mfaToken: string }
  | { step: "enrollment_loading" }
  | { step: "enrollment"; setupData: MfaSetupData }
  | { step: "enrollment_confirming"; setupData: MfaSetupData }
  | { step: "enrollment_success" };

// ── Component ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const { user, login, verifyMfa, setupMfa, confirmMfaEnrollment } = useAuth();
  const [loginStep, setLoginStep] = useState<LoginStep>({ step: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  // ── Credentials step ───────────────────────────────────────────────────────

  async function handleLoginSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await login(email, password);

      if ("requiresMfaEnrollment" in result) {
        // Backend requires this user to enroll MFA before proceeding.
        // The enrollment token is now stored in AuthContext memory.
        setLoginStep({ step: "enrollment_loading" });
        const setupData = await setupMfa();
        setLoginStep({ step: "enrollment", setupData });
      } else if (result.requiresMfa) {
        // result is now narrowed to { requiresMfa: true; mfaToken: string }
        setLoginStep({ step: "mfa_verify", mfaToken: result.mfaToken });
      }
      // else: session persisted — user state updated → redirects to "/"
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoginStep({ step: "credentials" });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── MFA verify step ────────────────────────────────────────────────────────

  async function handleMfaSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (loginStep.step !== "mfa_verify") return;

    setError(null);
    setIsSubmitting(true);

    try {
      await verifyMfa(loginStep.mfaToken, mfaCode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "MFA verification failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Enrollment confirm step ────────────────────────────────────────────────

  async function handleEnrollmentConfirm(code: string): Promise<void> {
    if (loginStep.step !== "enrollment") return;
    const { setupData } = loginStep;
    setLoginStep({ step: "enrollment_confirming", setupData });
    try {
      await confirmMfaEnrollment(code);
      setLoginStep({ step: "enrollment_success" });
    } catch (err: unknown) {
      // Reset to enrolling so the user can retry; re-throw so
      // MfaEnrollmentPanel can display the error inline.
      setLoginStep({ step: "enrollment", setupData });
      throw err;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loginStep.step === "enrollment_success") {
    return (
      <AppShell>
        <section className="auth-card">
          <h2>MFA enabled</h2>
          <p>
            Your authenticator app is now set up. Please sign in again with
            your email, password, and the code from your app.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoginStep({ step: "credentials" });
              setError(null);
            }}
          >
            Back to sign in
          </button>
        </section>
      </AppShell>
    );
  }

  if (loginStep.step === "enrollment_loading") {
    return (
      <AppShell>
        <section className="auth-card">
          <h2>Setting up MFA</h2>
          <p className="loading-message">
            Your account requires multi-factor authentication. Setting up…
          </p>
          {error ? <p className="status-card__error">{error}</p> : null}
        </section>
      </AppShell>
    );
  }

  if (loginStep.step === "enrollment" || loginStep.step === "enrollment_confirming") {
    return (
      <AppShell>
        <section className="auth-card">
          <h2>Enable MFA — required</h2>
          <p className="inventory-page__subtitle">
            Your account requires two-factor authentication. Scan the QR code
            or enter the key manually, then enter the 6-digit code to complete
            setup.
          </p>
          {error ? <p className="status-card__error" role="alert">{error}</p> : null}
          <MfaEnrollmentPanel
            setupData={loginStep.setupData}
            onConfirm={async (code) => { await handleEnrollmentConfirm(code); }}
            isBusy={loginStep.step === "enrollment_confirming"}
          />
        </section>
      </AppShell>
    );
  }

  if (loginStep.step === "mfa_verify") {
    return (
      <AppShell>
        <section className="auth-card">
          <h2>Verify MFA</h2>
          <form className="auth-form" onSubmit={(event) => { void handleMfaSubmit(event); }}>
            <label>
              MFA code
              <input
                value={mfaCode}
                onChange={(event) => { setMfaCode(event.target.value); }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Verify
            </button>
          </form>
          {error ? <p className="status-card__error">{error}</p> : null}
        </section>
      </AppShell>
    );
  }

  // Default: credentials step
  return (
    <AppShell>
      <section className="auth-card">
        <h2>Sign in</h2>
        <form className="auth-form" onSubmit={(event) => { void handleLoginSubmit(event); }}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); }}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); }}
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error ? <p className="status-card__error">{error}</p> : null}
      </section>
    </AppShell>
  );
}
