import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { ClinicData, UpdateClinicData } from "../types/clinic.js";
import { canViewClinicSettings } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ─── Constants ────────────────────────────────────────────────────────────────

const AU_TIMEZONES = [
  { value: "Australia/Sydney",    label: "Sydney / Canberra (AEST/AEDT)"   },
  { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)"           },
  { value: "Australia/Brisbane",  label: "Brisbane (AEST — no DST)"        },
  { value: "Australia/Adelaide",  label: "Adelaide (ACST/ACDT)"            },
  { value: "Australia/Perth",     label: "Perth (AWST)"                    },
  { value: "Australia/Hobart",    label: "Hobart (AEST/AEDT)"             },
  { value: "Australia/Darwin",    label: "Darwin (ACST — no DST)"          },
] as const;

const AU_STATES = [
  { value: "ACT", label: "ACT — Australian Capital Territory" },
  { value: "NSW", label: "NSW — New South Wales"              },
  { value: "NT",  label: "NT — Northern Territory"            },
  { value: "QLD", label: "QLD — Queensland"                   },
  { value: "SA",  label: "SA — South Australia"               },
  { value: "TAS", label: "TAS — Tasmania"                     },
  { value: "VIC", label: "VIC — Victoria"                     },
  { value: "WA",  label: "WA — Western Australia"             },
] as const;

const TIER_LABELS: Record<string, string> = {
  standard:   "Standard",
  premium:    "Premium",
  enterprise: "Enterprise",
};

// ─── Form types ───────────────────────────────────────────────────────────────

