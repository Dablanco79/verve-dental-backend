import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { StaffUser, UserRole } from "../types/index.js";
import { canManageUsers, ROLE_LABELS } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const ALL_ROLES: UserRole[] = ["owner_admin", "group_practice_manager", "clinical_staff"];

type FormState = {
  email: string;
  password: string;
  role: UserRole;
};

function initialForm(): FormState {
  return { email: "", password: "", role: "clinical_staff" };
}

export function ManageUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.listUsers(user.clinicId);
      setUsers(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (!user) return null;

  if (!canManageUsers(user.role)) {
    return <Navigate to="/" replace />;
  }

  // Managers can only create clinical_staff; admins can select any role.
  const availableRoles =
    user.role === "owner_admin" ? ALL_ROLES : (["clinical_staff"] as UserRole[]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;

    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const created = await apiClient.createUser(user.clinicId, {
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        clinicName: user.clinicName,
      });

      setUsers((prev) => [...prev, created]);
      setSuccessMessage(`Account created for ${created.email}`);
      setForm(initialForm);
      setShowForm(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Manage staff accounts</h2>
            <p className="inventory-page__subtitle">
              {user.clinicName} — {users.length} account{users.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="inventory-page__actions">
            {!showForm ? (
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setShowForm(true);
                  setFormError(null);
                  setSuccessMessage(null);
                }}
              >
                + Add user
              </button>
            ) : (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setShowForm(false);
                  setForm(initialForm);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {successMessage ? (
          <p className="inventory-notice" role="status">
            {successMessage}
          </p>
        ) : null}

        {showForm ? (
          <form
            className="product-form"
            onSubmit={(event) => void handleSubmit(event)}
            aria-label="Create new staff account"
          >
            <fieldset className="product-form__section">
              <legend>New staff account</legend>
              <div className="product-form__grid">
                <label>
                  Email address
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, email: e.target.value }));
                    }}
                    placeholder="jane.smith@yourclinic.au"
                    required
                    autoComplete="off"
                  />
                </label>

                <label>
                  Temporary password
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, password: e.target.value }));
                    }}
                    placeholder="Min 8 characters"
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </label>

                <label>
                  Role
                  <select
                    value={form.role}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, role: e.target.value as UserRole }));
                    }}
                  >
                    {availableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>

            {formError ? <p className="status-card__error">{formError}</p> : null}

            <div className="product-form__actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="status-card">
        <h2>Staff accounts</h2>

        {isLoading ? (
          <p className="loading-message">Loading accounts…</p>
        ) : loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : users.length === 0 ? (
          <p className="loading-message">No accounts found for this clinic.</p>
        ) : (
          <div className="inventory-table-wrapper">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Clinic</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      <span className="inventory-badge">{ROLE_LABELS[u.role]}</span>
                    </td>
                    <td>{u.clinicName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
