import { createInMemoryLeaveRepository } from "../src/repositories/leaveRepository.js";
import type { UserRepository } from "../src/repositories/userRepository.js";
import { createLeaveService } from "../src/services/leaveService.js";
import type { CreateAuditEventInput } from "../src/types/analytics.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";

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

describe("Leave cancellation sole-owner exception", () => {
  it("persists exception evidence on the child, parent, and parent-scoped audits", async () => {
    const owner = caller("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "owner_admin");
    const manager = caller("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "group_practice_manager");
    const auditEvents: CreateAuditEventInput[] = [];
    const userRepository = {
      canUseSoleOwnerAdminLeaveReviewException: () => Promise.resolve(true),
    } as unknown as UserRepository;
    const service = createLeaveService(
      createInMemoryLeaveRepository(),
      userRepository,
      {
        recordEvent(input) {
          auditEvents.push(input);
          return Promise.resolve(input);
        },
      },
    );

    const leave = await service.createLeaveRequest(owner, CLINIC_ID, {
      leaveType: "annual",
      startDate: "2035-05-12",
      endDate: "2035-05-16",
      reason: "Five-day leave",
    });
    await service.approveLeaveRequest(manager, CLINIC_ID, leave.id);
    const request = await service.createCancellationRequest(
      owner,
      CLINIC_ID,
      leave.id,
      "Plans changed",
    );

    const result = await service.approveCancellationRequest(
      owner,
      CLINIC_ID,
      leave.id,
      request.id,
      "Sole authorised reviewer",
    );

    expect(result.request).toMatchObject({
      status: "approved",
      selfReviewExceptionUsed: true,
    });
    expect(result.leave).toMatchObject({
      status: "cancelled",
      cancellationSelfReviewExceptionUsed: true,
    });
    const decisionAudits = auditEvents.filter((event) =>
      ["cancellation_request_approved", "cancelled"].includes(event.action));
    expect(decisionAudits.map((event) => event.action).sort()).toEqual([
      "cancellation_request_approved",
      "cancelled",
    ]);
    expect(decisionAudits).toHaveLength(2);
    for (const event of decisionAudits) {
      expect(event).toMatchObject({
        entityId: leave.id,
        metadata: {
          cancellationRequestId: request.id,
          selfReviewExceptionUsed: true,
        },
      });
    }
  });
});
