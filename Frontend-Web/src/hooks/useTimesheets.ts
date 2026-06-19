import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { UserRole } from "../types/index.js";
import type {
  ApproveTimesheetRequest,
  ClockInRequest,
  ClockOutRequest,
  RejectTimesheetRequest,
  TimesheetEntry,
  TimesheetFilters,
  VerifyAttendanceRequest,
} from "../types/payroll.js";
import { canManagePayroll } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

export type UseTimesheetsResult = {
  /** Timesheets visible to the current user for this clinic. */
  timesheets: TimesheetEntry[];
  isLoading: boolean;
  error: string | null;
  /** Re-run the last fetch immediately. */
  refetch: () => void;
  /**
   * Clock the current user into a shift.
   * Only available to `clinical_staff` — the backend also enforces this.
   * Returns the newly created TimesheetEntry.
   */
  clockIn: (payload: ClockInRequest) => Promise<TimesheetEntry>;
  /**
   * Clock the current user out of an open entry.
   * Only available to `clinical_staff` — the backend also enforces this.
   * Returns the updated TimesheetEntry.
   */
  clockOut: (timesheetId: string, payload: ClockOutRequest) => Promise<TimesheetEntry>;
  /**
   * Approve a timesheet entry (manager/admin only).
   * `approvalNotes` is optional — pass an empty object for a silent approval.
   */
  approveTimesheet: (
    timesheetId: string,
    payload?: ApproveTimesheetRequest,
  ) => Promise<TimesheetEntry>;
  /**
   * Reject a timesheet entry (manager/admin only).
   * `approvalNotes` is required so staff understand the reason.
   */
  rejectTimesheet: (
    timesheetId: string,
    payload: RejectTimesheetRequest,
  ) => Promise<TimesheetEntry>;
  /**
   * Verify a commission_log entry's attendance status (manager/admin only).
   * This is the **materials forecasting safeguard** mutation — setting
   * `attendanceStatus = 'present'` allows the forecasting engine to count
   * full material usage for that shift.
   */
  verifyCommissionAttendance: (
    timesheetId: string,
    payload: VerifyAttendanceRequest,
  ) => Promise<TimesheetEntry>;
};

/**
 * Loads timesheet entries for a clinic and exposes the full payroll action set.
 *
 * **Role-aware fetching:**
 *   - `owner_admin` / `group_practice_manager` — calls
 *     `GET /clinics/:clinicId/timesheets` (clinic-wide list, manager-only).
 *   - `clinical_staff` — calls
 *     `GET /clinics/:clinicId/timesheets/me` (own entries only).
 *     The clinic-wide endpoint returns 403 for clinical_staff.
 *
 * Automatically re-fetches when `clinicId`, `role`, or `filters` change.
 * The hook is a no-op while `clinicId` is undefined.
 */
export function useTimesheets(
  clinicId: string | undefined,
  role: UserRole | undefined,
  filters: TimesheetFilters = {},
): UseTimesheetsResult {
  const [timesheets, setTimesheets] = useState<TimesheetEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable serialisation of the filters object so useCallback can depend on it
  // without triggering on every render (same pattern as useBilling).
  const filtersKey = JSON.stringify(filters);

  const fetch = useCallback(() => {
    if (!clinicId || !role) return;

    setIsLoading(true);
    setError(null);

    // Route based on role:
    //   Managers → GET /timesheets   (clinic-wide list, PAYROLL_MANAGER_ROLES)
    //   Staff    → GET /timesheets/me (own entries only, PAYROLL_ALL_ROLES)
    // Using /timesheets for clinical_staff returns 403.
    const listFn = canManagePayroll(role)
      ? apiClient.listTimesheets(clinicId, filters)
      : apiClient.listMyTimesheets(clinicId, filters);

    void listFn
      .then((result) => {
        setTimesheets(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load timesheets");
        setTimesheets([]);
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

  const clockIn = useCallback(
    async (payload: ClockInRequest): Promise<TimesheetEntry> => {
      if (!clinicId) throw new Error("No clinic selected");
      const entry = await apiClient.clockIn(clinicId, payload);
      fetch();
      return entry;
    },
    [clinicId, fetch],
  );

  const clockOut = useCallback(
    async (timesheetId: string, payload: ClockOutRequest): Promise<TimesheetEntry> => {
      if (!clinicId) throw new Error("No clinic selected");
      const entry = await apiClient.clockOut(clinicId, timesheetId, payload);
      fetch();
      return entry;
    },
    [clinicId, fetch],
  );

  const approveTimesheet = useCallback(
    async (
      timesheetId: string,
      payload: ApproveTimesheetRequest = {},
    ): Promise<TimesheetEntry> => {
      if (!clinicId) throw new Error("No clinic selected");
      if (!canManagePayroll(role ?? "clinical_staff")) {
        throw new Error("Insufficient permissions to approve timesheets");
      }
      const entry = await apiClient.approveTimesheet(clinicId, timesheetId, payload);
      fetch();
      return entry;
    },
    [clinicId, role, fetch],
  );

  const rejectTimesheet = useCallback(
    async (
      timesheetId: string,
      payload: RejectTimesheetRequest,
    ): Promise<TimesheetEntry> => {
      if (!clinicId) throw new Error("No clinic selected");
      if (!canManagePayroll(role ?? "clinical_staff")) {
        throw new Error("Insufficient permissions to reject timesheets");
      }
      const entry = await apiClient.rejectTimesheet(clinicId, timesheetId, payload);
      fetch();
      return entry;
    },
    [clinicId, role, fetch],
  );

  const verifyCommissionAttendance = useCallback(
    async (
      timesheetId: string,
      payload: VerifyAttendanceRequest,
    ): Promise<TimesheetEntry> => {
      if (!clinicId) throw new Error("No clinic selected");
      if (!canManagePayroll(role ?? "clinical_staff")) {
        throw new Error("Insufficient permissions to verify commission attendance");
      }
      const entry = await apiClient.verifyCommissionAttendance(
        clinicId,
        timesheetId,
        payload,
      );
      fetch();
      return entry;
    },
    [clinicId, role, fetch],
  );

  return {
    timesheets,
    isLoading,
    error,
    refetch: fetch,
    clockIn,
    clockOut,
    approveTimesheet,
    rejectTimesheet,
    verifyCommissionAttendance,
  };
}
