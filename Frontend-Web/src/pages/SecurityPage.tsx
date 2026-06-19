import { useState } from "react";

import { useAuth } from "../auth/useAuth.js";
import { MfaEnrollmentPanel } from "../components/MfaEnrollmentPanel.js";
import { AppShell } from "../components/layout/AppShell.js";
import type { MfaSetupData } from "../types/index.js";

// ── State machine ─────────────────────────────────────────────────────────────

type SecurityState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "enrolling"; setupData: MfaSetupData }
  | { phase: "confirming"; setupData: MfaSetupData }
  | { phase: "success" }
  | { phase: "setup_error"; message: string };

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Settings > Security page
 *
 * Handles the voluntary MFA enrollment flow for already-authenticated users.
 * The forced enrollment path (login returns requiresMfaEnrollment) is handled
 * inline in LoginPage using the same AuthContext methods.
 *
 * Security contract:
 *   - The TOTP secret is held only in React component state (memory).
 *   - The secret is never written to localStorage, sessionStorage, or any
 *     other persistent medium.
 *   - After successful confirmation the state machine transitions to 'success'
 *     and the secret is discarded.
 */
export function SecurityPage() {
  const { setupMfa, confirmMfaEnrollment } = useAuth();
  const [state, setState] = useState<SecurityState>({ phase: "idle" });

  async function handleEnableMfa(): Promise<void> {
    setState({ phase: "loading" });
    try {
      const setupData = await setupMfa();
      setState({ phase: "enrolling", setupData });
    } catch (err: unknown) {
      setState({
        phase: "setup_error",
        message: err instanceof Error ? err.message : "Failed to start MFA setup.",
      });
    }
  }

  async function handleConfirm(code: string): Promise<void> {
    if (state.phase !== "enrolling") return;
    const { setupData } = state;
    setState({ phase: "confirming", setupData });
    try {
      await confirmMfaEnrollment(code);
      setState({ phase: "success" });
    } catch (err: unknown) {
      // Reset to enrolling so the user can retry; re-throw so
      // MfaEnrollmentPanel surfaces the message in its own error state.
      setState({ phase: "enrolling", setupData });
      throw err;
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Security</h2>
            <p className="inventory-page__subtitle">
              Two-factor authentication (2FA / MFA)
            </p>
          </div>
        </div>

        {state.phase === "success" ? (
          <p className="inventory-notice" role="status">
            MFA has been enabled on your account. You will be asked for a
            verification code on your next sign-in.
          </p>
        ) : state.phase === "setup_error" ? (
          <div>
            <p className="status-card__error" role="alert">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => { setState({ phase: "idle" }); }}
            >
              Try again
            </button>
          </div>
        ) : state.phase === "idle" ? (
          <div>
            <p>
              Protect your account with an authenticator app. Once enabled, you
              will need a 6-digit code from the app each time you sign in.
            </p>
            <p className="inventory-page__subtitle">
              Compatible apps: Google Authenticator, Authy, Microsoft
              Authenticator, or any TOTP-compatible app.
            </p>
            <div className="product-form__actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => { void handleEnableMfa(); }}
              >
                Enable MFA
              </button>
            </div>
          </div>
        ) : state.phase === "loading" ? (
          <p className="loading-message">Setting up MFA…</p>
        ) : (
          <>
            <p className="mfa-panel__instructions">
              1. Open your authenticator app and scan the QR code below, or
              enter the key manually.
              <br />
              2. Enter the 6-digit code shown in the app to confirm setup.
            </p>
            <MfaEnrollmentPanel
              setupData={state.setupData}
              onConfirm={async (code) => { await handleConfirm(code); }}
              onCancel={() => { setState({ phase: "idle" }); }}
              isBusy={state.phase === "confirming"}
            />
          </>
        )}
      </section>
    </AppShell>
  );
}
