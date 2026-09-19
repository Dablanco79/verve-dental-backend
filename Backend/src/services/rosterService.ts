import type { AuthenticatedUser, UserRecord } from "../types/auth.js";
import type {
  CreateRosterEntryInput,
  ListRosterOptions,
  ListRosterPageOptions,
  RosterEntry,
  RosterPage,
  UpdateRosterEntryInput,
} from "../types/roster.js";
import { AppError } from "../types/errors.js";

// ─── Melbourne timezone helpers ───────────────────────────────────────────────

const MELBOURNE_TZ = "Australia/Melbourne";

/**
 * Returns the UTC [start, end] range spanning the full calendar day of
 * `utcDate` in Australia/Melbourne (handles both AEST +10:00 and AEDT +11:00).
 *
 * Node.js setHours(0,0,0,0) uses process-local time (UTC on servers), not
 * Melbourne time. This function derives the Melbourne UTC offset dynamically
 * using Intl.DateTimeFormat so the day window is always correct regardless of
 * where the server runs.
 *
 * Example: utcDate = 2026-09-21T22:00:00Z (= 08:00 AEST 22 Sep)
 *   → dayStart = 2026-09-21T14:00:00Z (= midnight AEST on 22 Sep)
 *   → dayEnd   = 2026-09-22T13:59:59.999Z (= 23:59:59.999 AEST on 22 Sep)
 */
