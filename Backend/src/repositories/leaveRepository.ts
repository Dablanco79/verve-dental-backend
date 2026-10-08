import { randomUUID } from "node:crypto";
import { AppError } from "../types/errors.js";

import type {
  ApproveLeaveResult,
  ApproveLeaveCancellationResult,
  CancelApprovedLeaveInput,
  CreateLeaveCancellationRequestInput,
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  LeaveCancellationRequest,
  LeaveRosterConflict,
  ListLeaveOptions,
  ListLeaveCancellationRequestOptions,
  ListLeavePageOptions,
  RosterLeaveBlock,
  UpdateLeaveStatusInput,
  ReviewLeaveCancellationRequestInput,
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
  createCancellationRequest(input: CreateLeaveCancellationRequestInput): Promise<LeaveCancellationRequest>;
  listCancellationRequestsByStaff(staffUserId: string, options?: ListLeaveCancellationRequestOptions): Promise<LeaveCancellationRequest[]>;
  listCancellationRequestsByClinic(clinicId: string, options?: ListLeaveCancellationRequestOptions): Promise<LeaveCancellationRequest[]>;
  findCancellationRequestById(input: {
    requestId: string;
    leaveId: string;
    clinicId: string;
  }): Promise<LeaveCancellationRequest | null>;
  approveCancellationRequest(input: ReviewLeaveCancellationRequestInput): Promise<ApproveLeaveCancellationResult>;
  declineCancellationRequest(input: ReviewLeaveCancellationRequestInput): Promise<LeaveCancellationRequest>;
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
  const cancellationRecords: LeaveCancellationRequest[] = [];

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
        cancellationSelfReviewExceptionUsed: false,
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
      if (cancellationRecords.some((item) =>
        item.leaveRequestId === input.leaveId && item.status === "pending")) {
        return Promise.reject(new AppError(
          409,
          "PENDING_CANCELLATION_REQUEST",
          "This leave request already has a pending cancellation request",
        ));
      }
      const cancelled: LeaveRequest = {
        ...request,
        status: "cancelled",
        cancelledByUserId: input.cancelledByUserId,
        cancelledAt: new Date(),
        cancellationReason: input.cancellationReason,
        cancellationSelfReviewExceptionUsed: input.selfReviewExceptionUsed ?? false,
        updatedAt: new Date(),
      };
      records[records.indexOf(request)] = cancelled;
      return Promise.resolve({ ...cancelled });
    },

    createCancellationRequest(input): Promise<LeaveCancellationRequest> {
      const leave = records.find((item) =>
        item.id === input.leaveRequestId &&
        item.clinicId === input.clinicId &&
        item.staffUserId === input.staffUserId);
      if (!leave) return Promise.reject(new AppError(404, "NOT_FOUND", "Leave request not found"));
      if (leave.status !== "approved") {
        return Promise.reject(new AppError(409, "INVALID_STATUS_TRANSITION", "Only approved leave can be cancelled"));
      }
      if (cancellationRecords.some((item) =>
        item.leaveRequestId === input.leaveRequestId && item.status === "pending")) {
        return Promise.reject(new AppError(409, "DUPLICATE_PENDING_CANCELLATION", "A cancellation request is already pending"));
      }
      const now = new Date();
      const record: LeaveCancellationRequest = {
        id: randomUUID(),
        ...input,
        status: "pending",
        requestedAt: now,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNotes: null,
        selfReviewExceptionUsed: false,
        createdAt: now,
        updatedAt: now,
      };
      cancellationRecords.push(record);
      return Promise.resolve({ ...record });
    },

    listCancellationRequestsByStaff(staffUserId, options) {
      return Promise.resolve(cancellationRecords
        .filter((item) => item.staffUserId === staffUserId && (!options?.status || item.status === options.status))
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
        .map((item) => ({ ...item })));
    },

    listCancellationRequestsByClinic(clinicId, options) {
      return Promise.resolve(cancellationRecords
        .filter((item) => item.clinicId === clinicId && (!options?.status || item.status === options.status))
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
        .map((item) => ({ ...item })));
    },

    findCancellationRequestById(input) {
      const item = cancellationRecords.find((record) =>
        record.id === input.requestId &&
        record.leaveRequestId === input.leaveId &&
        record.clinicId === input.clinicId);
      return Promise.resolve(item ? { ...item } : null);
    },

    approveCancellationRequest(input) {
      const child = cancellationRecords.find((item) =>
        item.id === input.requestId && item.leaveRequestId === input.leaveId &&
        item.clinicId === input.clinicId && item.staffUserId === input.expectedStaffUserId);
      const leave = records.find((item) => item.id === input.leaveId);
      if (!child || !leave) return Promise.reject(new AppError(404, "NOT_FOUND", "Cancellation request not found"));
      if (child.status !== "pending" || leave.status !== "approved") {
        return Promise.reject(new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending"));
      }
      const now = new Date();
      Object.assign(child, {
        status: "approved",
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: now,
        reviewNotes: input.reviewNotes,
        selfReviewExceptionUsed: input.selfReviewExceptionUsed,
        updatedAt: now,
      });
      Object.assign(leave, {
        status: "cancelled",
        cancelledByUserId: input.reviewedByUserId,
        cancelledAt: now,
        cancellationReason: child.requestReason,
        cancellationSelfReviewExceptionUsed: input.selfReviewExceptionUsed,
        updatedAt: now,
      });
      return Promise.resolve({ request: { ...child }, leave: { ...leave } });
    },

    declineCancellationRequest(input) {
      const child = cancellationRecords.find((item) =>
        item.id === input.requestId && item.leaveRequestId === input.leaveId &&
        item.clinicId === input.clinicId && item.staffUserId === input.expectedStaffUserId);
      const leave = records.find((item) => item.id === input.leaveId);
      if (!child || !leave) return Promise.reject(new AppError(404, "NOT_FOUND", "Cancellation request not found"));
      if (child.status !== "pending" || leave.status !== "approved") {
        return Promise.reject(new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending"));
      }
      const now = new Date();
      Object.assign(child, {
        status: "declined",
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: now,
        reviewNotes: input.reviewNotes,
        selfReviewExceptionUsed: input.selfReviewExceptionUsed,
        updatedAt: now,
      });
      return Promise.resolve({ ...child });
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
