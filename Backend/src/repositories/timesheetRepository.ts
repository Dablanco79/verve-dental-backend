import { randomUUID } from "node:crypto";

import type { CreateAuditEventInput } from "../types/analytics.js";
import { AppError } from "../types/errors.js";
import type {
  ClockMutation,
  CreateTimesheetEntryInput,
  GeofenceLocation,
  ListTimesheetOptions,
  ListTimesheetPageOptions,
  TimesheetEntry,
  TimesheetPage,
  UpdateTimesheetEntryInput,
} from "../types/payroll.js";

export type CorrectTimesheetWithAuditInput = {
  id: string;
  clinicId: string;
  clockMutation: ClockMutation & { clockInAt: Date };
  auditEvent: CreateAuditEventInput;
  ownerAdmin: boolean;
};

export type TimesheetCorrectionAuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

function correctionAuditSnapshot(entry: TimesheetEntry): Record<string, unknown> {
  return {
    clockInAt: entry.clockInAt?.toISOString() ?? null,
    clockOutAt: entry.clockOutAt?.toISOString() ?? null,
    breakDurationMinutes: entry.breakDurationMinutes,
    totalHoursWorked: entry.totalHoursWorked,
    ordinaryHours: entry.ordinaryHours,
    overtime15xHours: entry.overtime15xHours,
    overtime2xHours: entry.overtime2xHours,
    overtimeCustomHours: entry.overtimeCustomHours,
    status: entry.timesheetStatus,
  };
}

export function buildTimesheetCorrectionAuditEvent(
  input: CorrectTimesheetWithAuditInput,
  before: TimesheetEntry,
  after: TimesheetEntry,
): CreateAuditEventInput {
  return {
    ...input.auditEvent,
    clinicId: input.clinicId,
    entityId: input.id,
    metadata: {
      ...input.auditEvent.metadata,
      before: correctionAuditSnapshot(before),
      after: correctionAuditSnapshot(after),
    },
  };
}

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
  /**
   * Returns a Map of rosterEntryId → TimesheetEntry | null for a batch of IDs.
   * IDs with no linked timesheet entry map to null.
   * Uses a single DB query (WHERE roster_entry_id = ANY($1::uuid[])) rather than N
   * individual findByRosterEntry calls — safe for production-volume history queries.
   * Empty input returns an empty Map immediately without a DB round-trip.
   */
  findByRosterEntryIds(ids: string[]): Promise<Map<string, TimesheetEntry | null>>;
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
  correctWithAudit(input: CorrectTimesheetWithAuditInput): Promise<TimesheetEntry>;
  /**
   * Activates a system-auto pre-filled timesheet entry with the actual
   * server-authoritative clock-in time.
   *
   * Called exclusively by timesheetService.clockIn() when a roster shift had
   * its timesheet pre-created by generateFromCompletedRoster()
   * (generatedBy = "system_auto", timesheetStatus = "draft").
   *
   * Writes:
   *   clock_in_at            = clockInAt   (actual arrival, replaces scheduled pre-fill)
   *   clock_out_at           = NULL        (not yet clocked out)
   *   break_duration_minutes = NULL
   *   <all five hour-bucket columns> = NULL
   *   generated_by           = generatedBy (stamps staff member's identity)
   *
   * Intentionally does NOT touch: timesheet_status, shift_start_at, shift_end_at,
   * attendance_status, clinic_id, rostered_clinic_id, roster_entry_id.
   */
  activateClockIn(
    id: string,
    clockInAt: Date,
    generatedBy: string,
    clockInLocation?: GeofenceLocation | null,
    clockInNote?: string | null,
  ): Promise<TimesheetEntry>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation (used when DATABASE_URL is absent)
// ─────────────────────────────────────────────────────────────────────────────

