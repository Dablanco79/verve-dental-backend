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
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";
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
   * Only owner_admin (any clinic) and group_practice_manager (home clinic only)
   * receive unrestricted read access.
   */
  function hasFullClinicReadAccess(
    user: AuthenticatedUser,
    requestedClinicId: string,
  ): boolean {
    if (user.role === "owner_admin") return true;
    if (
      user.role === "group_practice_manager" &&
      user.homeClinicId === requestedClinicId
    )
      return true;
    return false;
  }

  /** Only owner_admin and group_practice_manager at their home clinic may write. */
  function assertClinicWriteAccess(
    user: AuthenticatedUser,
    requestedClinicId: string,
  ): void {
    if (user.role === "owner_admin") return;

    if (
      user.role === "group_practice_manager" &&
      user.homeClinicId === requestedClinicId
    ) {
      return;
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
      // owner_admin and group_practice_manager (own clinic) get the full list.
      if (hasFullClinicReadAccess(caller, clinicId)) {
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
      if (hasFullClinicReadAccess(caller, clinicId)) {
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
      if (
        !hasFullClinicReadAccess(caller, clinicId) &&
        entry.staffUserId !== caller.id
      ) {
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
      assertClinicWriteAccess(caller, clinicId);

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

      // Module 06 — resolve clinic name from the canonical clinics table.
      // The clinic record is the authoritative source; its name is independent
      // of which users happen to be homed at the clinic.
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

      const entry = await rosterRepository.createEntry({
        ...input,
        rosteredClinicId: clinicId,
        rosteredClinicName,
        staffEmail: staffUser.email,
        createdByUserId: caller.id,
        createdByEmail: caller.email,
      });

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
      assertClinicWriteAccess(caller, clinicId);

      const existing = await rosterRepository.findEntryById(entryId);

      if (!existing || existing.rosteredClinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      if (existing.status === "cancelled") {
        throw new AppError(409, "ENTRY_CANCELLED", "Cannot update a cancelled roster entry");
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

      const updated = await rosterRepository.updateEntry(entryId, input, {
        userId: caller.id,
        email: caller.email,
      });

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
      assertClinicWriteAccess(caller, clinicId);

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
  };
}
