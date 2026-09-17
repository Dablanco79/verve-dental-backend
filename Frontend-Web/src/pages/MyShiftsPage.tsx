import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { RosterEntry } from "../types/roster.js";
import { ROSTER_STATUS_LABELS, SHIFT_TYPE_LABELS } from "../types/roster.js";

const apiClient = createApiClient(loadConfig());

// ── Formatters ────────────────────────────────────────────────────────────────

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

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function durationLabel(startIso: string, endIso: string): string {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const hours = diffMs / (1000 * 60 * 60);
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
}

// ── Calendar date helpers ─────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isSameLocalDay(isoString: string, dayDate: Date): boolean {
  const d = new Date(isoString);
  return (
    d.getFullYear() === dayDate.getFullYear() &&
    d.getMonth() === dayDate.getMonth() &&
    d.getDate() === dayDate.getDate()
  );
}

function formatDayHeader(date: Date): { weekday: string; dayMonth: string } {
  return {
    weekday: date.toLocaleDateString("en-AU", { weekday: "short" }),
    dayMonth: date.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
  };
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const s = start.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const e = end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Load a 10-week window (5 weeks before + 5 weeks after today) so both
 * past and upcoming shifts are visible in the calendar.
 */
const LOOK_AHEAD_WEEKS = 5;
const LOOK_BACK_WEEKS = 5;

// ── Component ─────────────────────────────────────────────────────────────────

type DisplayMode = "list" | "calendar";
type CalendarView = "month" | "week";

export function MyShiftsPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayMode, setDisplayMode] = useState<DisplayMode>("list");
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());

  const loadShifts = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const from = new Date(Date.now() - LOOK_BACK_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + LOOK_AHEAD_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString();
      // Use the clinic-agnostic endpoint so shifts across ALL rostered clinics
      // are returned, not just the user's home clinic.
      const result = await apiClient.getMyShiftsAllClinics({ from, to });
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

  const now = new Date();
  const upcoming = entries.filter((e) => new Date(e.shiftStartAt) >= now);
  const past = entries.filter((e) => new Date(e.shiftStartAt) < now);

  // ── Calendar navigation ───────────────────────────────────────────────────

  function goBack() {
    setAnchorDate((d) => {
      if (calendarView === "week") return addDays(d, -7);
      return new Date(d.getFullYear(), d.getMonth() - 1, 1);
    });
  }

  function goForward() {
    setAnchorDate((d) => {
      if (calendarView === "week") return addDays(d, 7);
      return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    });
  }

  function getRangeLabel(): string {
    if (calendarView === "week") return formatWeekRange(getWeekStart(anchorDate));
    return anchorDate.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  }

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

          <div className="my-shifts-controls">
            {/* View toggle: List | Calendar */}
            <div
              className="my-shifts-view-toggle"
              role="group"
              aria-label="Shift view mode"
            >
              {(["list", "calendar"] as DisplayMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`my-shifts-toggle-btn${displayMode === mode ? " my-shifts-toggle-btn--active" : ""}`}
                  onClick={() => {
                    setDisplayMode(mode);
                  }}
                  aria-pressed={displayMode === mode}
                >
                  {mode === "list" ? "List" : "Calendar"}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="button-link"
              onClick={() => {
                void loadShifts();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading your shifts…</p>
        ) : displayMode === "list" ? (
          <MyShiftsList upcoming={upcoming} past={past} />
        ) : (
          <>
            {/* Calendar sub-controls */}
            <div className="my-shifts-cal-toolbar">
              <div
                className="my-shifts-cal-view-selector"
                role="group"
                aria-label="Calendar view"
              >
                {(["month", "week"] as CalendarView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`my-shifts-cal-btn${calendarView === v ? " my-shifts-cal-btn--active" : ""}`}
                    onClick={() => {
                      setCalendarView(v);
                    }}
                    aria-pressed={calendarView === v}
                  >
                    {v === "month" ? "Month" : "Week"}
                  </button>
                ))}
              </div>

              <div className="roster-cal__nav">
                <button
                  type="button"
                  className="roster-nav-btn"
                  onClick={goBack}
                  aria-label={`Previous ${calendarView}`}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="roster-cal__week-label">{getRangeLabel()}</span>
                <button
                  type="button"
                  className="roster-nav-btn"
                  onClick={goForward}
                  aria-label={`Next ${calendarView}`}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="roster-today-btn"
                  onClick={() => {
                    setAnchorDate(new Date());
                  }}
                >
                  Today
                </button>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="my-shifts-empty">
                <p className="my-shifts-empty__title">No shifts scheduled in this period.</p>
                <p className="my-shifts-empty__hint">
                  Your manager will add shifts to the roster. Check back soon.
                </p>
              </div>
            ) : calendarView === "month" ? (
              <MyShiftsMonthView entries={entries} anchorDate={anchorDate} />
            ) : (
              <MyShiftsWeekView entries={entries} anchorDate={anchorDate} />
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function MyShiftsList({
  upcoming,
  past,
}: {
  upcoming: RosterEntry[];
  past: RosterEntry[];
}) {
  if (upcoming.length === 0 && past.length === 0) {
    return (
      <div className="my-shifts-empty">
        <p className="my-shifts-empty__title">No upcoming shifts scheduled.</p>
        <p className="my-shifts-empty__hint">
          Your manager will add shifts to the roster. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <>
      {upcoming.length > 0 ? (
        <ShiftGroup label="Upcoming" entries={upcoming} />
      ) : null}
      {past.length > 0 ? (
        <ShiftGroup label="Recent" entries={past} faded />
      ) : null}
    </>
  );
}

function ShiftGroup({
  label,
  entries,
  faded = false,
}: {
  label: string;
  entries: RosterEntry[];
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

            {entry.rosteredClinicName ? (
              <div className="my-shift__clinic">
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

// ── Calendar: Month view ──────────────────────────────────────────────────────

function MyShiftsMonthView({
  entries,
  anchorDate,
}: {
  entries: RosterEntry[];
  anchorDate: Date;
}) {
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const gridStart = getWeekStart(monthStart);
  const gridDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  // Expanded day state: show all shifts for a day
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  return (
    <div className="my-shifts-month-view">
      <div className="my-shifts-month-grid">
        {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((d) => (
          <div key={d} className="my-shifts-month__col-head">
            {d}
          </div>
        ))}

        {gridDays.map((dayDate) => {
          const isInMonth = dayDate.getMonth() === month;
          const isToday = isSameLocalDay(today.toISOString(), dayDate);
          const dayKey = `${String(dayDate.getFullYear())}-${pad(dayDate.getMonth() + 1)}-${pad(dayDate.getDate())}`;
          const isExpanded = expandedDay === dayKey;

          const dayEntries = entries
            .filter((e) => isSameLocalDay(e.shiftStartAt, dayDate))
            .sort(
              (a, b) => new Date(a.shiftStartAt).getTime() - new Date(b.shiftStartAt).getTime(),
            );

          const MAX = 2;
          const shown = isExpanded ? dayEntries : dayEntries.slice(0, MAX);
          const rest = !isExpanded ? dayEntries.length - shown.length : 0;

          return (
            <div
              key={dayKey}
              className={[
                "my-shifts-month-cell",
                isInMonth ? "" : "my-shifts-month-cell--out",
                isToday ? "my-shifts-month-cell--today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="my-shifts-month-cell__num">{dayDate.getDate()}</span>

              <div className="my-shifts-month-cell__entries">
                {shown.map((entry) => (
                  <div
                    key={entry.id}
                    className={`my-shifts-month-entry my-shifts-month-entry--${entry.status}`}
                    title={`${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)} · ${entry.rosteredClinicName}`}
                  >
                    <span
                      className={`my-shifts-month-entry__dot my-shifts-month-entry__dot--${entry.status}`}
                      aria-hidden="true"
                    />
                    <span className="my-shifts-month-entry__time">
                      {formatTime(entry.shiftStartAt)}
                    </span>
                    <span className="my-shifts-month-entry__clinic">
                      {shortClinicName(entry.rosteredClinicName)}
                    </span>
                    <span
                      className={`my-shifts-month-entry__status my-shifts-month-entry__status--${entry.status}`}
                    >
                      {ROSTER_STATUS_LABELS[entry.status]}
                    </span>
                  </div>
                ))}

                {rest > 0 ? (
                  <button
                    type="button"
                    className="my-shifts-month-cell__more"
                    onClick={() => {
                      setExpandedDay(dayKey);
                    }}
                  >
                    +{rest} more
                  </button>
                ) : null}

                {isExpanded && dayEntries.length > MAX ? (
                  <button
                    type="button"
                    className="my-shifts-month-cell__collapse"
                    onClick={() => {
                      setExpandedDay(null);
                    }}
                  >
                    Show less
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendar: Week view ───────────────────────────────────────────────────────

function MyShiftsWeekView({
  entries,
  anchorDate,
}: {
  entries: RosterEntry[];
  anchorDate: Date;
}) {
  const weekStart = getWeekStart(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div className="my-shifts-week-view">
      <div className="my-shifts-week-grid">
        {days.map((dayDate) => {
          const isToday = isSameLocalDay(today.toISOString(), dayDate);
          const { weekday, dayMonth } = formatDayHeader(dayDate);
          const dayKey = dayDate.toISOString();

          const dayEntries = entries
            .filter((e) => isSameLocalDay(e.shiftStartAt, dayDate))
            .sort(
              (a, b) => new Date(a.shiftStartAt).getTime() - new Date(b.shiftStartAt).getTime(),
            );

          return (
            <div
              key={dayKey}
              className={`my-shifts-week-day${isToday ? " my-shifts-week-day--today" : ""}`}
            >
              <div className="my-shifts-week-day__head">
                <span className="my-shifts-week-day__weekday">{weekday}</span>
                <span className="my-shifts-week-day__date">{dayMonth}</span>
              </div>

              <div className="my-shifts-week-day__shifts">
                {dayEntries.length === 0 ? (
                  <p className="my-shifts-week-empty">—</p>
                ) : (
                  dayEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`my-shifts-week-card my-shifts-week-card--${entry.status}`}
                    >
                      <div className="my-shifts-week-card__time">
                        {formatTime(entry.shiftStartAt)}–{formatTime(entry.shiftEndAt)}
                      </div>
                      <div className="my-shifts-week-card__clinic">
                        📍 {entry.rosteredClinicName}
                      </div>
                      <div className="my-shifts-week-card__meta">
                        <span
                          className={`my-shifts-week-card__type my-shifts-week-card__type--${entry.shiftType}`}
                        >
                          {SHIFT_TYPE_LABELS[entry.shiftType]}
                        </span>
                        <span
                          className={`my-shifts-week-card__status my-shifts-week-card__status--${entry.status}`}
                        >
                          {ROSTER_STATUS_LABELS[entry.status]}
                        </span>
                      </div>
                      {entry.notes ? (
                        <div className="my-shifts-week-card__notes">{entry.notes}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Short clinic label for compact cells.
 * "Bentleigh East Dental" → "Bentleigh East"
 */
function shortClinicName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length >= 3) return `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
  if (words.length === 2) return name;
  return name.slice(0, 14);
}
