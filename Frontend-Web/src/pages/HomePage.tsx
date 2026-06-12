import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { HealthResponse } from "../types/index.js";

const apiClient = createApiClient(loadConfig());

export function HomePage() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiClient
      .getHealth()
      .then((response) => {
        if (!cancelled) {
          setHealth(response);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unable to reach the API";
          setError(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <h2>Dashboard</h2>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
        </div>

        {user ? (
          <dl>
            <div>
              <dt>Signed in as</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{user.role}</dd>
            </div>
            <div>
              <dt>Home clinic</dt>
              <dd>{user.homeClinicName}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="status-card">
        <h2>Quick links</h2>
        <p>
          <Link to="/inventory">Open clinic inventory</Link> to scan barcodes and review stock levels.
        </p>
      </section>

      <section className="status-card">
        <h2>Platform status</h2>
        {health ? (
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{health.status}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{health.service}</dd>
            </div>
            <div>
              <dt>Timestamp</dt>
              <dd>{health.timestamp}</dd>
            </div>
          </dl>
        ) : null}
        {error ? <p className="status-card__error">{error}</p> : null}
        {!health && !error ? <p>Checking backend health…</p> : null}
      </section>
    </AppShell>
  );
}
