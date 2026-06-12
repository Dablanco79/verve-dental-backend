import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { RosterEntry } from "../types/roster.js";
import { ROSTER_STATUS_LABELS, SHIFT_TYPE_LABELS } from "../types/roster.js";

const apiClient = createApiClient(loadConfig());

// ── Formatters ───────────────────────────────────────────────────────────────

function formatShiftDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function durationLabel(startIso: string, endIso: string): string {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const hours = diffMs / (1000 * 60 * 60);
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
}

// ── Component ────────────────────────────────────────────────────────────────

const LOOK_AHEAD_MS = 56 * 24 * 60 * 60 * 1000; // 8 weeks

export function MyShiftsPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + LOOK_AHEAD_MS).toISOString();
      const result = await apiClient.getMyShifts(user.homeClinicId, { from, to });
      setEntries(result.filter((e) => e.status !== "cancelled"));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load shifts");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  if (!user) return null;

  const upcoming = entries.filter((e) => new Date(e.shiftStartAt) >= new Date());
  const past = entries.filter((e) => new Date(e.shiftStartAt) < new Date());

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>My shifts</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} —{" "}
              {upcoming.length} upcoming shift{upcoming.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            className="button-link"
            onClick={() => void loadShifts()}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading your shifts…</p>
        ) : entries.length === 0 ? (
          <div className="my-shifts-empty">
            <p className="my-shifts-empty__title">No upcoming shifts scheduled.</p>
            <p className="my-shifts-empty__hint">
              Your manager will add shifts to the roster. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 ? (
              <ShiftGroup label="Upcoming" entries={upcoming} user={user} />
            ) : null}

            {past.length > 0 ? (
              <ShiftGroup label="Recent" entries={past} user={user} faded />
            ) : null}
          </>
        )}
      </section>
    </AppShell>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function ShiftGroup({
  label,
  entries,
  user,
  faded = false,
}: {
  label: string;
  entries: RosterEntry[];
  user: { homeClinicName: string };
  faded?: boolean;
}) {
  return (
    <div className={`my-shifts-group${faded ? " my-shifts-group--faded" : ""}`}>
      <h3 className="my-shifts-group__label">{label}</h3>
      <ul className="my-shifts-list" aria-label={`${label} shifts`}>
        {entries.map((entry) => (
          <li key={entry.id} className={`my-shift my-shift--${entry.status}`}>
            <div className="my-shift__date">{formatShiftDate(entry.shiftStartAt)}</div>

            <div className="my-shift__details">
              <span className="my-shift__time">
                {formatTimeRange(entry.shiftStartAt, entry.shiftEndAt)}
              </span>
              <span className="my-shift__duration">
                ({durationLabel(entry.shiftStartAt, entry.shiftEndAt)})
              </span>
              <span
                className={`my-shift__badge my-shift__badge--type-${entry.shiftType}`}
              >
                {SHIFT_TYPE_LABELS[entry.shiftType]}
              </span>
              <span
                className={`my-shift__badge my-shift__badge--status-${entry.status}`}
              >
                {ROSTER_STATUS_LABELS[entry.status]}
              </span>
            </div>

            {entry.rosteredClinicName !== user.homeClinicName ? (
              <div className="my-shift__cross-clinic">
                📍 {entry.rosteredClinicName}
              </div>
            ) : null}

            {entry.notes ? (
              <div className="my-shift__notes">{entry.notes}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
