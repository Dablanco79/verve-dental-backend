import { randomUUID } from "node:crypto";

import type {
  ApproveLeaveResult,
  CancelApprovedLeaveInput,
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  LeaveRosterConflict,
  ListLeaveOptions,
  ListLeavePageOptions,
  RosterLeaveBlock,
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
  listByClinicPaginated(clinicId: string, options?: ListLeavePageOptions): Promise<LeavePage>;
  /**
   * Returns all approved leave requests covering the given date for a staff
   * member.  Used by the roster scheduler to block shift creation on leave days.
   */
  findApprovedOverlap(
    staffUserId: string,
    date: string,
  ): Promise<LeaveRequest[]>;
  findApprovedOverlapRange(
    staffUserId: string,
    firstDate: string,
    lastDate: string,
  ): Promise<LeaveRequest[]>;
  approveWithRosterConflicts(input: {
    leaveId: string;
    clinicId: string;
    expectedStaffUserId: string;
    reviewedByUserId: string;
    reviewNotes: string | null;
    timeZone: string;
  }): Promise<ApproveLeaveResult>;
  cancelApprovedLeave(input: CancelApprovedLeaveInput): Promise<LeaveRequest>;
  listRosterConflicts(input: {
    leaveId: string;
    clinicId: string;
    expectedStaffUserId: string;
    timeZone: string;
  }): Promise<LeaveRosterConflict[]>;
  listApprovedForStaff(
    staffUserIds: string[],
    firstDate: string,
    lastDate: string,
  ): Promise<RosterLeaveBlock[]>;
  updateStatus(id: string, input: UpdateLeaveStatusInput): Promise<LeaveRequest>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation (used when DATABASE_URL is absent)
// ─────────────────────────────────────────────────────────────────────────────

export function createInMemoryLeaveRepository(
  loadRosterConflicts?: (
    staffUserId: string,
    startDate: string,
    endDate: string,
  ) => Promise<LeaveRosterConflict[]>,
): LeaveRepository {
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
        cancelledByUserId: null,
        cancelledAt: null,
        cancellationReason: null,
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

    listByClinicPaginated(
      clinicId: string,
      options?: ListLeavePageOptions,
    ): Promise<LeavePage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const all = records
        .filter((r) => {
          if (r.clinicId !== clinicId) return false;
          if (options?.status && r.status !== options.status) return false;
          if (options?.leaveType && r.leaveType !== options.leaveType) return false;
          if (options?.from && r.endDate < options.from) return false;
          if (options?.to && r.startDate > options.to) return false;
          return true;
        })
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      const total = all.length;
      const page = all.slice(offset, offset + limit).map((r) => ({ ...r }));

      return Promise.resolve({ items: page, total, limit, offset });
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

    findApprovedOverlapRange(
      staffUserId: string,
      firstDate: string,
      lastDate: string,
    ): Promise<LeaveRequest[]> {
      return Promise.resolve(
        records
          .filter(
            (r) =>
              r.staffUserId === staffUserId &&
              r.status === "approved" &&
              r.startDate <= lastDate &&
              r.endDate >= firstDate,
          )
          .map((r) => ({ ...r })),
      );
    },

    async approveWithRosterConflicts(input): Promise<ApproveLeaveResult> {
      const request = records.find(
        (record) =>
          record.id === input.leaveId &&
          record.clinicId === input.clinicId &&
          record.staffUserId === input.expectedStaffUserId,
      );
      if (!request) throw new Error(`Leave request not found: ${input.leaveId}`);
      if (request.status !== "pending") {
        throw new Error(`Leave request is already '${request.status}' and cannot be approved`);
      }

      const conflicts = loadRosterConflicts
        ? await loadRosterConflicts(request.staffUserId, request.startDate, request.endDate)
        : [];
      const leave: LeaveRequest = {
        ...request,
        status: "approved",
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes,
        updatedAt: new Date(),
      };
      records[records.indexOf(request)] = leave;
      return { leave, conflicts };
    },

    cancelApprovedLeave(input): Promise<LeaveRequest> {
      const request = records.find(
        (record) =>
          record.id === input.leaveId &&
          record.clinicId === input.clinicId &&
          record.staffUserId === input.expectedStaffUserId,
      );
      if (!request) {
        return Promise.reject(new Error(`Leave request not found: ${input.leaveId}`));
      }
      if (request.status !== "approved") {
        return Promise.reject(
          new Error(`Leave request is '${request.status}' and cannot be cancelled`),
        );
      }
      const cancelled: LeaveRequest = {
        ...request,
        status: "cancelled",
        cancelledByUserId: input.cancelledByUserId,
        cancelledAt: new Date(),
        cancellationReason: input.cancellationReason,
        updatedAt: new Date(),
      };
      records[records.indexOf(request)] = cancelled;
      return Promise.resolve({ ...cancelled });
    },

    async listRosterConflicts(input): Promise<LeaveRosterConflict[]> {
      const request = records.find(
        (record) =>
          record.id === input.leaveId &&
          record.clinicId === input.clinicId &&
          record.staffUserId === input.expectedStaffUserId,
      );
      if (!request) return [];
      return loadRosterConflicts
        ? loadRosterConflicts(request.staffUserId, request.startDate, request.endDate)
        : [];
    },

    listApprovedForStaff(
      staffUserIds: string[],
      firstDate: string,
      lastDate: string,
    ): Promise<RosterLeaveBlock[]> {
      const staff = new Set(staffUserIds);
      return Promise.resolve(
        records
          .filter(
            (record) =>
              staff.has(record.staffUserId) &&
              record.status === "approved" &&
              record.startDate <= lastDate &&
              record.endDate >= firstDate,
          )
          .map((record) => ({
            leaveId: record.id,
            staffUserId: record.staffUserId,
            staffEmail: record.staffEmail,
            startDate: record.startDate,
            endDate: record.endDate,
          })),
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