function melbourneDayWindow(utcDate: Date): { dayStart: Date; dayEnd: Date } {
  // Step 1: Get the calendar date string "YYYY-MM-DD" in Melbourne timezone.
  const localDateStr = new Intl.DateTimeFormat("sv", {
    timeZone: MELBOURNE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utcDate);

  // Step 2: Determine the UTC offset at approximately midnight of that local
  // date. Melbourne DST transitions happen at 2:00 AM local, never at midnight,
  // so using the offset near midnight is always correct for midnight itself.
  const approxUtcMidnight = new Date(`${localDateStr}T00:00:00Z`);
  const tzParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(approxUtcMidnight);
  const rawOffset = tzParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+10:00";
  // "GMT+10:00" → "+10:00", "GMT+11:00" → "+11:00"
  const isoOffset = rawOffset.slice(3);

  const dayStart = new Date(`${localDateStr}T00:00:00.000${isoOffset}`);
  // End = start of next local day minus 1ms (DST-safe: avoids 24h assumption)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { dayStart, dayEnd };
}
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { UserClinicAssignmentsRepository } from "../repositories/userClinicAssignmentsRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

// Narrow write-only audit dependency.
type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

/**
 * Minimal interface of TimesheetService consumed by RosterService.
 * Using a structural type (not an import) breaks the potential circular
 * dependency between rosterService ↔ timesheetService.
 */
type RosterCompletionHook = {
  generateFromCompletedRoster(
    rosterEntry: RosterEntry,
    staffUser: UserRecord,
  ): Promise<unknown>;
};

/**
 * Fields the service consumer must supply.  Everything else (staffEmail,
 * rosteredClinicId, rosteredClinicName, createdByUserId, createdByEmail)
 * is filled in server-side by the service layer.
 */
export type CreateRosterInput = Omit<
  CreateRosterEntryInput,
  | "staffEmail"
  | "createdByUserId"
  | "createdByEmail"
  | "rosteredClinicId"
  | "rosteredClinicName"
>;

export type ConflictCheckResult = {
  /** Strict time overlaps — block the save (RED). */
  overlapping: RosterEntry[];
  /** Same calendar day, no time overlap — informational only (AMBER). */
  sameDay: RosterEntry[];
};

export type RosterService = ReturnType<typeof createRosterService>;

export function createRosterService(
  rosterRepository: RosterRepository,
  userRepository: UserRepository,
  /**
   * Module 06 — canonical clinic lookup.
   * Replaces the previous `userRepository.getClinicName()` workaround that
   * derived clinic names from the user roster ORDER BY email LIMIT 1.
   * The clinicRepository is the authoritative source of clinic metadata.
   */
  clinicRepository: ClinicRepository,
  /**
   * Multi-clinic access foundation (Migration 047).
   * Used for roster-eligibility checks and eligible-staff queries.
   */
  assignmentsRepository: UserClinicAssignmentsRepository,
  /**
   * Optional hook fired after a roster entry transitions to 'completed'.
   * Injected by dependencies.ts to avoid a circular import between
   * rosterService and timesheetService.
   */
  onRosterCompleted?: RosterCompletionHook,
  /** Optional audit writer — injected by the route factory when available. */
  auditWriter?: AuditWriter,
) {
  /**
   * Returns true when the caller is entitled to see the full clinic roster.
   * owner_admin sees any clinic; GPMs see their home clinic plus any clinic
   * where they have can_operate=true in user_clinic_assignments.
   */
  async function hasFullClinicReadAccess(
    user: AuthenticatedUser,
    requestedClinicId: string,
  ): Promise<boolean> {
    if (user.role === "owner_admin") return true;
    if (user.role === "group_practice_manager") {
      if (user.homeClinicId === requestedClinicId) return true;
      // Also allow clinics where manager has can_operate=true
      return assignmentsRepository.hasOperationalAccess(user.id, requestedClinicId);
    }
    return false;
  }

  /**
   * Asserts the caller may write to the given clinic's roster.
   * owner_admin has unrestricted write access.
   * GPMs may write to their home clinic and any clinic where they have
   * can_operate=true in user_clinic_assignments.
   */
  async function assertClinicWriteAccess(
    user: AuthenticatedUser,
    requestedClinicId: string,
  ): Promise<void> {
    if (user.role === "owner_admin") return;
    if (user.role === "group_practice_manager") {
      if (user.homeClinicId === requestedClinicId) return;
      const hasAccess = await assignmentsRepository.hasOperationalAccess(user.id, requestedClinicId);
      if (hasAccess) return;
    }
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to manage this clinic's roster",
    );
  }

  return {
    async listByClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      // owner_admin and group_practice_manager (own/assigned clinic) get the full list.
      if (await hasFullClinicReadAccess(caller, clinicId)) {
        return rosterRepository.listByClinic(clinicId, options);
      }

      // clinical_staff (and any other role) are silently scoped to their own
      // shifts only — they never receive another staff member's roster data.
      // Uses the composite DB index instead of loading all staff shifts into memory.
      return rosterRepository.listByStaffAtClinic(caller.id, clinicId, options);
    },

    async listByClinicPaginated(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListRosterPageOptions,
    ): Promise<RosterPage> {
      if (await hasFullClinicReadAccess(caller, clinicId)) {
        return rosterRepository.listByClinicPaginated(clinicId, options);
      }
      return rosterRepository.listByStaffAtClinicPaginated(caller.id, clinicId, options);
    },

    async getEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      entryId: string,
    ): Promise<RosterEntry> {
      const entry = await rosterRepository.findEntryById(entryId);

      if (!entry || entry.rosteredClinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      // Privileged roles see any entry; others can only see their own.
      const canReadAll = await hasFullClinicReadAccess(caller, clinicId);
      if (!canReadAll && entry.staffUserId !== caller.id) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      return entry;
    },

    async getMyShifts(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      return rosterRepository.listByStaffAtClinic(caller.id, clinicId, options);
    },

    async createEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      input: CreateRosterInput,
    ): Promise<RosterEntry> {
      await assertClinicWriteAccess(caller, clinicId);

      if (input.shiftEndAt <= input.shiftStartAt) {
        throw new AppError(
          400,
          "INVALID_SHIFT_TIMES",
          "shiftEndAt must be after shiftStartAt",
        );
      }

      const staffUser = await userRepository.findById(input.staffUserId);

      if (!staffUser) {
        throw new AppError(404, "USER_NOT_FOUND", "Staff user not found");
      }

      if (!staffUser.isActive) {
        throw new AppError(400, "USER_INACTIVE", "Staff user account is not active");
      }

      // ── Roster eligibility check ──────────────────────────────────────────
      // owner_admin may roster any user at any clinic (broad operational trust).
      // Managers must have the target staff member roster-eligible at the clinic.
      if (caller.role !== "owner_admin") {
        const eligible = await assignmentsRepository.hasRosterEligibility(
          input.staffUserId,
          clinicId,
        );
        if (!eligible) {
          throw new AppError(
            403,
            "STAFF_NOT_ELIGIBLE_FOR_CLINIC",
            "This staff member is not eligible to be rostered at this clinic. " +
              "An owner_admin must grant roster eligibility via Clinic Access settings first.",
          );
        }
      }

      // Module 06 — resolve clinic name from the canonical clinics table.
      const rosteredClinic = await clinicRepository.findById(clinicId);

      if (!rosteredClinic) {
        throw new AppError(
          404,
          "CLINIC_NOT_FOUND",
          "Target clinic not found",
        );
      }

      if (!rosteredClinic.isActive) {
        throw new AppError(
          400,
          "CLINIC_INACTIVE",
          "Cannot roster staff to an inactive clinic",
        );
      }

      const rosteredClinicName = rosteredClinic.name;

      // ── Cross-clinic conflict check (atomic, advisory-locked in Postgres) ──
      // The repository acquires a per-staff advisory lock, re-checks for
      // overlaps on the SAME connection/transaction, then inserts — all
      // atomically.  Concurrent managers cannot both succeed for the same
      // staff member.
      const entry = await rosterRepository.createEntry(
        {
          ...input,
          rosteredClinicId: clinicId,
          rosteredClinicName,
          staffEmail: staffUser.email,
          createdByUserId: caller.id,
          createdByEmail: caller.email,
        },
        {
          windowStart: input.shiftStartAt,
          windowEnd: input.shiftEndAt,
          staffDisplayName: staffUser.displayName ?? staffUser.email,
        },
      );

      auditWriter?.recordEvent({
        clinicId,
        entityType: "roster_entry",
        entityId: entry.id,
        action: "created",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          staffUserId: entry.staffUserId,
          staffEmail: entry.staffEmail,
          shiftType: entry.shiftType,
          shiftStartAt: entry.shiftStartAt.toISOString(),
          shiftEndAt: entry.shiftEndAt.toISOString(),
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return entry;
    },

    async updateEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      entryId: string,
      input: UpdateRosterEntryInput,
    ): Promise<RosterEntry> {
      await assertClinicWriteAccess(caller, clinicId);

      const existing = await rosterRepository.findEntryById(entryId);

      if (!existing || existing.rosteredClinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      if (existing.status === "cancelled") {
        throw new AppError(409, "ENTRY_CANCELLED", "Cannot update a cancelled roster entry");
      }

      // ── Clinic move validation ────────────────────────────────────────────
      let newRosteredClinicName: string | undefined;
      if (input.rosteredClinicId && input.rosteredClinicId !== existing.rosteredClinicId) {
        // Validate caller has write access to the new clinic too
        await assertClinicWriteAccess(caller, input.rosteredClinicId);

        const newClinic = await clinicRepository.findById(input.rosteredClinicId);
        if (!newClinic) throw new AppError(404, "CLINIC_NOT_FOUND", "Target clinic not found");
        if (!newClinic.isActive) throw new AppError(400, "CLINIC_INACTIVE", "Cannot move shift to an inactive clinic");

        // Staff eligibility at new clinic (owner_admin is unrestricted)
        if (caller.role !== "owner_admin") {
          const eligible = await assignmentsRepository.hasRosterEligibility(
            existing.staffUserId,
            input.rosteredClinicId,
          );
          if (!eligible) {
            throw new AppError(
              403,
              "STAFF_NOT_ELIGIBLE_FOR_CLINIC",
              "This staff member is not eligible at the target clinic.",
            );
          }
        }
        newRosteredClinicName = newClinic.name;
      }

      const newStart = input.shiftStartAt ?? existing.shiftStartAt;
      const newEnd = input.shiftEndAt ?? existing.shiftEndAt;

      if (newEnd <= newStart) {
        throw new AppError(
          400,
          "INVALID_SHIFT_TIMES",
          "shiftEndAt must be after shiftStartAt",
        );
      }

      // ── Cross-clinic conflict check (atomic, advisory-locked in Postgres) ──
      // Only needed when times are changing.  The excludeEntryId prevents
      // self-conflict on the entry being edited.
      const timesChanged =
        input.shiftStartAt !== undefined || input.shiftEndAt !== undefined;

      const updated = await rosterRepository.updateEntry(
        entryId,
        { ...input, rosteredClinicName: newRosteredClinicName },
        { userId: caller.id, email: caller.email },
        timesChanged
          ? {
              staffUserId: existing.staffUserId,
              windowStart: newStart,
              windowEnd: newEnd,
              excludeEntryId: entryId,
            }
          : undefined,
      );

      // ── Roster-completion hook ───────────────────────────────────────────
      // Fire after a successful status transition to 'completed'.
      // The hook auto-generates the appropriate timesheet entry (commission
      // attendance log or hourly draft) based on the staff member's payroll
      // track.  We await it so the caller sees an error if generation fails.
      if (input.status === "completed" && onRosterCompleted) {
        const staffUser = await userRepository.findById(updated.staffUserId);
        if (staffUser) {
          await onRosterCompleted.generateFromCompletedRoster(updated, staffUser);
        }
      }

      auditWriter?.recordEvent({
        clinicId,
        entityType: "roster_entry",
        entityId: entryId,
        action: input.status === "completed" ? "completed" : "updated",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          previousStatus: existing.status,
          newStatus: updated.status,
          changes: Object.keys(input),
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return updated;
    },

    async cancelEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      entryId: string,
    ): Promise<RosterEntry> {
      await assertClinicWriteAccess(caller, clinicId);

      const existing = await rosterRepository.findEntryById(entryId);

      if (!existing || existing.rosteredClinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      if (existing.status === "cancelled") {
        throw new AppError(409, "ALREADY_CANCELLED", "Roster entry is already cancelled");
      }

      const cancelled = await rosterRepository.updateEntry(
        entryId,
        { status: "cancelled" },
        { userId: caller.id, email: caller.email },
      );

      auditWriter?.recordEvent({
        clinicId,
        entityType: "roster_entry",
        entityId: entryId,
        action: "cancelled",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          previousStatus: existing.status,
          staffUserId: existing.staffUserId,
          staffEmail: existing.staffEmail,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return cancelled;
    },

    /**
     * Returns all active users who are roster-eligible at the given clinic.
     * Used by the Add Shift staff selector (replaces the home-clinic-only
     * listUsers path for roster purposes).
     *
     * owner_admin may see all active users at a clinic without an explicit
     * assignment (they have implicit roster authority everywhere).
     */
    async getRosterEligibleStaff(
      caller: AuthenticatedUser,
      clinicId: string,
    ): Promise<{ id: string; email: string; displayName: string | null; firstName: string | null; lastName: string | null }[]> {
      // Assert caller can see this clinic's roster.
      if (!(await hasFullClinicReadAccess(caller, clinicId))) {
        throw new AppError(403, "FORBIDDEN", "You do not have access to this clinic's roster");
      }

      // owner_admin: return all active users who have a roster-eligible assignment
      // at this clinic (or the home-clinic users as a fallback if no assignments).
      const assignments = await assignmentsRepository.listRosterEligible(clinicId);
      const userIds = assignments.map((a) => a.userId);

      const users = await Promise.all(
        userIds.map((id) => userRepository.findById(id)),
      );

      return users
        .filter((u): u is NonNullable<typeof u> => u !== null && u.isActive)
        .map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          firstName: u.firstName,
          lastName: u.lastName,
        }));
    },

    /**
     * Returns all roster entries for the authenticated user across every clinic
     * where they are rostered. Does NOT require a clinicId scope.
     *
     * Security: only returns entries where staffUserId === caller.id.
     * The repository uses an ownerAdmin DB context to bypass the RLS
     * rostered_clinic_id restriction, but application-layer enforcement
     * ensures the caller can only see their own entries.
     */
    async getMyShiftsAllClinics(
      caller: AuthenticatedUser,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      return rosterRepository.listByStaff(caller.id, options);
    },

    /**
     * Checks whether a proposed shift would conflict with any of the staff
     * member's existing shifts across ALL clinics.
     *
     * Returns two lists:
     *  - overlapping: strict time overlaps → RED, Save must be blocked
     *  - sameDay:     same calendar day, no time overlap → AMBER, informational
     *
     * Callers must have roster-write access to the target clinic.
     * `excludeEntryId` should be set to the current entry ID during edit
     * operations so the shift does not conflict with itself.
     */
    async checkConflictsForShift(
      caller: AuthenticatedUser,
      clinicId: string,
      params: {
        staffUserId: string;
        proposedStart: Date;
        proposedEnd: Date;
        excludeEntryId?: string;
      },
    ): Promise<ConflictCheckResult> {
      await assertClinicWriteAccess(caller, clinicId);

      const { staffUserId, proposedStart, proposedEnd, excludeEntryId } = params;

      // Strict time overlaps.
      const overlapping = await rosterRepository.findOverlappingShifts(
        staffUserId,
        proposedStart,
        proposedEnd,
        excludeEntryId,
      );

      // Same calendar day (full day window in Melbourne local time), excluding
      // overlaps already found. Uses timezone-aware calculation so that shifts
      // on different Melbourne calendar days are never falsely flagged.
      const { dayStart, dayEnd } = melbourneDayWindow(proposedStart);

      const overlappingIds = new Set(overlapping.map((e) => e.id));
      const allOnDay = await rosterRepository.findOverlappingShifts(
        staffUserId,
        dayStart,
        dayEnd,
        excludeEntryId,
      );
      const sameDay = allOnDay.filter((e) => !overlappingIds.has(e.id));

      return { overlapping, sameDay };
    },

    /**
     * Returns the list of clinics a manager can view/manage rosters for.
     * owner_admin → all active clinics.
     * group_practice_manager → home clinic + any clinic with can_operate=true.
     * clinical_staff → their home clinic only (informational; staff use /roster/me).
     */
    async getAccessibleRosterClinics(
      caller: AuthenticatedUser,
    ): Promise<{ id: string; name: string; preferredName: string | null }[]> {
      if (caller.role === "owner_admin") {
        const all = await clinicRepository.findAll();
        return all.map((c) => ({ id: c.id, name: c.name, preferredName: c.preferredName }));
      }
      if (caller.role === "group_practice_manager") {
        // Clinics where manager has can_operate=true
        const operationalIds = await assignmentsRepository.listOperationalClinicIds(caller.id);
        const clinicIds = new Set(operationalIds);
        // Also include home clinic even if not explicitly assigned
        clinicIds.add(caller.homeClinicId);
        const clinics = await Promise.all(
          [...clinicIds].map((id) => clinicRepository.findById(id)),
        );
        return clinics
          .filter((c): c is NonNullable<typeof c> => c !== null && c.isActive)
          .map((c) => ({ id: c.id, name: c.name, preferredName: c.preferredName }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      // clinical_staff — only their home clinic
      const home = await clinicRepository.findById(caller.homeClinicId);
      if (!home || !home.isActive) return [];
      return [{ id: home.id, name: home.name, preferredName: home.preferredName }];
    },
  };
}
