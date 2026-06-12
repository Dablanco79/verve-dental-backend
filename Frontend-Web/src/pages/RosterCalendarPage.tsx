import { useCallback, useEffect, useState, type FormEvent } from "react";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { StaffUser } from "../types/index.js";
import type {
  RosterEntry,
  ShiftType,
} from "../types/roster.js";
import {
  ALL_SHIFT_TYPES,
  SHIFT_TYPE_LABELS,
} from "../types/roster.js";
import { canManageRoster } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Date helpers ────────────────────────────────────────────────────────────

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** "jane.smith@clinic.au" → "Jane Smith" */
function staffLabel(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Local state types ────────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

export function RosterCalendarPage() {
  const { user } = useAuth();

  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<RosterEntry | null>(null);
  const [form, setForm] = useState<ShiftFormState>(blankForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canWrite = user ? canManageRoster(user.role) : false;

  const loadWeek = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const from = weekStart.toISOString();
      const to = addDays(weekStart, 7).toISOString();
      const result = await apiClient.listRoster(user.homeClinicId, { from, to });
      setEntries(result);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Unable to load roster");
    } finally {
      setIsLoading(false);
    }
  }, [user, weekStart]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    if (!user || !canWrite) return;
    void apiClient
      .listUsers(user.homeClinicId)
      .then(setStaffList)
      .catch(() => undefined);
  }, [user, canWrite]);

  if (!user) return null;

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setFormError(null);
    setIsSubmitting(true);

    try {
      const shiftStartAt = buildIso(form.date, form.startTime);
      const shiftEndAt = buildIso(form.date, form.endTime);
      const notes = form.notes.trim() || null;

      if (editingEntry) {
        const updated = await apiClient.updateShift(user.homeClinicId, editingEntry.id, {
          shiftStartAt,
          shiftEndAt,
          shiftType: form.shiftType,
          notes,
        });
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        const created = await apiClient.createShift(user.homeClinicId, {
          staffUserId: form.staffUserId,
          rosteredClinicName: user.homeClinicName,
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
      const cancelled = await apiClient.cancelShift(user.homeClinicId, editingEntry.id);
      setEntries((prev) => prev.map((e) => (e.id === cancelled.id ? cancelled : e)));
      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to cancel shift");
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        {/* ── Header ── */}
        <div className="status-card__header roster-cal__header">
          <div>
            <h2>Roster</h2>
            <p className="inventory-page__subtitle">{user.homeClinicName}</p>
          </div>

          <div className="roster-cal__nav">
            <button
              type="button"
              className="roster-nav-btn"
              onClick={() => {
                setWeekStart((d) => addDays(d, -7));
              }}
              aria-label="Previous week"
            >
              ‹
            </button>

            <span className="roster-cal__week-label">
              {formatWeekRange(weekStart)}
            </span>

            <button
              type="button"
              className="roster-nav-btn"
              onClick={() => {
                setWeekStart((d) => addDays(d, 7));
              }}
              aria-label="Next week"
            >
              ›
            </button>

            <button
              type="button"
              className="roster-today-btn"
              onClick={() => {
                setWeekStart(getWeekStart(new Date()));
              }}
            >
              Today
            </button>

            <button
              type="button"
              className="button-link roster-refresh-btn"
              onClick={() => void loadWeek()}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        {loadError ? (
          <p className="status-card__error">{loadError}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading roster…</p>
        ) : (
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
                          aria-label={`Shift: ${entry.staffEmail}, ${formatTime(entry.shiftStartAt)}–${formatTime(entry.shiftEndAt)}`}
                        >
                          <span className="roster-shift__name">
                            {staffLabel(entry.staffEmail)}
                          </span>
                          <span className="roster-shift__time">
                            {formatTime(entry.shiftStartAt)}–{formatTime(entry.shiftEndAt)}
                          </span>
                          <span
                            className={`roster-shift__type-badge roster-shift__type-badge--${entry.shiftType}`}
                          >
                            {SHIFT_TYPE_LABELS[entry.shiftType]}
                          </span>
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
        )}
      </section>

      {/* ── Shift Modal ── */}
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
              <h3 className="roster-modal__title">
                {editingEntry ? "Edit shift" : "Add shift"}
              </h3>
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
              onSubmit={(e) => void handleSubmit(e)}
            >
              {/* Staff member — only shown when creating */}
              {editingEntry ? (
                <div className="roster-form__field-static">
                  <span className="roster-form__static-label">Staff member</span>
                  <span className="roster-form__static-value">
                    {editingEntry.staffEmail}
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
                        {s.email}
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
                    onClick={() => void handleCancelShift()}
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
