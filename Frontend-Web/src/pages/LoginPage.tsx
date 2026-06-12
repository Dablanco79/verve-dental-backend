import { useState, type SubmitEvent } from "react";
import { Navigate } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell.js";
import { useAuth } from "../auth/useAuth.js";

export function LoginPage() {
  const { user, login, verifyMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleLoginSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await login(email, password);

      if (result.requiresMfa && result.mfaToken) {
        setMfaToken(result.mfaToken);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfaSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!mfaToken) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await verifyMfa(mfaToken, mfaCode);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "MFA verification failed";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="auth-card">
        <h2>{mfaToken ? "Verify MFA" : "Sign in"}</h2>

        {mfaToken ? (
          <form className="auth-form" onSubmit={(event) => void handleMfaSubmit(event)}>
            <label>
              MFA code
              <input
                value={mfaCode}
                onChange={(event) => {
                  setMfaCode(event.target.value);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Verify
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(event) => void handleLoginSubmit(event)}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Sign in
            </button>
          </form>
        )}

        {error ? <p className="status-card__error">{error}</p> : null}
      </section>
    </AppShell>
  );
}
