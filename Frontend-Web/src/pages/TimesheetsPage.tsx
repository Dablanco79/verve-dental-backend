import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Download, Info, MapPin } from "lucide-react";
import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { loadConfig } from "../config/index.js";
import { useTimesheets } from "../hooks/useTimesheets.js";
import type {
  AttendanceStatus,
  ClockInRequest,
  ClockLocationInput,
  ClockOutRequest,
  ExportTimesheetParams,
  GeofenceLocation,
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
import {
  buildGeofenceLocation,
  formatDistance,
  requestGeolocation,
  requiresGeofenceWarning,
  toClockLocationInput,
} from "../utils/geofence.js";
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
function TsLocationBadge({
  status,
  distanceMetres,
}: {
  status: TsLocationState;
  distanceMetres?: number | null;
}) {
  if (status === null) return null;
  const { Icon, className } = TS_LOCATION_CONFIG[status];
  const label =
    status === "outside_range" && distanceMetres != null
      ? `Outside — ${String(distanceMetres)} m`
      : TS_LOCATION_CONFIG[status].label;
  const hint =
    status === "outside_range" && distanceMetres != null
      ? `Outside normal clock area — ${String(distanceMetres)} m away`
      : TS_LOCATION_CONFIG[status].hint;
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

/** Converts a stored GeofenceLocation to the TsLocationState used by TsLocationBadge. */
function geofenceToLocationState(loc: GeofenceLocation | null): TsLocationState {
  if (!loc) return "not_recorded";
  switch (loc.locationState) {
    case "within":      return "verified";
    case "outside":     return "outside_range";
    case "denied":      return "denied";
    case "unavailable": return "unavailable";
  }
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

/**
 * Compact geofence summary shown in manager approval/review tables.
 * Shows an exception badge when either event was outside range, and a
 * two-line detail (clock-in / clock-out) for the location audit trail.
 */
function GeofenceSummaryCell({
  clockInLoc,
  clockOutLoc,
}: {
  clockInLoc: GeofenceLocation | null;
  clockOutLoc: GeofenceLocation | null;
}) {
  if (!clockInLoc && !clockOutLoc) {
    return <span className="ts-loc-historical">Not recorded</span>;
  }

  const hasException =
    clockInLoc?.locationState === "outside" ||
    clockOutLoc?.locationState === "outside";

  function locLine(loc: GeofenceLocation | null, label: string): string {
    if (!loc) return `${label}: —`;
    switch (loc.locationState) {
      case "within":
        return `${label}: Within${
          loc.distanceMetres !== null
            ? ` — ${String(Math.round(loc.distanceMetres))} m`
            : ""
        }`;
      case "outside":
        return `${label}: Outside${
          loc.distanceMetres !== null
            ? ` — ${String(Math.round(loc.distanceMetres))} m`
            : ""
        }`;
      case "denied":      return `${label}: Permission denied`;
      case "unavailable": return `${label}: Unavailable`;
    }
  }

  return (
    <div className="ts-geofence-summary">
      {hasException && (
        <div className="ts-geofence-exception" role="status">
          <AlertTriangle size={12} aria-hidden="true" />
          {" Location exception"}
        </div>
      )}
      <div className="ts-geofence-detail">{locLine(clockInLoc, "In")}</div>
      <div className="ts-geofence-detail">{locLine(clockOutLoc, "Out")}</div>
    </div>
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
  // ── Individual-action state ───────────────────────────────────────────────
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveNotes, setApproveNotes] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Bulk selection state ──────────────────────────────────────────────────
  // selectedIds: Set of entry IDs currently checked.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // rowNotes: per-row approver comment for bulk operations (id → text).
  // Kept separate from the individual approve/reject inline-form notes.
  const [rowNotes, setRowNotes] = useState<Map<string, string>>(new Map());
  // missingNoteIds: IDs highlighted when bulk-reject validation finds missing reasons.
  const [missingNoteIds, setMissingNoteIds] = useState<Set<string>>(new Set());
  // Bulk async state.
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  // bulkConfirmMode: shows confirmation panel for the given action; null = action bar.
  const [bulkConfirmMode, setBulkConfirmMode] = useState<"approve" | "reject" | null>(null);
  // bulkResult: displayed after a bulk operation completes (e.g. "5 approved · 1 failed").
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // ── Derived selection flags ───────────────────────────────────────────────
  const allIds = entries.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelectAll(): void {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
    setMissingNoteIds(new Set());
    setBulkResult(null);
  }

  function toggleSelectRow(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    setMissingNoteIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setBulkResult(null);
  }

  function getRowNote(id: string): string {
    return rowNotes.get(id) ?? "";
  }

  function setRowNote(id: string, value: string): void {
    setRowNotes((prev) => new Map(prev).set(id, value));
    if (value.trim()) {
      setMissingNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // ── Individual action handlers ────────────────────────────────────────────

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

  // ── Bulk action handlers ──────────────────────────────────────────────────

  function handleBulkApproveClick(): void {
    setBulkResult(null);
    setMissingNoteIds(new Set());
    setBulkConfirmMode("approve");
  }

  async function executeBulkApprove(): Promise<void> {
    setIsBulkBusy(true);
    setBulkConfirmMode(null);
    const ids = [...selectedIds];
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const note = getRowNote(id).trim() || null;
      try {
        await onApprove(id, note);
        ok++;
      } catch {
        failed.push(id);
      }
    }
    setIsBulkBusy(false);
    // Keep only failed IDs selected so the manager can retry them.
    setSelectedIds(new Set(failed));
    const parts: string[] = [];
    if (ok > 0) parts.push(`${String(ok)} approved`);
    if (failed.length > 0) parts.push(`${String(failed.length)} failed`);
    setBulkResult(parts.join(" · "));
  }

  function handleBulkRejectClick(): void {
    setBulkResult(null);
    // Validate: every selected row must have a non-empty rejection note.
    const missing = [...selectedIds].filter((id) => !getRowNote(id).trim());
    if (missing.length > 0) {
      setMissingNoteIds(new Set(missing));
      return;
    }
    setMissingNoteIds(new Set());
    setBulkConfirmMode("reject");
  }

  async function executeBulkReject(): Promise<void> {
    setIsBulkBusy(true);
    setBulkConfirmMode(null);
    const ids = [...selectedIds];
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const note = getRowNote(id).trim();
      try {
        await onReject(id, note);
        ok++;
      } catch {
        failed.push(id);
      }
    }
    setIsBulkBusy(false);
    setSelectedIds(new Set(failed));
    const parts: string[] = [];
    if (ok > 0) parts.push(`${String(ok)} rejected`);
    if (failed.length > 0) parts.push(`${String(failed.length)} failed`);
    setBulkResult(parts.join(" · "));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        No timesheets pending approval — you&apos;re all caught up!
      </p>
    );
  }

  // Total column count: checkbox + Staff + Date + Type + Clock In + Clock Out +
  //   Hours + Location + Staff Note + Status + Actions = 11
  const COL_COUNT = 11;

  return (
    <div className="pr-table-wrap">
      {/* ── Bulk action bar (shown when ≥ 1 row selected) ───────────────── */}
      {selectedIds.size > 0 && !isBulkBusy && bulkConfirmMode === null && (
        <div className="pr-bulk-bar" role="region" aria-label="Bulk actions">
          <span className="pr-bulk-bar__count">{selectedIds.size} selected</span>
          <div className="pr-bulk-bar__actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--approve"
              onClick={handleBulkApproveClick}
            >
              Approve {selectedIds.size} selected
            </button>
            <button
              type="button"
              className="pr-action-btn pr-action-btn--reject"
              onClick={handleBulkRejectClick}
            >
              Reject {selectedIds.size} selected
            </button>
            <button
              type="button"
              className="pr-action-btn pr-action-btn--ghost"
              onClick={() => {
                setSelectedIds(new Set());
                setMissingNoteIds(new Set());
                setBulkResult(null);
              }}
            >
              Clear selection
            </button>
          </div>
          {missingNoteIds.size > 0 && (
            <p className="pr-bulk-bar__missing" role="alert">
              Add a rejection reason to each selected timesheet before continuing.
            </p>
          )}
        </div>
      )}

      {/* ── Bulk approve confirmation panel ──────────────────────────────── */}
      {bulkConfirmMode === "approve" && (
        <div className="pr-bulk-confirm" role="region" aria-label="Confirm bulk approval">
          <span className="pr-bulk-confirm__text">
            Approve {selectedIds.size} selected{" "}
            {selectedIds.size === 1 ? "timesheet" : "timesheets"}?
          </span>
          <div className="pr-bulk-confirm__actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--approve"
              onClick={() => { void executeBulkApprove(); }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="pr-inline-form__cancel"
              onClick={() => { setBulkConfirmMode(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk reject confirmation panel ────────────────────────────────── */}
      {bulkConfirmMode === "reject" && (
        <div
          className="pr-bulk-confirm pr-bulk-confirm--reject"
          role="region"
          aria-label="Confirm bulk rejection"
        >
          <span className="pr-bulk-confirm__text">
            Reject {selectedIds.size} selected{" "}
            {selectedIds.size === 1 ? "timesheet" : "timesheets"}?
          </span>
          <div className="pr-bulk-confirm__actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--reject"
              onClick={() => { void executeBulkReject(); }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="pr-inline-form__cancel"
              onClick={() => { setBulkConfirmMode(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk processing indicator ─────────────────────────────────────── */}
      {isBulkBusy && (
        <p className="pr-bulk-bar__processing" aria-live="polite" aria-busy="true">
          Processing…
        </p>
      )}

      {/* ── Bulk result summary ───────────────────────────────────────────── */}
      {bulkResult !== null && !isBulkBusy && (
        <p className="pr-bulk-bar__result" role="status">
          {bulkResult}
        </p>
      )}

      <table className="pr-table">
        <thead>
          <tr>
            {/* ── Select All / Deselect All header checkbox ──────────────── */}
            <th className="pr-table__th pr-table__th--checkbox">
              <input
                type="checkbox"
                aria-label="Select all timesheets"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleSelectAll}
              />
            </th>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Date</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">Clock In</th>
            <th className="pr-table__th">Clock Out</th>
            <th className="pr-table__th">Hours</th>
            <th className="pr-table__th">Location</th>
            <th className="pr-table__th">Staff Note</th>
            <th className="pr-table__th">Status</th>
            <th className="pr-table__th" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr className={`pr-table__row${selectedIds.has(entry.id) ? " pr-table__row--selected" : ""}`}>
                {/* ── Row checkbox ──────────────────────────────────────── */}
                <td className="pr-table__td pr-table__td--checkbox">
                  <input
                    type="checkbox"
                    aria-label={`Select timesheet for ${entry.staffEmail} on ${entry.shiftDate}`}
                    checked={selectedIds.has(entry.id)}
                    onChange={() => { toggleSelectRow(entry.id); }}
                    disabled={isBulkBusy}
                  />
                </td>
                <td className="pr-table__td">{entry.staffEmail}</td>
                <td className="pr-table__td pr-table__td--mono">{entry.shiftDate}</td>
                <td className="pr-table__td">
                  <PayrollTypeBadge type={entry.payrollType} />
                </td>
                {/* Stage 5: TsLocationBadge status=null — visual treatment wired, not live */}
                <td className="pr-table__td pr-table__td--clocked">
                  <span className="pr-table__td-time">{formatDateTime(entry.clockInAt)}</span>
                  <TsLocationBadge
                    status={geofenceToLocationState(entry.clockInLocation)}
                    distanceMetres={entry.clockInLocation?.distanceMetres}
                  />
                </td>
                <td className="pr-table__td pr-table__td--clocked">
                  <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
                  <TsLocationBadge
                    status={geofenceToLocationState(entry.clockOutLocation)}
                    distanceMetres={entry.clockOutLocation?.distanceMetres}
                  />
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatHours(entry.totalHoursWorked)}
                </td>
                <td className="pr-table__td ts-geofence-cell">
                  <GeofenceSummaryCell
                    clockInLoc={entry.clockInLocation}
                    clockOutLoc={entry.clockOutLocation}
                  />
                </td>
                <td className="pr-table__td ts-staff-note-cell">
                  {(entry.clockInNote ?? entry.clockOutNote) ? (
                    <span
                      className="ts-staff-note"
                      title={[entry.clockInNote, entry.clockOutNote].filter(Boolean).join(" / ")}
                    >
                      {entry.clockInNote ?? entry.clockOutNote}
                    </span>
                  ) : null}
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
                      disabled={isBusy || isBulkBusy}
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
                      disabled={isBusy || isBulkBusy}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>

              {/* ── Per-row approver comment (shown when checkbox is checked) ── */}
              {selectedIds.has(entry.id) ? (
                <tr className="pr-table__row pr-table__row--note-input">
                  <td colSpan={COL_COUNT} className="pr-table__td pr-table__td--note">
                    <div className="pr-row-note">
                      <label
                        htmlFor={`row-note-${entry.id}`}
                        className="pr-row-note__label"
                      >
                        Approver Comment
                        <span className="pr-row-note__hint">
                          {" "}— optional for approval, required for rejection
                        </span>
                      </label>
                      <textarea
                        id={`row-note-${entry.id}`}
                        className={`pr-row-note__textarea${
                          missingNoteIds.has(entry.id) ? " pr-row-note__textarea--required" : ""
                        }`}
                        rows={2}
                        maxLength={2000}
                        placeholder="Approver comment…"
                        value={getRowNote(entry.id)}
                        onChange={(e) => { setRowNote(entry.id, e.target.value); }}
                        disabled={isBulkBusy}
                      />
                      {missingNoteIds.has(entry.id) ? (
                        <span className="pr-row-note__error" role="alert">
                          A rejection reason is required for this timesheet.
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}

              {/* ── Inline approval form (optional notes) ──────────────── */}
              {approvingId === entry.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={COL_COUNT} className="pr-table__td">
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
                  <td colSpan={COL_COUNT} className="pr-table__td">
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
  /** Home clinic ID — used as the geofence target for ad-hoc shifts. */
  clinicId: string;
  /** Fetches clinic coordinates for geofence proximity check. */
  getClinicCoordinates: (
    clinicId: string,
  ) => Promise<{ clinicId: string; latitude: number | null; longitude: number | null }>;
  /**
   * Clinics available as "physical location" for ad-hoc clock-ins.
   * Home clinic + distinct clinics from today's roster shifts.
   * Shown in the Physical Location dropdown when no roster shift is selected.
   */
  availableClinics: Array<{ id: string; name: string }>;
};

// ── Geofence warning panel ───────────────────────────────────────────────────

type GeofenceWarningProps = {
  location: GeofenceLocation;
  clinicName?: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isBusy: boolean;
  /**
   * Staff-authored note text for this clock event.
   * When the geofence state is an exception (outside / denied / unavailable),
   * the Confirm button is disabled until note.trim() is non-empty.
   */
  note: string;
  onNoteChange: (value: string) => void;
};

function GeofenceWarningPanel({
  location,
  clinicName,
  actionLabel,
  onConfirm,
  onCancel,
  isBusy,
  note,
  onNoteChange,
}: GeofenceWarningProps) {
  let message: string;
  let detail: string;

  if (location.locationState === "outside") {
    const distStr =
      location.distanceMetres !== null
        ? ` (${formatDistance(location.distanceMetres)} away)`
        : "";
    message = `You appear to be outside${clinicName ? ` ${clinicName}` : " the clinic location"}${distStr}.`;
    detail = `You can still ${actionLabel.toLowerCase()}, but this will be recorded for attendance review.`;
  } else if (location.locationState === "denied") {
    message = "Location permission was not granted.";
    detail = `Your location could not be verified. You can still ${actionLabel.toLowerCase()}, but no location data will be recorded.`;
  } else {
    // "unavailable"
    message = "Your location is currently unavailable.";
    detail = `Location services could not be reached. You can still ${actionLabel.toLowerCase()}, but no location data will be recorded.`;
  }

  // Confirm is disabled until the staff member provides a non-blank explanation.
  const confirmDisabled = isBusy || note.trim() === "";

  return (
    <div className="ts-geofence-warning" role="alert">
      <div className="ts-geofence-warning__header">
        <AlertTriangle size={16} aria-hidden="true" className="ts-geofence-warning__icon" />
        <strong className="ts-geofence-warning__title">Location check</strong>
      </div>
      <p className="ts-geofence-warning__message">{message}</p>
      <p className="ts-geofence-warning__detail">{detail}</p>
      <div className="ts-geofence-warning__note-field">
        <label
          htmlFor="ts-geofence-note"
          className="ts-geofence-warning__note-label"
        >
          Reason <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="ts-geofence-note"
          className="ts-geofence-warning__note-textarea"
          rows={3}
          maxLength={500}
          placeholder={`Explain why you are ${actionLabel.toLowerCase() === "clock out" ? "clocking out" : "clocking in"} here (e.g. "Covering at Heathmont today", "Location unavailable on phone")`}
          value={note}
          onChange={(e) => { onNoteChange(e.target.value); }}
          disabled={isBusy}
          aria-required="true"
          aria-label={`Reason for ${actionLabel.toLowerCase()} location exception`}
        />
        <p className="ts-geofence-warning__note-hint">
          Required — {500 - note.length} characters remaining
        </p>
      </div>
      <div className="ts-geofence-warning__actions">
        <button
          type="button"
          className="vds-btn vds-btn--primary ts-geofence-warning__confirm"
          onClick={onConfirm}
          disabled={confirmDisabled}
          aria-disabled={confirmDisabled}
        >
          {isBusy ? "Saving…" : `Confirm ${actionLabel}`}
        </button>
        <button
          type="button"
          className="vds-btn vds-btn--secondary ts-geofence-warning__cancel"
          onClick={onCancel}
          disabled={isBusy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Clock widget ──────────────────────────────────────────────────────────────

function ClockWidget({
  openEntry,
  todayShifts,
  onClockIn,
  onClockOut,
  clinicId,
  getClinicCoordinates,
  availableClinics,
}: ClockWidgetProps) {
  const nowDate = new Date();
  const laterDate = new Date(nowDate.getTime() + 8 * 60 * 60 * 1000);

  const [startAt, setStartAt] = useState(() => toDatetimeLocal(nowDate));
  const [endAt, setEndAt] = useState(() => toDatetimeLocal(laterDate));
  const [breakMins, setBreakMins] = useState("30");
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Geofence state ─────────────────────────────────────────────────────────
  // pendingLocation: the GeofenceLocation built while the user is looking at
  // the warning.  Confirmed to the API when they click "Confirm".
  // pendingAction: which action is pending confirmation ("in" or "out").
  const [pendingLocation, setPendingLocation] = useState<GeofenceLocation | null>(null);
  const [pendingAction, setPendingAction] = useState<"in" | "out" | null>(null);
  // Live location badge for the current open entry (shown while clocked in).
  const [liveClockInState, setLiveClockInState] = useState<TsLocationState>(null);

  // ── Staff note state ───────────────────────────────────────────────────────
  // Separate note fields for clock-in and clock-out.  Always optional in the
  // UI; the backend enforces requirement when a geofence exception is detected.
  // The GeofenceWarningPanel also disables "Confirm" until a note is provided.
  const [clockInNoteText, setClockInNoteText] = useState("");
  const [clockOutNoteText, setClockOutNoteText] = useState("");

  // Tracks which roster shift the staff member is clocking into.
  // null = ad-hoc (no roster link).
  const [selectedShift, setSelectedShift] = useState<RosterEntry | null>(null);

  // Ad-hoc only: the physical clinic explicitly selected by the user.
  // null until the user chooses — Clock In is blocked until a selection is made.
  const [selectedPhysicalClinicId, setSelectedPhysicalClinicId] = useState<string | null>(null);

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

  // ── Geofence helpers ───────────────────────────────────────────────────────

  /** Resolves the physical target clinic for geofencing. */
  function geofenceTargetClinicId(): string {
    // Roster-linked: use the physical rostered clinic, not the home clinic.
    // Ad-hoc: use the explicitly selected physical clinic (or fall back to home clinic
    // if not yet selected — the validation gate in initiateClockIn prevents this path).
    return selectedShift?.rosteredClinicId ?? selectedPhysicalClinicId ?? clinicId;
  }

  /** Fetches location and builds a GeofenceLocation, always resolving (never throws). */
  async function resolveGeofenceLocation(targetClinicId: string): Promise<GeofenceLocation> {
    const [geoResult, coordsResult] = await Promise.allSettled([
      requestGeolocation(),
      getClinicCoordinates(targetClinicId),
    ]);

    const geo = geoResult.status === "fulfilled" ? geoResult.value : { state: "unavailable" as const };
    const coords = coordsResult.status === "fulfilled" ? coordsResult.value : null;

    return buildGeofenceLocation(
      geo,
      targetClinicId,
      coords?.latitude ?? null,
      coords?.longitude ?? null,
    );
  }

  /** Maps a GeofenceLocation to the TsLocationState used by TsLocationBadge. */
  function toTsLocationState(loc: GeofenceLocation | null): TsLocationState {
    if (!loc) return null;
    switch (loc.locationState) {
      case "within":      return "verified";
      case "outside":     return "outside_range";
      case "denied":      return "denied";
      case "unavailable": return "unavailable";
    }
  }

  // ── Clock In flow ──────────────────────────────────────────────────────────

  async function initiateClockIn(): Promise<void> {
    // Ad-hoc validation: require an explicit physical clinic selection before proceeding.
    if (!selectedShift && !selectedPhysicalClinicId) {
      setFormError("Select your physical location to continue");
      return;
    }
    setIsBusy(true);
    setFormError(null);
    try {
      const targetId = geofenceTargetClinicId();
      const location = await resolveGeofenceLocation(targetId);

      if (requiresGeofenceWarning(location)) {
        // Show warning — user must confirm before API call proceeds.
        setPendingLocation(location);
        setPendingAction("in");
        setIsBusy(false);
        return;
      }

      // Within range — proceed immediately.
      await submitClockIn(location);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-in failed. Try again.");
      setIsBusy(false);
    }
  }

  async function submitClockIn(location: GeofenceLocation | null): Promise<void> {
    setIsBusy(true);
    setPendingLocation(null);
    setPendingAction(null);
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
      //
      // Convert GeofenceLocation → ClockLocationInput: strips backend-computed
      // fields (distanceMetres, withinRange, locationState "within"/"outside")
      // so the backend can authoritatively recompute them from the coordinates.
      const clockInLocation: ClockLocationInput | null =
        location ? toClockLocationInput(location) : null;

      // Pass the staff note — backend enforces it when geofence is an exception;
      // empty string sent as null so the server stores null for no-note cases.
      const clockInNote = clockInNoteText.trim() !== "" ? clockInNoteText.trim() : null;

      await onClockIn({
        rosterEntryId: selectedShift?.id ?? null,
        shiftStartAt: selectedShift
          ? selectedShift.shiftStartAt
          : new Date(startAt).toISOString(),
        shiftEndAt: selectedShift
          ? selectedShift.shiftEndAt
          : new Date(endAt).toISOString(),
        // Ad-hoc: send the explicitly selected physical clinic.
        // Roster-linked: null (backend uses the roster entry's rosteredClinicId).
        physicalClinicId: selectedShift ? null : selectedPhysicalClinicId,
        clockInLocation,
        clockInNote,
      });
      setLiveClockInState(toTsLocationState(location));
      // Clear note state after successful clock-in.
      setClockInNoteText("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-in failed. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  // ── Clock Out flow ─────────────────────────────────────────────────────────

  async function initiateClockOut(): Promise<void> {
    if (!openEntry) return;
    const breakParsed = parseInt(breakMins, 10);
    if (Number.isNaN(breakParsed) || breakParsed < 0) {
      setFormError("Break duration must be a non-negative whole number.");
      return;
    }
    setIsBusy(true);
    setFormError(null);
    try {
      // For clock-out, use the rostered clinic ID from the open entry
      // (it was already set correctly at clock-in time).
      const targetId = openEntry.rosteredClinicId;
      const location = await resolveGeofenceLocation(targetId);

      if (requiresGeofenceWarning(location)) {
        setPendingLocation(location);
        setPendingAction("out");
        setIsBusy(false);
        return;
      }

      await submitClockOut(openEntry.id, breakParsed, location);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-out failed. Try again.");
      setIsBusy(false);
    }
  }

  async function submitClockOut(
    timesheetId: string,
    breakParsed: number,
    location: GeofenceLocation | null,
  ): Promise<void> {
    setIsBusy(true);
    setPendingLocation(null);
    setPendingAction(null);
    try {
      // clockOutAt is intentionally omitted — the backend records server time
      // as the authoritative clock-out timestamp.
      //
      // Convert GeofenceLocation → ClockLocationInput: strips backend-computed
      // fields so the backend can authoritatively recompute them.
      const clockOutLocation: ClockLocationInput | null =
        location ? toClockLocationInput(location) : null;

      // Pass the staff note — backend enforces it when geofence is an exception;
      // empty string sent as null so the server stores null for no-note cases.
      const clockOutNote = clockOutNoteText.trim() !== "" ? clockOutNoteText.trim() : null;

      await onClockOut(timesheetId, {
        breakDurationMinutes: breakParsed,
        clockOutLocation,
        clockOutNote,
      });
      // Clear note state after successful clock-out.
      setClockOutNoteText("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-out failed. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  // ── Warning confirmation handlers ──────────────────────────────────────────

  function handleGeofenceConfirm(): void {
    if (!pendingAction || !pendingLocation) return;
    if (pendingAction === "in") {
      void submitClockIn(pendingLocation);
    } else {
      if (!openEntry) return;
      const breakParsed = parseInt(breakMins, 10);
      void submitClockOut(openEntry.id, Number.isNaN(breakParsed) ? 0 : breakParsed, pendingLocation);
    }
  }

  function handleGeofenceCancel(): void {
    setPendingLocation(null);
    setPendingAction(null);
    setIsBusy(false);
  }

  // ── Active shift: Clock Out ──────────────────────────────────────────────
  if (openEntry) {
    // Show the geofence warning panel when a pending confirmation is waiting.
    if (pendingLocation && pendingAction === "out") {
      return (
        <div className="pr-clock-card pr-clock-card--active ts-clock-card">
          <div className="ts-clock-status-row">
            <span className="vds-badge vds-badge--success ts-clock-badge">Active shift</span>
          </div>
          <GeofenceWarningPanel
            location={pendingLocation}
            actionLabel="Clock Out"
            onConfirm={handleGeofenceConfirm}
            onCancel={handleGeofenceCancel}
            isBusy={isBusy}
            note={clockOutNoteText}
            onNoteChange={setClockOutNoteText}
          />
        </div>
      );
    }

    return (
      <div className="pr-clock-card pr-clock-card--active ts-clock-card">
        {/* Status row — badge + live clock-in location signal */}
        <div className="ts-clock-status-row">
          <span className="vds-badge vds-badge--success ts-clock-badge">Active shift</span>
          {/* Live geofence state from the clock-in event */}
          <TsLocationBadge status={liveClockInState ?? toTsLocationState(openEntry.clockInLocation)} />
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
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="clock-out-note">
              Clock Out Note <span className="pr-clock-form__label-optional">(optional)</span>
            </label>
            <textarea
              id="clock-out-note"
              className="pr-clock-form__control ts-clock-note"
              rows={2}
              maxLength={500}
              placeholder="Add a note (e.g. 'Emergency patient — stayed back')"
              value={clockOutNoteText}
              onChange={(e) => { setClockOutNoteText(e.target.value); }}
              disabled={isBusy}
            />
          </div>
          <div className="pr-clock-form__actions ts-clock-actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--clock-out"
              onClick={() => { void initiateClockOut(); }}
              disabled={isBusy}
            >
              {isBusy ? "Checking location…" : "Clock Out"}
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
  if (pendingLocation && pendingAction === "in") {
    return (
      <div className="pr-clock-card ts-clock-card ts-clock-card--idle">
        <div className="ts-clock-status-row">
          <span className="vds-badge vds-badge--neutral ts-clock-badge">No active shift</span>
        </div>
        <GeofenceWarningPanel
          location={pendingLocation}
          actionLabel="Clock In"
          onConfirm={handleGeofenceConfirm}
          onCancel={handleGeofenceCancel}
          isBusy={isBusy}
          note={clockInNoteText}
          onNoteChange={setClockInNoteText}
        />
      </div>
    );
  }

  return (
    <div className="pr-clock-card ts-clock-card ts-clock-card--idle">
      {/* Status row — badge (location badge shown after clock-in, not before) */}
      <div className="ts-clock-status-row">
        <span className="vds-badge vds-badge--neutral ts-clock-badge">No active shift</span>
        <MapPin size={14} aria-hidden="true" className="ts-clock-location-hint" />
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
          /* ── Ad-hoc mode: physical location selector + editable time inputs ── */
          <>
            {/* Physical Location selector — required for ad-hoc clock-ins.
                Staff must explicitly confirm which clinic they are working at. */}
            <div className="pr-clock-form__field">
              <label className="pr-clock-form__label" htmlFor="physical-clinic-select">
                Physical location
              </label>
              <select
                id="physical-clinic-select"
                className="pr-clock-form__control"
                value={selectedPhysicalClinicId ?? ""}
                onChange={(e) => {
                  setSelectedPhysicalClinicId(e.target.value || null);
                  setFormError(null); // clear the "select location" error on change
                }}
                disabled={isBusy}
                aria-required="true"
              >
                <option value="">Select physical location…</option>
                {availableClinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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

        <div className="pr-clock-form__field">
          <label className="pr-clock-form__label" htmlFor="clock-in-note">
            Clock In Note <span className="pr-clock-form__label-optional">(optional)</span>
          </label>
          <textarea
            id="clock-in-note"
            className="pr-clock-form__control ts-clock-note"
            rows={2}
            maxLength={500}
            placeholder="Add a note (e.g. 'Covering at Heathmont today')"
            value={clockInNoteText}
            onChange={(e) => { setClockInNoteText(e.target.value); }}
            disabled={isBusy}
          />
        </div>

        <div className="pr-clock-form__actions ts-clock-actions">
          <button
            type="button"
            className="vds-btn vds-btn--primary ts-clock-btn-primary"
            onClick={() => { void initiateClockIn(); }}
            disabled={isBusy}
          >
            {isBusy ? "Checking location…" : "Clock In"}
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
            {/* Manager's response on the timesheet — distinct from staff notes */}
            <th className="pr-table__th">Approval / Rejection Note</th>
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
              {/* Stage 5: TsLocationBadge wired to live geofence data */}
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockInAt)}</span>
                <TsLocationBadge
                  status={geofenceToLocationState(entry.clockInLocation)}
                  distanceMetres={entry.clockInLocation?.distanceMetres}
                />
              </td>
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
                <TsLocationBadge
                  status={geofenceToLocationState(entry.clockOutLocation)}
                  distanceMetres={entry.clockOutLocation?.distanceMetres}
                />
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
              {/* Approver comment — shown to staff so they understand approval/rejection reasons.
                  Kept visually distinct from clockInNote / clockOutNote (staff-authored).
                  Renders "—" when the manager left no comment. */}
              <td className="pr-table__td ts-approval-note-cell">
                {entry.approvalNotes ?? "—"}
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
            <th className="pr-table__th">Location</th>
            <th className="pr-table__th">Staff Note</th>
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
                <TsLocationBadge
                  status={geofenceToLocationState(entry.clockInLocation)}
                  distanceMetres={entry.clockInLocation?.distanceMetres}
                />
              </td>
              <td className="pr-table__td pr-table__td--clocked">
                <span className="pr-table__td-time">{formatDateTime(entry.clockOutAt)}</span>
                <TsLocationBadge
                  status={geofenceToLocationState(entry.clockOutLocation)}
                  distanceMetres={entry.clockOutLocation?.distanceMetres}
                />
              </td>
              <td className="pr-table__td pr-table__td--mono">
                {formatHours(entry.totalHoursWorked)}
              </td>
              <td className="pr-table__td ts-geofence-cell">
                <GeofenceSummaryCell
                  clockInLoc={entry.clockInLocation}
                  clockOutLoc={entry.clockOutLocation}
                />
              </td>
              <td className="pr-table__td ts-staff-note-cell">
                {(entry.clockInNote ?? entry.clockOutNote) ? (
                  <span
                    className="ts-staff-note"
                    title={[entry.clockInNote, entry.clockOutNote].filter(Boolean).join(" / ")}
                  >
                    {entry.clockInNote ?? entry.clockOutNote}
                  </span>
                ) : null}
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

  // ── Today's roster shifts (all roles) ────────────────────────────────────
  // Fetched once per page mount so ClockWidget can include the exact
  // rosterEntryId in the clock-in request.  Available to all authenticated
  // roles — managers and admins are also entitled to their own personal Clock
  // In/Out.  Errors are silently ignored; widget falls back to ad-hoc mode.
  const [todayShifts, setTodayShifts] = useState<RosterEntry[]>([]);
  const [attendanceClinics, setAttendanceClinics] = useState<
    { id: string; name: string }[]
  >([]);

  // Available clinics for ad-hoc physical location selection.
  // Attendance eligibility is deliberately separate from operational/module
  // scope. Merge the dedicated attendance endpoint, home/current clinic, and
  // clinics from the caller's own cross-clinic roster shifts.
  // MUST be computed before early returns (useMemo is a hook call).
  // MUST be declared after todayShifts useState (used in dependency array).
  const availableClinics = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of attendanceClinics) {
      map.set(c.id, c.name);
    }
    if (user) {
      map.set(user.homeClinicId, user.homeClinicName);
    }
    if (
      clinicId &&
      (clinicId === user?.homeClinicId || map.has(clinicId))
    ) {
      map.set(clinicId, clinicName ?? user?.homeClinicName ?? "Home Clinic");
    }
    for (const s of todayShifts) {
      map.set(s.rosteredClinicId, s.rosteredClinicName);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [attendanceClinics, clinicId, clinicName, todayShifts, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void apiClient
      .getMyAttendanceClinics()
      .then((clinics) => {
        if (!cancelled) setAttendanceClinics(clinics);
      })
      .catch(() => {
        if (!cancelled) {
          setAttendanceClinics([
            { id: user.homeClinicId, name: user.homeClinicName },
          ]);
        }
      });

    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // ±12-hour window captures any shift whose scheduled start falls within
    // a generous "today" regardless of the Melbourne / UTC offset.
    const now = new Date();
    const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const to   = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    void apiClient
      .getMyShiftsAllClinics({ from, to })
      .then((shifts) => {
        if (!cancelled) {
          setTodayShifts(shifts.filter((s) => s.status !== "cancelled"));
        }
      })
      .catch(() => {
        // Silently ignore — ClockWidget falls back to ad-hoc mode.
      });

    return () => { cancelled = true; };
  }, [user]);

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

  // When All Clinics is selected, clinicId is undefined.  Show a controlled
  // "select a clinic" message BEFORE the clinicId null-guard fires — otherwise
  // the null-guard returns blank and this branch is never reached.
  if (isAllClinicsScope && isManager) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to use Timesheets</h2>
          <p>
            Timesheets and Clock In/Out are managed at clinic level. Choose a clinic from the
            clinic selector to continue.
          </p>
        </section>
      </AppShell>
    );
  }

  // clinicId from useOperationalClinic() is `string | undefined`; early-return
  // here narrows it to `string` for all JSX below (passed to ClockWidget props).
  // The isAllClinicsScope branch above already handles the only legitimate case
  // where clinicId is undefined, so this guard catches unexpected missing context.
  if (!clinicId) return null;

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

  // The caller's own open (clocked-in, not yet clocked-out) entry.
  // Scoped to user.id because managers see the full clinic list via
  // listTimesheets — without the identity check, a staff member's open entry
  // would appear as the manager's active session.
  const openEntry = timesheets.find(
    (t) =>
      t.staffUserId === user.id &&
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
            {/* ── Personal: Clock In / Clock Out (all roles) ── */}
            <div className="pr-section ts-hub__clock-section">
              <h2 className="pr-section__title">Today&apos;s Session</h2>
              <ClockWidget
                openEntry={openEntry}
                todayShifts={todayShifts}
                onClockIn={clockIn}
                onClockOut={clockOut}
                clinicId={clinicId}
                getClinicCoordinates={apiClient.getClinicCoordinates}
                availableClinics={availableClinics}
              />
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
                clinicId={clinicId}
                getClinicCoordinates={apiClient.getClinicCoordinates}
                availableClinics={availableClinics}
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
