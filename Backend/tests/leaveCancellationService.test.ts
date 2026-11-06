import { createInMemoryLeaveRepository } from "../src/repositories/leaveRepository.js";
import { createInMemoryUserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import { createLeaveService } from "../src/services/leaveService.js";
import type { CreateAuditEventInput } from "../src/types/analytics.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STAFF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function caller(
  id: string,
  role: AuthenticatedUser["role"],
): AuthenticatedUser {
  return {
    id,
    email: `${id}@example.test`,
    role,
    homeClinicId: CLINIC_ID,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: ["module:leave"],
  };
}

function harness() {
  const repository = createInMemoryLeaveRepository();
  const auditEvents: CreateAuditEventInput[] = [];
  const service = createLeaveService(
    repository,
    {
      recordEvent(input) {
        auditEvents.push(input);
        return Promise.resolve(input);
      },
    },
    undefined,
    createInMemoryUserClinicAssignmentsRepository(),
  );
  return { repository, auditEvents, service };
}

describe("Leave cancellation independent review", () => {
  it("forbids Owner/Admin direct cancellation and child approval or decline without mutations or audits", async () => {
    const owner = caller(OWNER_ID, "owner_admin");
    const manager = caller(MANAGER_ID, "group_practice_manager");
    const { repository, auditEvents, service } = harness();

    const leave = await service.createLeaveRequest(owner, CLINIC_ID, {
      leaveType: "annual",
      startDate: "2035-05-12",
      endDate: "2035-05-16",
      reason: "Five-day leave",
    });
    await service.approveLeaveRequest(manager, CLINIC_ID, leave.id);

    await expect(
      service.cancelApprovedLeaveRequest(owner, CLINIC_ID, leave.id, "Direct self cancellation"),
    ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });

    const request = await service.createCancellationRequest(
      owner,
      CLINIC_ID,
      leave.id,
      "Plans changed",
    );

    await expect(
      service.approveCancellationRequest(
        owner,
        CLINIC_ID,
        leave.id,
        request.id,
        "Self approval",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });
    await expect(
      service.declineCancellationRequest(
        owner,
        CLINIC_ID,
        leave.id,
        request.id,
        "Self decline",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });

    await expect(repository.findById(leave.id)).resolves.toMatchObject({
      status: "approved",
      cancelledByUserId: null,
      cancellationSelfReviewExceptionUsed: false,
    });
    await expect(repository.findCancellationRequestById({
      requestId: request.id,
      leaveId: leave.id,
      clinicId: CLINIC_ID,
    })).resolves.toMatchObject({
      status: "pending",
      reviewedByUserId: null,
      selfReviewExceptionUsed: false,
    });
    expect(auditEvents.filter((event) =>
      ["cancelled", "cancellation_request_approved", "cancellation_request_declined"]
        .includes(event.action))).toEqual([]);
  });

  it("preserves independent Owner/Admin approval and records false exception evidence", async () => {
    const owner = caller(OWNER_ID, "owner_admin");
    const manager = caller(MANAGER_ID, "group_practice_manager");
    const staff = caller(STAFF_ID, "clinical_staff");
    const { auditEvents, service } = harness();
    const leave = await service.createLeaveRequest(staff, CLINIC_ID, {
      leaveType: "annual",
      startDate: "2035-06-12",
      endDate: "2035-06-12",
      reason: null,
    });
    await service.approveLeaveRequest(manager, CLINIC_ID, leave.id);
    const request = await service.createCancellationRequest(
      staff,
      CLINIC_ID,
      leave.id,
      "Plans changed",
    );

    const result = await service.approveCancellationRequest(
      owner,
      CLINIC_ID,
      leave.id,
      request.id,
      "Independently reviewed",
    );
    expect(result.request).toMatchObject({
      status: "approved",
      reviewedByUserId: OWNER_ID,
      selfReviewExceptionUsed: false,
    });
    expect(result.leave).toMatchObject({
      status: "cancelled",
      cancelledByUserId: OWNER_ID,
      cancellationSelfReviewExceptionUsed: false,
    });
    const decisionAudits = auditEvents.filter((event) =>
      ["cancellation_request_approved", "cancelled"].includes(event.action));
    expect(decisionAudits).toHaveLength(2);
    for (const event of decisionAudits) {
      expect(event).toMatchObject({
        entityId: leave.id,
        metadata: {
          cancellationRequestId: request.id,
          selfReviewExceptionUsed: false,
        },
      });
    }
  });

  it("preserves independent GPM decline and records false exception evidence", async () => {
    const owner = caller(OWNER_ID, "owner_admin");
    const manager = caller(MANAGER_ID, "group_practice_manager");
    const staff = caller(STAFF_ID, "clinical_staff");
    const { auditEvents, repository, service } = harness();
    const leave = await service.createLeaveRequest(staff, CLINIC_ID, {
      leaveType: "annual",
      startDate: "2035-07-12",
      endDate: "2035-07-12",
      reason: null,
    });
    await service.approveLeaveRequest(owner, CLINIC_ID, leave.id);
    const request = await service.createCancellationRequest(
      staff,
      CLINIC_ID,
      leave.id,
      "Leave remains required",
    );

    await expect(
      service.declineCancellationRequest(
        manager,
        CLINIC_ID,
        leave.id,
        request.id,
        "Coverage requires the approved leave to remain",
      ),
    ).resolves.toMatchObject({
      status: "declined",
      reviewedByUserId: MANAGER_ID,
      selfReviewExceptionUsed: false,
    });
    await expect(repository.findById(leave.id)).resolves.toMatchObject({
      status: "approved",
      cancellationSelfReviewExceptionUsed: false,
    });
    expect(auditEvents.find((event) =>
      event.action === "cancellation_request_declined")).toMatchObject({
      metadata: { selfReviewExceptionUsed: false },
    });
  });
});
