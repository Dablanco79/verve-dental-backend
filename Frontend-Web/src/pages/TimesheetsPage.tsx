import { Fragment, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Download, Info } from "lucide-react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { loadConfig } from "../config/index.js";
import { useTimesheets } from "../hooks/useTimesheets.js";
import type {
  AttendanceStatus,
  ClockInRequest,
  ClockOutRequest,
  ExportTimesheetParams,
  PayrollType,
  TimesheetEntry,
  TimesheetFilters,
  TimesheetStatus,
} from "../types/payroll.js";
import {
  ATTENDANCE_STATUS_LABELS,
  PAYROLL_TYPE_LABELS,
  TIMESHEET_STATUS_LABELS,
} from "../types/payroll.js";
import type { RosterEntry } from "../types/roster.js";
import { canManagePayroll } from "../utils/roles.js";

// Module-level API client (same pattern as useTimesheets / MyShiftsPage).
const apiClient = createApiClient(loadConfig());

// ── Utility helpers ─────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHours(h: number | null): string {
  if (h === null) return "—";
  return `${h.toFixed(2)} h`;
}

/** Formats a rostered shift window as "HH:MM – HH:MM" (24-hour, Melbourne locale). */
function formatShiftTime(isoStart: string, isoEnd: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${fmt(isoStart)} – ${fmt(isoEnd)}`;
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
    "T" +
    [pad(date.getHours()), pad(date.getMinutes())].join(":")
  );
}

// ── Stage 5: Timesheet Location Visual States ────────────────────────────────
//
// VISUAL STATES ONLY — not connected to navigator.geolocation or any live GPS
// data. The `status` prop will be `null` in all current runtime paths.
// These components are ready to receive real values once the functional
// geolocation change is implemented (post–Stage 5).
//
// DO NOT pass hardcoded fixture values in production code paths.

type TsLocationState =
  | "verified"       // within 100m — success green
  | "outside_range"  // > 100m, clock still allowed — amber warning
  | "unavailable"    // location service unavailable — amber
  | "denied"         // permission denied — amber/neutral
  | "not_recorded"   // historical entry, no GPS — neutral
  | null;            // status unknown / pre-functional — renders nothing

const TS_LOCATION_CONFIG = {
  verified: {
    label: "Location verified",
    hint: null as string | null,
    className: "ts-loc-badge--verified",
    Icon: CheckCircle2,
  },
  outside_range: {
    label: "Outside normal clock area",
    hint: "Timesheet can still be submitted — manager review required",
    className: "ts-loc-badge--outside",
    Icon: AlertTriangle,
  },
  unavailable: {
    label: "Location unavailable",
    hint: "Recorded without GPS",
    className: "ts-loc-badge--unavailable",
    Icon: AlertTriangle,
  },
  denied: {
    label: "Location permission not granted",
    hint: null as string | null,
    className: "ts-loc-badge--denied",
    Icon: Info,
  },
  not_recorded: {
    label: "Location not recorded",
    hint: "Historical entry",
    className: "ts-loc-badge--historical",
    Icon: Clock,
  },
} as const;

/** Inline location-state badge. Renders nothing when status is null. */
function TsLocationBadge({ status }: { status: TsLocationState }) {
  if (status === null) return null;
  const { Icon, label, hint, className } = TS_LOCATION_CONFIG[status];
  return (
    <span
      className={`ts-loc-badge ${className}`}
      title={hint ?? label}
    >
      <Icon size={12} aria-hidden="true" />
      <span className="ts-loc-badge__text">{label}</span>
    </span>
  );
}

// ── Badge components ─────────────────────────────────────────────────────────

function TimesheetStatusBadge({ status }: { status: TimesheetStatus | null }) {
  if (!status) return null;
  return (
    <span className={`pr-badge pr-badge--${status}`}>
      {TIMESHEET_STATUS_LABELS[status]}
    </span>
  );
}

function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span className={`pr-badge pr-badge--${status}`}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  );
}

function PayrollTypeBadge({ type }: { type: PayrollType }) {
  return (
    <span className={`pr-badge pr-badge--${type}`}>
      {PAYROLL_TYPE_LABELS[type]}
    </span>
  );
}

// ── Manager: Hourly approval queue ──────────────────────────────────────────

type ApprovalQueueProps = {
  entries: TimesheetEntry[];
  /** Notes are optional — pass null for a silent approval. */
  onApprove: (id: string, notes: string | null) => Promise<void>;
  onReject: (id: string, notes: string) => Promise<void>;
};

function ApprovalQueue({ entries, onApprove, onReject }: ApprovalQueueProps) {
  // Approval inline-form state (notes are optional).
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveNotes, setApproveNotes] = useState("");
  // Rejection inline-form state (notes are required).
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleApprove(id: string, notes: string | null): Promise<void> {
    setIsBusy(true);
    setActionError(null);
    try {
      await onApprove(id, notes);
      setApprovingId(null);
      setApproveNotes("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRejectSubmit(id: string): Promise<void> {
    if (!rejectNotes.trim()) {
      setActionError("A rejection reason is required.");
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      await onReject(id, rejectNotes.trim());
      setRejectingId(null);
      setRejectNotes("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rejection failed.");
    } finally {
      setIsBusy(false);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        No timesheets pending approval — you&apos;re all caught up!
      </p>
    );
  }

  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Date</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">Clock In</th>
            <th className="pr-table__th">Clock Out</th>
            <th className="pr-table__th">Hours</th>
            <th className="pr-table__th">Status</th>
            <th className="pr-table__th" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr className="pr-table__row">
                <td className="pr-table__td">{entry.staffEmail}</td>
                <td className="pr-table__td pr-table__td--mono">{entry.shiftDate}</td>
                <td className="pr-table__td">
                  <PayrollTypeBadge type={entry.payrollType} />
                </td>
                {/* Stage 5: TsLocationBadge status=null — visual treatment wired, not live */}
                <td className="pr-table__td pr-table__td--clocked">
                  <span className="pr-table__td-time">{formatDateTime(entry.clockInAt)}</span>
                  <TsLocationBadge status={null} />
                </td>
                <td className="pr-table__td pr-table__td--clocked">
                  <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
                  <TsLocationBadge status={null} />
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatHours(entry.totalHoursWorked)}
                </td>
                <td className="pr-table__td">
                  <TimesheetStatusBadge status={entry.timesheetStatus} />
                </td>
                <td className="pr-table__td pr-table__td--actions">
                  <div className="pr-row-actions">
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--approve"
                      onClick={() => {
                        // Toggle approval inline form; close rejection form.
                        setApprovingId(entry.id === approvingId ? null : entry.id);
                        setApproveNotes("");
                        setRejectingId(null);
                        setActionError(null);
                      }}
                      disabled={isBusy}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--reject"
                      onClick={() => {
                        // Toggle rejection inline form; close approval form.
                        setRejectingId(entry.id === rejectingId ? null : entry.id);
                        setRejectNotes("");
                        setApprovingId(null);
                        setApproveNotes("");
                        setActionError(null);
                      }}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
              {/* ── Inline approval form (optional notes) ──────────────── */}
              {approvingId === entry.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={8} className="pr-table__td">
                    <div className="pr-inline-form pr-inline-form--approval">
                      {/* Notes are optional — manager may approve silently */}
                      <textarea
                        className="pr-inline-form__textarea"
                        placeholder="Approval note (optional) — appears in the export and staff record…"
                        value={approveNotes}
                        onChange={(e) => { setApproveNotes(e.target.value); }}
                        disabled={isBusy}
                        rows={2}
                      />
                      <div className="pr-inline-form__row-actions">
                        <button
                          type="button"
                          className="pr-action-btn pr-action-btn--approve"
                          onClick={() => {
                            void handleApprove(entry.id, approveNotes.trim() || null);
                          }}
                          disabled={isBusy}
                        >
                          {isBusy ? "Saving…" : "Confirm Approval"}
                        </button>
                        <button
                          type="button"
                          className="pr-inline-form__cancel"
                          onClick={() => {
                            setApprovingId(null);
                            setActionError(null);
                          }}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {actionError ? (
                      <p className="pr-inline-form__error" role="alert">
                        {actionError}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              {/* ── Inline rejection form (required notes) ─────────────── */}
              {rejectingId === entry.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={8} className="pr-table__td">
                    <div className="pr-inline-form pr-inline-form--rejection">
                      <div className="pr-inline-form__rejection-header">
                        <AlertTriangle size={14} aria-hidden="true" className="pr-inline-form__rejection-icon" />
                        <span>Rejection reason</span>
                      </div>
                      {/* VDS textarea — required reason field */}
                      <textarea
                        className="pr-inline-form__textarea"
                        placeholder="Rejection reason (required)…"
                        value={rejectNotes}
                        onChange={(e) => { setRejectNotes(e.target.value); }}
                        disabled={isBusy}
                        rows={2}
                        aria-required="true"
                      />
                      <div className="pr-inline-form__row-actions">
                        <button
                          type="button"
                          className="pr-action-btn pr-action-btn--reject"
                          onClick={() => { void handleRejectSubmit(entry.id); }}
                          disabled={isBusy}
                        >
                          {isBusy ? "Saving…" : "Submit Rejection"}
                        </button>
                        <button
                          type="button"
                          className="pr-inline-form__cancel"
                          onClick={() => {
                            setRejectingId(null);
                            setActionError(null);
                          }}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {actionError ? (
                      <p className="pr-inline-form__error" role="alert">
                        {actionError}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Manager: Commission verification ────────────────────────────────────────

type CommissionVerificationProps = {
  entries: TimesheetEntry[];
  onVerify: (
    id: string,
    status: "present" | "absent" | "sick" | "cancelled",
    note: string,
  ) => Promise<void>;
};

function CommissionVerification({ entries, onVerify }: CommissionVerificationProps) {
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<"present" | "absent" | "sick" | "cancelled">("present");
  const [verifyNote, setVerifyNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleVerifySubmit(id: string): Promise<void> {
    setIsBusy(true);
    setActionError(null);
    try {
      await onVerify(id, verifyStatus, verifyNote.trim());
      setVerifyingId(null);
      setVerifyNote("");
      setVerifyStatus("present");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        No commission entries pending attendance verification.
      </p>
    );
  }

  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Provider</th>
            <th className="pr-table__th">Date</th>
            <th className="pr-table__th">Location</th>
            <th className="pr-table__th">Attendance</th>
            <th className="pr-table__th">Manager Note</th>
            <th className="pr-table__th" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr className="pr-table__row">
                <td className="pr-table__td">{entry.staffEmail}</td>
                <td className="pr-table__td pr-table__td--mono">{entry.shiftDate}</td>
                <td className="pr-table__td">{entry.rosteredClinicName}</td>
                <td className="pr-table__td">
                  <AttendanceBadge status={entry.attendanceStatus} />
                </td>
                <td className="pr-table__td">{entry.commissionNote ?? "—"}</td>
                <td className="pr-table__td pr-table__td--actions">
                  <button
                    type="button"
                    className="pr-action-btn pr-action-btn--verify"
                    onClick={() => {
                      setVerifyingId(entry.id === verifyingId ? null : entry.id);
                      setVerifyStatus("present");
                      setVerifyNote("");
                      setActionError(null);
                    }}
                    disabled={isBusy}
                  >
                    Verify
                  </button>
                </td>
              </tr>
              {verifyingId === entry.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={6} className="pr-table__td">
                    <div className="pr-inline-form">
                      <select
                        className="pr-inline-form__select"
                        value={verifyStatus}
                        onChange={(e) => {
                          setVerifyStatus(
                            e.target.value as "present" | "absent" | "sick" | "cancelled",
                          );
                        }}
                        disabled={isBusy}
                      >
                        <option value="present">Present — count full usage</option>
                        <option value="absent">Absent — zero usage</option>
                        <option value="sick">Sick — zero usage</option>
                        <option value="cancelled">Cancelled — zero usage</option>
                      </select>
                      <input
                        className="pr-inline-form__input"
                        type="text"
                        placeholder="Manager note (optional)…"
                        value={verifyNote}
                        onChange={(e) => { setVerifyNote(e.target.value); }}
                        disabled={isBusy}
                      />
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--verify"
                        onClick={() => { void handleVerifySubmit(entry.id); }}
                        disabled={isBusy}
                      >
                        {isBusy ? "Saving…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        className="pr-inline-form__cancel"
                        onClick={() => {
                          setVerifyingId(null);
                          setActionError(null);
                        }}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                    {actionError ? (
                      <p className="pr-inline-form__error" role="alert">
                        {actionError}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Staff: Clock widget ──────────────────────────────────────────────────────

type ClockWidgetProps = {
  openEntry: TimesheetEntry | undefined;
  /**
   * Roster shifts for today (non-cancelled) fetched from /roster/me.
   * Passed down from TimesheetsPage so the widget can include the exact
   * roster entry ID in the clock-in request.
   *
   * - length === 0 → ad-hoc mode (no rosterEntryId sent)
   * - length === 1 → auto-selected; shift times shown as read-only
   * - length  >  1 → user selects from a dropdown before clocking in
   */
  todayShifts: RosterEntry[];
  onClockIn: (payload: ClockInRequest) => Promise<TimesheetEntry>;
  onClockOut: (timesheetId: string, payload: ClockOutRequest) => Promise<TimesheetEntry>;
};

function ClockWidget({
  openEntry,
  todayShifts,
  onClockIn,
  onClockOut,
}: ClockWidgetProps) {
  const nowDate = new Date();
  const laterDate = new Date(nowDate.getTime() + 8 * 60 * 60 * 1000);

  const [startAt, setStartAt] = useState(() => toDatetimeLocal(nowDate));
  const [endAt, setEndAt] = useState(() => toDatetimeLocal(laterDate));
  const [breakMins, setBreakMins] = useState("30");
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Tracks which roster shift the staff member is clocking into.
  // null = ad-hoc (no roster link).
  const [selectedShift, setSelectedShift] = useState<RosterEntry | null>(null);

  // Auto-select when exactly one non-cancelled shift is known for today.
  // If multiple, the user must choose from the dropdown.
  useEffect(() => {
    if (todayShifts.length === 1) {
      setSelectedShift(todayShifts[0] ?? null);
    } else if (todayShifts.length === 0) {
      setSelectedShift(null);
    }
    // Multiple shifts: leave selection to the user; don't auto-reset.
  }, [todayShifts]);

  async function handleClockIn(): Promise<void> {
    setIsBusy(true);
    setFormError(null);
    try {
      // rosteredClinicId, rosteredClinicName, and shiftDate are all derived
      // server-side — sending them from the client would be rejected by the
      // backend's strict schema and could allow location spoofing.
      //
      // When a roster entry is selected, pass its exact ID so the service can
      // activate the system_auto pre-fill (or create a roster-linked entry if
      // no pre-fill exists).  shiftStartAt/shiftEndAt fall back to the roster
      // entry's scheduled times — the backend ignores them for pre-fill
      // activation but uses them as the planned window for a new entry.
      await onClockIn({
        rosterEntryId: selectedShift?.id ?? null,
        shiftStartAt: selectedShift
          ? selectedShift.shiftStartAt
          : new Date(startAt).toISOString(),
        shiftEndAt: selectedShift
          ? selectedShift.shiftEndAt
          : new Date(endAt).toISOString(),
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-in failed. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClockOut(): Promise<void> {
    if (!openEntry) return;
    const breakParsed = parseInt(breakMins, 10);
    if (Number.isNaN(breakParsed) || breakParsed < 0) {
      setFormError("Break duration must be a non-negative whole number.");
      return;
    }
    setIsBusy(true);
    setFormError(null);
    try {
      // clockOutAt is intentionally omitted — the backend records server time
      // as the authoritative clock-out timestamp.
      await onClockOut(openEntry.id, {
        breakDurationMinutes: breakParsed,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-out failed. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  // ── Active shift: Clock Out ──────────────────────────────────────────────
  if (openEntry) {
    return (
      <div className="pr-clock-card pr-clock-card--active ts-clock-card">
        {/* Status row — badge + location signal (Stage 5: status=null, renders nothing) */}
        <div className="ts-clock-status-row">
          <span className="vds-badge vds-badge--success ts-clock-badge">Active shift</span>
          {/* Clock-in location: Stage 5 visual slot — not live */}
          <TsLocationBadge status={null} />
        </div>

        <p className="pr-clock-card__shift-info">
          Clocked in at{" "}
          <strong className="ts-clock-time">{formatDateTime(openEntry.clockInAt)}</strong>
        </p>
        <p className="pr-clock-card__shift-info">
          Planned end:{" "}
          <strong className="ts-clock-time">{formatDateTime(openEntry.shiftEndAt)}</strong>
        </p>

        <div className="pr-clock-form pr-clock-form--out ts-clock-form">
          {/* Clock-out time is recorded server-side at the moment of the request
              — no client timestamp is accepted.  Manager back-fills use
              createManualEntry() which does accept explicit timestamps. */}
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="break-mins">
              Break (minutes)
            </label>
            <input
              id="break-mins"
              type="number"
              className="pr-clock-form__control"
              value={breakMins}
              onChange={(e) => { setBreakMins(e.target.value); }}
              min="0"
              step="5"
              disabled={isBusy}
            />
          </div>
          <div className="pr-clock-form__actions ts-clock-actions">
            {/* Clock-out location: Stage 5 visual slot — not live */}
            <TsLocationBadge status={null} />
            <button
              type="button"
              className="pr-action-btn pr-action-btn--clock-out"
              onClick={() => { void handleClockOut(); }}
              disabled={isBusy}
            >
              {isBusy ? "Saving…" : "Clock Out"}
            </button>
          </div>
          {formError ? (
            <p className="pr-clock-form__error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  // ── No active shift: Clock In ────────────────────────────────────────────
  return (
    <div className="pr-clock-card ts-clock-card ts-clock-card--idle">
      {/* Status row — badge + location signal (Stage 5: status=null, renders nothing) */}
      <div className="ts-clock-status-row">
        <span className="vds-badge vds-badge--neutral ts-clock-badge">No active shift</span>
        {/* Clock-in location: Stage 5 visual slot — not live */}
        <TsLocationBadge status={null} />
      </div>

      {/* Clock In form — dominant action, shown directly */}
      <div className="pr-clock-form ts-clock-form">

        {/* ── Roster shift picker (multiple shifts today) ── */}
        {todayShifts.length > 1 ? (
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="roster-shift-select">
              Select shift
            </label>
            <select
              id="roster-shift-select"
              className="pr-clock-form__control"
              value={selectedShift?.id ?? ""}
              onChange={(e) => {
                const shift = todayShifts.find((s) => s.id === e.target.value) ?? null;
                setSelectedShift(shift);
              }}
              disabled={isBusy}
            >
              <option value="">Ad-hoc (no roster shift)</option>
              {todayShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatShiftTime(s.shiftStartAt, s.shiftEndAt)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* ── Roster shift info (single auto-selected shift) ── */}
        {selectedShift ? (
          <p className="pr-clock-card__shift-info ts-clock-shift-info">
            Rostered shift:{" "}
            <strong className="ts-clock-time">
              {formatShiftTime(selectedShift.shiftStartAt, selectedShift.shiftEndAt)}
            </strong>
          </p>
        ) : (
          /* ── Ad-hoc mode: editable time inputs ── */
          <>
            <div className="pr-clock-form__field">
              <label className="pr-clock-form__label" htmlFor="shift-start">
                Shift start
              </label>
              <input
                id="shift-start"
                type="datetime-local"
                className="pr-clock-form__control"
                value={startAt}
                onChange={(e) => { setStartAt(e.target.value); }}
                disabled={isBusy}
              />
            </div>
            <div className="pr-clock-form__field">
              <label className="pr-clock-form__label" htmlFor="shift-end">
                Planned end
              </label>
              <input
                id="shift-end"
                type="datetime-local"
                className="pr-clock-form__control"
                value={endAt}
                onChange={(e) => { setEndAt(e.target.value); }}
                disabled={isBusy}
              />
            </div>
          </>
        )}

        <div className="pr-clock-form__actions ts-clock-actions">
          <button
            type="button"
            className="vds-btn vds-btn--primary ts-clock-btn-primary"
            onClick={() => { void handleClockIn(); }}
            disabled={isBusy}
          >
            {isBusy ? "Clocking in…" : "Clock In"}
          </button>
        </div>
        {formError ? (
          <p className="pr-clock-form__error" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Staff: Personal timesheet ledger ─────────────────────────────────────────

function MyLedger({ entries }: { entries: TimesheetEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        No timesheet entries found for the last 30 days.
      </p>
    );
  }

  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Date</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">Location</th>
            <th className="pr-table__th">Clock In</th>
            <th className="pr-table__th">Clock Out</th>
            <th className="pr-table__th">Hours</th>
            <th className="pr-table__th">Status</th>
            <th className="pr-table__th">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="pr-table__row">
              <td className="pr-table__td pr-table__td--mono">{entry.shiftDate}</td>
              <td className="pr-table__td">
                <PayrollTypeBadge type={entry.payrollType} />
              </td>
              <td className="pr-table__td">{entry.rosteredClinicName}</td>
              {/* Stage 5: TsLocationBadge status=null — visual treatment wired, not live */}
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockInAt)}</span>
                <TsLocationBadge status={null} />
              </td>
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
                <TsLocationBadge status={null} />
              </td>
              <td className="pr-table__td pr-table__td--mono">
                {formatHours(entry.totalHoursWorked)}
              </td>
              <td className="pr-table__td">
                <TimesheetStatusBadge status={entry.timesheetStatus} />
              </td>
              <td className="pr-table__td">
                <AttendanceBadge status={entry.attendanceStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Manager: Timesheet view filter ───────────────────────────────────────────

/**
 * Controls which status tier the manager is currently viewing.
 * Default is "pending" — preserving existing behaviour.
 */
type TimesheetViewFilter = "pending" | "approved" | "rejected" | "all";

const VIEW_FILTER_LABELS: Record<TimesheetViewFilter, string> = {
  pending:  "Pending",
  approved: "Approved",
  rejected: "Rejected",
  all:      "All",
};

type TimesheetViewFilterBarProps = {
  value: TimesheetViewFilter;
  onChange: (v: TimesheetViewFilter) => void;
  /** Badge counts shown on each tab (0 hides the badge). */
  counts: Partial<Record<TimesheetViewFilter, number>>;
};

function TimesheetViewFilterBar({
  value,
  onChange,
  counts,
}: TimesheetViewFilterBarProps) {
  const options: TimesheetViewFilter[] = ["pending", "approved", "rejected", "all"];
  return (
    <div className="ts-view-filter" role="group" aria-label="Timesheet status filter">
      {options.map((opt) => {
        const count = counts[opt] ?? 0;
        return (
          <button
            key={opt}
            type="button"
            className={`ts-view-filter__btn${value === opt ? " ts-view-filter__btn--active" : ""}`}
            onClick={() => { onChange(opt); }}
            aria-pressed={value === opt}
          >
            {VIEW_FILTER_LABELS[opt]}
            {count > 0 ? (
              <span
                className={`pr-section__count${opt === "pending" ? " pr-section__count--warn" : ""}`}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Manager: Reviewed timesheets table (approved / rejected / all) ────────────

function ReviewedTimesheets({ entries }: { entries: TimesheetEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        No timesheets found for the selected filter.
      </p>
    );
  }

  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Date</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">Clock In</th>
            <th className="pr-table__th">Clock Out</th>
            <th className="pr-table__th">Hours</th>
            <th className="pr-table__th">Status</th>
            <th className="pr-table__th">Approval Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="pr-table__row">
              <td className="pr-table__td">{entry.staffEmail}</td>
              <td className="pr-table__td pr-table__td--mono">{entry.shiftDate}</td>
              <td className="pr-table__td">
                <PayrollTypeBadge type={entry.payrollType} />
              </td>
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockInAt)}</span>
              </td>
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
              </td>
              <td className="pr-table__td pr-table__td--mono">
                {formatHours(entry.totalHoursWorked)}
              </td>
              <td className="pr-table__td">
                <TimesheetStatusBadge status={entry.timesheetStatus} />
              </td>
              <td className="pr-table__td">{entry.approvalNotes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Export panel (manager only) ───────────────────────────────────────────────

type ExportPanelProps = {
  /** Unique staff emails from the currently loaded timesheets. */
  availableStaff: string[];
  onExport: (params: ExportTimesheetParams) => Promise<string>;
};

function ExportPanel({ availableStaff, onExport }: ExportPanelProps) {
  // Default to current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayStr);
  const [staffEmail, setStaffEmail] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastFilename, setLastFilename] = useState<string | null>(null);

  const isDateRangeValid = !from || !to || from <= to;

  async function handleExport(): Promise<void> {
    if (!isDateRangeValid) return;
    setIsExporting(true);
    setExportError(null);
    setLastFilename(null);

    const params: ExportTimesheetParams = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (staffEmail) params.staffEmail = staffEmail;

    try {
      const filename = await onExport(params);
      setLastFilename(filename);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Export failed. Please try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="pr-section ts-export-panel">
      <h2 className="pr-section__title">
        Export Hours
      </h2>
      <p className="pr-section__hint">
        Download actual worked hours for payroll and admin purposes. The export
        includes all records matching the selected filters.
      </p>

      <div className="ts-export-form">
        {/* Date range */}
        <div className="ts-export-form__row">
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="export-from">
              From
            </label>
            <input
              id="export-from"
              type="date"
              className="pr-clock-form__control"
              value={from}
              onChange={(e) => { setFrom(e.target.value); }}
              disabled={isExporting}
            />
          </div>
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="export-to">
              To
            </label>
            <input
              id="export-to"
              type="date"
              className="pr-clock-form__control"
              value={to}
              onChange={(e) => { setTo(e.target.value); }}
              disabled={isExporting}
            />
          </div>
          {/* Staff filter */}
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="export-staff">
              Staff (optional)
            </label>
            <select
              id="export-staff"
              className="pr-clock-form__control"
              value={staffEmail}
              onChange={(e) => { setStaffEmail(e.target.value); }}
              disabled={isExporting}
            >
              <option value="">All staff</option>
              {availableStaff.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!isDateRangeValid ? (
          <p className="pr-inline-form__error" role="alert">
            &ldquo;From&rdquo; date must be on or before &ldquo;To&rdquo; date.
          </p>
        ) : null}

        <div className="ts-export-form__actions">
          <button
            type="button"
            className="vds-btn vds-btn--primary ts-export-btn"
            onClick={() => { void handleExport(); }}
            disabled={isExporting || !isDateRangeValid}
            aria-busy={isExporting}
          >
            <Download size={15} aria-hidden="true" />
            {isExporting ? "Exporting…" : "Export Hours"}
          </button>
        </div>

        {exportError ? (
          <p className="pr-inline-form__error" role="alert">
            {exportError}
          </p>
        ) : null}

        {lastFilename && !exportError ? (
          <p className="ts-export-success" role="status">
            Downloaded: {lastFilename}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TimesheetsPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();

  // Stable 30-day window initialised once at mount — avoids refetch on re-render.
  const [filters] = useState<TimesheetFilters>(() => ({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  }));

  // ── Manager view filter state — MUST be declared before any early returns ──
  // Default "pending" preserves existing behaviour.
  const [viewFilter, setViewFilter] = useState<TimesheetViewFilter>("pending");

  const isManager = user ? canManagePayroll(user.role) : false;

  // ── Today's roster shifts (staff only) ───────────────────────────────────
  // Fetched once per page mount so ClockWidget can include the exact
  // rosterEntryId in the clock-in request.  Errors are silently ignored —
  // the widget falls back to ad-hoc mode (no rosterEntryId) which remains
  // safe and functional.
  const [todayShifts, setTodayShifts] = useState<RosterEntry[]>([]);

  useEffect(() => {
    if (!clinicId || isManager) return;

    // ±12-hour window captures any shift whose scheduled start falls within
    // a generous "today" regardless of the Melbourne / UTC offset.
    const now = new Date();
    const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const to   = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    void apiClient
      .getMyShifts(clinicId, { from, to })
      .then((shifts) => {
        setTodayShifts(shifts.filter((s) => s.status !== "cancelled"));
      })
      .catch(() => {
        // Silently ignore — ClockWidget falls back to ad-hoc mode.
      });
  }, [clinicId, isManager]);

  const {
    timesheets,
    isLoading,
    error,
    refetch,
    clockIn,
    clockOut,
    approveTimesheet,
    rejectTimesheet,
    verifyCommissionAttendance,
    exportTimesheets,
  } = useTimesheets(clinicId, user?.role, filters);

  if (!user) return null;

  if (isAllClinicsScope && isManager) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view timesheets</h2>
          <p>
            Timesheets are clinic-specific. Choose a clinic from the clinic selector to review
            and approve staff timesheets.
          </p>
        </section>
      </AppShell>
    );
  }

  // Client-side splits for the two manager queues (pending view).
  const pendingApproval = timesheets.filter(
    (t) => t.timesheetStatus === "submitted" && t.payrollType !== "commission_log",
  );
  const pendingCommission = timesheets.filter(
    (t) =>
      t.payrollType === "commission_log" &&
      t.attendanceStatus === "pending_verification",
  );

  // Entries for the non-pending views (hourly tracks only).
  const hourlyTimesheets = timesheets.filter(
    (t) => t.payrollType !== "commission_log",
  );
  const reviewedEntries: TimesheetEntry[] = (() => {
    if (viewFilter === "approved") {
      return hourlyTimesheets.filter((t) => t.timesheetStatus === "approved");
    }
    if (viewFilter === "rejected") {
      // Includes "requires_amendment" — also needs attention.
      return hourlyTimesheets.filter(
        (t) =>
          t.timesheetStatus === "rejected" ||
          t.timesheetStatus === "requires_amendment",
      );
    }
    if (viewFilter === "all") {
      return timesheets; // all entries, all statuses
    }
    return []; // "pending" uses the queue components
  })();

  // Badge counts for the filter bar.
  const filterCounts: Partial<Record<TimesheetViewFilter, number>> = {
    pending:  pendingApproval.length,
    approved: hourlyTimesheets.filter((t) => t.timesheetStatus === "approved").length,
    rejected: hourlyTimesheets.filter(
      (t) =>
        t.timesheetStatus === "rejected" ||
        t.timesheetStatus === "requires_amendment",
    ).length,
    all: timesheets.length,
  };

  // Unique staff emails from loaded timesheets — drives the export staff picker.
  const availableStaff = [...new Set(timesheets.map((t) => t.staffEmail))].sort();

  // Staff: the open (clocked-in, not yet clocked-out) entry for today.
  const openEntry = isManager
    ? undefined
    : timesheets.find(
        (t) =>
          t.payrollType !== "commission_log" &&
          t.clockInAt !== null &&
          t.clockOutAt === null,
      );

  const subtitleText = isManager
    ? `${String(pendingApproval.length)} pending hourly approval · ${String(pendingCommission.length)} pending commission verification`
    : "your shift history and clock in / out";

  const clinicDisplay = clinicName ?? user.homeClinicName;

  return (
    <AppShell>
      {/* ── Page H1 ── */}
      <header className="ts-hub__header">
        <div className="ts-hub__header-text">
          <h1 className="ts-hub__title">
            {isManager ? "Timesheets" : "My Timesheets"}
          </h1>
          <p className="ts-hub__subtitle">
            {clinicDisplay}
            <span className="ts-hub__subtitle-sep">—</span>
            {subtitleText}
          </p>
        </div>
        <div className="ts-hub__header-actions">
          <button
            type="button"
            className="vds-btn vds-btn--ghost vds-btn--sm"
            onClick={refetch}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="status-card ts-hub__content">
        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading timesheets…</p>
        ) : isManager ? (
          <>
            <div className="inventory-receiving-callout pr-self-service-callout" role="note">
              <h3>Personal shifts and clock in / out</h3>
              <p>
                Owner/Admin timesheets open in approval mode. Personal roster visibility remains
                under My Shifts; clock in/out is shown here for users with staff timekeeping access.
              </p>
              <Link to="/my-shifts" className="link-button">
                Open My Shifts
              </Link>
            </div>

            {/* ── Manager: Export Hours ── */}
            <ExportPanel
              availableStaff={availableStaff}
              onExport={exportTimesheets}
            />

            {/* ── Manager: Timesheet status filter ── */}
            <TimesheetViewFilterBar
              value={viewFilter}
              onChange={setViewFilter}
              counts={filterCounts}
            />

            {viewFilter === "pending" ? (
              <>
                {/* ── Manager: Hourly approval queue ── */}
                <div className="pr-section">
                  <h2 className="pr-section__title">
                    Hourly Approval Queue
                    {pendingApproval.length > 0 ? (
                      <span className="pr-section__count pr-section__count--warn">
                        {pendingApproval.length}
                      </span>
                    ) : null}
                  </h2>
                  <ApprovalQueue
                    entries={pendingApproval}
                    onApprove={async (id, notes) => {
                      await approveTimesheet(id, { approvalNotes: notes });
                    }}
                    onReject={async (id, notes) => {
                      await rejectTimesheet(id, { approvalNotes: notes });
                    }}
                  />
                </div>

                {/* ── Manager: Commission attendance verification ── */}
                <div className="pr-section">
                  <h2 className="pr-section__title">
                    Commission Attendance Verification
                    {pendingCommission.length > 0 ? (
                      <span className="pr-section__count pr-section__count--warn">
                        {pendingCommission.length}
                      </span>
                    ) : null}
                  </h2>
                  <p className="pr-section__hint">
                    Attendance status directly controls materials forecast accuracy. Only mark{" "}
                    <strong>Present</strong> if the provider was physically at the clinic and treated
                    patients.
                  </p>
                  <CommissionVerification
                    entries={pendingCommission}
                    onVerify={async (id, status, note) => {
                      await verifyCommissionAttendance(id, {
                        attendanceStatus: status,
                        commissionNote: note || null,
                      });
                    }}
                  />
                </div>
              </>
            ) : (
              /* ── Manager: Reviewed / all timesheets ── */
              <div className="pr-section">
                <h2 className="pr-section__title">
                  {VIEW_FILTER_LABELS[viewFilter]} Timesheets
                  {reviewedEntries.length > 0 ? (
                    <span className="pr-section__count">{reviewedEntries.length}</span>
                  ) : null}
                </h2>
                <ReviewedTimesheets entries={reviewedEntries} />
              </div>
            )}
          </>
        ) : (
          <>
            {/* ── Staff: Clock In / Clock Out ── */}
            <div className="pr-section ts-hub__clock-section">
              <h2 className="pr-section__title">Today&apos;s Session</h2>
              <ClockWidget
                openEntry={openEntry}
                todayShifts={todayShifts}
                onClockIn={clockIn}
                onClockOut={clockOut}
              />
            </div>

            {/* ── Staff: Personal timesheet ledger ── */}
            <div className="pr-section">
              <h2 className="pr-section__title">My Timesheet Ledger (Last 30 Days)</h2>
              <MyLedger entries={timesheets} />
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