type FormValues = {
  name: string;
  abn: string;
  addressLine1: string;
  suburb: string;
  state: string;
  postcode: string;
  timezone: string;
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function clinicToForm(clinic: ClinicData): FormValues {
  return {
    name:        clinic.name,
    abn:         clinic.abn ?? "",
    addressLine1: clinic.addressLine1 ?? "",
    suburb:      clinic.suburb ?? "",
    state:       clinic.state ?? "",
    postcode:    clinic.postcode ?? "",
    timezone:    clinic.timezone,
  };
}

/**
 * Strips all whitespace and hyphens from an ABN string for validation and
 * submission.  Standard AU display format is "XX XXX XXX XXX" or
 * "XX-XXX-XXX-XXX"; the backend stores and accepts the digit-only form.
 */
function normaliseAbn(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

function validateForm(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  const name = values.name.trim();
  if (name.length < 3) {
    errors.name = "Clinic name must be at least 3 characters.";
  } else if (name.length > 100) {
    errors.name = "Clinic name must be 100 characters or fewer.";
  }

  const abn = normaliseAbn(values.abn);
  if (abn.length > 0 && !/^\d{9,11}$/.test(abn)) {
    errors.abn = "ABN must be 9–11 digits (spaces and hyphens are stripped automatically).";
  }

  const postcode = values.postcode.trim();
  if (postcode.length > 0 && !/^\d{4}$/.test(postcode)) {
    errors.postcode = "Postcode must be exactly 4 digits.";
  }

  return errors;
}

function buildPayload(values: FormValues): UpdateClinicData {
  const abn = normaliseAbn(values.abn);
  return {
    name:        values.name.trim(),
    abn:         abn.length > 0 ? abn : null,
    addressLine1: values.addressLine1.trim() || null,
    suburb:      values.suburb.trim() || null,
    state:       values.state !== "" ? (values.state) : null,
    postcode:    values.postcode.trim() || null,
    timezone:    values.timezone,
  };
}

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClinicSettingsPage() {
  const { user } = useAuth();

  const [clinic,       setClinic]       = useState<ClinicData | null>(null);
  const [form,         setForm]         = useState<FormValues | null>(null);
  const [isFetching,   setIsFetching]   = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors,  setFieldErrors]  = useState<FieldErrors>({});
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const isReadOnly = user?.role !== "owner_admin";

  const loadClinic = useCallback(async () => {
    if (!user) return;
    setIsFetching(true);
    setFetchError(null);
    setSubmitSuccess(false);
    try {
      const data = await apiClient.getClinic(user.homeClinicId);
      setClinic(data);
      setForm(clinicToForm(data));
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Unable to load clinic settings.");
    } finally {
      setIsFetching(false);
    }
  }, [user]);

  useEffect(() => {
    void loadClinic();
  }, [loadClinic]);

  // clinical_staff must not access this page — redirect immediately.
  if (user && !canViewClinicSettings(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (!user) return null;

  // ── Field change handler ─────────────────────────────────────────────────

  function handleChange(
    field: keyof FormValues,
    value: string,
  ): void {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
    // Clear the field's inline error as the user types.
    if (fieldErrors[field]) {
      setFieldErrors((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([k]) => k !== field),
        ),
      );
    }
    setSubmitSuccess(false);
    setSubmitError(null);
  }

  // ── Submit handler ───────────────────────────────────────────────────────

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form || !clinic) return;

    setSubmitError(null);
    setSubmitSuccess(false);

    const errors = validateForm(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const updated = await apiClient.updateClinicSettings(
        clinic.id,
        buildPayload(form),
      );
      setClinic(updated);
      setForm(clinicToForm(updated));
      setSubmitSuccess(true);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save clinic settings.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* ── Header card ──────────────────────────────────────────────── */}
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Clinic settings</h2>
            <p className="inventory-page__subtitle">
              {clinic?.name ?? user.homeClinicName}
              {clinic ? ` — last updated ${formatUpdatedAt(clinic.updatedAt)}` : ""}
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={() => void loadClinic()}
              disabled={isFetching || isSubmitting}
            >
              {isFetching ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Read-only notice for group_practice_manager ─────────────── */}
        {isReadOnly ? (
          <p className="inventory-notice inventory-notice--info cs-readonly-notice" role="note">
            <strong>View only.</strong> Only the practice owner can update clinic
            settings. Contact your <em>owner_admin</em> to request changes.
          </p>
        ) : null}
      </section>

      {/* ── Content states ────────────────────────────────────────────── */}
      {fetchError ? (
        <section className="status-card">
          <p className="status-card__error" role="alert">{fetchError}</p>
        </section>
      ) : isFetching || !form || !clinic ? (
        <section className="status-card">
          <p className="loading-message">Loading clinic settings…</p>
        </section>
      ) : (
        <>
          {/* ── Settings form ─────────────────────────────────────────── */}
          <section className="status-card">
            {submitSuccess ? (
              <p className="inventory-notice" role="status">
                Clinic settings saved successfully.
              </p>
            ) : null}

            {submitError ? (
              <p className="status-card__error" role="alert">{submitError}</p>
            ) : null}

            <form
              className="product-form"
              onSubmit={(e) => { void handleSubmit(e); }}
              aria-label="Clinic settings"
              noValidate
            >
              {/* ── Section 1: Practice profile ─────────────────────── */}
              <fieldset className="product-form__section">
                <legend>Practice profile</legend>

                <div className="product-form__grid">
                  {/* Clinic name */}
                  <label className="product-form__full">
                    Clinic name
                    <span className="cs-required" aria-hidden="true"> *</span>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => { handleChange("name", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      required
                      minLength={3}
                      maxLength={100}
                      placeholder="e.g. Verve Dental Clinic A"
                      aria-describedby={fieldErrors.name ? "err-name" : undefined}
                      aria-invalid={!!fieldErrors.name}
                    />
                    {fieldErrors.name ? (
                      <span id="err-name" className="cs-field-error" role="alert">
                        {fieldErrors.name}
                      </span>
                    ) : null}
                  </label>

                  {/* ABN */}
                  <label>
                    Australian Business Number (ABN)
                    <input
                      type="text"
                      value={form.abn}
                      onChange={(e) => { handleChange("abn", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      placeholder="e.g. 12 345 678 901"
                      inputMode="numeric"
                      maxLength={14}
                      aria-describedby={fieldErrors.abn ? "err-abn" : "hint-abn"}
                      aria-invalid={!!fieldErrors.abn}
                    />
                    {fieldErrors.abn ? (
                      <span id="err-abn" className="cs-field-error" role="alert">
                        {fieldErrors.abn}
                      </span>
                    ) : (
                      <span id="hint-abn" className="cs-field-hint">
                        11 digits — spaces and hyphens are stripped automatically
                      </span>
                    )}
                  </label>

                  {/* Timezone */}
                  <label>
                    Timezone
                    <select
                      value={form.timezone}
                      onChange={(e) => { handleChange("timezone", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      aria-invalid={!!fieldErrors.timezone}
                    >
                      {AU_TIMEZONES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Subscription tier — always read-only */}
                  <div className="cs-tier-row">
                    <span className="cs-tier-label">Subscription tier</span>
                    <span className={`cs-tier-badge cs-tier-badge--${clinic.subscriptionTier}`}>
                      {TIER_LABELS[clinic.subscriptionTier] ?? clinic.subscriptionTier}
                    </span>
                    <span className="cs-field-hint">
                      Tier changes require a billing workflow — contact support.
                    </span>
                  </div>
                </div>
              </fieldset>

              {/* ── Section 2: Address ──────────────────────────────── */}
              <fieldset className="product-form__section">
                <legend>Address</legend>

                <div className="product-form__grid">
                  {/* Address line 1 */}
                  <label className="product-form__full">
                    Street address
                    <input
                      type="text"
                      value={form.addressLine1}
                      onChange={(e) => { handleChange("addressLine1", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      placeholder="e.g. Level 2, 123 Pitt Street"
                      maxLength={255}
                    />
                  </label>

                  {/* Suburb */}
                  <label>
                    Suburb
                    <input
                      type="text"
                      value={form.suburb}
                      onChange={(e) => { handleChange("suburb", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      placeholder="e.g. Sydney"
                      maxLength={128}
                    />
                  </label>

                  {/* State */}
                  <label>
                    State / Territory
                    <select
                      value={form.state}
                      onChange={(e) => { handleChange("state", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                    >
                      <option value="">— Select state —</option>
                      {AU_STATES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Postcode */}
                  <label>
                    Postcode
                    <input
                      type="text"
                      value={form.postcode}
                      onChange={(e) => { handleChange("postcode", e.target.value); }}
                      disabled={isReadOnly || isSubmitting}
                      placeholder="e.g. 2000"
                      inputMode="numeric"
                      maxLength={4}
                      aria-describedby={fieldErrors.postcode ? "err-postcode" : undefined}
                      aria-invalid={!!fieldErrors.postcode}
                    />
                    {fieldErrors.postcode ? (
                      <span id="err-postcode" className="cs-field-error" role="alert">
                        {fieldErrors.postcode}
                      </span>
                    ) : null}
                  </label>
                </div>
              </fieldset>

              {/* ── Save actions — owner_admin only ─────────────────── */}
              {!isReadOnly ? (
                <div className="product-form__actions cs-actions">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                  >
                    {isSubmitting ? "Saving…" : "Save settings"}
                  </button>
                  <button
                    type="button"
                    className="cs-actions__reset"
                    disabled={isSubmitting}
                    onClick={() => {
                      setForm(clinicToForm(clinic));
                      setFieldErrors({});
                      setSubmitError(null);
                      setSubmitSuccess(false);
                    }}
                  >
                    Reset
                  </button>
                </div>
              ) : null}
            </form>
          </section>

          {/* ── Metadata card ─────────────────────────────────────────── */}
          <section className="status-card">
            <h3 className="cs-meta__heading">Record metadata</h3>
            <dl className="account-details">
              <div className="account-details__row">
                <dt>Clinic ID</dt>
                <dd><code className="cs-meta__code">{clinic.id}</code></dd>
              </div>
              <div className="account-details__row">
                <dt>Status</dt>
                <dd>
                  <span className={`cs-status-badge cs-status-badge--${clinic.isActive ? "active" : "inactive"}`}>
                    {clinic.isActive ? "Active" : "Inactive"}
                  </span>
                </dd>
              </div>
              <div className="account-details__row">
                <dt>Created</dt>
                <dd>{formatUpdatedAt(clinic.createdAt)}</dd>
              </div>
              <div className="account-details__row">
                <dt>Last updated</dt>
                <dd>{formatUpdatedAt(clinic.updatedAt)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </AppShell>
  );
}
