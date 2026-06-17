import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { UserRole } from "../types/index.js";
import type {
  ApproveLeaveRequest,
  CreateLeaveRequest,
  LeaveFilters,
  LeaveRequest,
  RejectLeaveRequest,
} from "../types/payroll.js";
import { canManagePayroll } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

export type UseLeaveResult = {
  /**
   * Leave requests visible to the current user.
   *   - Managers see all clinic requests (via `listLeave`).
   *   - Staff see only their own requests (via `listMyLeave`).
   */
  requests: LeaveRequest[];
  isLoading: boolean;
  error: string | null;
  /** Re-run the last fetch immediately. */
  refetch: () => void;
  /**
   * Submit a new leave request.
   * Available to all authenticated roles — the backend scopes the created
   * record to the authenticated user's own identity.
   */
  submitRequest: (payload: CreateLeaveRequest) => Promise<LeaveRequest>;
  /**
   * Approve a pending leave request (manager/admin only).
   * `reviewNotes` is optional for approvals.
   */
  approveLeave: (leaveId: string, payload?: ApproveLeaveRequest) => Promise<LeaveRequest>;
  /**
   * Reject a leave request (manager/admin only).
   * `reviewNotes` is required so the staff member understands the reason.
   */
  rejectLeave: (leaveId: string, payload: RejectLeaveRequest) => Promise<LeaveRequest>;
  /**
   * Withdraw a pending leave request.
   * Staff may withdraw their own requests; the backend enforces ownership.
   * `owner_admin` may also withdraw on behalf of a staff member.
   */
  withdrawLeave: (leaveId: string) => Promise<LeaveRequest>;
};

/**
 * Loads leave requests for a clinic with **dual-view fetching** based on role:
 *
 *   - `owner_admin` / `group_practice_manager` — calls
 *     `GET /clinics/:clinicId/leave` (clinic-wide, all staff, filterable).
 *   - `clinical_staff` — calls
 *     `GET /clinics/:clinicId/leave/me` (own requests only).
 *
 * The same `filters` object is forwarded to both endpoints so date-range
 * and status filters work consistently regardless of the caller's role.
 *
 * Automatically re-fetches when `clinicId`, `role`, or `filters` change.
 * The hook is a no-op while `clinicId` or `role` is undefined.
 */
export function useLeave(
  clinicId: string | undefined,
  role: UserRole | undefined,
  filters: LeaveFilters = {},
): UseLeaveResult {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable serialisation so useCallback dependency array stays shallow.
  const filtersKey = JSON.stringify(filters);

  const fetch = useCallback(() => {
    if (!clinicId || !role) return;

    setIsLoading(true);
    setError(null);

    // Dual-view dispatch: managers see all clinic requests; staff see their own.
    const request = canManagePayroll(role)
      ? apiClient.listLeave(clinicId, filters)
      : apiClient.listMyLeave(clinicId, filters);

    void request
      .then((result) => {
        setRequests(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load leave requests");
        setRequests([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
    // filtersKey is the stable proxy for the filters object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, role, filtersKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const submitRequest = useCallback(
    async (payload: CreateLeaveRequest): Promise<LeaveRequest> => {
      if (!clinicId) throw new Error("No clinic selected");
      const created = await apiClient.createLeaveRequest(clinicId, payload);
      fetch();
      return created;
    },
    [clinicId, fetch],
  );

  const approveLeave = useCallback(
    async (leaveId: string, payload: ApproveLeaveRequest = {}): Promise<LeaveRequest> => {
      if (!clinicId) throw new Error("No clinic selected");
      if (!canManagePayroll(role ?? "clinical_staff")) {
        throw new Error("Insufficient permissions to approve leave requests");
      }
      const updated = await apiClient.approveLeave(clinicId, leaveId, payload);
      fetch();
      return updated;
    },
    [clinicId, role, fetch],
  );

  const rejectLeave = useCallback(
    async (leaveId: string, payload: RejectLeaveRequest): Promise<LeaveRequest> => {
      if (!clinicId) throw new Error("No clinic selected");
      if (!canManagePayroll(role ?? "clinical_staff")) {
        throw new Error("Insufficient permissions to reject leave requests");
      }
      const updated = await apiClient.rejectLeave(clinicId, leaveId, payload);
      fetch();
      return updated;
    },
    [clinicId, role, fetch],
  );

  const withdrawLeave = useCallback(
    async (leaveId: string): Promise<LeaveRequest> => {
      if (!clinicId) throw new Error("No clinic selected");
      const updated = await apiClient.withdrawLeave(clinicId, leaveId);
      fetch();
      return updated;
    },
    [clinicId, fetch],
  );

  return {
    requests,
    isLoading,
    error,
    refetch: fetch,
    submitRequest,
    approveLeave,
    rejectLeave,
    withdrawLeave,
  };
}