export function createInMemoryTimesheetRepository(
  auditWriter?: TimesheetCorrectionAuditWriter,
): TimesheetRepository {
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
        // Note fields default to null if not supplied by the caller.
        clockInNote: input.clockInNote ?? null,
        clockOutNote: input.clockOutNote ?? null,
        // Location fields default to null if not supplied by the caller.
        clockInLocation: input.clockInLocation ?? null,
        clockOutLocation: input.clockOutLocation ?? null,
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

    findByRosterEntryIds(ids: string[]): Promise<Map<string, TimesheetEntry | null>> {
      const result = new Map<string, TimesheetEntry | null>();
      for (const id of ids) {
        const found = entries.find((e) => e.rosterEntryId === id);
        result.set(id, found ? { ...found } : null);
      }
      return Promise.resolve(result);
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
            if (options?.staffEmail && e.staffEmail !== options.staffEmail) return false;
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
          if (options?.staffEmail && e.staffEmail !== options.staffEmail) return false;
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
        | "clockInAt"
        | "clockOutAt"
        | "breakDurationMinutes"
        | "totalHoursWorked"
        | "ordinaryHours"
        | "overtime15xHours"
        | "overtime2xHours"
        | "overtimeCustomHours"
      >> = input.clockMutation !== undefined
        ? {
            ...(input.clockMutation.clockInAt !== undefined && {
              clockInAt: input.clockMutation.clockInAt,
            }),
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
        // clockMutation expands atomically — corrected clocks and all hour buckets together.
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
        ...(input.clockOutNote !== undefined && { clockOutNote: input.clockOutNote }),
        ...(input.clockOutLocation !== undefined && { clockOutLocation: input.clockOutLocation }),
        updatedAt: new Date(),
      };

      entries[index] = updated;
      return Promise.resolve({ ...updated });
    },

    async correctWithAudit(input: CorrectTimesheetWithAuditInput): Promise<TimesheetEntry> {
      const index = entries.findIndex((entry) => entry.id === input.id);
      const existing = entries[index];
      if (
        index === -1 ||
        !existing ||
        existing.clinicId !== input.clinicId ||
        (existing.payrollType !== "hourly_auto" && existing.payrollType !== "hourly_manual") ||
        (existing.timesheetStatus !== "submitted" &&
          existing.timesheetStatus !== "rejected" &&
          existing.timesheetStatus !== "requires_amendment")
      ) {
        throw new AppError(
          409,
          "TIMESHEET_NOT_CORRECTABLE",
          "Timesheet is no longer correctable",
        );
      }
      if (!auditWriter) {
        throw new AppError(
          500,
          "AUDIT_WRITER_UNAVAILABLE",
          "Timesheet correction audit writer is unavailable",
        );
      }

      const original = existing;
      const mutation = input.clockMutation;
      const corrected: TimesheetEntry = {
        ...existing,
        clockInAt: mutation.clockInAt,
        clockOutAt: mutation.clockOutAt,
        breakDurationMinutes: mutation.breakDurationMinutes,
        totalHoursWorked: mutation.totalHoursWorked,
        ordinaryHours: mutation.ordinaryHours,
        overtime15xHours: mutation.overtime15xHours,
        overtime2xHours: mutation.overtime2xHours,
        overtimeCustomHours: mutation.overtimeCustomHours,
        timesheetStatus: "submitted",
        approvedByUserId: null,
        approvedAt: null,
        approvalNotes: null,
        updatedAt: new Date(),
      };
      entries[index] = corrected;

      try {
        await auditWriter.recordEvent(
          buildTimesheetCorrectionAuditEvent(input, original, corrected),
        );
        return { ...corrected };
      } catch (error) {
        entries[index] = original;
        throw error;
      }
    },

    activateClockIn(
      id: string,
      clockInAt: Date,
      generatedBy: string,
      clockInLocation?: GeofenceLocation | null,
      clockInNote?: string | null,
    ): Promise<TimesheetEntry> {
      const index = entries.findIndex((e) => e.id === id);
      const existing = entries[index];

      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Timesheet entry not found: ${id}`));
      }

      const activated: TimesheetEntry = {
        ...existing,
        clockInAt,
        // Clear the scheduled pre-fill — staff has not yet clocked out.
        clockOutAt: null,
        breakDurationMinutes: null,
        totalHoursWorked: null,
        ordinaryHours: null,
        overtime15xHours: null,
        overtime2xHours: null,
        overtimeCustomHours: null,
        // Stamp actual identity so subsequent clock-in attempts are blocked.
        generatedBy,
        // Record geofence snapshot and staff note if supplied.
        clockInLocation: clockInLocation !== undefined ? clockInLocation : (existing.clockInLocation ?? null),
        clockInNote: clockInNote !== undefined ? clockInNote : (existing.clockInNote ?? null),
        updatedAt: new Date(),
      };

      entries[index] = activated;
      return Promise.resolve({ ...activated });
    },
  };
}
