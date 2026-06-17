import { Fragment, useState } from "react";

import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useTimesheets } from "../hooks/useTimesheets.js";
import type {
  AttendanceStatus,
  ClockInRequest,
  ClockOutRequest,
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
import { canManagePayroll } from "../utils/roles.js";

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

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
    "T" +
    [pad(date.getHours()), pad(date.getMinutes())].join(":")
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
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, notes: string) => Promise<void>;
};

function ApprovalQueue({ entries, onApprove, onReject }: ApprovalQueueProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleApprove(id: string): Promise<void> {
    setIsBusy(true);
    setActionError(null);
    try {
      await onApprove(id);
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
                <td className="pr-table__td">{formatDateTime(entry.clockInAt)}</td>
                <td className="pr-table__td">{formatDateTime(entry.clockOutAt)}</td>
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
                      onClick={() => { void handleApprove(entry.id); }}
                      disabled={isBusy}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--reject"
                      onClick={() => {
                        setRejectingId(entry.id === rejectingId ? null : entry.id);
                        setRejectNotes("");
                        setActionError(null);
                      }}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
              {rejectingId === entry.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={8} className="pr-table__td">
                    <div className="pr-inline-form">
                      <input
                        className="pr-inline-form__input"
                        type="text"
                        placeholder="Rejection reason (required)…"
                        value={rejectNotes}
                        onChange={(e) => { setRejectNotes(e.target.value); }}
                        disabled={isBusy}
                      />
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--reject"
                        onClick={() => { void handleRejectSubmit(entry.id); }}
                        disabled={isBusy}
                      >
                        {isBusy ? "Saving…" : "Confirm"}
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
  homeClinicId: string;
  homeClinicName: string;
  onClockIn: (payload: ClockInRequest) => Promise<TimesheetEntry>;
  onClockOut: (timesheetId: string, payload: ClockOutRequest) => Promise<TimesheetEntry>;
};

function ClockWidget({
  openEntry,
  homeClinicId,
  homeClinicName,
  onClockIn,
  onClockOut,
}: ClockWidgetProps) {
  const nowDate = new Date();
  const laterDate = new Date(nowDate.getTime() + 8 * 60 * 60 * 1000);

  const [showForm, setShowForm] = useState(false);
  const [startAt, setStartAt] = useState(() => toDatetimeLocal(nowDate));
  const [endAt, setEndAt] = useState(() => toDatetimeLocal(laterDate));
  const [clockOutAt, setClockOutAt] = useState(() => toDatetimeLocal(nowDate));
  const [breakMins, setBreakMins] = useState("30");
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleClockIn(): Promise<void> {
    setIsBusy(true);
    setFormError(null);
    try {
      await onClockIn({
        rosteredClinicId: homeClinicId,
        rosteredClinicName: homeClinicName,
        shiftStartAt: new Date(startAt).toISOString(),
        shiftEndAt: new Date(endAt).toISOString(),
      });
      setShowForm(false);
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
      await onClockOut(openEntry.id, {
        clockOutAt: new Date(clockOutAt).toISOString(),
        breakDurationMinutes: breakParsed,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Clock-out failed. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  if (openEntry) {
    return (
      <div className="pr-clock-card pr-clock-card--active">
        <p className="pr-clock-card__status-label">Active Shift</p>
        <p className="pr-clock-card__shift-info">
          Clocked in at <strong>{formatDateTime(openEntry.clockInAt)}</strong>
        </p>
        <p className="pr-clock-card__shift-info">
          Planned end: <strong>{formatDateTime(openEntry.shiftEndAt)}</strong>
        </p>
        <div className="pr-clock-form pr-clock-form--out">
          <div className="pr-clock-form__field">
            <label className="pr-clock-form__label" htmlFor="clock-out-at">
              Clock-out time
            </label>
            <input
              id="clock-out-at"
              type="datetime-local"
              className="pr-clock-form__control"
              value={clockOutAt}
              onChange={(e) => { setClockOutAt(e.target.value); }}
              disabled={isBusy}
            />
          </div>
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
          <div className="pr-clock-form__actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--reject"
              onClick={() => { void handleClockOut(); }}
              disabled={isBusy}
            >
              {isBusy ? "Saving…" : "End Shift"}
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

  return (
    <div className="pr-clock-card">
      <p className="pr-clock-card__status-label">No active shift</p>
      {!showForm ? (
        <button
          type="button"
          className="pr-action-btn pr-action-btn--submit"
          onClick={() => { setShowForm(true); }}
        >
          Start Shift
        </button>
      ) : (
        <div className="pr-clock-form">
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
          <div className="pr-clock-form__actions">
            <button
              type="button"
              className="pr-action-btn pr-action-btn--submit"
              onClick={() => { void handleClockIn(); }}
              disabled={isBusy}
            >
              {isBusy ? "Clocking in…" : "Clock In"}
            </button>
            <button
              type="button"
              className="pr-inline-form__cancel"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              disabled={isBusy}
            >
              Cancel
            </button>
          </div>
          {formError ? (
            <p className="pr-clock-form__error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      )}
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
              <td className="pr-table__td">{formatDateTime(entry.clockInAt)}</td>
              <td className="pr-table__td">{formatDateTime(entry.clockOutAt)}</td>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function TimesheetsPage() {
  const { user } = useAuth();

  // Stable 30-day window initialised once at mount — avoids refetch on re-render.
  const [filters] = useState<TimesheetFilters>(() => ({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  }));

  const isManager = user ? canManagePayroll(user.role) : false;

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
  } = useTimesheets(user?.homeClinicId, user?.role, filters);

  if (!user) return null;

  // Client-side splits for the two manager queues.
  const pendingApproval = timesheets.filter(
    (t) => t.timesheetStatus === "submitted" && t.payrollType !== "commission_log",
  );
  const pendingCommission = timesheets.filter(
    (t) =>
      t.payrollType === "commission_log" &&
      t.attendanceStatus === "pending_verification",
  );

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
    : "your shift history and clock-in/out";

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Timesheets</h2>
            <p className="inventory-page__subtitle">
              {user.homeClinicName} — {subtitleText}
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={refetch}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="status-card__error" role="alert">
            {error}
          </p>
        ) : isLoading ? (
          <p className="loading-message">Loading timesheets…</p>
        ) : isManager ? (
          <>
            {/* ── Manager: Hourly approval queue ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">
                Hourly Approval Queue
                {pendingApproval.length > 0 ? (
                  <span className="pr-section__count pr-section__count--warn">
                    {pendingApproval.length}
                  </span>
                ) : null}
              </h3>
              <ApprovalQueue
                entries={pendingApproval}
                onApprove={async (id) => {
                  await approveTimesheet(id, {});
                }}
                onReject={async (id, notes) => {
                  await rejectTimesheet(id, { approvalNotes: notes });
                }}
              />
            </div>

            {/* ── Manager: Commission attendance verification ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">
                Commission Attendance Verification
                {pendingCommission.length > 0 ? (
                  <span className="pr-section__count pr-section__count--warn">
                    {pendingCommission.length}
                  </span>
                ) : null}
              </h3>
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
          <>
            {/* ── Staff: Clock widget ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">Today&apos;s Session</h3>
              <ClockWidget
                openEntry={openEntry}
                homeClinicId={user.homeClinicId}
                homeClinicName={user.homeClinicName}
                onClockIn={clockIn}
                onClockOut={clockOut}
              />
            </div>

            {/* ── Staff: Personal timesheet ledger ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">My Timesheet Ledger (Last 30 Days)</h3>
              <MyLedger entries={timesheets} />
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
