import { createInMemoryLeaveRepository } from "../src/repositories/leaveRepository.js";
import { createInMemoryUserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import type { UserRepository } from "../src/repositories/userRepository.js";
import { createLeaveService } from "../src/services/leaveService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

const HOME_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const HISTORICAL_CLINIC_ID = "22222222-2222-4222-8222-222222222222";

function manager(homeClinicId: string): AuthenticatedUser {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "manager@example.test",
    role: "group_practice_manager",
    homeClinicId,
    homeClinicName: "Home clinic",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: ["module:leave"],
  };
}

function owner(): AuthenticatedUser {
  return {
    ...manager(HOME_CLINIC_ID),
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@example.test",
    role: "owner_admin",
  };
}

function service() {
  return createLeaveService(
    createInMemoryLeaveRepository(),
    {} as UserRepository,
    undefined,
    undefined,
    createInMemoryUserClinicAssignmentsRepository(),
  );
}

describe("WF08 personal leave home-clinic fail-closed guard", () => {
  it.each(["", "not-a-clinic-id"])(
    "rejects submission when the authenticated home clinic is missing or invalid (%s)",
    async (homeClinicId) => {
      await expect(
        service().createLeaveRequest(manager(homeClinicId), HOME_CLINIC_ID, {
          leaveType: "annual",
          startDate: "2038-05-10",
          endDate: "2038-05-10",
          reason: null,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "TENANT_ACCESS_DENIED",
      });
    },
  );

  it("rejects personal history lookup outside the authenticated home clinic", async () => {
    await expect(
      service().getLeaveForStaff(
        manager("22222222-2222-4222-8222-222222222222"),
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        HOME_CLINIC_ID,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "TENANT_ACCESS_DENIED",
    });
  });

  it("denies self-withdrawal of historical cross-clinic leave without stranding review", async () => {
    const repository = createInMemoryLeaveRepository();
    const leaveService = createLeaveService(
      repository,
      {} as UserRepository,
      undefined,
      undefined,
      createInMemoryUserClinicAssignmentsRepository(),
    );
    const historical = await repository.create({
      staffUserId: manager(HOME_CLINIC_ID).id,
      staffEmail: "manager@example.test",
      clinicId: HISTORICAL_CLINIC_ID,
      leaveType: "annual",
      startDate: "2037-01-20",
      endDate: "2037-01-20",
      totalDays: 1,
      reason: "Created before home-clinic binding",
    });

    await expect(
      leaveService.withdrawLeaveRequest(
        manager(HOME_CLINIC_ID),
        HISTORICAL_CLINIC_ID,
        historical.id,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "TENANT_ACCESS_DENIED",
    });
    await expect(repository.findById(historical.id)).resolves.toMatchObject({
      status: "pending",
    });

    await expect(
      leaveService.rejectLeaveRequest(
        owner(),
        HISTORICAL_CLINIC_ID,
        historical.id,
        "Independent review closes the legacy request",
      ),
    ).resolves.toMatchObject({
      status: "rejected",
    });
  });
});
