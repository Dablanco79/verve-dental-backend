import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateRosterEntryInput,
  ListRosterOptions,
  RosterEntry,
  UpdateRosterEntryInput,
} from "../types/roster.js";
import { AppError } from "../types/errors.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";

export type CreateRosterInput = Omit<
  CreateRosterEntryInput,
  "staffEmail" | "createdByUserId"
>;

export type RosterService = ReturnType<typeof createRosterService>;

export function createRosterService(
  rosterRepository: RosterRepository,
  userRepository: UserRepository,
) {
  /**
   * Grants read access when the caller's homeClinicId matches, or when they have
   * an active (non-cancelled) roster entry at the requested clinic.
   * owner_admin bypasses this check entirely.
   */
  async function assertClinicReadAccess(
    user: AuthenticatedUser,
    requestedClinicId: string,
  ): Promise<void> {
    if (user.role === "owner_admin") return;
    if (user.homeClinicId === requestedClinicId) return;

    const hasShift = await rosterRepository.hasActiveShiftAtClinic(
      user.id,
      requestedClinicId,
    );

    if (!hasShift) {
      throw new AppError(
        403,
        "TENANT_ACCESS_DENIED",
        "You do not have access to this clinic's data",
      );
    }
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
      await assertClinicReadAccess(caller, clinicId);
      return rosterRepository.listByClinic(clinicId, options);
    },

    async getEntry(
      caller: AuthenticatedUser,
      clinicId: string,
      entryId: string,
    ): Promise<RosterEntry> {
      await assertClinicReadAccess(caller, clinicId);

      const entry = await rosterRepository.findEntryById(entryId);

      if (!entry || entry.rosteredClinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Roster entry not found");
      }

      return entry;
    },

    async getMyShifts(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      await assertClinicReadAccess(caller, clinicId);

      const all = await rosterRepository.listByStaff(caller.id, options);
      return all.filter((e) => e.rosteredClinicId === clinicId);
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

      // Look up the staff member's email to denormalize onto the entry.
      const staffUser = await userRepository.findById(input.staffUserId);

      if (!staffUser) {
        throw new AppError(404, "USER_NOT_FOUND", "Staff user not found");
      }

      if (!staffUser.isActive) {
        throw new AppError(400, "USER_INACTIVE", "Staff user account is not active");
      }

      return rosterRepository.createEntry({
        ...input,
        staffEmail: staffUser.email,
        createdByUserId: caller.id,
      });
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

      return rosterRepository.updateEntry(entryId, input, {
        userId: caller.id,
        email: caller.email,
      });
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

      return rosterRepository.updateEntry(
        entryId,
        { status: "cancelled" },
        { userId: caller.id, email: caller.email },
      );
    },
  };
}
