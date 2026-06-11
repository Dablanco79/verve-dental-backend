import { useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import { AppShell } from "../components/layout/AppShell.js";
import type { HealthResponse } from "../types/index.js";

const apiClient = createApiClient(loadConfig());

export function HomePage() {
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
