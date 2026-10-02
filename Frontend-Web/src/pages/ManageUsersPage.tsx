import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { loadConfig } from "../config/index.js";
import { usePayRates } from "../hooks/usePayRates.js";
import type { ClinicData } from "../types/clinic.js";
import type {
  CreatePayRateRequest,
  EmploymentType,
  StaffPayrollTrack,
  StaffUser,
  UserRole,
} from "../types/index.js";

import {
  DEFAULT_SUPER_RATE,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_TRACK_LABELS,
  STAFF_PAYROLL_TRACKS,
} from "../types/index.js";
import { canManageUsers, ROLE_LABELS } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const MODULE_ITEMS: Array<{ permission: string; label: string; roles: UserRole[] }> = [
  { permission: "module:timesheets", label: "Timesheets", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:roster", label: "Roster", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:leave", label: "Leave", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:inventory", label: "Inventory", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:stocktakes", label: "Stocktakes", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:procurement", label: "Procurement", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:receiving", label: "Receiving", roles: ["owner_admin", "group_practice_manager", "clinical_staff"] },
  { permission: "module:reports", label: "Reports & Analytics", roles: ["owner_admin", "group_practice_manager"] },
  // Pay-rate access — GPM only.
  // owner_admin has inherent payroll:rates:* access and does not need a toggle.
  // clinical_staff must never access other staff members' pay rates.
  { permission: "payroll:rates:read",  label: "View staff pay rates", roles: ["group_practice_manager"] },
  { permission: "payroll:rates:write", label: "Edit staff pay rates",  roles: ["group_practice_manager"] },
];

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

type ClinicAccessState = {
  userId: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  availableClinics: { id: string; name: string }[];
  assignments: { clinicId: string; canRoster: boolean; canOperate: boolean }[];
};

type ModuleAccessState = {
  userId: string;
  userRole: UserRole;
  isLoading: boolean;
  isSaving: string | null; // permission currently being toggled
  error: string | null;
  activePermissions: Set<string>;
};

type EditState = {
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  payrollTrack: StaffPayrollTrack;
  role: UserRole;
  /** The home-clinic ID the user had when the edit panel was opened.
   *  Used as the URL :clinicId so the backend can locate the record by its
   *  current clinic before applying any clinic-reassignment change. */
  originalClinicId: string;
  /** The clinic the admin has selected — may differ from originalClinicId
   *  when the admin is reassigning the user to a new home clinic. */
  selectedClinicId: string;
  selectedClinicName: string;
  isSubmitting: boolean;
  error: string | null;
};

type PayRateFormState = {
  /** The userId this form was opened for.  Checked before every POST to
   *  prevent stale form state from being submitted to the wrong staff member. */
  userId: string;
  baseHourlyRateDollars: string;
  employmentType: EmploymentType;
  contractedWeeklyHours: string;
  superRatePercent: string;
  effectiveFrom: string;
  isSubmitting: boolean;
  error: string | null;
  isOpen: boolean;
};

/** Derive a display label for a user row: "First Last" > displayName > email. */
function nameLabel(u: StaffUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.displayName) return u.displayName;
  return "—";
}

