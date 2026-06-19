import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  CreateLeaveRequestInput,
  LeavePage,
  LeaveRequest,
  ListLeaveOptions,
  ListLeavePageOptions,
} from "../types/payroll.js";
import type { LeaveRepository } from "../repositories/leaveRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

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
  rosterRepository: RosterRepository,
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
      input: Omit<CreateLeaveRequestInput, "staffUserId" | "staffEmail" | "clinicId">,
    ): Promise<LeaveRequest> {
      // clinical_staff may only submit for their own home clinic.
      if (caller.role === "clinical_staff" && caller.homeClinicId !== clinicId) {
        throw new AppError(403, "FORBIDDEN", "You can only submit leave for your home clinic");
      }

      if (input.startDate > input.endDate) {
        throw new AppError(400, "INVALID_DATE_RANGE", "startDate must be on or before endDate");
      }

      if (input.totalDays <= 0) {
        throw new AppError(400, "INVALID_TOTAL_DAYS", "totalDays must be greater than zero");
      }

      return leaveRepository.create({
        ...input,
        staffUserId: caller.id,
        staffEmail: caller.email,
        clinicId,
      });
    },

    /**
     * Manager approves a leave request.
     *
     * ROSTER GUARDRAIL: Any scheduled or confirmed roster shifts for the staff
     * member that overlap the leave date window are automatically cancelled.
     * This prevents the roster from showing the staff member as available on
     * days they have approved leave, protecting both scheduling integrity and
     * the materials forecasting engine (cancelled shifts → zero expected usage).
     */
    async approveLeaveRequest(
      caller: AuthenticatedUser,
      clinicId: string,
      leaveId: string,
      reviewNotes: string | null = null,
    ): Promise<LeaveRequest> {
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

      // ── Roster guardrail ──────────────────────────────────────────────────
      // Find all roster entries for the staff member that overlap the leave
      // date window. The from/to window is expressed as TIMESTAMPTZ boundaries:
      //   from = midnight on the first leave day (UTC)
      //   to   = midnight on the day AFTER the last leave day (exclusive)
      //
      // CROSS-TENANT SAFETY: listByStaffAtClinic is used intentionally rather
      // than listByStaff.  The underlying query requires BOTH employee_id AND
      // clinic_id predicates (WHERE staff_user_id = $1 AND rostered_clinic_id = $2),
      // guaranteeing that an approval action inside Tenant A cannot cascade-cancel
      // roster shifts belonging to Tenant B even if the staff member is rostered
      // across multiple clinics.
      const leaveFrom = new Date(`${request.startDate}T00:00:00.000Z`);
      const leaveTo = new Date(`${request.endDate}T00:00:00.000Z`);
      leaveTo.setUTCDate(leaveTo.getUTCDate() + 1);

      const overlappingShifts = await rosterRepository.listByStaffAtClinic(
        request.staffUserId,
        clinicId,
        { from: leaveFrom, to: leaveTo },
      );

      const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set(["scheduled", "confirmed"]);

      await Promise.all(
        overlappingShifts
          .filter((s) => CANCELLABLE_STATUSES.has(s.status))
          .map((s) =>
            rosterRepository.updateEntry(
              s.id,
              { status: "cancelled" },
              { userId: caller.id, email: caller.email },
            ),
          ),
      );
      // ─────────────────────────────────────────────────────────────────────

      const approved = await leaveRepository.updateStatus(leaveId, {
        status: "approved",
        reviewedByUserId: caller.id,
        reviewNotes,
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

      return approved;
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
