import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { loadConfig } from "../config/index.js";

// Slimmer staff type used for the roster-eligible staff selector.
// The full StaffUser shape is not needed here — only identity fields.
type EligibleStaff = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};
import type {
  RosterEntry,
  ShiftType,
} from "../types/roster.js";
import {
  ALL_SHIFT_TYPES,
  ROSTER_STATUS_LABELS,
  SHIFT_TYPE_LABELS,
} from "../types/roster.js";
import { canManageRoster } from "../utils/roles.js";
import { staffDisplayName, staffLabelFromEmail } from "../utils/staffName.js";

const apiClient = createApiClient(loadConfig());

// ── View mode ─────────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month" | "two_months" | "quarter";

const VIEW_MODES: ViewMode[] = ["day", "week", "month", "two_months", "quarter"];

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  two_months: "2 Months",
  quarter: "Quarter",
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun, 1 = Mon … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
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

/** Compare a UTC ISO string's local calendar date against a local Date. */
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
  const e = end.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${s} – ${e}`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "YYYY-MM-DD" from a local Date */
function toDateInput(date: Date): string {
  return `${date.getFullYear().toString()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "HH:mm" from a UTC ISO string, displayed in local time */
function toTimeInput(isoString: string): string {
  const d = new Date(isoString);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combine a local date "YYYY-MM-DD" + local time "HH:mm" into a UTC ISO string.
 * new Date("YYYY-MM-DDTHH:mm") parses as local time per the ECMAScript spec.
 */
function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

/** Staff initials for compact month/overview cells */
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Short clinic label for compact cells.
 * "Bentleigh East Dental" → "Bentleigh East"
 * Falls back to first 14 chars for single-word or very long names.
 */
function shortClinicName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length >= 3) return `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
  if (words.length === 2) return name;
  return name.slice(0, 14);
}

// ── Local state types ─────────────────────────────────────────────────────────

type ShiftFormState = {
  staffUserId: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  notes: string;
};

function blankForm(date = ""): ShiftFormState {
  return {
    staffUserId: "",
    date,
    startTime: "08:00",
    endTime: "17:00",
    shiftType: "standard",
    notes: "",
  };
}

function formFromEntry(entry: RosterEntry): ShiftFormState {
  return {
    staffUserId: entry.staffUserId,
    date: toDateInput(new Date(entry.shiftStartAt)),
    startTime: toTimeInput(entry.shiftStartAt),
    endTime: toTimeInput(entry.shiftEndAt),
    shiftType: entry.shiftType,
    notes: entry.notes ?? "",
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RosterCalendarPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();

  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [staffList, setStaffList] = useState<EligibleStaff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<RosterEntry | null>(null);
  const [form, setForm] = useState<ShiftFormState>(blankForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canWrite = user ? canManageRoster(user.role) : false;

  /** Resolve the best display name for a roster entry's staff member. */
  function resolveStaffName(userId: string, email: string): string {
    const found = staffList.find((s) => s.id === userId);
    return found ? staffDisplayName(found) : staffLabelFromEmail(email);
  }

  const loadEntries = useCallback(async () => {
    if (!user || !clinicId) {
      setIsLoading(false);
      return;
    }
    // 2-month and quarter are pre-pilot placeholders — do not load data
    if (viewMode === "two_months" || viewMode === "quarter") {
      setIsLoading(false);
      setEntries([]);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      let from: string;
      let to: string;

      if (viewMode === "day") {
        const dayStart = new Date(anchorDate);
        dayStart.setHours(0, 0, 0, 0);
        from = dayStart.toISOString();
        to = addDays(dayStart, 1).toISOString();
      } else if (viewMode === "week") {
        const ws = getWeekStart(anchorDate);
        from = ws.toISOString();
        to = addDays(ws, 7).toISOString();
      } else {
        // month — single request, may be incomplete beyond backend page limit
        const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
        const monthLastDay = new Date(
          anchorDate.getFullYear(),
          anchorDate.getMonth() + 1,
          0,
        );
        from = monthStart.toISOString();
        to = addDays(monthLastDay, 1).toISOString();
      }

      const result = await apiClient.listRoster(clinicId, { from, to });
      setEntries(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load roster");
    } finally {
      setIsLoading(false);
    }
  }, [user, clinicId, viewMode, anchorDate]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!user || !clinicId || !canWrite) return;
    void apiClient
      .listRosterEligibleStaff(clinicId)
      .then(setStaffList)
      .catch(() => undefined);
  }, [user, clinicId, canWrite]);

  if (!user) return null;

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view the roster</h2>
          <p>
            The roster is clinic-specific. Choose a clinic from the clinic selector to view and
            manage scheduled shifts.
          </p>
        </section>
      </AppShell>
    );
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  function goBack() {
    setAnchorDate((d) => {
      if (viewMode === "day") return addDays(d, -1);
      if (viewMode === "week") return addDays(d, -7);
      return new Date(d.getFullYear(), d.getMonth() - 1, 1);
    });
  }

  function goForward() {
    setAnchorDate((d) => {
      if (viewMode === "day") return addDays(d, 1);
      if (viewMode === "week") return addDays(d, 7);
      return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    });
  }

  function getRangeLabel(): string {
    if (viewMode === "day") {
      return anchorDate.toLocaleDateString("en-AU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    if (viewMode === "week") {
      return formatWeekRange(getWeekStart(anchorDate));
    }
    // month
    return anchorDate.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  }

  function getNavAriaLabel(direction: "prev" | "next"): string {
    const prefix = direction === "prev" ? "Previous" : "Next";
    if (viewMode === "day") return `${prefix} day`;
    if (viewMode === "week") return `${prefix} week`;
    return `${prefix} month`;
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────────

  function openCreate(dayDate: Date) {
    setEditingEntry(null);
    setForm(blankForm(toDateInput(dayDate)));
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(entry: RosterEntry) {
    setEditingEntry(entry);
    setForm(formFromEntry(entry));
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEntry(null);
    setFormError(null);
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setFormError(null);
    setIsSubmitting(true);

    try {
      const shiftStartAt = buildIso(form.date, form.startTime);
      const shiftEndAt = buildIso(form.date, form.endTime);
      const notes = form.notes.trim() || null;

      if (editingEntry) {
        const updated = await apiClient.updateShift(
          clinicId ?? user.homeClinicId,
          editingEntry.id,
          { shiftStartAt, shiftEndAt, shiftType: form.shiftType, notes },
        );
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        const created = await apiClient.createShift(clinicId ?? user.homeClinicId, {
          staffUserId: form.staffUserId,
          rosteredClinicName: clinicName ?? user.homeClinicName,
          shiftStartAt,
          shiftEndAt,
          shiftType: form.shiftType,
          notes,
        });
        setEntries((prev) => [...prev, created]);
      }

      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save shift");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelShift(): Promise<void> {
    if (!user || !editingEntry) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const cancelled = await apiClient.cancelShift(
        clinicId ?? user.homeClinicId,
        editingEntry.id,
      );
      setEntries((prev) => prev.map((e) => (e.id === cancelled.id ? cancelled : e)));
      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to cancel shift");
      setIsSubmitting(false);
    }
  }

  // ── View renderers ────────────────────────────────────────────────────────────

  function renderWeekView() {
    const weekStart = getWeekStart(anchorDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    return (
      <div className="roster-grid-wrapper">
        <div className="roster-grid">
          {days.map((dayDate) => {
            const isToday = isSameLocalDay(new Date().toISOString(), dayDate);
            const { weekday, dayMonth } = formatDayHeader(dayDate);

            const dayEntries = entries
              .filter((e) => isSameLocalDay(e.shiftStartAt, dayDate))
              .sort(
                (a, b) =>
                  new Date(a.shiftStartAt).getTime() -
                  new Date(b.shiftStartAt).getTime(),
              );

            return (
              <div
                key={dayDate.toISOString()}
                className={`roster-day${isToday ? " roster-day--today" : ""}`}
              >
                <div className="roster-day__head">
                  <span className="roster-day__weekday">{weekday}</span>
                  <span className="roster-day__date">{dayMonth}</span>
                </div>

                <div className="roster-day__shifts">
                  {dayEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`roster-shift roster-shift--${entry.status}${canWrite ? " roster-shift--clickable" : ""}`}
                      onClick={() => {
                        if (canWrite) openEdit(entry);
                      }}
                      aria-label={`Shift: ${resolveStaffName(entry.staffUserId, entry.staffEmail)}, ${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)}`}
                    >
                      <span className="roster-shift__name">
                        {resolveStaffName(entry.staffUserId, entry.staffEmail)}
                      </span>
                      <span className="roster-shift__time">
                        {formatTime(entry.shiftStartAt)}–{formatTime(entry.shiftEndAt)}
                      </span>
                      <span className="roster-shift__clinic">
                        {entry.rosteredClinicName}
                      </span>
                      <div className="roster-shift__badges">
                        <span
                          className={`roster-status-badge roster-status-badge--${entry.status}`}
                        >
                          {ROSTER_STATUS_LABELS[entry.status]}
                        </span>
                        <span
                          className={`roster-shift__type-badge roster-shift__type-badge--${entry.shiftType}`}
                        >
                          {SHIFT_TYPE_LABELS[entry.shiftType]}
                        </span>
                      </div>
                    </button>
                  ))}

                  {canWrite ? (
                    <button
                      type="button"
                      className="roster-add-btn"
                      onClick={() => {
                        openCreate(dayDate);
                      }}
                      aria-label={`Add shift on ${dayMonth}`}
                    >
                      + Add shift
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

  function renderDayView() {
    const isToday = isSameLocalDay(new Date().toISOString(), anchorDate);
    const { dayMonth } = formatDayHeader(anchorDate);

    const dayEntries = entries
      .filter((e) => isSameLocalDay(e.shiftStartAt, anchorDate))
      .sort(
        (a, b) =>
          new Date(a.shiftStartAt).getTime() - new Date(b.shiftStartAt).getTime(),
      );

    return (
      <div className={`roster-day-view${isToday ? " roster-day-view--today" : ""}`}>
        {dayEntries.length === 0 ? (
          <p className="roster-empty">
            No shifts scheduled {isToday ? "today" : "on this day"}.
          </p>
        ) : null}

        <div className="roster-day-view__shifts">
          {dayEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`roster-day-card roster-day-card--${entry.status}${canWrite ? " roster-shift--clickable" : ""}`}
              onClick={() => {
                if (canWrite) openEdit(entry);
              }}
              aria-label={`Shift: ${resolveStaffName(entry.staffUserId, entry.staffEmail)}, ${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)}`}
            >
              <div className="roster-day-card__main">
                <span className="roster-day-card__name">
                  {resolveStaffName(entry.staffUserId, entry.staffEmail)}
                </span>
                <span className="roster-day-card__time">
                  {formatTime(entry.shiftStartAt)} – {formatTime(entry.shiftEndAt)}
                </span>
              </div>
              <span className="roster-day-card__clinic">{entry.rosteredClinicName}</span>
              <div className="roster-day-card__badges">
                <span
                  className={`roster-status-badge roster-status-badge--${entry.status}`}
                >
                  {ROSTER_STATUS_LABELS[entry.status]}
                </span>
                <span
                  className={`roster-shift__type-badge roster-shift__type-badge--${entry.shiftType}`}
                >
                  {SHIFT_TYPE_LABELS[entry.shiftType]}
                </span>
              </div>
              {entry.notes ? (
                <p className="roster-day-card__notes">{entry.notes}</p>
              ) : null}
            </button>
          ))}

          {canWrite ? (
            <button
              type="button"
              className="roster-add-btn roster-add-btn--day"
              onClick={() => {
                openCreate(anchorDate);
              }}
              aria-label={`Add shift on ${dayMonth}`}
            >
              + Add shift
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderMonthView() {
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();

    // Build a 6-row (42-day) grid starting from the Monday on/before the 1st of the month
    const monthStart = new Date(year, month, 1);
    const gridStart = getWeekStart(monthStart);
    const gridDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

    const MAX_PER_CELL = 3;

    return (
      <div className="roster-month-view">
        {/* Truncation warning — month data comes from a single API page */}
        <div className="roster-month-notice" role="status">
          <AlertTriangle size={14} aria-hidden="true" className="roster-month-notice__icon" />
          <span>
            <strong>⚠ Pilot blocker:</strong> Month is the default view but currently loads
            a single API page only. Complete paginated month data loading must be implemented
            before pilot launch. This notice will be removed once pagination is in place.
          </span>
        </div>

        <div className="roster-month-grid">
          {/* Column headers */}
          {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((d) => (
            <div key={d} className="roster-month__col-head">
              {d}
            </div>
          ))}

          {/* Day cells */}
          {gridDays.map((dayDate) => {
            const isInMonth = dayDate.getMonth() === month;
            const isToday = isSameLocalDay(new Date().toISOString(), dayDate);
            const { dayMonth } = formatDayHeader(dayDate);

            const dayEntries = entries
              .filter((e) => isSameLocalDay(e.shiftStartAt, dayDate))
              .sort(
                (a, b) =>
                  new Date(a.shiftStartAt).getTime() -
                  new Date(b.shiftStartAt).getTime(),
              );
            const shown = dayEntries.slice(0, MAX_PER_CELL);
            const rest = dayEntries.length - shown.length;

            return (
              <div
                key={dayDate.toISOString()}
                className={[
                  "roster-month-cell",
                  isInMonth ? "" : "roster-month-cell--out",
                  isToday ? "roster-month-cell--today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="roster-month-cell__num">{dayDate.getDate()}</span>

                <div className="roster-month-cell__entries">
                  {shown.map((entry) => {
                    const staffName = resolveStaffName(
                      entry.staffUserId,
                      entry.staffEmail,
                    );
                    const initials = getInitials(staffName);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`roster-month-entry roster-month-entry--${entry.status}${canWrite ? " roster-shift--clickable" : ""}`}
                        onClick={() => {
                          if (canWrite) openEdit(entry);
                        }}
                        aria-label={`Shift: ${staffName}, ${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)}`}
                        title={`${staffName} ${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)}`}
                      >
                        <span
                          className={`roster-month-entry__dot roster-month-entry__dot--${entry.status}`}
                          aria-hidden="true"
                        />
                        <span className="roster-month-entry__initials">{initials}</span>
                        <span className="roster-month-entry__time">
                          {formatTime(entry.shiftStartAt)}
                        </span>
                        <span className="roster-month-entry__clinic">
                          {shortClinicName(entry.rosteredClinicName)}
                        </span>
                      </button>
                    );
                  })}
                  {rest > 0 ? (
                    <span className="roster-month-cell__more">+{rest} more</span>
                  ) : null}
                </div>

                {canWrite && isInMonth ? (
                  <button
                    type="button"
                    className="roster-month-cell__add"
                    onClick={() => {
                      openCreate(dayDate);
                    }}
                    aria-label={`Add shift on ${dayMonth}`}
                  >
                    +
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderPrePilotPlaceholder(mode: "two_months" | "quarter") {
    const label = mode === "two_months" ? "2-Month View" : "Quarter View";
    const detail =
      mode === "two_months"
        ? "The 2-Month roster view requires complete paginated data loading across approximately 60 days of shifts."
        : "The Quarter view requires complete paginated data loading and high-level shift aggregation across approximately 90 days.";

    return (
      <div className="roster-pre-pilot-notice">
        <div className="roster-pre-pilot-notice__badge">Pre-Pilot Requirement</div>
        <h2 className="roster-pre-pilot-notice__heading">{label}</h2>
        <p>{detail}</p>
        <p>
          This view is included in the approved navigation structure. Full implementation will
          be completed before pilot launch.
        </p>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  const showNavigation = viewMode !== "two_months" && viewMode !== "quarter";

  return (
    <AppShell>
      {/* ── Page header ── */}
      <div className="roster-hub__header">
        <div>
          <h1 className="roster-hub__title">Roster</h1>
          <p className="roster-hub__subtitle">{clinicName ?? user.homeClinicName}</p>
        </div>

        {/* Export actions — visual prototype only; PDF and Excel are approved pre-pilot requirements */}
        <div className="roster-hub__export-actions">
          <span className="roster-hub__export-label">Export</span>
          <button
            type="button"
            className="roster-export-btn"
            disabled
            title="PDF export — post-pilot (unless operational testing requires it for Pilot Day 0)"
            aria-label="Export roster as PDF (post-pilot requirement)"
          >
            PDF
          </button>
          <button
            type="button"
            className="roster-export-btn"
            disabled
            title="Excel export — approved pre-pilot requirement, not yet implemented"
            aria-label="Export roster as Excel (pre-pilot requirement)"
          >
            Excel
          </button>
        </div>
      </div>

      {/* ── Toolbar: view selector + navigation ── */}
      <div className="roster-hub__toolbar">
        {/* View mode segmented control */}
        <div className="roster-view-selector" role="group" aria-label="Roster view mode">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`roster-view-btn${viewMode === mode ? " roster-view-btn--active" : ""}`}
              onClick={() => {
                setViewMode(mode);
              }}
              aria-pressed={viewMode === mode}
            >
              {VIEW_MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        {/* Range navigation — hidden for pre-pilot placeholder views */}
        {showNavigation ? (
          <div className="roster-cal__nav">
            <button
              type="button"
              className="roster-nav-btn"
              onClick={goBack}
              aria-label={getNavAriaLabel("prev")}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>

            <span className="roster-cal__week-label">{getRangeLabel()}</span>

            <button
              type="button"
              className="roster-nav-btn"
              onClick={goForward}
              aria-label={getNavAriaLabel("next")}
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

            <button
              type="button"
              className="button-link roster-refresh-btn"
              onClick={() => {
                void loadEntries();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        ) : null}
      </div>

      {/* ── View content ── */}
      <section className="status-card roster-hub__content">
        {viewMode === "two_months" || viewMode === "quarter" ? (
          renderPrePilotPlaceholder(viewMode)
        ) : loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading roster…</p>
        ) : viewMode === "day" ? (
          renderDayView()
        ) : viewMode === "month" ? (
          renderMonthView()
        ) : (
          renderWeekView()
        )}
      </section>

      {/* ── Shift modal ── */}
      {showModal ? (
        <div
          className="roster-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={editingEntry ? "Edit shift" : "Add shift"}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="roster-modal">
            <div className="roster-modal__header">
              <h2 className="roster-modal__title">
                {editingEntry ? "Edit shift" : "Add shift"}
              </h2>
              <button
                type="button"
                className="roster-modal__close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="roster-form"
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              {/* Staff member — static display when editing, selector when creating */}
              {editingEntry ? (
                <div className="roster-form__field-static">
                  <span className="roster-form__static-label">Staff member</span>
                  <span className="roster-form__static-value">
                    {resolveStaffName(editingEntry.staffUserId, editingEntry.staffEmail)}
                    <span className="roster-form__static-secondary">
                      {editingEntry.staffEmail}
                    </span>
                  </span>
                </div>
              ) : (
                <label className="roster-form__field">
                  Staff member
                  <select
                    required
                    value={form.staffUserId}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, staffUserId: e.target.value }));
                    }}
                    className="roster-form__control"
                  >
                    <option value="">— Select staff member —</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {staffDisplayName(s)}
                        {s.firstName || s.lastName || s.displayName
                          ? ` (${s.email})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Date */}
              <label className="roster-form__field">
                Date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, date: e.target.value }));
                  }}
                  className="roster-form__control"
                />
              </label>

              {/* Start / End time */}
              <div className="roster-form__row">
                <label className="roster-form__field">
                  Start time
                  <input
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, startTime: e.target.value }));
                    }}
                    className="roster-form__control"
                  />
                </label>

                <label className="roster-form__field">
                  End time
                  <input
                    type="time"
                    required
                    value={form.endTime}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, endTime: e.target.value }));
                    }}
                    className="roster-form__control"
                  />
                </label>
              </div>

              {/* Shift type */}
              <label className="roster-form__field">
                Shift type
                <select
                  value={form.shiftType}
                  onChange={(e) => {
                    setForm((f) => ({
                      ...f,
                      shiftType: e.target.value as ShiftType,
                    }));
                  }}
                  className="roster-form__control"
                >
                  {ALL_SHIFT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SHIFT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>

              {/* Notes */}
              <label className="roster-form__field">
                Notes
                <span className="roster-form__optional">(optional)</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, notes: e.target.value }));
                  }}
                  className="roster-form__control roster-form__textarea"
                  rows={2}
                  maxLength={1000}
                  placeholder="Special instructions, location details…"
                />
              </label>

              {formError ? (
                <p className="status-card__error">{formError}</p>
              ) : null}

              {/* Actions */}
              <div className="roster-form__actions">
                {editingEntry && editingEntry.status !== "cancelled" ? (
                  <button
                    type="button"
                    className="roster-form__danger-btn"
                    onClick={() => {
                      void handleCancelShift();
                    }}
                    disabled={isSubmitting}
                  >
                    Cancel shift
                  </button>
                ) : null}

                <div className="roster-form__actions-right">
                  <button
                    type="button"
                    className="link-button"
                    onClick={closeModal}
                    disabled={isSubmitting}
                  >
                    Discard
                  </button>

                  <button
                    type="submit"
                    className="roster-form__submit-btn"
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? editingEntry
                        ? "Saving…"
                        : "Adding…"
                      : editingEntry
                        ? "Save changes"
                        : "Add shift"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
