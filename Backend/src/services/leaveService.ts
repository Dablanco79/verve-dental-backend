import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  ApproveLeaveResult,
  ApproveLeaveCancellationResult,
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  LeaveCancellationRequest,
  ListLeaveCancellationRequestOptions,
  LeaveRosterConflict,
  ListLeaveOptions,
  ListLeavePageOptions,
} from "../types/payroll.js";
import type { LeaveRepository } from "../repositories/leaveRepository.js";
import type { LeaveCoverageRepository } from "../repositories/leaveCoverageRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { UserClinicAssignmentsRepository } from "../repositories/userClinicAssignmentsRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";
import { inclusiveCalendarDayCount } from "../utils/calendarDate.js";
import { OPERATIONAL_TZ } from "../utils/melbourneTime.js";

type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Managers and admins may act on leave requests in clinics they can operate. */
async function assertReviewAccess(
  caller: AuthenticatedUser,
  clinicId: string,
  clinicAssignmentsRepository: UserClinicAssignmentsRepository,
): Promise<void> {
  if (caller.role === "owner_admin") return;
  if (caller.role === "group_practice_manager") {
    if (caller.homeClinicId === clinicId) return;
    if (await clinicAssignmentsRepository.hasOperationalAccess(caller.id, clinicId)) return;
  }
  throw new AppError(403, "FORBIDDEN", "Only managers and admins can approve or reject leave requests");
}

/** Only the owning staff member (or an owner_admin) can withdraw their own request. */
function assertOwnership(caller: AuthenticatedUser, request: LeaveRequest): void {
  if (caller.id === request.staffUserId) return;
  if (caller.role === "owner_admin") return;
  throw new AppError(403, "FORBIDDEN", "You can only manage your own leave requests");
}

/** Personal leave is always recorded and read against the user's authoritative home clinic. */
function assertPersonalHomeClinic(
  caller: AuthenticatedUser,
  clinicId: string,
): void {
  if (caller.homeClinicId === clinicId) return;
  throw new AppError(
    403,
    "TENANT_ACCESS_DENIED",
    "Personal leave is only available for your home clinic",
  );
}

/**
 * Original leave decisions require a reviewer other than the employee whose
 * leave is being reviewed. The sole Owner/Admin exception is intentionally
 * limited to cancellation workflows and does not apply here.
 */
function assertIndependentLeaveReviewer(
  caller: AuthenticatedUser,
  request: LeaveRequest,
): void {
  if (caller.id !== request.staffUserId) return;
  throw new AppError(
    403,
    "SELF_REVIEW_FORBIDDEN",
    "You cannot approve or reject your own leave request",
  );
}

