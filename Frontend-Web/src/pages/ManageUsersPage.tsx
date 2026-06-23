import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { ClinicData } from "../types/clinic.js";
import type { StaffUser, UserRole } from "../types/index.js";
import { canManageUsers, ROLE_LABELS } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// Roles an owner_admin may assign.
const ADMIN_ASSIGNABLE_ROLES: UserRole[] = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
];

// Roles a group_practice_manager may assign (clinical_staff only).
const MANAGER_ASSIGNABLE_ROLES: UserRole[] = ["clinical_staff"];

type FormState = {
  email: string;
  password: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  displayName: string;
  /** clinicId to POST to — only used when the caller is owner_admin. */
  selectedClinicId: string;
  selectedClinicName: string;
};

type ResetPasswordState = {
  userId: string;
  newPassword: string;
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
};

/** Derive a display label for a user row: "First Last" > displayName > email. */
function nameLabel(u: StaffUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.displayName) return u.displayName;
  return "—";
}

export function ManageUsersPage() {
  const { user } = useAuth();

  // ── Users list ──────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Clinic list (owner_admin only) ─────────────────────────────────────────
  const [clinics, setClinics] = useState<ClinicData[]>([]);
  const [clinicsLoading, setClinicsLoading] = useState(false);

  // ── Create user form ───────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ── Reset password ─────────────────────────────────────────────────────────
  const [resetState, setResetState] = useState<ResetPasswordState | null>(null);

  // ── Init form when user is known ───────────────────────────────────────────
  function buildInitialForm(targetClinicId: string, targetClinicName: string): FormState {
    return {
      email: "",
      password: "",
      role: "clinical_staff",
      firstName: "",
      lastName: "",
      displayName: "",
      selectedClinicId: targetClinicId,
      selectedClinicName: targetClinicName,
    };
  }

  const loadUsers = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.listUsers(user.homeClinicId);
      setUsers(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Load clinic list for owner_admin so they can pick the target clinic.
  const loadClinics = useCallback(async () => {
    if (!user || user.role !== "owner_admin") return;
    setClinicsLoading(true);
    try {
      const result = await apiClient.listClinics();
      setClinics(result);
    } catch {
      // Non-critical — falls back to home clinic only
    } finally {
      setClinicsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadUsers();
    void loadClinics();
  }, [loadUsers, loadClinics]);

  if (!user) return null;

  if (!canManageUsers(user.role)) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = user.role === "owner_admin";
  const availableRoles = isAdmin ? ADMIN_ASSIGNABLE_ROLES : MANAGER_ASSIGNABLE_ROLES;

  function openForm(): void {
    if (!user) return;
    setShowForm(true);
    setFormError(null);
    setSuccessMessage(null);
    setForm(buildInitialForm(user.homeClinicId, user.homeClinicName));
  }

  function closeForm(): void {
    setShowForm(false);
    setForm(null);
    setFormError(null);
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !form) return;

    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const created = await apiClient.createUser(form.selectedClinicId, {
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        clinicName: form.selectedClinicName,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        displayName: form.displayName.trim() || null,
      });

      setUsers((prev) => [...prev, created]);
      const fullName = `${created.firstName ?? ""} ${created.lastName ?? ""}`.trim();
      const name = created.displayName ?? (fullName || created.email);
      setSuccessMessage(`Account created for ${name}`);
      closeForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !resetState) return;

    setResetState((s) => s && { ...s, isSubmitting: true, error: null });

    try {
      await apiClient.resetUserPassword(user.homeClinicId, resetState.userId, {
        newPassword: resetState.newPassword,
      });
      setResetState((s) => s && { ...s, isSubmitting: false, success: true });
    } catch (err: unknown) {
      setResetState(
        (s) =>
          s && {
            ...s,
            isSubmitting: false,
            error: err instanceof Error ? err.message : "Failed to reset password",
          },
      );
    }
  }

  // When the admin picks a different clinic in the selector, update form state.
  function handleClinicChange(clinicId: string): void {
    const picked = clinics.find((c) => c.id === clinicId);
    if (!picked || !form) return;
    setForm((f) =>
      f ? { ...f, selectedClinicId: picked.id, selectedClinicName: picked.name } : f,
    );
  }

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Manage staff accounts</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} — {users.length} account{users.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="inventory-page__actions">
            {!showForm ? (
              <button type="button" className="button-link" onClick={openForm}>
                + Add user
              </button>
            ) : (
              <button type="button" className="link-button" onClick={closeForm}>
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

        {/* ── Create user form ──────────────────────────────────────────────── */}
        {showForm && form ? (
          <form
            className="product-form"
            onSubmit={(event) => { void handleSubmit(event); }}
            aria-label="Create new staff account"
          >
            <fieldset className="product-form__section">
              <legend>New staff account</legend>
              <div className="product-form__grid">

                {/* ── Clinic selector — owner_admin only ── */}
                {isAdmin ? (
                  <label>
                    Home clinic
                    <select
                      value={form.selectedClinicId}
                      onChange={(e) => { handleClinicChange(e.target.value); }}
                      disabled={clinicsLoading}
                      aria-label="Home clinic"
                    >
                      {clinicsLoading ? (
                        <option value="">Loading clinics…</option>
                      ) : (
                        clinics.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                ) : null}

                <label>
                  First name
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => {
                      setForm((f) => f && { ...f, firstName: e.target.value });
                    }}
                    placeholder="Jane"
                    required
                    maxLength={100}
                    autoComplete="off"
                  />
                </label>

                <label>
                  Last name
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => {
                      setForm((f) => f && { ...f, lastName: e.target.value });
                    }}
                    placeholder="Smith"
                    required
                    maxLength={100}
                    autoComplete="off"
                  />
                </label>

                <label>
                  Display name
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => {
                      setForm((f) => f && { ...f, displayName: e.target.value });
                    }}
                    placeholder="Defaults to First Last"
                    maxLength={200}
                    autoComplete="off"
                  />
                </label>

                <label>
                  Email address
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => {
                      setForm((f) => f && { ...f, email: e.target.value });
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
                      setForm((f) => f && { ...f, password: e.target.value });
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
                      setForm((f) => f && { ...f, role: e.target.value as UserRole });
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

      {/* ── Staff accounts table ──────────────────────────────────────────────── */}
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
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Home clinic</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <React.Fragment key={u.id}>
                    <tr>
                      <td>{nameLabel(u)}</td>
                      <td>{u.email}</td>
                      <td>
                        <span className="inventory-badge">{ROLE_LABELS[u.role]}</span>
                      </td>
                      <td>{u.homeClinicName}</td>
                      <td>
                        {resetState?.userId === u.id && resetState.success ? (
                          <span className="inventory-notice--inline">Password reset</span>
                        ) : (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setResetState(
                                resetState?.userId === u.id
                                  ? null
                                  : {
                                      userId: u.id,
                                      newPassword: "",
                                      isSubmitting: false,
                                      error: null,
                                      success: false,
                                    },
                              );
                            }}
                          >
                            {resetState?.userId === u.id ? "Cancel" : "Reset password"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {resetState?.userId === u.id && !resetState.success ? (
                      <tr key={`${u.id}-reset`}>
                        <td colSpan={5}>
                          <form
                            className="reset-password-form"
                            onSubmit={(event) => { void handleResetPassword(event); }}
                            aria-label={`Reset password for ${u.email}`}
                          >
                            <label>
                              New password
                              <input
                                type="password"
                                value={resetState.newPassword}
                                onChange={(e) => {
                                  setResetState(
                                    (s) => s && { ...s, newPassword: e.target.value },
                                  );
                                }}
                                required
                                minLength={8}
                                placeholder="Min 8 characters"
                                autoComplete="new-password"
                              />
                            </label>
                            {resetState.error ? (
                              <p className="status-card__error">{resetState.error}</p>
                            ) : null}
                            <button type="submit" disabled={resetState.isSubmitting}>
                              {resetState.isSubmitting ? "Resetting…" : "Set new password"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
