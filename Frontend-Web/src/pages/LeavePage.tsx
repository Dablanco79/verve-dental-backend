import React, { Fragment, useState } from "react";

import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { useLeave } from "../hooks/useLeave.js";
import type {
  ApproveLeaveResult,
  CreateLeaveRequest,
  LeaveCancellationRequest,
  LeaveFilters,
  LeaveRequest,
  LeaveRosterConflict,
  LeaveRequestStatus,
  LeaveType,
} from "../types/payroll.js";
import {
  LEAVE_REQUEST_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
} from "../types/payroll.js";
import { canManagePayroll } from "../utils/roles.js";

// ── Utility helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  return Math.floor(
    (Date.UTC(ey ?? 0, (em ?? 1) - 1, ed ?? 1) -
      Date.UTC(sy ?? 0, (sm ?? 1) - 1, sd ?? 1)) /
      86_400_000,
  ) + 1;
}

// ── Badge components ─────────────────────────────────────────────────────────

function LeaveStatusBadge({ status }: { status: LeaveRequestStatus }) {
  return (
    <span className={`lv-badge lv-badge--${status}`}>
      {LEAVE_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

function LeaveTypeBadge({ type }: { type: LeaveType }) {
  return (
    <span className={`lv-badge lv-badge--${type}`}>
      {LEAVE_TYPE_LABELS[type]}
    </span>
  );
}

// ── Manager: Pending leave approval queue ────────────────────────────────────

type PendingLeaveQueueProps = {
  entries: LeaveRequest[];
  onApprove: (id: string) => Promise<ApproveLeaveResult>;
  onReject: (id: string, notes: string) => Promise<void>;
};

function PendingLeaveQueue({ entries, onApprove, onReject }: PendingLeaveQueueProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] = useState<ApproveLeaveResult | null>(null);

  async function handleApprove(id: string): Promise<void> {
    setIsBusy(true);
    setActionError(null);
    try {
      const result = await onApprove(id);
      setApprovalResult(result);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRejectSubmit(id: string): Promise<void> {
    if (!rejectNotes.trim()) {
      setActionError("A rejection reason is required so the staff member understands why.");
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

  if (entries.length === 0 && !approvalResult) {
    return (
      <p className="pr-table__empty">No leave requests pending your approval.</p>
    );
  }

  return (
    <>
      {approvalResult ? (
        <div className="lv-approval-result" role="status">
          <strong>Leave was approved.</strong>
          {approvalResult.conflicts.length > 0 ? (
            <>
              <p>
                Existing shifts remain unchanged. Manual roster action is required for:
              </p>
              <ul>
                {approvalResult.conflicts.map((conflict) => (
                  <li key={conflict.rosterEntryId}>
                    {conflict.rosteredClinicName}:{" "}
                    {new Date(conflict.shiftStartAt).toLocaleString("en-AU")} –{" "}
                    {new Date(conflict.shiftEndAt).toLocaleTimeString("en-AU")}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No existing roster shifts conflict with this leave.</p>
          )}
        </div>
      ) : null}
      {entries.length > 0 ? <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">From</th>
            <th className="pr-table__th">To</th>
            <th className="pr-table__th">Days</th>
            <th className="pr-table__th">Reason</th>
            <th className="pr-table__th" />
          </tr>
        </thead>
        <tbody>
          {entries.map((req) => (
            <Fragment key={req.id}>
              <tr className="pr-table__row">
                <td className="pr-table__td">{req.staffEmail}</td>
                <td className="pr-table__td">
                  <LeaveTypeBadge type={req.leaveType} />
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatDate(req.startDate)}
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatDate(req.endDate)}
                </td>
                <td className="pr-table__td pr-table__td--mono">{req.totalDays}</td>
                <td className="pr-table__td">{req.reason ?? "—"}</td>
                <td className="pr-table__td pr-table__td--actions">
                  <div className="pr-row-actions">
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--approve"
                      onClick={() => { void handleApprove(req.id); }}
                      disabled={isBusy}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--reject"
                      onClick={() => {
                        setRejectingId(req.id === rejectingId ? null : req.id);
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
              {rejectingId === req.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={7} className="pr-table__td">
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
                        onClick={() => { void handleRejectSubmit(req.id); }}
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
      </div> : null}
    </>
  );
}

// ── Manager: Pending cancellation request queue ──────────────────────────────

function PendingCancellationQueue({
  entries,
  leaveRequests,
  onApprove,
  onDecline,
}: {
  entries: LeaveCancellationRequest[];
  leaveRequests: LeaveRequest[];
  onApprove: (request: LeaveCancellationRequest) => Promise<unknown>;
  onDecline: (request: LeaveCancellationRequest, notes: string) => Promise<LeaveCancellationRequest>;
}) {
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function approve(request: LeaveCancellationRequest): Promise<void> {
    setBusyId(request.id);
    setActionError(null);
    try {
      await onApprove(request);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function decline(request: LeaveCancellationRequest): Promise<void> {
    if (!reviewNotes.trim()) {
      setActionError("Review notes are required to decline a cancellation request.");
      return;
    }
    setBusyId(request.id);
    setActionError(null);
    try {
      await onDecline(request, reviewNotes.trim());
      setDecliningId(null);
      setReviewNotes("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Decline failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (entries.length === 0) {
    return <p className="pr-table__empty">No cancellation requests pending review.</p>;
  }

  return (
    <div className="pr-table-wrap">
      <p>Roster blocks remain in place until a cancellation request is approved. No shifts are changed or restored.</p>
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Leave</th>
            <th className="pr-table__th">Request Reason</th>
            <th className="pr-table__th">Requested</th>
            <th className="pr-table__th" />
          </tr>
        </thead>
        <tbody>
          {entries.map((request) => {
            const leave = leaveRequests.find((item) => item.id === request.leaveRequestId);
            return (
              <Fragment key={request.id}>
                <tr className="pr-table__row">
                  <td className="pr-table__td">{leave?.staffEmail ?? request.staffUserId}</td>
                  <td className="pr-table__td">
                    {leave ? `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}` : "—"}
                  </td>
                  <td className="pr-table__td">{request.requestReason}</td>
                  <td className="pr-table__td">{formatDate(request.requestedAt)}</td>
                  <td className="pr-table__td pr-table__td--actions">
                    <div className="pr-row-actions">
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--approve"
                        disabled={busyId !== null}
                        onClick={() => { void approve(request); }}
                      >
                        {busyId === request.id ? "Saving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--reject"
                        disabled={busyId !== null}
                        onClick={() => {
                          setDecliningId(decliningId === request.id ? null : request.id);
                          setReviewNotes("");
                          setActionError(null);
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
                {decliningId === request.id ? (
                  <tr className="pr-table__row pr-table__row--expanded">
                    <td colSpan={5} className="pr-table__td">
                      <div className="pr-inline-form">
                        <textarea
                          className="pr-inline-form__input"
                          aria-label="Cancellation decline notes"
                          placeholder="Review notes (required)…"
                          value={reviewNotes}
                          onChange={(event) => { setReviewNotes(event.target.value); }}
                          disabled={busyId !== null}
                        />
                        <button
                          type="button"
                          className="pr-action-btn pr-action-btn--reject"
                          onClick={() => { void decline(request); }}
                          disabled={busyId !== null}
                        >
                          Confirm Decline
                        </button>
                      </div>
                      {actionError ? <p className="pr-inline-form__error" role="alert">{actionError}</p> : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Manager: All-requests read-only table ────────────────────────────────────

function AllLeaveTable({
  entries,
  cancellationRequests,
  onReviewConflicts,
  onCancelApprovedLeave,
}: {
  entries: LeaveRequest[];
  cancellationRequests: LeaveCancellationRequest[];
  onReviewConflicts: (leaveId: string) => Promise<LeaveRosterConflict[]>;
  onCancelApprovedLeave: (leaveId: string, cancellationReason: string) => Promise<LeaveRequest>;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, LeaveRosterConflict[]>>({});
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);

  async function reviewConflicts(leaveId: string): Promise<void> {
    setReviewingId(leaveId);
    setConflictError(null);
    try {
      const result = await onReviewConflicts(leaveId);
      setConflicts((current) => ({ ...current, [leaveId]: result }));
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : "Unable to load roster conflicts.");
    } finally {
      setReviewingId(null);
    }
  }

  async function cancelApprovedLeave(leaveId: string): Promise<void> {
    const reason = cancellationReason.trim();
    if (!reason) {
      setCancellationError("A cancellation reason is required.");
      return;
    }
    setIsCancelling(true);
    setCancellationError(null);
    try {
      await onCancelApprovedLeave(leaveId, reason);
      setConflicts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([currentLeaveId]) => currentLeaveId !== leaveId),
        ),
      );
      setCancellingId(null);
      setCancellationReason("");
      setCancelledMessage(
        "Approved leave was cancelled. Leave blocks are removed when the roster is refreshed; no shifts were created, restored, moved or changed.",
      );
    } catch (error) {
      setCancellationError(
        error instanceof Error ? error.message : "Unable to cancel approved leave.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">No leave requests found for the last 90 days.</p>
    );
  }

  return (
    <div className="pr-table-wrap">
      {cancelledMessage ? (
        <p className="lv-cancellation-result" role="status">{cancelledMessage}</p>
      ) : null}
      <table className="pr-table">
        <thead>
          <tr>
            <th className="pr-table__th">Staff</th>
            <th className="pr-table__th">Type</th>
            <th className="pr-table__th">From</th>
            <th className="pr-table__th">To</th>
            <th className="pr-table__th">Days</th>
            <th className="pr-table__th">Status</th>
            <th className="pr-table__th">Decision Details</th>
            <th className="pr-table__th">Roster / Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((req) => (
            <Fragment key={req.id}>
            <tr className="pr-table__row">
              <td className="pr-table__td">{req.staffEmail}</td>
              <td className="pr-table__td">
                <LeaveTypeBadge type={req.leaveType} />
              </td>
              <td className="pr-table__td pr-table__td--mono">
                {formatDate(req.startDate)}
              </td>
              <td className="pr-table__td pr-table__td--mono">
                {formatDate(req.endDate)}
              </td>
              <td className="pr-table__td pr-table__td--mono">{req.totalDays}</td>
              <td className="pr-table__td">
                <LeaveStatusBadge status={req.status} />
              </td>
              <td className="pr-table__td">
                {req.status === "cancelled"
                  ? req.cancellationReason ?? "—"
                  : req.reviewNotes ?? "—"}
              </td>
              <td className="pr-table__td">
                {req.status === "approved" ? (
                  <>
                    <button
                      type="button"
                      className="button-link"
                      disabled={reviewingId === req.id}
                      onClick={() => { void reviewConflicts(req.id); }}
                    >
                      {reviewingId === req.id ? "Checking…" : "Review conflicts"}
                    </button>
                    {conflicts[req.id] ? (
                      (conflicts[req.id]?.length ?? 0) > 0 ? (
                        <>
                          <span className="lv-conflict-count">
                            {conflicts[req.id]?.length ?? 0} unresolved
                          </span>
                          <ul className="lv-conflict-list">
                            {(conflicts[req.id] ?? []).map((conflict) => (
                              <li key={conflict.rosterEntryId}>
                                {conflict.rosteredClinicName},{" "}
                                {new Date(conflict.shiftStartAt).toLocaleString("en-AU")}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <span className="lv-conflict-count">None</span>
                      )
                    ) : null}
                    {cancellationRequests.some(
                      (request) => request.leaveRequestId === req.id && request.status === "pending",
                    ) ? (
                      <p>A cancellation request is pending. Review it in the queue above.</p>
                    ) : (
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--reject"
                        disabled={isCancelling}
                        onClick={() => {
                          setCancellingId(req.id === cancellingId ? null : req.id);
                          setCancellationReason("");
                          setCancellationError(null);
                          setCancelledMessage(null);
                        }}
                      >
                        Cancel Approved Leave
                      </button>
                    )}
                  </>
                ) : "—"}
              </td>
            </tr>
            {cancellingId === req.id ? (
              <tr className="pr-table__row pr-table__row--expanded">
                <td colSpan={8} className="pr-table__td">
                  <div className="pr-inline-form pr-inline-form--rejection">
                    <div>
                      <strong>Cancel approved leave?</strong>
                      <p>
                        This removes approved leave blocks after roster refresh. It does not
                        create, restore, move or change any shifts.
                      </p>
                    </div>
                    <textarea
                      className="pr-inline-form__input"
                      aria-label="Cancellation reason"
                      placeholder="Cancellation reason (required)…"
                      value={cancellationReason}
                      onChange={(event) => { setCancellationReason(event.target.value); }}
                      disabled={isCancelling}
                      maxLength={2000}
                    />
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--reject"
                      onClick={() => { void cancelApprovedLeave(req.id); }}
                      disabled={isCancelling}
                    >
                      {isCancelling ? "Cancelling…" : "Confirm Cancellation"}
                    </button>
                    <button
                      type="button"
                      className="pr-inline-form__cancel"
                      onClick={() => {
                        setCancellingId(null);
                        setCancellationReason("");
                        setCancellationError(null);
                      }}
                      disabled={isCancelling}
                    >
                      Keep Approved Leave
                    </button>
                  </div>
                  {cancellationError ? (
                    <p className="pr-inline-form__error" role="alert">
                      {cancellationError}
                    </p>
                  ) : null}
                </td>
              </tr>
            ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      {conflictError ? <p className="status-card__error">{conflictError}</p> : null}
    </div>
  );
}

// ── Staff: Request leave form ────────────────────────────────────────────────

type RequestLeaveFormProps = {
  onSubmit: (payload: CreateLeaveRequest) => Promise<LeaveRequest>;
};

function RequestLeaveForm({ onSubmit }: RequestLeaveFormProps) {
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFormError(null);

    if (!startDate || !endDate) {
      setFormError("Start and end dates are required.");
      return;
    }
    if (endDate < startDate) {
      setFormError("End date must be on or after the start date.");
      return;
    }
    setIsBusy(true);
    try {
      await onSubmit({
        leaveType,
        startDate,
        endDate,
        reason: reason.trim() || null,
      });
      setSubmitted(true);
      // Reset form fields for the next submission.
      setStartDate("");
      setEndDate("");
      setReason("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="lv-request-form">
        <p className="lv-request-form__success">
          Leave request submitted! Your manager will review it shortly.
        </p>
        <div className="lv-request-form__actions">
          <button
            type="button"
            className="pr-action-btn pr-action-btn--submit"
            onClick={() => { setSubmitted(false); }}
          >
            Submit another request
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="lv-request-form"
      onSubmit={(e) => { void handleSubmit(e); }}
      noValidate
    >
      <div className="lv-request-form__field">
        <label className="lv-request-form__label" htmlFor="lv-type">
          Leave Type
        </label>
        <select
          id="lv-type"
          className="lv-request-form__control"
          value={leaveType}
          onChange={(e) => { setLeaveType(e.target.value as LeaveType); }}
          disabled={isBusy}
        >
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LEAVE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="lv-request-form__field">
        <label className="lv-request-form__label" htmlFor="lv-start">
          Start Date
        </label>
        <input
          id="lv-start"
          type="date"
          className="lv-request-form__control"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
          }}
          disabled={isBusy}
          required
        />
      </div>

      <div className="lv-request-form__field">
        <label className="lv-request-form__label" htmlFor="lv-end">
          End Date
        </label>
        <input
          id="lv-end"
          type="date"
          className="lv-request-form__control"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => { setEndDate(e.target.value); }}
          disabled={isBusy}
          required
        />
      </div>

      <div className="lv-request-form__field">
        <span className="lv-request-form__label">Whole Days</span>
        <output className="lv-request-form__control">
          {startDate && endDate ? inclusiveDayCount(startDate, endDate) : "—"}
        </output>
        <span className="lv-request-form__hint">
          Every calendar date from start through end is unavailable.
        </span>
      </div>

      <div className="lv-request-form__field lv-request-form__field--full">
        <label className="lv-request-form__label" htmlFor="lv-reason">
          Reason
          <span className="lv-request-form__hint"> (optional)</span>
        </label>
        <textarea
          id="lv-reason"
          className="lv-request-form__control lv-request-form__textarea"
          value={reason}
          onChange={(e) => { setReason(e.target.value); }}
          placeholder="Brief explanation for your leave request…"
          rows={3}
          maxLength={500}
          disabled={isBusy}
        />
      </div>

      {formError ? (
        <p className="lv-request-form__error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="lv-request-form__actions">
        <button
          type="submit"
          className="pr-action-btn pr-action-btn--submit"
          disabled={isBusy}
        >
          {isBusy ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </form>
  );
}

// ── Staff: My leave requests (with withdraw action) ──────────────────────────

type MyLeaveTableProps = {
  entries: LeaveRequest[];
  cancellationRequests: LeaveCancellationRequest[];
  onWithdraw: (id: string) => Promise<LeaveRequest>;
  onRequestCancellation: (
    leaveId: string,
    reason: string,
  ) => Promise<LeaveCancellationRequest>;
};

function MyLeaveTable({
  entries,
  cancellationRequests,
  onWithdraw,
  onRequestCancellation,
}: MyLeaveTableProps) {
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [requestingCancellationId, setRequestingCancellationId] = useState<string | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [isRequestingCancellation, setIsRequestingCancellation] = useState(false);

  async function handleWithdraw(id: string): Promise<void> {
    setWithdrawingId(id);
    setWithdrawError(null);
    try {
      await onWithdraw(id);
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Withdrawal failed.");
    } finally {
      setWithdrawingId(null);
    }
  }

  async function requestCancellation(leaveId: string): Promise<void> {
    if (!requestReason.trim()) {
      setCancellationError("A cancellation reason is required.");
      return;
    }
    setIsRequestingCancellation(true);
    setCancellationError(null);
    try {
      await onRequestCancellation(leaveId, requestReason.trim());
      setRequestingCancellationId(null);
      setRequestReason("");
    } catch (error) {
      setCancellationError(
        error instanceof Error ? error.message : "Unable to request cancellation.",
      );
    } finally {
      setIsRequestingCancellation(false);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="pr-table__empty">
        You have no leave requests in the last 90 days.
      </p>
    );
  }

  return (
    <>
      {withdrawError ? (
        <p className="status-card__error" role="alert" style={{ marginBottom: "0.75rem" }}>
          {withdrawError}
        </p>
      ) : null}
      <div className="pr-table-wrap">
        <table className="pr-table">
          <thead>
            <tr>
              <th className="pr-table__th">Type</th>
              <th className="pr-table__th">From</th>
              <th className="pr-table__th">To</th>
              <th className="pr-table__th">Days</th>
              <th className="pr-table__th">Status</th>
              <th className="pr-table__th">Decision Details</th>
              <th className="pr-table__th" />
            </tr>
          </thead>
          <tbody>
            {entries.map((req) => {
              const relatedRequests = cancellationRequests.filter(
                (request) => request.leaveRequestId === req.id,
              );
              const pendingCancellation = relatedRequests.find(
                (request) => request.status === "pending",
              );
              const latestCancellation = pendingCancellation ?? relatedRequests.at(-1);
              return (
              <Fragment key={req.id}>
              <tr className="pr-table__row">
                <td className="pr-table__td">
                  <LeaveTypeBadge type={req.leaveType} />
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatDate(req.startDate)}
                </td>
                <td className="pr-table__td pr-table__td--mono">
                  {formatDate(req.endDate)}
                </td>
                <td className="pr-table__td pr-table__td--mono">{req.totalDays}</td>
                <td className="pr-table__td">
                  <LeaveStatusBadge status={req.status} />
                </td>
                <td className="pr-table__td">
                  {latestCancellation
                    ? latestCancellation.status === "pending"
                      ? "Cancellation pending — approved leave and roster blocks remain in place."
                      : `Cancellation ${latestCancellation.status}: ${latestCancellation.reviewNotes ?? "No review notes."}`
                    : req.status === "cancelled"
                    ? req.cancellationReason ?? "—"
                    : req.reviewNotes ?? "—"}
                </td>
                <td className="pr-table__td pr-table__td--actions">
                  {req.status === "pending" ? (
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--withdraw"
                      onClick={() => { void handleWithdraw(req.id); }}
                      disabled={withdrawingId === req.id}
                    >
                      {withdrawingId === req.id ? "Withdrawing…" : "Withdraw"}
                    </button>
                  ) : req.status === "approved" && !pendingCancellation ? (
                    <button
                      type="button"
                      className="pr-action-btn pr-action-btn--reject"
                      onClick={() => {
                        setRequestingCancellationId(
                          requestingCancellationId === req.id ? null : req.id,
                        );
                        setRequestReason("");
                        setCancellationError(null);
                      }}
                    >
                      Request Cancellation
                    </button>
                  ) : pendingCancellation ? <span>Pending manager review</span> : null}
                </td>
              </tr>
              {requestingCancellationId === req.id ? (
                <tr className="pr-table__row pr-table__row--expanded">
                  <td colSpan={7} className="pr-table__td">
                    <div className="pr-inline-form">
                      <div>
                        <strong>Request cancellation of approved leave</strong>
                        <p>
                          No shifts will be changed or restored. Roster blocks remain until
                          a manager approves this request.
                        </p>
                      </div>
                      <textarea
                        className="pr-inline-form__input"
                        aria-label="Cancellation request reason"
                        placeholder="Cancellation reason (required)…"
                        value={requestReason}
                        onChange={(event) => { setRequestReason(event.target.value); }}
                        disabled={isRequestingCancellation}
                      />
                      <button
                        type="button"
                        className="pr-action-btn pr-action-btn--reject"
                        disabled={isRequestingCancellation}
                        onClick={() => { void requestCancellation(req.id); }}
                      >
                        {isRequestingCancellation ? "Submitting…" : "Submit Cancellation Request"}
                      </button>
                    </div>
                    {cancellationError ? (
                      <p className="pr-inline-form__error" role="alert">{cancellationError}</p>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LeavePage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();

  // Stable 90-day window — leave history is more meaningful over a longer period.
  const [filters] = useState<LeaveFilters>(() => ({
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  }));

  const isManager = user ? canManagePayroll(user.role) : false;

  const {
    requests,
    cancellationRequests,
    isLoading,
    error,
    refetch,
    submitRequest,
    approveLeave,
    listRosterConflicts,
    rejectLeave,
    cancelApprovedLeave,
    withdrawLeave,
    requestCancellation,
    approveCancellationRequest,
    declineCancellationRequest,
  } = useLeave(clinicId, user?.role, filters);

  if (!user) return null;

  if (isAllClinicsScope && isManager) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view leave</h2>
          <p>
            Leave management is clinic-specific. Choose a clinic from the clinic selector to
            review and approve leave requests.
          </p>
        </section>
      </AppShell>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const pendingCancellationRequests = cancellationRequests.filter(
    (request) => request.status === "pending",
  );

  const subtitleText = isManager
    ? `${String(pendingRequests.length)} pending approval`
    : "your leave requests and history";

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Leave Management</h2>
            <p className="inventory-page__subtitle">
              {clinicName ?? user.homeClinicName} — {subtitleText}
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
          <p className="loading-message">Loading leave requests…</p>
        ) : isManager ? (
          <>
            {/* ── Manager: Pending approval queue ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">
                Pending Approval
                {pendingRequests.length > 0 ? (
                  <span className="pr-section__count pr-section__count--warn">
                    {pendingRequests.length}
                  </span>
                ) : null}
              </h3>
              <PendingLeaveQueue
                entries={pendingRequests}
                onApprove={async (id) => {
                  return approveLeave(id, {});
                }}
                onReject={async (id, notes) => {
                  await rejectLeave(id, { reviewNotes: notes });
                }}
              />
            </div>

            <div className="pr-section">
              <h3 className="pr-section__title">
                Pending Cancellation Requests
                {pendingCancellationRequests.length > 0 ? (
                  <span className="pr-section__count pr-section__count--warn">
                    {pendingCancellationRequests.length}
                  </span>
                ) : null}
              </h3>
              <PendingCancellationQueue
                entries={pendingCancellationRequests}
                leaveRequests={requests}
                onApprove={async (request) => approveCancellationRequest(request, {})}
                onDecline={async (request, notes) =>
                  declineCancellationRequest(request, { reviewNotes: notes })}
              />
            </div>

            {/* ── Manager: All requests (last 90 days) ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">All Requests (Last 90 Days)</h3>
              <AllLeaveTable
                entries={requests}
                cancellationRequests={cancellationRequests}
                onReviewConflicts={listRosterConflicts}
                onCancelApprovedLeave={async (id, cancellationReason) => {
                  return cancelApprovedLeave(id, { cancellationReason });
                }}
              />
            </div>
          </>
        ) : (
          <>
            {/* ── Staff: Leave request form ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">Request Leave</h3>
              <RequestLeaveForm onSubmit={submitRequest} />
            </div>

            {/* ── Staff: My leave history ── */}
            <div className="pr-section">
              <h3 className="pr-section__title">My Requests (Last 90 Days)</h3>
              <MyLeaveTable
                entries={requests}
                cancellationRequests={cancellationRequests}
                onWithdraw={withdrawLeave}
                onRequestCancellation={async (leaveId, requestReason) =>
                  requestCancellation(leaveId, { requestReason })}
              />
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