export type LeaveService = ReturnType<typeof createLeaveService>;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createLeaveService(
  leaveRepository: LeaveRepository,
  userRepository: UserRepository,
  auditWriter: AuditWriter | undefined,
  leaveCoverageRepository: LeaveCoverageRepository | undefined,
  clinicAssignmentsRepository: UserClinicAssignmentsRepository,
) {
  const coverageRepository = (): LeaveCoverageRepository => {
    if (!leaveCoverageRepository) {
      throw new AppError(503, "LEAVE_COVERAGE_UNAVAILABLE", "Leave coverage is unavailable");
    }
    return leaveCoverageRepository;
  };

  const cleanGroupName = (name: string): string => {
    const cleaned = name.trim();
    if (!cleaned) throw new AppError(400, "VALIDATION_ERROR", "Coverage group name cannot be blank");
    return cleaned;
  };

  const auditCoverage = (
    caller: AuthenticatedUser,
    clinicId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): void => {
    auditWriter?.recordEvent({
      clinicId,
      entityType: "clinic",
      entityId: clinicId,
      action,
      actorId: caller.id,
      actorEmail: caller.email,
      metadata,
    }).catch((err: unknown) => {
      console.error("[Audit Failure Guard]:", err);
    });
  };

  async function selfReviewException(
    caller: AuthenticatedUser,
    clinicId: string,
    request: { staffUserId: string; requestedByUserId?: string },
  ): Promise<boolean> {
    if (caller.id !== request.staffUserId && caller.id !== request.requestedByUserId) return false;
    if (caller.role !== "owner_admin" ||
        !(await userRepository.canUseSoleOwnerAdminLeaveReviewException(clinicId, caller.id))) {
      throw new AppError(403, "SELF_REVIEW_FORBIDDEN", "You cannot review your own cancellation request");
    }
    return true;
  }

  return {
    /**
     * Any authenticated employee submits leave for themselves at their home clinic.
     * Employee identity is always derived from the authoritative caller context.
     */
    async createLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      input: Omit<
        CreateLeaveRequestInput,
        "staffUserId" | "staffEmail" | "clinicId" | "totalDays"
      >,
    ): Promise<LeaveRequest> {
      assertPersonalHomeClinic(caller, clinicId);

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
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);

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

      assertIndependentLeaveReviewer(caller, request);

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
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
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
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);

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

      assertIndependentLeaveReviewer(caller, request);

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
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);

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
      const exceptionUsed = await selfReviewException(caller, clinicId, request);

      const cancelled = await leaveRepository.cancelApprovedLeave({
        leaveId,
        clinicId,
        expectedStaffUserId: request.staffUserId,
        cancelledByUserId: caller.id,
        cancellationReason: reason,
        selfReviewExceptionUsed: exceptionUsed,
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
          selfReviewExceptionUsed: exceptionUsed,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return cancelled;
    },

    async createCancellationRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      requestReason: string,
    ): Promise<LeaveCancellationRequest> {
      assertPersonalHomeClinic(caller, clinicId);
      const reason = requestReason.trim();
      if (!reason) {
        throw new AppError(400, "CANCELLATION_REASON_REQUIRED", "A cancellation reason is required");
      }
      const leave = await leaveRepository.findById(leaveId);
      if (!leave || leave.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }
      if (leave.staffUserId !== caller.id) {
        throw new AppError(403, "FORBIDDEN", "You can only request cancellation of your own leave");
      }
      if (leave.status !== "approved") {
        throw new AppError(409, "INVALID_STATUS_TRANSITION", "Only approved leave can be cancelled");
      }
      const request = await leaveRepository.createCancellationRequest({
        leaveRequestId: leaveId,
        clinicId,
        staffUserId: caller.id,
        requestedByUserId: caller.id,
        requestReason: reason,
      });
      auditWriter?.recordEvent({
        clinicId,
        entityType: "leave_request",
        entityId: leaveId,
        action: "cancellation_requested",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: { leaveId, staffUserId: caller.id, requestReason: reason },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });
      return request;
    },

    async listCancellationRequests(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeaveCancellationRequestOptions,
    ): Promise<LeaveCancellationRequest[]> {
      if (caller.role === "clinical_staff") {
        assertPersonalHomeClinic(caller, clinicId);
        return leaveRepository.listCancellationRequestsByStaff(caller.id, clinicId, options);
      }
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      return leaveRepository.listCancellationRequestsByClinic(clinicId, options);
    },

    async listMyCancellationRequests(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeaveCancellationRequestOptions,
    ): Promise<LeaveCancellationRequest[]> {
      assertPersonalHomeClinic(caller, clinicId);
      return leaveRepository.listCancellationRequestsByStaff(caller.id, clinicId, options);
    },

    async approveCancellationRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      requestId: string,
      reviewNotes: string | null,
    ): Promise<ApproveLeaveCancellationResult> {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const request = await leaveRepository.findCancellationRequestById({ requestId, leaveId, clinicId });
      if (!request) {
        throw new AppError(404, "NOT_FOUND", "Cancellation request not found");
      }
      if (request.status !== "pending") throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
      const exceptionUsed = await selfReviewException(caller, clinicId, request);
      const result = await leaveRepository.approveCancellationRequest({
        requestId, leaveId, clinicId,
        expectedStaffUserId: request.staffUserId,
        reviewedByUserId: caller.id,
        reviewNotes,
        selfReviewExceptionUsed: exceptionUsed,
      });
      for (const action of ["cancellation_request_approved", "cancelled"]) {
        auditWriter?.recordEvent({
          clinicId,
          entityType: "leave_request",
          entityId: leaveId,
          action,
          actorId: caller.id,
          actorEmail: caller.email,
          metadata: { cancellationRequestId: requestId, staffUserId: request.staffUserId, selfReviewExceptionUsed: exceptionUsed },
        }).catch((err: unknown) => {
          console.error("[Audit Failure Guard]:", err);
        });
      }
      return result;
    },

    async declineCancellationRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      requestId: string,
      reviewNotes: string,
    ): Promise<LeaveCancellationRequest> {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      if (!reviewNotes.trim()) throw new AppError(400, "REVIEW_NOTES_REQUIRED", "Review notes are required");
      const request = await leaveRepository.findCancellationRequestById({ requestId, leaveId, clinicId });
      if (!request) {
        throw new AppError(404, "NOT_FOUND", "Cancellation request not found");
      }
      if (request.status !== "pending") throw new AppError(409, "INVALID_STATUS_TRANSITION", "Cancellation request is no longer pending");
      const exceptionUsed = await selfReviewException(caller, clinicId, request);
      const declined = await leaveRepository.declineCancellationRequest({
        requestId, leaveId, clinicId,
        expectedStaffUserId: request.staffUserId,
        reviewedByUserId: caller.id,
        reviewNotes: reviewNotes.trim(),
        selfReviewExceptionUsed: exceptionUsed,
      });
      auditWriter?.recordEvent({
        clinicId,
        entityType: "leave_request",
        entityId: leaveId,
        action: "cancellation_request_declined",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: { cancellationRequestId: requestId, staffUserId: request.staffUserId, reviewNotes: reviewNotes.trim(), selfReviewExceptionUsed: exceptionUsed },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });
      return declined;
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
      assertPersonalHomeClinic(caller, clinicId);
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
      assertPersonalHomeClinic(caller, clinicId);
      if (caller.id !== staffUserId) {
        throw new AppError(403, "FORBIDDEN", "You can only view your own leave requests");
      }

      return leaveRepository.listByStaff(staffUserId, clinicId, options);
    },

    /** Returns all leave requests for a clinic (manager view). */
    async getLeaveForClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeaveOptions,
    ): Promise<LeaveRequest[]> {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      return leaveRepository.listByClinic(clinicId, options);
    },

    /** Paginated leave requests for a clinic (manager view). */
    async getLeaveForClinicPaginated(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListLeavePageOptions,
    ): Promise<LeavePage> {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      return leaveRepository.listByClinicPaginated(clinicId, options);
    },

    async getCoverageWarning(
      caller: AuthenticatedUser,
      clinicId: string,
      startDate: string,
      endDate: string,
    ) {
      if (caller.role === "clinical_staff") {
        if (caller.homeClinicId !== clinicId) {
          throw new AppError(
            403,
            "FORBIDDEN",
            "You can only preview leave coverage for your home clinic",
          );
        }
      } else {
        await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      }
      try {
        inclusiveCalendarDayCount(startDate, endDate);
      } catch (error) {
        throw new AppError(
          400,
          "INVALID_DATE_RANGE",
          error instanceof Error ? error.message : "Invalid leave date range",
        );
      }
      return coverageRepository().getWarning(clinicId, caller.id, startDate, endDate);
    },

    async getLeaveCoverageWarning(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
    ) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const request = await leaveRepository.findById(leaveId);
      if (!request || request.clinicId !== clinicId) {
        throw new AppError(404, "NOT_FOUND", "Leave request not found");
      }
      if (request.status !== "pending") {
        throw new AppError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Leave request is already '${request.status}' and cannot be checked for coverage overlaps`,
        );
      }
      return coverageRepository().getWarning(
        clinicId,
        request.staffUserId,
        request.startDate,
        request.endDate,
      );
    },

    async getCoverageSettings(caller: AuthenticatedUser, clinicId: string) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      return coverageRepository().getSettings(clinicId);
    },

    async updateCoverageSettings(
      caller: AuthenticatedUser,
      clinicId: string,
      enabled: boolean,
    ) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const result = await coverageRepository().updateSettings(clinicId, enabled);
      auditCoverage(caller, clinicId, "leave_coverage_settings_updated", { enabled });
      return result;
    },

    async listCoverageGroups(caller: AuthenticatedUser, clinicId: string) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      return coverageRepository().listGroups(clinicId);
    },

    async createCoverageGroup(
      caller: AuthenticatedUser,
      clinicId: string,
      name: string,
    ) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const group = await coverageRepository().createGroup(clinicId, cleanGroupName(name));
      auditCoverage(caller, clinicId, "leave_coverage_group_created", {
        coverageGroupId: group.id,
        name: group.name,
      });
      return group;
    },

    async updateCoverageGroup(
      caller: AuthenticatedUser,
      clinicId: string,
      groupId: string,
      name: string,
    ) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const group = await coverageRepository().updateGroup(clinicId, groupId, cleanGroupName(name));
      auditCoverage(caller, clinicId, "leave_coverage_group_updated", {
        coverageGroupId: group.id,
        name: group.name,
      });
      return group;
    },

    async replaceCoverageGroupMembers(
      caller: AuthenticatedUser,
      clinicId: string,
      groupId: string,
      memberUserIds: string[],
    ) {
      await assertReviewAccess(caller, clinicId, clinicAssignmentsRepository);
      const group = await coverageRepository().replaceMembers(clinicId, groupId, memberUserIds);
      auditCoverage(caller, clinicId, "leave_coverage_members_updated", {
        coverageGroupId: group.id,
        memberCount: group.memberUserIds.length,
      });
      return group;
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
