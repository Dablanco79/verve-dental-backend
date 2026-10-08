import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  ApproveLeaveResult,
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  LeaveRosterConflict,
  ListLeaveOptions,
  ListLeavePageOptions,
} from "../types/payroll.js";
import type { LeaveRepository } from "../repositories/leaveRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";
import { inclusiveCalendarDayCount } from "../utils/calendarDate.js";
import { OPERATIONAL_TZ } from "../utils/melbourneTime.js";

type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Managers and admins may act on leave requests from any staff member in their clinic. */
function assertReviewAccess(caller: AuthenticatedUser, clinicId: string): void {
  if (caller.role === "owner_admin") return;
  if (caller.role === "group_practice_manager" && caller.homeClinicId === clinicId) return;
  throw new AppError(403, "FORBIDDEN", "Only managers and admins can approve or reject leave requests");
}

/** Only the owning staff member (or an owner_admin) can withdraw their own request. */
function assertOwnership(caller: AuthenticatedUser, request: LeaveRequest): void {
  if (caller.id === request.staffUserId) return;
  if (caller.role === "owner_admin") return;
  throw new AppError(403, "FORBIDDEN", "You can only manage your own leave requests");
}

export type LeaveService = ReturnType<typeof createLeaveService>;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createLeaveService(
  leaveRepository: LeaveRepository,
  auditWriter?: AuditWriter,
) {
  return {
    /**
     * Staff member submits a leave request for their home clinic.
     * Only the requesting staff member can create for themselves.
     * Managers/admins may create on behalf of staff (e.g. retrospective sick leave).
     */
    async createLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      input: Omit<
        CreateLeaveRequestInput,
        "staffUserId" | "staffEmail" | "clinicId" | "totalDays"
      >,
    ): Promise<LeaveRequest> {
      // clinical_staff may only submit for their own home clinic.
      if (caller.role === "clinical_staff" && caller.homeClinicId !== clinicId) {
        throw new AppError(403, "FORBIDDEN", "You can only submit leave for your home clinic");
      }

      let totalDays: number;
      try {
        totalDays = inclusiveCalendarDayCount(input.startDate, input.endDate);
      } catch (error) {
        throw new AppError(
          400,
          "INVALID_DATE_RANGE",
          error instanceof Error ? error.message : "Invalid leave date range",
        );
      }

      return leaveRepository.create({
        ...input,
        totalDays,
        staffUserId: caller.id,
        staffEmail: caller.email,
        clinicId,
      });
    },

    /**
     * Manager approves a leave request.
     *
     * Existing roster shifts are never changed. Cross-clinic conflicts are
     * returned so managers can resolve them manually.
     */
    async approveLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      reviewNotes: string | null = null,
    ): Promise<ApproveLeaveResult> {
      assertReviewAccess(caller, clinicId);

      const request = await leaveRepository.findById(leaveId);

      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }

      if (request.status !== "pending") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Leave request is already '${request.status}' and cannot be approved`,
        );
      }

      const result = await leaveRepository.approveWithRosterConflicts({
        leaveId,
        clinicId,
        expectedStaffUserId: request.staffUserId,
        reviewedByUserId: caller.id,
        reviewNotes,
        timeZone: OPERATIONAL_TZ,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "leave_request",
        entityId: leaveId,
        action: "approved",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          staffUserId: request.staffUserId,
          startDate: request.startDate,
          endDate: request.endDate,
          leaveType: request.leaveType,
          reviewNotes: reviewNotes ?? undefined,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return result;
    },

    async getRosterConflicts(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
    ): Promise<LeaveRosterConflict[]> {
      assertReviewAccess(caller, clinicId);
      const request = await leaveRepository.findById(leaveId);
      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }
      return leaveRepository.listRosterConflicts({
        leaveId,
        clinicId,
        expectedStaffUserId: request.staffUserId,
        timeZone: OPERATIONAL_TZ,
      });
    },

    /** Manager rejects a leave request with a mandatory review note. */
    async rejectLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      reviewNotes: string,
    ): Promise<LeaveRequest> {
      assertReviewAccess(caller, clinicId);

      if (!reviewNotes.trim()) {
        throw new AppError(
          400,
          "REVIEW_NOTES_REQUIRED",
          "A review note explaining the rejection is required",
        );
      }

      const request = await leaveRepository.findById(leaveId);

      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }

      if (request.status !== "pending") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Leave request is already '${request.status}' and cannot be rejected`,
        );
      }

      const rejected = await leaveRepository.updateStatus(leaveId, {
        status: "rejected",
        reviewedByUserId: caller.id,
        reviewNotes,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "leave_request",
        entityId: leaveId,
        action: "rejected",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          staffUserId: request.staffUserId,
          startDate: request.startDate,
          endDate: request.endDate,
          leaveType: request.leaveType,
          reviewNotes,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return rejected;
    },

    /** Authorised manager cancels previously approved leave without changing roster shifts. */
    async cancelApprovedLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      cancellationReason: string,
    ): Promise<LeaveRequest> {
      assertReviewAccess(caller, clinicId);

      const reason = cancellationReason.trim();
      if (!reason) {
        throw new AppError(
          400,
          "CANCELLATION_REASON_REQUIRED",
          "A reason for cancelling approved leave is required",
        );
      }

      const request = await leaveRepository.findById(leaveId);
      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }
      if (request.status !== "approved") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Leave request is '${request.status}' and cannot be cancelled`,
        );
      }

      const cancelled = await leaveRepository.cancelApprovedLeave({
        leaveId,
        clinicId,
        expectedStaffUserId: request.staffUserId,
        cancelledByUserId: caller.id,
        cancellationReason: reason,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "leave_request",
        entityId: leaveId,
        action: "cancelled",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          staffUserId: request.staffUserId,
          startDate: request.startDate,
          endDate: request.endDate,
          leaveType: request.leaveType,
          cancellationReason: reason,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return cancelled;
    },

    /**
     * Staff member withdraws their own pending leave request.
     * A withdrawn request can never be re-submitted — the staff member must
     * create a new request.  Approved leave cannot be withdrawn (they must
     * ask a manager to handle it manually).
     */
    async withdrawLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
    ): Promise<LeaveRequest> {
      const request = await leaveRepository.findById(leaveId);

      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }

      assertOwnership(caller, request);

      if (request.status !== "pending") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          "Only pending leave requests can be withdrawn",
        );
      }

      return leaveRepository.updateStatus(leaveId, {
        status: "withdrawn",
        reviewedByUserId: caller.id,
        reviewNotes: null,
      });
    },

    /** Returns leave requests for a specific staff member. */
    async getLeaveForStaff(
      caller: AuthenticatedUser,
      staffUserId: string,
      clinicId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      // clinical_staff can only see their own leave.
      if (caller.role === "clinical_staff" && caller.id !== staffUserId) {
        throw new AppError(403, "FORBIDDEN", "You can only view your own leave requests");
      }

      return leaveRepository.listByStaff(staffUserId, options);
    },

    /** Returns all leave requests for a clinic (manager view). */
    async getLeaveForClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      assertReviewAccess(caller, clinicId);
      return leaveRepository.listByClinic(clinicId, options);
    },

    /** Paginated leave requests for a clinic (manager view). */
    async getLeaveForClinicPaginated(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeavePageOptions,
    ): Promise<LeavePage> {
      assertReviewAccess(caller, clinicId);
      return leaveRepository.listByClinicPaginated(clinicId, options);
    },

    /**
     * Checks whether a staff member has any approved leave on a given date.
     * Used by the roster scheduler before confirming a shift.
     */
    async hasApprovedLeaveOn(staffUserId: string, date: string): Promise<boolean> {
      const overlap = await leaveRepository.findApprovedOverlap(staffUserId, date);
      return overlap.length > 0;
    },
  };
}
