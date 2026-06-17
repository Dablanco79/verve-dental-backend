import { randomUUID } from "node:crypto";

import type {
  CreateLeaveRequestInput,
  LeaveRequest,
  ListLeaveOptions,
  UpdateLeaveStatusInput,
} from "../types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// LeaveRepository interface
// ─────────────────────────────────────────────────────────────────────────────

export interface LeaveRepository {
  create(input: CreateLeaveRequestInput): Promise<LeaveRequest>;
  findById(id: string): Promise<LeaveRequest | null>;
  listByStaff(staffUserId: string, options?: ListLeaveOptions): Promise<LeaveRequest[]>;
  listByClinic(clinicId: string, options?: ListLeaveOptions): Promise<LeaveRequest[]>;
  /**
   * Returns all approved leave requests covering the given date for a staff
   * member.  Used by the roster scheduler to block shift creation on leave days.
   */
  findApprovedOverlap(
    staffUserId: string,
    date: string,
  ): Promise<LeaveRequest[]>;
  updateStatus(id: string, input: UpdateLeaveStatusInput): Promise<LeaveRequest>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation (used when DATABASE_URL is absent)
// ─────────────────────────────────────────────────────────────────────────────

export function createInMemoryLeaveRepository(): LeaveRepository {
  const records: LeaveRequest[] = [];

  return {
    create(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
      const now = new Date();
      const record: LeaveRequest = {
        ...input,
        id: randomUUID(),
        status: "pending",
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return Promise.resolve({ ...record });
    },

    findById(id: string): Promise<LeaveRequest | null> {
      const found = records.find((r) => r.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    listByStaff(
      staffUserId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      return Promise.resolve(
        records
          .filter((r) => {
            if (r.staffUserId !== staffUserId) return false;
            if (options?.status && r.status !== options.status) return false;
            if (options?.leaveType && r.leaveType !== options.leaveType) return false;
            // YYYY-MM-DD string comparison is lexicographically correct for ISO dates.
            if (options?.from && r.endDate < options.from) return false;
            if (options?.to && r.startDate > options.to) return false;
            return true;
          })
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map((r) => ({ ...r })),
      );
    },

    listByClinic(
      clinicId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      return Promise.resolve(
        records
          .filter((r) => {
            if (r.clinicId !== clinicId) return false;
            if (options?.status && r.status !== options.status) return false;
            if (options?.leaveType && r.leaveType !== options.leaveType) return false;
            if (options?.from && r.endDate < options.from) return false;
            if (options?.to && r.startDate > options.to) return false;
            return true;
          })
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map((r) => ({ ...r })),
      );
    },

    findApprovedOverlap(
      staffUserId: string,
      date: string,
    ): Promise<LeaveRequest[]> {
      return Promise.resolve(
        records
          .filter(
            (r) =>
              r.staffUserId === staffUserId &&
              r.status === "approved" &&
              r.startDate <= date &&
              r.endDate >= date,
          )
          .map((r) => ({ ...r })),
      );
    },

    updateStatus(
      id: string,
      input: UpdateLeaveStatusInput,
    ): Promise<LeaveRequest> {
      const index = records.findIndex((r) => r.id === id);
      const existing = records[index];

      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Leave request not found: ${id}`));
      }
      const updated: LeaveRequest = {
        ...existing,
        status: input.status,
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes,
        updatedAt: new Date(),
      };

      records[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
