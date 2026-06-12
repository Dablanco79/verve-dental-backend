import { randomUUID } from "node:crypto";

import type {
  CreateRosterEntryInput,
  ListRosterOptions,
  RosterEntry,
  UpdateRosterEntryInput,
} from "../types/roster.js";

export interface RosterRepository {
  createEntry(input: CreateRosterEntryInput): Promise<RosterEntry>;
  findEntryById(entryId: string): Promise<RosterEntry | null>;
  listByClinic(clinicId: string, options?: ListRosterOptions): Promise<RosterEntry[]>;
  listByStaff(
    staffUserId: string,
    options?: { from?: Date; to?: Date },
  ): Promise<RosterEntry[]>;
  /**
   * Returns all roster entries for a specific staff member at a specific clinic,
   * with optional date-window and status filtering applied in the database.
   *
   * Replaces the previous pattern of `listByStaff` + in-process `.filter()` so
   * the query uses the composite index
   * `idx_roster_entries_staff_clinic_start (staff_user_id, rostered_clinic_id, shift_start_at)`
   * instead of pulling every shift for the user into application memory.
   */
  listByStaffAtClinic(
    staffUserId: string,
    clinicId: string,
    options?: ListRosterOptions,
  ): Promise<RosterEntry[]>;
  updateEntry(
    entryId: string,
    input: UpdateRosterEntryInput,
    changedBy: { userId: string; email: string },
  ): Promise<RosterEntry>;
  /**
   * Returns true if the user has any non-cancelled roster entry at the given clinic.
   * Used by RosterService to grant cross-clinic read access to rostered staff.
   */
  hasActiveShiftAtClinic(staffUserId: string, clinicId: string): Promise<boolean>;
}

export function createInMemoryRosterRepository(): RosterRepository {
  const entries: RosterEntry[] = [];

  return {
    async createEntry(input: CreateRosterEntryInput): Promise<RosterEntry> {
      const now = new Date();
      const entry: RosterEntry = {
        ...input,
        id: randomUUID(),
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      };

      entries.push(entry);
      return { ...entry };
    },

    async findEntryById(entryId: string): Promise<RosterEntry | null> {
      const found = entries.find((e) => e.id === entryId);
      return found ? { ...found } : null;
    },

    async listByClinic(
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      return entries
        .filter((e) => {
          if (e.rosteredClinicId !== clinicId) return false;
          if (options?.status && e.status !== options.status) return false;
          // Overlap: shift_start_at < to AND shift_end_at > from
          if (options?.from && e.shiftEndAt <= options.from) return false;
          if (options?.to && e.shiftStartAt >= options.to) return false;
          return true;
        })
        .sort((a, b) => a.shiftStartAt.getTime() - b.shiftStartAt.getTime())
        .map((e) => ({ ...e }));
    },

    async listByStaff(
      staffUserId: string,
      options?: { from?: Date; to?: Date },
    ): Promise<RosterEntry[]> {
      return entries
        .filter((e) => {
          if (e.staffUserId !== staffUserId) return false;
          if (options?.from && e.shiftEndAt <= options.from) return false;
          if (options?.to && e.shiftStartAt >= options.to) return false;
          return true;
        })
        .sort((a, b) => a.shiftStartAt.getTime() - b.shiftStartAt.getTime())
        .map((e) => ({ ...e }));
    },

    async listByStaffAtClinic(
      staffUserId: string,
      clinicId: string,
      options?: ListRosterOptions,
    ): Promise<RosterEntry[]> {
      return entries
        .filter((e) => {
          if (e.staffUserId !== staffUserId) return false;
          if (e.rosteredClinicId !== clinicId) return false;
          if (options?.status && e.status !== options.status) return false;
          if (options?.from && e.shiftEndAt <= options.from) return false;
          if (options?.to && e.shiftStartAt >= options.to) return false;
          return true;
        })
        .sort((a, b) => a.shiftStartAt.getTime() - b.shiftStartAt.getTime())
        .map((e) => ({ ...e }));
    },

    async updateEntry(
      entryId: string,
      input: UpdateRosterEntryInput,
      _changedBy: { userId: string; email: string },
    ): Promise<RosterEntry> {
      const index = entries.findIndex((e) => e.id === entryId);

      if (index === -1) {
        throw new Error(`Roster entry not found: ${entryId}`);
      }

      const existing = entries[index]!;
      const updated: RosterEntry = {
        ...existing,
        ...(input.shiftStartAt !== undefined && { shiftStartAt: input.shiftStartAt }),
        ...(input.shiftEndAt !== undefined && { shiftEndAt: input.shiftEndAt }),
        ...(input.shiftType !== undefined && { shiftType: input.shiftType }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      };

      entries[index] = updated;
      return { ...updated };
    },

    async hasActiveShiftAtClinic(
      staffUserId: string,
      clinicId: string,
    ): Promise<boolean> {
      return entries.some(
        (e) =>
          e.staffUserId === staffUserId &&
          e.rosteredClinicId === clinicId &&
          e.status !== "cancelled",
      );
    },
  };
}
