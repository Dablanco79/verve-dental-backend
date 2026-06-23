import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { ClinicData } from "../types/clinic.js";
import { canManageClinics } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ─── Timezone display helper ──────────────────────────────────────────────────

const TZ_SHORT: Record<string, string> = {
  "Australia/Sydney":    "AEST/AEDT",
  "Australia/Melbourne": "AEST/AEDT",
  "Australia/Brisbane":  "AEST",
  "Australia/Adelaide":  "ACST/ACDT",
  "Australia/Perth":     "AWST",
  "Australia/Hobart":    "AEST/AEDT",
  "Australia/Darwin":    "ACST",
  "Australia/Lord_Howe": "LHST",
};

function tzLabel(tz: string): string {
  const city = tz.split("/")[1]?.replace(/_/g, " ") ?? tz;
  const abbr = TZ_SHORT[tz];
  return abbr ? `${city} (${abbr})` : city;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClinicsListPage() {
  const { user } = useAuth();
  const [clinics,    setClinics]    = useState<ClinicData[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setIsFetching(true);
    setFetchError(null);
    apiClient
      .listClinics()
      .then((data) => { setClinics(data); })
      .catch((err: unknown) => {
        setFetchError(
          err instanceof Error ? err.message : "Unable to load clinics.",
        );
      })
      .finally(() => { setIsFetching(false); });
  }, [user]);

  // owner_admin only — redirect everyone else to the dashboard.
  if (user && !canManageClinics(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (!user) return null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Clinics</h2>
            <p className="inventory-page__subtitle">
              {isFetching
                ? "Loading…"
                : `${String(clinics.length)} clinic${clinics.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/settings/clinics/new" className="button-link">
              Add clinic
            </Link>
          </div>
        </div>
      </section>

      {/* ── Content states ────────────────────────────────────────────────── */}
      {fetchError ? (
        <section className="status-card">
          <p className="status-card__error" role="alert">{fetchError}</p>
        </section>
      ) : isFetching ? (
        <section className="status-card">
          <p className="loading-message">Loading clinics…</p>
        </section>
      ) : clinics.length === 0 ? (
        <section className="status-card">
          <p>No clinics found.</p>
        </section>
      ) : (
        <section className="status-card">
          <table className="users-table" aria-label="Clinics">
            <thead>
              <tr>
                <th>Name</th>
                <th>Timezone</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {clinics.map((clinic) => (
                <tr key={clinic.id}>
                  <td>{clinic.name}</td>
                  <td>{tzLabel(clinic.timezone)}</td>
                  <td>
                    <span
                      className={`cs-status-badge cs-status-badge--${
                        clinic.isActive ? "active" : "inactive"
                      }`}
                    >
                      {clinic.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/settings/clinics/${clinic.id}/edit`}
                      className="button-link"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </AppShell>
  );
}
