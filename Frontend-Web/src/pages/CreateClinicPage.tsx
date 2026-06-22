import React, { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { UpdateClinicData } from "../types/clinic.js";
import { canManageClinics } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ─── Constants (mirrors ClinicSettingsPage) ───────────────────────────────────

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

// ─── Form types ───────────────────────────────────────────────────────────────

type FormValues = {
  name:        string;
  abn:         string;
  addressLine1: string;
  suburb:      string;
  state:       string;
  postcode:    string;
  timezone:    string;
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;

// ─── Pure helpers (mirrors ClinicSettingsPage) ────────────────────────────────

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

/**
 * Builds the optional PATCH payload from form values.
 * Only called when at least one of the optional fields is non-empty.
 */
function buildOptionalPayload(values: FormValues): UpdateClinicData {
  const abn = normaliseAbn(values.abn);
  return {
    abn:         abn.length > 0 ? abn : null,
    addressLine1: values.addressLine1.trim() || null,
    suburb:      values.suburb.trim() || null,
    state:       values.state !== "" ? values.state : null,
    postcode:    values.postcode.trim() || null,
  };
}

function hasOptionalFields(values: FormValues): boolean {
  return (
    normaliseAbn(values.abn).length > 0 ||
    values.addressLine1.trim().length > 0 ||
    values.suburb.trim().length > 0 ||
    values.state !== "" ||
    values.postcode.trim().length > 0
  );
}

const EMPTY_FORM: FormValues = {
  name:        "",
  abn:         "",
  addressLine1: "",
  suburb:      "",
  state:       "",
  postcode:    "",
  timezone:    "Australia/Melbourne",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateClinicPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form,         setForm]         = useState<FormValues>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors,  setFieldErrors]  = useState<FieldErrors>({});
  const [submitError,  setSubmitError]  = useState<string | null>(null);

  // owner_admin only.
  if (user && !canManageClinics(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (!user) return null;

  // ── Field change handler ─────────────────────────────────────────────────

  function handleChange(field: keyof FormValues, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field)),
      );
    }
    setSubmitError(null);
  }

  // ── Submit handler ───────────────────────────────────────────────────────
  //
  // The backend POST /clinics schema only accepts { name, timezone }.
  // ABN/address fields are applied in a subsequent PATCH if any are provided.
  // Both calls are transparent to the user — they see a single form action.

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setSubmitError(null);

    const errors = validateForm(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      // Step 1: create the clinic record (name + timezone).
      const newClinic = await apiClient.createClinic({
        name:     form.name.trim(),
        timezone: form.timezone,
      });

      // Step 2: if optional detail fields were filled in, patch them now.
      if (hasOptionalFields(form)) {
        await apiClient.updateClinicSettings(newClinic.id, buildOptionalPayload(form));
      }

      await navigate("/settings/clinics");
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create clinic.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Add new clinic</h2>
            <p className="inventory-page__subtitle">
              Create a new clinic location for your organisation.
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/settings/clinics" className="button-link">
              ← Back to clinics
            </Link>
          </div>
        </div>
      </section>

      {/* ── Form ────────────────────────────────────────────────────────── */}
      <section className="status-card">
        {submitError ? (
          <p className="status-card__error" role="alert">{submitError}</p>
        ) : null}

        <form
          className="product-form"
          onSubmit={(e) => { void handleSubmit(e); }}
          aria-label="Add new clinic"
          noValidate
        >
          {/* ── Section 1: Practice profile ─────────────────────────── */}
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
                  disabled={isSubmitting}
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="e.g. Verve Dental Clinic B"
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
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
                >
                  {AU_TIMEZONES.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          {/* ── Section 2: Address ──────────────────────────────────── */}
          <fieldset className="product-form__section">
            <legend>Address</legend>

            <div className="product-form__grid">
              {/* Street address */}
              <label className="product-form__full">
                Street address
                <input
                  type="text"
                  value={form.addressLine1}
                  onChange={(e) => { handleChange("addressLine1", e.target.value); }}
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
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

          {/* ── Actions ─────────────────────────────────────────────── */}
          <div className="product-form__actions cs-actions">
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Creating…" : "Create clinic"}
            </button>
            <Link
              to="/settings/clinics"
              className="cs-actions__reset"
              aria-disabled={isSubmitting}
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