export function ManageUsersPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();

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

  // ── Inline edit ────────────────────────────────────────────────────────────
  const [editState, setEditState] = useState<EditState | null>(null);

  // ── Clinic access (owner_admin only) ───────────────────────────────────────
  const [clinicAccess, setClinicAccess] = useState<ClinicAccessState | null>(null);

  // ── Module access (owner_admin only) ───────────────────────────────────────
  const [moduleAccess, setModuleAccess] = useState<ModuleAccessState | null>(null);

  // ── Pay profile (pay rates panel inside inline edit) ───────────────────────
  const [payRateForm, setPayRateForm] = useState<PayRateFormState | null>(null);
  const payProfileUserId = editState?.userId ?? null;
  const { rates: payRates, isLoading: payRatesLoading, error: payRatesError, createRate } =
    usePayRates(clinicId ?? null, payProfileUserId);

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
    if (!user || !clinicId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.listUsers(clinicId);
      setUsers(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setIsLoading(false);
    }
  }, [user, clinicId]);

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

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to manage staff accounts</h2>
          <p>
            Staff account management is clinic-specific. Choose a clinic from the clinic selector
            to view and manage user accounts.
          </p>
        </section>
      </AppShell>
    );
  }

  const isAdmin = user.role === "owner_admin";
  const availableRoles = isAdmin ? ADMIN_ASSIGNABLE_ROLES : MANAGER_ASSIGNABLE_ROLES;

  function openForm(): void {
    if (!user) return;
    setShowForm(true);
    setFormError(null);
    setSuccessMessage(null);
    setEditState(null);
    setResetState(null);
    setForm(buildInitialForm(user.homeClinicId, user.homeClinicName));
  }

  function openEdit(u: StaffUser): void {
    setEditState({
      userId: u.id,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      displayName: u.displayName ?? "",
      payrollTrack: u.payrollTrack,
      role: u.role,
      // Capture the user's current home clinic so the URL always targets the
      // right record even if the admin subsequently changes the selectedClinicId.
      originalClinicId: u.homeClinicId,
      selectedClinicId: u.homeClinicId,
      selectedClinicName: u.homeClinicName,
      isSubmitting: false,
      error: null,
    });
    setResetState(null);
    setShowForm(false);
    setModuleAccess(null);
    // Clear any pay-rate form from a previously edited user so it can never
    // leak into this user's panel (state-isolation invariant).
    setPayRateForm(null);
  }

  function closeEdit(): void {
    setEditState(null);
    setPayRateForm(null);
  }

  // ── Clinic access handlers ─────────────────────────────────────────────────

  async function openClinicAccess(u: StaffUser): Promise<void> {
    if (!user || user.role !== "owner_admin") return;
    setClinicAccess({
      userId: u.id,
      isLoading: true,
      isSaving: false,
      error: null,
      availableClinics: [],
      assignments: [],
    });
    setEditState(null);
    setResetState(null);
    setModuleAccess(null);
    setShowForm(false);
    try {
      const data = await apiClient.getUserClinicAccess(u.homeClinicId, u.id);
      setClinicAccess({
        userId: u.id,
        isLoading: false,
        isSaving: false,
        error: null,
        availableClinics: data.availableClinics,
        assignments: data.assignments.map((a) => ({
          clinicId: a.clinicId,
          canRoster: a.canRoster,
          canOperate: a.canOperate,
        })),
      });
    } catch (err: unknown) {
      setClinicAccess((s) =>
        s
          ? { ...s, isLoading: false, error: err instanceof Error ? err.message : "Failed to load clinic access" }
          : s,
      );
    }
  }

  async function saveClinicAccess(targetUser: StaffUser): Promise<void> {
    if (!clinicAccess) return;
    setClinicAccess((s) => s && { ...s, isSaving: true, error: null });
    try {
      await apiClient.putUserClinicAccess(
        targetUser.homeClinicId,
        targetUser.id,
        clinicAccess.assignments,
      );
      setClinicAccess(null);
    } catch (err: unknown) {
      setClinicAccess((s) =>
        s
          ? { ...s, isSaving: false, error: err instanceof Error ? err.message : "Failed to save clinic access" }
          : s,
      );
    }
  }

  function toggleAssignment(
    clinicId: string,
    field: "canRoster" | "canOperate",
    value: boolean,
  ): void {
    setClinicAccess((s) => {
      if (!s) return s;
      const exists = s.assignments.some((a) => a.clinicId === clinicId);
      if (!exists) {
        // Add a new row for this clinic if it doesn't exist yet.
        return {
          ...s,
          assignments: [
            ...s.assignments,
            { clinicId, canRoster: field === "canRoster" ? value : false, canOperate: field === "canOperate" ? value : false },
          ],
        };
      }
      return {
        ...s,
        assignments: s.assignments.map((a) =>
          a.clinicId === clinicId ? { ...a, [field]: value } : a,
        ),
      };
    });
  }

  async function openModuleAccess(u: StaffUser): Promise<void> {
    if (!user || user.role !== "owner_admin") return;
    setModuleAccess({
      userId: u.id,
      userRole: u.role,
      isLoading: true,
      isSaving: null,
      error: null,
      activePermissions: new Set(),
    });
    setEditState(null);
    setResetState(null);
    setClinicAccess(null);
    setShowForm(false);
    try {
      // data is PermissionGrantRow[] — the API envelope { data: [...] } is
      // unwrapped by request().  Do NOT access data.grants — there is no such
      // property; doing so returns undefined and crashes .filter().
      const data = await apiClient.listUserPermissions(u.homeClinicId, u.id);
      // Include all non-revoked permissions tracked by MODULE_ITEMS
      // (both "module:*" and "payroll:*" families).
      const moduleItemPermissions = new Set(MODULE_ITEMS.map((m) => m.permission));
      const active = new Set(
        data
          .filter((g) => g.revokedAt === null && moduleItemPermissions.has(g.permission))
          .map((g) => g.permission),
      );
      setModuleAccess((s) => s ? { ...s, isLoading: false, activePermissions: active } : s);
    } catch (err: unknown) {
      setModuleAccess((s) =>
        s ? { ...s, isLoading: false, error: err instanceof Error ? err.message : "Failed to load permissions" } : s,
      );
    }
  }

  async function toggleModulePermission(u: StaffUser, permission: string, grant: boolean): Promise<void> {
    if (!moduleAccess || !user) return;
    setModuleAccess((s) => s ? { ...s, isSaving: permission, error: null } : s);
    try {
      if (grant) {
        await apiClient.grantUserPermission(u.homeClinicId, u.id, permission);
      } else {
        await apiClient.revokeUserPermission(u.homeClinicId, u.id, permission);
      }
      setModuleAccess((s) => {
        if (!s) return s;
        const next = new Set(s.activePermissions);
        if (grant) next.add(permission); else next.delete(permission);
        return { ...s, isSaving: null, activePermissions: next };
      });
    } catch (err: unknown) {
      setModuleAccess((s) =>
        s ? { ...s, isSaving: null, error: err instanceof Error ? err.message : "Failed to update permission" } : s,
      );
    }
  }

  /**
   * Wraps toggleModulePermission with permission-dependency enforcement:
   *   - Enabling  payroll:rates:write also grants  payroll:rates:read  (if not already active).
   *   - Disabling payroll:rates:read  also revokes payroll:rates:write (if currently active).
   */
  async function handlePermissionToggle(u: StaffUser, permission: string, grant: boolean): Promise<void> {
    if (!moduleAccess) return;

    // Capture pre-change state before any API calls alter it.
    const wasReadActive  = moduleAccess.activePermissions.has("payroll:rates:read");
    const wasWriteActive = moduleAccess.activePermissions.has("payroll:rates:write");

    // Enabling Write → first ensure Read is granted.
    if (permission === "payroll:rates:write" && grant && !wasReadActive) {
      await toggleModulePermission(u, "payroll:rates:read", true);
    }

    await toggleModulePermission(u, permission, grant);

    // Disabling Read → also revoke Write so it can never outlive View.
    if (permission === "payroll:rates:read" && !grant && wasWriteActive) {
      await toggleModulePermission(u, "payroll:rates:write", false);
    }
  }

  async function handleSaveEdit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !editState) return;

    setEditState((s) => s && { ...s, isSubmitting: true, error: null });

    try {
      const body: Record<string, unknown> = {
        firstName: editState.firstName.trim() || undefined,
        lastName: editState.lastName.trim() || undefined,
        displayName: editState.displayName.trim() || null,
        payrollTrack: editState.payrollTrack,
      };

      if (isAdmin) {
        body.role = editState.role;
        // Send the newly selected clinic in the body so the backend can
        // apply a home-clinic reassignment.  The URL, however, must use
        // originalClinicId — the clinic the user belonged to when the panel
        // was opened — so the backend's ownership check (target.homeClinicId
        // === URL clinicId) can locate the record.
        body.homeClinicId = editState.selectedClinicId;
        body.homeClinicName = editState.selectedClinicName;
      }

      const updated = await apiClient.updateUser(
        editState.originalClinicId, // ← original clinic in URL (for backend scoping)
        editState.userId,
        body,
      );
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      // Use closeEdit() so payRateForm is cleared atomically with editState.
      closeEdit();
    } catch (err: unknown) {
      setEditState(
        (s) =>
          s && {
            ...s,
            isSubmitting: false,
            error: err instanceof Error ? err.message : "Failed to save changes",
          },
      );
    }
  }

  function openPayRateForm(): void {
    if (!editState) return;
    setPayRateForm({
      // Bind the form to the currently open user so the defensive guard in
      // handleSubmitPayRate can detect stale state if openEdit was called
      // for a different user without clearing this form first.
      userId: editState.userId,
      baseHourlyRateDollars: "",
      employmentType: "full_time",
      contractedWeeklyHours: "",
      superRatePercent: String(DEFAULT_SUPER_RATE),
      effectiveFrom: "",
      isSubmitting: false,
      error: null,
      isOpen: true,
    });
  }

  /**
   * Direct async handler for the Pay Profile "Save rate" button.
   *
   * Previously this was an onSubmit handler on an inner <form>, which caused
   * React's SyntheticEvent bubbling to also fire handleSaveEdit on the outer
   * user-edit <form>.  The Pay Profile section is now a <div role="form"> and
   * this function is called directly from the button's onClick — no form event
   * is involved and no bubbling to the parent form can occur.
   */
  async function handleSubmitPayRateDirect(): Promise<void> {
    if (!payRateForm) return;

    // Defensive invariant: the form must belong to the currently open user.
    // If they differ it means state leaked from a previously edited user
    // (e.g. openEdit was called without clearing this form).  Clear the
    // stale form instead of silently submitting to the wrong staff member.
    if (payRateForm.userId !== editState?.userId) {
      setPayRateForm(null);
      return;
    }

    const rateDollars = parseFloat(payRateForm.baseHourlyRateDollars);
    if (isNaN(rateDollars) || rateDollars <= 0) {
      setPayRateForm((s) => s && { ...s, error: "Base hourly rate must be a positive number." });
      return;
    }

    const superPercent = parseFloat(payRateForm.superRatePercent);
    if (isNaN(superPercent) || superPercent < 0 || superPercent > 100) {
      setPayRateForm((s) => s && { ...s, error: "Super rate must be between 0 and 100." });
      return;
    }

    const contractedHours = payRateForm.contractedWeeklyHours.trim()
      ? parseFloat(payRateForm.contractedWeeklyHours)
      : null;

    const payload: CreatePayRateRequest = {
      baseHourlyRateCents: Math.round(rateDollars * 100),
      employmentType: payRateForm.employmentType,
      contractedWeeklyHours: contractedHours,
      superRatePercent: superPercent,
      effectiveFrom: payRateForm.effectiveFrom,
    };

    setPayRateForm((s) => s && { ...s, isSubmitting: true, error: null });
    try {
      await createRate(payload);
      setPayRateForm(null);
    } catch (err: unknown) {
      setPayRateForm(
        (s) =>
          s && {
            ...s,
            isSubmitting: false,
            error: err instanceof Error ? err.message : "Failed to save pay rate",
          },
      );
    }
  }

  function handleEditClinicChange(clinicId: string): void {
    const picked = clinics.find((c) => c.id === clinicId);
    if (!picked || !editState) return;
    setEditState((s) =>
      s ? { ...s, selectedClinicId: picked.id, selectedClinicName: picked.name } : s,
    );
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
      await apiClient.resetUserPassword(clinicId ?? user.homeClinicId, resetState.userId, {
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
              {clinicName ?? user.homeClinicName} — {users.length} account{users.length !== 1 ? "s" : ""}
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
                {users.map((u) => {
                  const isEditingThis = editState?.userId === u.id;
                  const isResettingThis = resetState?.userId === u.id;
                  return (
                    <React.Fragment key={u.id}>
                      <tr>
                        <td>{nameLabel(u)}</td>
                        <td>{u.email}</td>
                        <td>
                          <span className="inventory-badge">{ROLE_LABELS[u.role]}</span>
                        </td>
                        <td>{u.homeClinicName}</td>
                        <td>
                          <span className="user-row-actions">
                            {/* Edit action */}
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => {
                                if (isEditingThis) {
                                  closeEdit();
                                } else {
                                  openEdit(u);
                                }
                              }}
                            >
                              {isEditingThis ? "Cancel" : "Edit"}
                            </button>

                            {/* Clinic access — owner_admin only */}
                            {isAdmin ? (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                  if (clinicAccess?.userId === u.id) {
                                    setClinicAccess(null);
                                  } else {
                                    void openClinicAccess(u);
                                  }
                                }}
                              >
                                {clinicAccess?.userId === u.id ? "Close access" : "Clinic access"}
                              </button>
                            ) : null}

                            {/* Module access — owner_admin only */}
                            {isAdmin ? (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                  if (moduleAccess?.userId === u.id) {
                                    setModuleAccess(null);
                                  } else {
                                    void openModuleAccess(u);
                                  }
                                }}
                              >
                                {moduleAccess?.userId === u.id ? "Close modules" : "Module access"}
                              </button>
                            ) : null}

                            {/* Reset password action */}
                            {!isEditingThis ? (
                              isResettingThis && resetState.success ? (
                                <span className="inventory-notice--inline">Password reset</span>
                              ) : (
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={() => {
                                    setResetState(
                                      isResettingThis
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
                                  {isResettingThis ? "Cancel" : "Reset password"}
                                </button>
                              )
                            ) : null}
                          </span>
                        </td>
                      </tr>

                      {/* Inline edit panel */}
                      {isEditingThis ? (
                        <tr key={`${u.id}-edit`}>
                          <td colSpan={5}>
                            <form
                              className="product-form"
                              onSubmit={(event) => { void handleSaveEdit(event); }}
                              aria-label={`Edit ${u.email}`}
                              noValidate
                            >
                              <div className="product-form__grid">
                                <label>
                                  First name
                                  <input
                                    type="text"
                                    value={editState.firstName}
                                    onChange={(e) => {
                                      setEditState((s) => s && { ...s, firstName: e.target.value });
                                    }}
                                    maxLength={100}
                                    autoComplete="off"
                                  />
                                </label>
                                <label>
                                  Last name
                                  <input
                                    type="text"
                                    value={editState.lastName}
                                    onChange={(e) => {
                                      setEditState((s) => s && { ...s, lastName: e.target.value });
                                    }}
                                    maxLength={100}
                                    autoComplete="off"
                                  />
                                </label>
                                <label>
                                  Display name
                                  <input
                                    type="text"
                                    value={editState.displayName}
                                    onChange={(e) => {
                                      setEditState((s) => s && { ...s, displayName: e.target.value });
                                    }}
                                    placeholder="Defaults to First Last"
                                    maxLength={200}
                                    autoComplete="off"
                                  />
                                </label>
                                <label>
                                  Payroll track
                                  <select
                                    value={editState.payrollTrack}
                                    onChange={(e) => {
                                      setEditState(
                                        (s) =>
                                          s && {
                                            ...s,
                                            payrollTrack: e.target.value as StaffPayrollTrack,
                                          },
                                      );
                                    }}
                                    aria-label="Payroll track"
                                  >
                                    {STAFF_PAYROLL_TRACKS.map((t) => (
                                      <option key={t} value={t}>
                                        {PAYROLL_TRACK_LABELS[t]}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                {/* Role and clinic — owner_admin only */}
                                {isAdmin ? (
                                  <>
                                    <label>
                                      Role
                                      <select
                                        value={editState.role}
                                        onChange={(e) => {
                                          setEditState(
                                            (s) =>
                                              s && { ...s, role: e.target.value as UserRole },
                                          );
                                        }}
                                        aria-label="Role"
                                      >
                                        {ADMIN_ASSIGNABLE_ROLES.map((r) => (
                                          <option key={r} value={r}>
                                            {ROLE_LABELS[r]}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      Home clinic
                                      <select
                                        value={editState.selectedClinicId}
                                        onChange={(e) => {
                                          handleEditClinicChange(e.target.value);
                                        }}
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
                                  </>
                                ) : null}
                              </div>

                              {editState.error ? (
                                <p className="status-card__error">{editState.error}</p>
                              ) : null}

                              {/* ── Pay Profile section ─────────────────────────────── */}
                              {user.permissions.includes("payroll:rates:read") ? (
                                <div className="product-form__section" style={{ marginTop: "1.5rem" }}>
                                  <h4 style={{ marginBottom: "0.5rem" }}>Pay Profile</h4>

                                  {payRatesLoading ? (
                                    <p className="loading-message">Loading pay rates…</p>
                                  ) : payRatesError ? (
                                    <p className="status-card__error">{payRatesError}</p>
                                  ) : (
                                    <>
                                      {/* Current active rate */}
                                      {(() => {
                                        const activeRate = payRates.find((r) => r.effectiveTo === null);
                                        if (!activeRate) {
                                          return (
                                            <p className="inventory-page__subtitle">
                                              No pay rate configured — using default estimate for forecasting.
                                            </p>
                                          );
                                        }
                                        return (
                                          <div className="inventory-page__subtitle" style={{ marginBottom: "0.75rem" }}>
                                            <strong>Current rate:</strong>{" "}
                                            ${(activeRate.baseHourlyRateCents / 100).toFixed(2)}/hr
                                            {" · "}
                                            {EMPLOYMENT_TYPE_LABELS[activeRate.employmentType]}
                                            {activeRate.contractedWeeklyHours !== null
                                              ? ` · ${String(activeRate.contractedWeeklyHours)}h/wk`
                                              : ""}
                                            {" · "}
                                            Super {activeRate.superRatePercent}%
                                            {" · "}
                                            From {activeRate.effectiveFrom}
                                          </div>
                                        );
                                      })()}

                                      {/* Add / Update Rate form — write permission required */}
                                      {user.permissions.includes("payroll:rates:write") ? (
                                        <>
                                          {payRateForm ? (
                                            <div
                                              role="form"
                                              aria-label="Add or update pay rate"
                                            >
                                              <div className="product-form__grid">
                                                <label>
                                                  Base hourly rate ($)
                                                  <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0.01"
                                                    value={payRateForm.baseHourlyRateDollars}
                                                    onChange={(e) => {
                                                      setPayRateForm((s) => s && { ...s, baseHourlyRateDollars: e.target.value });
                                                    }}
                                                    required
                                                    placeholder="e.g. 45.00"
                                                  />
                                                </label>

                                                <label>
                                                  Employment type
                                                  <select
                                                    value={payRateForm.employmentType}
                                                    onChange={(e) => {
                                                      setPayRateForm((s) => s && { ...s, employmentType: e.target.value as EmploymentType });
                                                    }}
                                                    aria-label="Employment type"
                                                  >
                                                    {EMPLOYMENT_TYPES.map((t) => (
                                                      <option key={t} value={t}>
                                                        {EMPLOYMENT_TYPE_LABELS[t]}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </label>

                                                <label>
                                                  Contracted weekly hours (optional)
                                                  <input
                                                    type="number"
                                                    step="0.5"
                                                    min="0"
                                                    max="168"
                                                    value={payRateForm.contractedWeeklyHours}
                                                    onChange={(e) => {
                                                      setPayRateForm((s) => s && { ...s, contractedWeeklyHours: e.target.value });
                                                    }}
                                                    placeholder="e.g. 38"
                                                  />
                                                </label>

                                                <label>
                                                  Superannuation rate (%)
                                                  <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    value={payRateForm.superRatePercent}
                                                    onChange={(e) => {
                                                      setPayRateForm((s) => s && { ...s, superRatePercent: e.target.value });
                                                    }}
                                                    required
                                                    aria-label="Superannuation rate percent"
                                                  />
                                                  <span className="inventory-page__subtitle" style={{ fontSize: "0.8rem" }}>
                                                    Standard SG rate is prefilled. Adjust if this employee receives a different employer contribution.
                                                  </span>
                                                </label>

                                                <label>
                                                  Effective from (YYYY-MM-DD)
                                                  <input
                                                    type="date"
                                                    value={payRateForm.effectiveFrom}
                                                    onChange={(e) => {
                                                      setPayRateForm((s) => s && { ...s, effectiveFrom: e.target.value });
                                                    }}
                                                    required
                                                    aria-label="Effective from date"
                                                  />
                                                </label>
                                              </div>

                                              {payRateForm.error ? (
                                                <p className="status-card__error">{payRateForm.error}</p>
                                              ) : null}

                                              <div className="product-form__actions">
                                                <button
                                                  type="button"
                                                  disabled={payRateForm.isSubmitting}
                                                  onClick={() => { void handleSubmitPayRateDirect(); }}
                                                >
                                                  {payRateForm.isSubmitting ? "Saving rate…" : "Save rate"}
                                                </button>
                                                <button
                                                  type="button"
                                                  className="link-button"
                                                  onClick={() => { setPayRateForm(null); }}
                                                  disabled={payRateForm.isSubmitting}
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <button
                                              type="button"
                                              className="link-button"
                                              onClick={openPayRateForm}
                                            >
                                              + Add / Update Rate
                                            </button>
                                          )}
                                        </>
                                      ) : null}
                                    </>
                                  )}
                                </div>
                              ) : null}

                              <div className="product-form__actions">
                                <button type="submit" disabled={editState.isSubmitting}>
                                  {editState.isSubmitting ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={closeEdit}
                                  disabled={editState.isSubmitting}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}

                      {/* Inline reset-password panel */}
                      {isResettingThis && !resetState.success ? (
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

                      {/* Module access panel — owner_admin only */}
                      {isAdmin && moduleAccess?.userId === u.id ? (
                        <tr key={`${u.id}-module-access`}>
                          <td colSpan={5}>
                            <div className="product-form" aria-label={`Module access for ${u.email}`}>
                              <h3 style={{ marginBottom: "0.75rem" }}>Module access — {nameLabel(u)}</h3>
                              {u.role === "owner_admin" ? (
                                <p className="inventory-page__subtitle">
                                  Owner / Admins have full access to all modules by role.
                                </p>
                              ) : moduleAccess.isLoading ? (
                                <p className="loading-message">Loading module permissions…</p>
                              ) : moduleAccess.error ? (
                                <p className="status-card__error">{moduleAccess.error}</p>
                              ) : (
                                <>
                                  <p className="inventory-page__subtitle" style={{ marginBottom: "1rem" }}>
                                    Toggle which operational modules this user can access. Changes take effect on their next login.
                                  </p>
                                  <div className="inventory-table-wrapper">
                                    <table className="inventory-table">
                                      <thead>
                                        <tr>
                                          <th>Module</th>
                                          <th>Access</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {MODULE_ITEMS
                                          .filter((m) => m.roles.includes(u.role))
                                          .map((m) => {
                                            const active = moduleAccess.activePermissions.has(m.permission);
                                            const isSaving = moduleAccess.isSaving === m.permission;
                                            return (
                                              <tr key={m.permission}>
                                                <td>{m.label}</td>
                                                <td>
                                                  <input
                                                    type="checkbox"
                                                    checked={active}
                                                    disabled={isSaving}
                                                    aria-label={`${m.label} access`}
                                                    onChange={(e) => {
                                                      void handlePermissionToggle(u, m.permission, e.target.checked);
                                                    }}
                                                  />
                                                  {isSaving ? <span style={{ marginLeft: "0.5rem" }}>…</span> : null}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="product-form__actions">
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => { setModuleAccess(null); }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}

                      {/* Clinic access panel — owner_admin only */}
                      {isAdmin && clinicAccess?.userId === u.id ? (
                        <tr key={`${u.id}-clinic-access`}>
                          <td colSpan={5}>
                            <div className="product-form" aria-label={`Clinic access for ${u.email}`}>
                              <h3 style={{ marginBottom: "0.75rem" }}>
                                Clinic access — {nameLabel(u)}
                              </h3>
                              <p className="inventory-page__subtitle" style={{ marginBottom: "1rem" }}>
                                Home clinic: <strong>{u.homeClinicName}</strong>
                                {" · "}
                                Home clinic assignments cannot be removed here.
                              </p>

                              {clinicAccess.isLoading ? (
                                <p className="loading-message">Loading assignments…</p>
                              ) : clinicAccess.error ? (
                                <p className="status-card__error">{clinicAccess.error}</p>
                              ) : (
                                <>
                                  <div className="inventory-table-wrapper">
                                    <table className="inventory-table">
                                      <thead>
                                        <tr>
                                          <th>Clinic</th>
                                          <th>Can be rostered</th>
                                          <th>Operational access</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {clinicAccess.availableClinics.map((clinic) => {
                                          const asgn = clinicAccess.assignments.find(
                                            (a) => a.clinicId === clinic.id,
                                          );
                                          const canRoster = asgn?.canRoster ?? false;
                                          const canOperate = asgn?.canOperate ?? false;
                                          const isHome = clinic.id === u.homeClinicId;
                                          return (
                                            <tr key={clinic.id}>
                                              <td>
                                                {clinic.name}
                                                {isHome ? (
                                                  <span className="inventory-badge" style={{ marginLeft: "0.5rem" }}>
                                                    Home
                                                  </span>
                                                ) : null}
                                              </td>
                                              <td>
                                                <input
                                                  type="checkbox"
                                                  checked={canRoster}
                                                  disabled={isHome}
                                                  aria-label={`Can roster at ${clinic.name}`}
                                                  onChange={(e) => {
                                                    toggleAssignment(clinic.id, "canRoster", e.target.checked);
                                                  }}
                                                />
                                              </td>
                                              <td>
                                                <input
                                                  type="checkbox"
                                                  checked={canOperate}
                                                  disabled={isHome}
                                                  aria-label={`Operational access at ${clinic.name}`}
                                                  onChange={(e) => {
                                                    toggleAssignment(clinic.id, "canOperate", e.target.checked);
                                                  }}
                                                />
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="product-form__actions">
                                    <button
                                      type="button"
                                      disabled={clinicAccess.isSaving}
                                      onClick={() => void saveClinicAccess(u)}
                                    >
                                      {clinicAccess.isSaving ? "Saving…" : "Save clinic access"}
                                    </button>
                                    <button
                                      type="button"
                                      className="link-button"
                                      disabled={clinicAccess.isSaving}
                                      onClick={() => { setClinicAccess(null); }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
