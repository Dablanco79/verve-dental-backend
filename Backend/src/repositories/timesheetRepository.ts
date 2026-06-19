import { randomUUID } from "node:crypto";

import type {
  CreateTimesheetEntryInput,
  ListTimesheetOptions,
  ListTimesheetPageOptions,
  TimesheetEntry,
  TimesheetPage,
  UpdateTimesheetEntryInput,
} from "../types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// TimesheetRepository interface
// ─────────────────────────────────────────────────────────────────────────────

export interface TimesheetRepository {
  create(input: CreateTimesheetEntryInput): Promise<TimesheetEntry>;
  findById(id: string): Promise<TimesheetEntry | null>;
  /**
   * Looks up the timesheet entry linked to a specific roster shift.
   * Used by the commission-log generation hook to prevent duplicate entries
   * when a roster shift transitions to 'completed' more than once (e.g. retry).
   */
  findByRosterEntry(rosterEntryId: string): Promise<TimesheetEntry | null>;
  listByStaff(staffUserId: string, options?: ListTimesheetOptions): Promise<TimesheetEntry[]>;
  listByClinic(clinicId: string, options?: ListTimesheetOptions): Promise<TimesheetEntry[]>;
  listByClinicPaginated(clinicId: string, options?: ListTimesheetPageOptions): Promise<TimesheetPage>;
  /**
   * Returns all commission_log entries for a clinic on a specific date where
   * attendance has been verified (present | absent | sick).
   *
   * FORECASTING SAFEGUARD CONTRACT:
   *   – 'present'          → include (forecasting engine counts full usage)
   *   – 'absent' | 'sick'  → include (forecasting engine zeroes usage)
   *   – 'pending_verification' → EXCLUDE (not yet verified; skip entirely)
   *   – 'cancelled'        → EXCLUDE (shift did not occur; already zero)
   *
   * The Postgres implementation hits idx_timesheet_attendance_forecast; the
   * in-memory implementation applies the same predicate in application memory.
   *
   * @param rosteredClinicId  The physical clinic where materials are consumed.
   * @param date              YYYY-MM-DD shift date to evaluate.
   */
  getForecastLogs(rosteredClinicId: string, date: string): Promise<TimesheetEntry[]>;
  update(id: string, input: UpdateTimesheetEntryInput): Promise<TimesheetEntry>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation (used when DATABASE_URL is absent)
// ─────────────────────────────────────────────────────────────────────────────

export function createInMemoryTimesheetRepository(): TimesheetRepository {
  const entries: TimesheetEntry[] = [];

  return {
    create(input: CreateTimesheetEntryInput): Promise<TimesheetEntry> {
      const now = new Date();
      const entry: TimesheetEntry = {
        ...input,
        id: randomUUID(),
        // commission_log entries have no submission workflow; hourly tracks
        // start as 'draft' until the staff member or system submits them.
        timesheetStatus: input.payrollType === "commission_log" ? null : "draft",
        approvedByUserId: null,
        approvedAt: null,
        approvalNotes: null,
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      return Promise.resolve({ ...entry });
    },

    findById(id: string): Promise<TimesheetEntry | null> {
      const found = entries.find((e) => e.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    findByRosterEntry(rosterEntryId: string): Promise<TimesheetEntry | null> {
      const found = entries.find((e) => e.rosterEntryId === rosterEntryId);
      return Promise.resolve(found ? { ...found } : null);
    },

    listByStaff(
      staffUserId: string,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      return Promise.resolve(
        entries
          .filter((e) => {
            if (e.staffUserId !== staffUserId) return false;
            if (options?.payrollType && e.payrollType !== options.payrollType) return false;
            if (options?.attendanceStatus && e.attendanceStatus !== options.attendanceStatus) return false;
            if (options?.timesheetStatus && e.timesheetStatus !== options.timesheetStatus) return false;
            if (options?.shiftDate && e.shiftDate !== options.shiftDate) return false;
            // YYYY-MM-DD lexicographic comparison is correct for ISO date strings.
            if (options?.from && e.shiftDate < options.from) return false;
            if (options?.to && e.shiftDate > options.to) return false;
            return true;
          })
          .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))
          .map((e) => ({ ...e })),
      );
    },

    listByClinic(
      clinicId: string,
      options?: ListTimesheetOptions,
    ): Promise<TimesheetEntry[]> {
      return Promise.resolve(
        entries
          .filter((e) => {
            if (e.clinicId !== clinicId) return false;
            if (options?.payrollType && e.payrollType !== options.payrollType) return false;
            if (options?.attendanceStatus && e.attendanceStatus !== options.attendanceStatus) return false;
            if (options?.shiftDate && e.shiftDate !== options.shiftDate) return false;
            if (options?.from && e.shiftDate < options.from) return false;
            if (options?.to && e.shiftDate > options.to) return false;
            // pendingApprovalOnly overrides any timesheetStatus filter.
            if (options?.pendingApprovalOnly) return e.timesheetStatus === "submitted";
            if (options?.timesheetStatus && e.timesheetStatus !== options.timesheetStatus) return false;
            return true;
          })
          .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))
          .map((e) => ({ ...e })),
      );
    },

    listByClinicPaginated(
      clinicId: string,
      options?: ListTimesheetPageOptions,
    ): Promise<TimesheetPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const all = entries
        .filter((e) => {
          if (e.clinicId !== clinicId) return false;
          if (options?.payrollType && e.payrollType !== options.payrollType) return false;
          if (options?.attendanceStatus && e.attendanceStatus !== options.attendanceStatus) return false;
          if (options?.shiftDate && e.shiftDate !== options.shiftDate) return false;
          if (options?.from && e.shiftDate < options.from) return false;
          if (options?.to && e.shiftDate > options.to) return false;
          if (options?.pendingApprovalOnly) return e.timesheetStatus === "submitted";
          if (options?.timesheetStatus && e.timesheetStatus !== options.timesheetStatus) return false;
          return true;
        })
        .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate));
      const total = all.length;
      const page = all.slice(offset, offset + limit).map((e) => ({ ...e }));

      return Promise.resolve({ items: page, total, limit, offset });
    },

    getForecastLogs(
      rosteredClinicId: string,
      date: string,
    ): Promise<TimesheetEntry[]> {
      return Promise.resolve(
        entries
          .filter(
            (e) =>
              e.payrollType === "commission_log" &&
              e.rosteredClinicId === rosteredClinicId &&
              e.shiftDate === date &&
              // STRICT: only verified statuses — pending_verification and
              // cancelled are deliberately excluded so the forecasting engine
              // never sees unverified or void shifts.
              (e.attendanceStatus === "present" ||
                e.attendanceStatus === "absent" ||
                e.attendanceStatus === "sick") &&
              // STRUCTURAL SAFEGUARD: every forecast-eligible row must carry a
              // manager approval audit trail (mirrors the Postgres SQL guard).
              e.approvedByUserId !== null &&
              e.approvedAt !== null,
          )
          .map((e) => ({ ...e })),
      );
    },

    update(
      id: string,
      input: UpdateTimesheetEntryInput,
    ): Promise<TimesheetEntry> {
      const index = entries.findIndex((e) => e.id === id);
      const existing = entries[index];

      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Timesheet entry not found: ${id}`));
      }

      // Expand clockMutation into its constituent fields atomically.
      const clockFields: Partial<Pick<
        TimesheetEntry,
        | "clockOutAt"
        | "breakDurationMinutes"
        | "totalHoursWorked"
        | "ordinaryHours"
        | "overtime15xHours"
        | "overtime2xHours"
        | "overtimeCustomHours"
      >> = input.clockMutation !== undefined
        ? {
            clockOutAt: input.clockMutation.clockOutAt,
            breakDurationMinutes: input.clockMutation.breakDurationMinutes,
            totalHoursWorked: input.clockMutation.totalHoursWorked,
            ordinaryHours: input.clockMutation.ordinaryHours,
            overtime15xHours: input.clockMutation.overtime15xHours,
            overtime2xHours: input.clockMutation.overtime2xHours,
            overtimeCustomHours: input.clockMutation.overtimeCustomHours,
          }
        : {};

      const updated: TimesheetEntry = {
        ...existing,
        // Apply only fields that were explicitly provided.
        ...(input.attendanceStatus !== undefined && { attendanceStatus: input.attendanceStatus }),
        ...(input.timesheetStatus !== undefined && { timesheetStatus: input.timesheetStatus }),
        // clockMutation expands atomically — clock-out and all hour buckets together.
        ...clockFields,
        // Individual hour-bucket overrides (approval re-calc path, no clock change).
        ...(input.totalHoursWorked !== undefined && { totalHoursWorked: input.totalHoursWorked }),
        ...(input.ordinaryHours !== undefined && { ordinaryHours: input.ordinaryHours }),
        ...(input.overtime15xHours !== undefined && { overtime15xHours: input.overtime15xHours }),
        ...(input.overtime2xHours !== undefined && { overtime2xHours: input.overtime2xHours }),
        ...(input.overtimeCustomHours !== undefined && { overtimeCustomHours: input.overtimeCustomHours }),
        ...(input.commissionNote !== undefined && { commissionNote: input.commissionNote }),
        ...(input.approvedByUserId !== undefined && { approvedByUserId: input.approvedByUserId }),
        ...(input.approvedAt !== undefined && { approvedAt: input.approvedAt }),
        ...(input.approvalNotes !== undefined && { approvalNotes: input.approvalNotes }),
        updatedAt: new Date(),
      };

      entries[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
