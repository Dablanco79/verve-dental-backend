import React, { useState } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import { ROLE_LABELS } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function initialForm(): PasswordFormState {
  return { currentPassword: "", newPassword: "", confirmPassword: "" };
}

export function AccountPage() {
  const { user, logout } = useAuth();

  const [form, setForm] = useState<PasswordFormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!user) return null;

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (form.newPassword !== form.confirmPassword) {
      setFormError("New passwords do not match.");
      return;
    }

    if (form.newPassword.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      await apiClient.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });

      setSuccessMessage(
        "Password changed successfully. You will be logged out in a moment — please log in again with your new password.",
      );
      setForm(initialForm);

      // Back-end has revoked all refresh tokens for this user. Force a clean
      // local logout after a short pause so the user can read the message.
      setTimeout(() => {
        void logout();
      }, 3000);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>My account</h2>
            <p className="inventory-page__subtitle">{user.homeClinicName}</p>
          </div>
        </div>

        <dl className="account-details">
          <div className="account-details__row">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="account-details__row">
            <dt>Role</dt>
            <dd>
              <span className="inventory-badge">{ROLE_LABELS[user.role]}</span>
            </dd>
          </div>
          <div className="account-details__row">
            <dt>Home clinic</dt>
            <dd>{user.homeClinicName}</dd>
          </div>
        </dl>
      </section>

      <section className="status-card">
        <h2>Change password</h2>
        <p className="inventory-page__subtitle">
          After changing your password you will be logged out and must log in again.
        </p>

        {successMessage ? (
          <p className="inventory-notice" role="status">
            {successMessage}
          </p>
        ) : (
          <form
            className="product-form"
            onSubmit={(event) => { void handleSubmit(event); }}
            aria-label="Change password"
          >
            <fieldset className="product-form__section">
              <div className="product-form__grid">
                <label>
                  Current password
                  <input
                    type="password"
                    value={form.currentPassword}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, currentPassword: e.target.value }));
                    }}
                    required
                    autoComplete="current-password"
                  />
                </label>

                <label>
                  New password
                  <input
                    type="password"
                    value={form.newPassword}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, newPassword: e.target.value }));
                    }}
                    required
                    minLength={8}
                    placeholder="Min 8 characters"
                    autoComplete="new-password"
                  />
                </label>

                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, confirmPassword: e.target.value }));
                    }}
                    required
                    minLength={8}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                </label>
              </div>
            </fieldset>

            {formError ? <p className="status-card__error">{formError}</p> : null}

            <div className="product-form__actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Change password"}
              </button>
            </div>
          </form>
        )}
      </section>
    </AppShell>
  );
}
