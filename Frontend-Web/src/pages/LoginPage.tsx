import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { useState, type ReactNode, type SubmitEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { MfaEnrollmentPanel } from "../components/MfaEnrollmentPanel.js";
import type { MfaSetupData } from "../types/index.js";

// ── Step machine ──────────────────────────────────────────────────────────────

type LoginStep =
  | { step: "credentials" }
  | { step: "mfa_verify"; mfaToken: string }
  | { step: "enrollment_loading" }
  | { step: "enrollment"; setupData: MfaSetupData }
  | { step: "enrollment_confirming"; setupData: MfaSetupData }
  | { step: "enrollment_success" };

function LoginLayout({ children, isFlow = false }: { children: ReactNode; isFlow?: boolean }) {
  return (
    <main className="renqor-login">
      <section
        className={`renqor-login__content${isFlow ? " renqor-login__content--flow" : ""}`}
      >
        <header className="renqor-login__brand">
          <img
            src="/assets/brand/renqor-horizontal-dark.svg"
            alt="RENQOR"
            className="renqor-login__wordmark"
          />
          <p>Operational Intelligence Made Clear</p>
        </header>
        <div className="renqor-login__stage">{children}</div>
        <p className="renqor-login__footer">Secure access to RENQOR operations</p>
      </section>

      <aside className="renqor-login__visual" aria-hidden="true">
        <img
          src="/assets/brand/rq-right-artwork.png"
          alt=""
          className="renqor-login__artwork"
        />
        <div className="renqor-login__visual-caption">
          <img
            src="/assets/brand/renqor-horizontal-dark.svg"
            alt=""
            className="renqor-login__visual-wordmark"
          />
          <span>Operational intelligence for modern, multi-location operations.</span>
        </div>
      </aside>
    </main>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const location = useLocation();
  const { user, login, verifyMfa, setupMfa, confirmMfaEnrollment } = useAuth();
  const [loginStep, setLoginStep] = useState<LoginStep>({ step: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const locationState = location.state as { from?: string; message?: string } | null;
  const returnTo = locationState?.from?.startsWith("/") ? locationState.from : "/";
  const sessionMessage = locationState?.message ?? null;

  if (user) {
    return <Navigate to={returnTo} replace />;
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
        // Pass the enrollmentToken directly — do not rely on AuthContext state
        // having flushed yet, which would cause setupMfa() to see null and fall
        // through to requireAccessToken(), throwing "Authentication required".
        setLoginStep({ step: "enrollment_loading" });
        const setupData = await setupMfa(result.enrollmentToken);
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
      <LoginLayout isFlow>
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
      </LoginLayout>
    );
  }

  if (loginStep.step === "enrollment_loading") {
    return (
      <LoginLayout isFlow>
        <section className="auth-card">
          <h2>Setting up MFA</h2>
          <p className="loading-message">
            Your account requires multi-factor authentication. Setting up…
          </p>
          {error ? <p className="status-card__error">{error}</p> : null}
        </section>
      </LoginLayout>
    );
  }

  if (loginStep.step === "enrollment" || loginStep.step === "enrollment_confirming") {
    return (
      <LoginLayout isFlow>
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
      </LoginLayout>
    );
  }

  if (loginStep.step === "mfa_verify") {
    return (
      <LoginLayout isFlow>
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
          {error ? <p className="status-card__error" role="alert">{error}</p> : null}
        </section>
      </LoginLayout>
    );
  }

  // Default: credentials step
  return (
    <LoginLayout>
      <section className="renqor-login__form-panel" aria-labelledby="login-heading">
        <div className="renqor-login__intro">
          <h1 id="login-heading">Welcome</h1>
          <p>Sign in to your RENQOR account to continue managing your operations.</p>
        </div>

        {sessionMessage ? (
          <p className="renqor-login__notice" role="status">{sessionMessage}</p>
        ) : null}

        <form
          className="renqor-login__form"
          onSubmit={(event) => { void handleLoginSubmit(event); }}
        >
          <label htmlFor="login-email">Email address</label>
          <div className="renqor-login__input-wrap">
            <Mail size={18} strokeWidth={1.7} aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); }}
              autoComplete="username"
              placeholder="you@company.com"
              required
            />
          </div>

          <label htmlFor="login-password">Password</label>
          <div className="renqor-login__input-wrap">
            <LockKeyhole size={18} strokeWidth={1.7} aria-hidden="true" />
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); }}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
          </div>

          <button className="renqor-login__submit" type="submit" disabled={isSubmitting}>
            <span>{isSubmitting ? "Signing in…" : "Sign in"}</span>
            <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </form>

        {error ? <p className="renqor-login__error" role="alert">{error}</p> : null}
      </section>
    </LoginLayout>
  );
}
