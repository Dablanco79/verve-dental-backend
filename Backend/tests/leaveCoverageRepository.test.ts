import { createInMemoryLeaveCoverageRepository } from "../src/repositories/leaveCoverageRepository.js";
import { createInMemoryLeaveRepository } from "../src/repositories/leaveRepository.js";
import { createInMemoryUserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createLeaveService } from "../src/services/leaveService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

describe("leave coverage warnings", () => {
  it("implements the state matrix and returns a privacy-minimal, deduplicated warning", async () => {
    const leave = createInMemoryLeaveRepository();
    const coverage = createInMemoryLeaveCoverageRepository(
      createInMemoryUserClinicAssignmentsRepository(),
      leave,
    );
    const subject = SEED_USER_IDS.clinicAStaff;
    const peer = SEED_USER_IDS.clinicAManager;

    expect(await coverage.getWarning(SEED_CLINIC_A_ID, subject, "2035-04-01", "2035-04-02"))
      .toMatchObject({ enabled: false, status: "disabled", overlappingColleagueCount: 0 });

    await coverage.updateSettings(SEED_CLINIC_A_ID, true);
    expect(await coverage.getWarning(SEED_CLINIC_A_ID, subject, "2035-04-01", "2035-04-02"))
      .toMatchObject({ enabled: true, status: "unconfigured" });

    const first = await coverage.createGroup(SEED_CLINIC_A_ID, "Nurses");
    expect(await coverage.getWarning(SEED_CLINIC_A_ID, subject, "2035-04-01", "2035-04-02"))
      .toMatchObject({ status: "staff_unassigned" });

    const second = await coverage.createGroup(SEED_CLINIC_A_ID, "Closing team");
    await coverage.replaceMembers(SEED_CLINIC_A_ID, first.id, [subject, peer]);
    await coverage.replaceMembers(SEED_CLINIC_A_ID, second.id, [subject, peer]);

    const request = await leave.create({
      staffUserId: peer,
      staffEmail: "private@example.test",
      clinicId: SEED_CLINIC_A_ID,
      leaveType: "sick",
      startDate: "2035-04-02",
      endDate: "2035-04-04",
      totalDays: 3,
      reason: "private reason",
    });
    await leave.approveWithRosterConflicts({
      leaveId: request.id,
      clinicId: SEED_CLINIC_A_ID,
      expectedStaffUserId: peer,
      reviewedByUserId: SEED_USER_IDS.clinicAAdmin,
      reviewNotes: null,
      timeZone: "Australia/Melbourne",
    });
    // A pending cancellation does not alter the approved parent.
    await leave.createCancellationRequest({
      leaveRequestId: request.id,
      clinicId: SEED_CLINIC_A_ID,
      staffUserId: peer,
      requestedByUserId: peer,
      requestReason: "pending only",
    });

    const warning = await coverage.getWarning(
      SEED_CLINIC_A_ID,
      subject,
      "2035-04-01",
      "2035-04-02",
    );
    expect(warning).toMatchObject({
      enabled: true,
      status: "ready",
      overlappingColleagueCount: 1,
    });
    expect(warning.affectedGroups).toHaveLength(2);
    expect(warning.affectedGroups).toContainEqual(
      { clinicId: SEED_CLINIC_A_ID, groupId: first.id, groupName: "Nurses" },
    );
    expect(warning.affectedGroups).toContainEqual(
      { clinicId: SEED_CLINIC_A_ID, groupId: second.id, groupName: "Closing team" },
    );
    expect(JSON.stringify(warning)).not.toMatch(
      /private@example|private reason|sick|leaveId|startDate|endDate/,
    );
  });

  it("rejects non-roster-eligible members", async () => {
    const coverage = createInMemoryLeaveCoverageRepository(
      createInMemoryUserClinicAssignmentsRepository(),
      createInMemoryLeaveRepository(),
    );
    const group = await coverage.createGroup(SEED_CLINIC_A_ID, "Eligible only");
    await expect(
      coverage.replaceMembers(
        SEED_CLINIC_A_ID,
        group.id,
        ["99999999-9999-4999-8999-999999999999"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_COVERAGE_MEMBERS" });
  });

  it("enforces employee home-clinic scope inside the service", async () => {
    const leave = createInMemoryLeaveRepository();
    const assignments = createInMemoryUserClinicAssignmentsRepository();
    const coverage = createInMemoryLeaveCoverageRepository(
      assignments,
      leave,
    );
    const service = createLeaveService(
      leave,
      undefined,
      coverage,
      assignments,
    );
    const caller: AuthenticatedUser = {
      id: SEED_USER_IDS.clinicAStaff,
      email: "staff@clinic-a.au",
      role: "clinical_staff",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Clinic A",
      firstName: null,
      lastName: null,
      displayName: null,
      permissions: ["module:leave"],
    };
    await expect(
      service.getCoverageWarning(caller, SEED_CLINIC_B_ID, "2035-01-01", "2035-01-01"),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });
});
