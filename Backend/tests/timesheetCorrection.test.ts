import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import type { ClinicRepository } from "../src/repositories/clinicRepository.js";
import type { RosterRepository } from "../src/repositories/rosterRepository.js";
import { createInMemoryTimesheetRepository } from "../src/repositories/timesheetRepository.js";
import type { UserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import type { UserRepository } from "../src/repositories/userRepository.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createTimesheetService } from "../src/services/timesheetService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { CreateAuditEventInput } from "../src/types/analytics.js";
import type { TimesheetStatus } from "../src/types/payroll.js";

type Timesheet = {
  id: string;
  clockInAt: string;
  clockOutAt: string;
  totalHoursWorked: number;
  ordinaryHours: number;
  overtime15xHours: number;
  overtime2xHours: number;
  timesheetStatus: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
};

const correctionBody = {
  clockInAt: "2028-05-31T21:30:00.000Z",
  clockOutAt: "2028-06-01T08:00:00.000Z",
  correctionReason: "Manager verified paper log",
};

function createServiceHarness(
  status: TimesheetStatus,
  options: { payrollType?: "hourly_auto" | "commission_log"; staffUserId?: string } = {},
) {
  const auditEvents: CreateAuditEventInput[] = [];
  const repository = createInMemoryTimesheetRepository({
    recordEvent: (event) => {
      auditEvents.push(event);
      return Promise.resolve(event);
    },
  });
  const service = createTimesheetService(
    repository,
    {} as UserRepository,
    {} as RosterRepository,
    {
      hasOperationalAccess: () => Promise.resolve(true),
    } as unknown as UserClinicAssignmentsRepository,
    {} as ClinicRepository,
  );
  const caller: AuthenticatedUser = {
    id: SEED_USER_IDS.clinicAManager,
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: SEED_CLINIC_A_ID,
    homeClinicName: "Verve Dental Clinic A",
    firstName: "Morgan",
    lastName: "Manager",
    displayName: null,
    payrollTrack: "hourly",
    permissions: ["module:timesheets"],
  };

  const entryPromise = repository
    .create({
      payrollType: options.payrollType ?? "hourly_auto",
      staffUserId: options.staffUserId ?? SEED_USER_IDS.clinicAStaff,
      staffEmail: "staff@clinic-a.au",
      clinicId: SEED_CLINIC_A_ID,
      rosteredClinicId: SEED_CLINIC_A_ID,
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2028-06-01",
      shiftStartAt: new Date("2028-05-31T22:00:00.000Z"),
      shiftEndAt: new Date("2028-06-01T08:00:00.000Z"),
      attendanceStatus: "present",
      clockInAt: new Date("2028-05-31T22:00:00.000Z"),
      clockOutAt: new Date("2028-06-01T06:30:00.000Z"),
      breakDurationMinutes: 30,
      totalHoursWorked: 8,
      ordinaryHours: 8,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      commissionNote: null,
      generatedBy: "staff@clinic-a.au",
      clockInLocation: null,
      clockOutLocation: null,
    })
    .then((entry) => repository.update(entry.id, { timesheetStatus: status }));

  return { service, caller, entryPromise, auditEvents };
}

describe("manager timesheet correction API", () => {
  it("recalculates submitted hours, clears review fields, and records the audit event", async () => {
    const app = await createTestApp();
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
      .set("Authorization", `Bearer ${manager}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        rosterEntryId: null,
        shiftDate: "2028-06-01",
        shiftStartAt: "2028-05-31T22:00:00.000Z",
        shiftEndAt: "2028-06-01T08:00:00.000Z",
        clockInAt: "2028-05-31T22:00:00.000Z",
        clockOutAt: "2028-06-01T06:30:00.000Z",
        breakDurationMinutes: 30,
      })
      .expect(201);
    const original = (created.body as { data: Timesheet }).data;

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${original.id}/reject`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ approvalNotes: "Incorrect punch" })
      .expect(200);

    const correctedResponse = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${original.id}/correct`)
      .set("Authorization", `Bearer ${manager}`)
      .send({
        clockInAt: "2028-05-31T21:30:00.000Z",
        clockOutAt: "2028-06-01T08:00:00.000Z",
        correctionReason: "  Manager verified paper log  ",
      })
      .expect(200);
    const corrected = (correctedResponse.body as { data: Timesheet }).data;

    expect(corrected).toMatchObject({
      clockInAt: "2028-05-31T21:30:00.000Z",
      clockOutAt: "2028-06-01T08:00:00.000Z",
      totalHoursWorked: 10,
      ordinaryHours: 8,
      overtime15xHours: 2,
      overtime2xHours: 0,
      timesheetStatus: "submitted",
      approvedByUserId: null,
      approvedAt: null,
      approvalNotes: null,
    });

    const auditResponse = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/analytics/audit-events`)
      .query({ entityType: "timesheet_entry", entityId: original.id })
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    const events = (auditResponse.body as {
      data: { events: Array<Record<string, unknown>> };
    }).data.events;
    const event = events.find((candidate) => candidate["action"] === "corrected");
    expect(event).toBeDefined();
    if (!event) throw new Error("Correction audit event missing");
    expect(event).toMatchObject({
      entityType: "timesheet_entry",
      entityId: original.id,
      actorId: SEED_USER_IDS.clinicAManager,
      actorEmail: "manager@clinic-a.au",
    });
    const metadata = event["metadata"];
    expect(metadata).toBeDefined();
    if (typeof metadata !== "object" || metadata === null) {
      throw new Error("Correction audit metadata missing");
    }
    expect(metadata).toMatchObject({
      reason: "Manager verified paper log",
      before: { status: "rejected" },
      after: { status: "submitted", totalHoursWorked: 10 },
    });
    const createdAt = event["createdAt"];
    expect(typeof createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(String(createdAt)))).toBe(false);
  });

  it.each([
    ["blank reason", { clockInAt: "2028-05-31T22:00:00.000Z", clockOutAt: "2028-06-01T06:00:00.000Z", correctionReason: " " }],
    ["equal times", { clockInAt: "2028-06-01T06:00:00.000Z", clockOutAt: "2028-06-01T06:00:00.000Z", correctionReason: "Fix" }],
    ["reversed times", { clockInAt: "2028-06-01T07:00:00.000Z", clockOutAt: "2028-06-01T06:00:00.000Z", correctionReason: "Fix" }],
  ])("rejects %s", async (_label, correction) => {
    const app = await createTestApp();
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const created = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
      .set("Authorization", `Bearer ${manager}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        rosterEntryId: null,
        shiftDate: "2028-06-02",
        shiftStartAt: "2028-06-01T22:00:00.000Z",
        shiftEndAt: "2028-06-02T06:00:00.000Z",
        clockInAt: "2028-06-01T22:00:00.000Z",
        clockOutAt: "2028-06-02T06:00:00.000Z",
        breakDurationMinutes: 0,
      })
      .expect(201);
    const id = (created.body as { data: Timesheet }).data.id;

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${manager}`)
      .send(correction)
      .expect(400);
  });

  it("blocks self correction, approved entries, and wrong-clinic targets", async () => {
    const app = await createTestApp();
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const created = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
      .set("Authorization", `Bearer ${owner}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAManager,
        rosterEntryId: null,
        shiftDate: "2028-06-03",
        shiftStartAt: "2028-06-02T22:00:00.000Z",
        shiftEndAt: "2028-06-03T06:00:00.000Z",
        clockInAt: "2028-06-02T22:00:00.000Z",
        clockOutAt: "2028-06-03T06:00:00.000Z",
        breakDurationMinutes: 0,
      })
      .expect(201);
    const id = (created.body as { data: Timesheet }).data.id;
    const body = {
      clockInAt: "2028-06-02T21:55:00.000Z",
      clockOutAt: "2028-06-03T06:00:00.000Z",
      correctionReason: "Verified",
    };

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${manager}`)
      .send(body)
      .expect(403);

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${id}/approve`)
      .set("Authorization", `Bearer ${owner}`)
      .send({})
      .expect(200);
    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${owner}`)
      .send(body)
      .expect(409);

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${owner}`)
      .send(body)
      .expect(404);
  });

  it("allows a manager to correct Clinic B only while assignment and module grant are active", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const ownerAToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const ownerBToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const created = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicBAdmin,
        rosterEntryId: null,
        shiftDate: "2028-06-04",
        shiftStartAt: "2028-06-03T22:00:00.000Z",
        shiftEndAt: "2028-06-04T06:00:00.000Z",
        clockInAt: "2028-06-03T22:00:00.000Z",
        clockOutAt: "2028-06-04T06:00:00.000Z",
        breakDurationMinutes: 0,
      })
      .expect(201);
    const id = (created.body as { data: Timesheet }).data.id;
    const body = {
      clockInAt: "2028-06-03T21:45:00.000Z",
      clockOutAt: "2028-06-04T06:00:00.000Z",
      correctionReason: "Clinic B paper log",
    };

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(body)
      .expect(403);

    await request(app)
      .put(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/clinic-access`,
      )
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({
        assignments: [
          { clinicId: SEED_CLINIC_A_ID, canRoster: true, canOperate: true },
          { clinicId: SEED_CLINIC_B_ID, canRoster: false, canOperate: true },
        ],
      })
      .expect(200);
    await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions`,
      )
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ permission: "module:timesheets" })
      .expect(201);

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(body)
      .expect(200);

    await request(app)
      .delete(
        `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions/module%3Atimesheets`,
      )
      .set("Authorization", `Bearer ${ownerAToken}`)
      .expect(204);

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(body)
      .expect(403);
  });
});

describe("timesheet correction service invariants", () => {
  it.each<TimesheetStatus>(["submitted", "rejected", "requires_amendment"])(
    "corrects and recalculates an hourly %s entry",
    async (status) => {
      const { service, caller, entryPromise, auditEvents } = createServiceHarness(status);
      const entry = await entryPromise;

      const corrected = await service.correctTimesheet(caller, SEED_CLINIC_A_ID, entry.id, {
        clockInAt: new Date(correctionBody.clockInAt),
        clockOutAt: new Date(correctionBody.clockOutAt),
        correctionReason: `  ${correctionBody.correctionReason}  `,
      });

      expect(corrected).toMatchObject({
        timesheetStatus: "submitted",
        totalHoursWorked: 10,
        ordinaryHours: 8,
        overtime15xHours: 2,
        overtime2xHours: 0,
        approvedByUserId: null,
        approvedAt: null,
        approvalNotes: null,
      });
      expect(auditEvents).toHaveLength(1);
      const auditEvent = auditEvents[0];
      expect(auditEvent?.actorId).toBe(caller.id);
      expect(auditEvent?.metadata["reason"]).toBe(correctionBody.correctionReason);
      expect(auditEvent?.metadata["before"]).toMatchObject({ status });
      expect(auditEvent?.metadata["after"]).toMatchObject({
        status: "submitted",
        totalHoursWorked: 10,
      });
    },
  );

  it("rejects self-correction of a rejected entry", async () => {
    const { service, caller, entryPromise } = createServiceHarness("rejected", {
      staffUserId: SEED_USER_IDS.clinicAManager,
    });
    const entry = await entryPromise;

    await expect(
      service.correctTimesheet(caller, SEED_CLINIC_A_ID, entry.id, {
        clockInAt: new Date(correctionBody.clockInAt),
        clockOutAt: new Date(correctionBody.clockOutAt),
        correctionReason: correctionBody.correctionReason,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "SELF_REVIEW_FORBIDDEN" });
  });

  it.each<TimesheetStatus>(["approved", "processed"])(
    "keeps %s entries immutable",
    async (status) => {
      const { service, caller, entryPromise } = createServiceHarness(status);
      const entry = await entryPromise;
      await expect(
        service.correctTimesheet(caller, SEED_CLINIC_A_ID, entry.id, {
          clockInAt: new Date(correctionBody.clockInAt),
          clockOutAt: new Date(correctionBody.clockOutAt),
          correctionReason: correctionBody.correctionReason,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "TIMESHEET_NOT_CORRECTABLE" });
    },
  );

  it("blocks commission entries independently of status", async () => {
    const { service, caller, entryPromise } = createServiceHarness("submitted", {
      payrollType: "commission_log",
    });
    const entry = await entryPromise;
    await expect(
      service.correctTimesheet(caller, SEED_CLINIC_A_ID, entry.id, {
        clockInAt: new Date(correctionBody.clockInAt),
        clockOutAt: new Date(correctionBody.clockOutAt),
        correctionReason: correctionBody.correctionReason,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "TIMESHEET_NOT_CORRECTABLE" });
  });

  it("rejects a correction whose stored break exceeds the corrected duration", async () => {
    const { service, caller, entryPromise } = createServiceHarness("submitted");
    const entry = await entryPromise;
    await expect(
      service.correctTimesheet(caller, SEED_CLINIC_A_ID, entry.id, {
        clockInAt: new Date("2028-06-01T06:00:00.000Z"),
        clockOutAt: new Date("2028-06-01T06:15:00.000Z"),
        correctionReason: correctionBody.correctionReason,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CLOCK_TIMES" });
  });

  it("restores the exact entry and records no successful event when audit writing fails", async () => {
    const successfulEvents: CreateAuditEventInput[] = [];
    const repository = createInMemoryTimesheetRepository({
      recordEvent: () => Promise.reject(new Error("injected audit failure")),
    });
    const service = createTimesheetService(
      repository,
      {} as UserRepository,
      {} as RosterRepository,
      {
        hasOperationalAccess: () => Promise.resolve(true),
      } as unknown as UserClinicAssignmentsRepository,
      {} as ClinicRepository,
    );
    const original = await repository.create({
      payrollType: "hourly_auto",
      staffUserId: SEED_USER_IDS.clinicAStaff,
      staffEmail: "staff@clinic-a.au",
      clinicId: SEED_CLINIC_A_ID,
      rosteredClinicId: SEED_CLINIC_A_ID,
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2028-06-01",
      shiftStartAt: new Date("2028-05-31T22:00:00.000Z"),
      shiftEndAt: new Date("2028-06-01T08:00:00.000Z"),
      attendanceStatus: "present",
      clockInAt: new Date("2028-05-31T22:00:00.000Z"),
      clockOutAt: new Date("2028-06-01T06:30:00.000Z"),
      breakDurationMinutes: 30,
      totalHoursWorked: 8,
      ordinaryHours: 8,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      commissionNote: null,
      generatedBy: "staff@clinic-a.au",
      clockInLocation: null,
      clockOutLocation: null,
    });
    const reviewed = await repository.update(original.id, {
      timesheetStatus: "rejected",
      approvedByUserId: SEED_USER_IDS.clinicAAdmin,
      approvedAt: new Date("2028-06-02T00:00:00.000Z"),
      approvalNotes: "Incorrect punch",
    });
    const caller = createServiceHarness("submitted").caller;

    await expect(
      service.correctTimesheet(caller, SEED_CLINIC_A_ID, original.id, {
        clockInAt: new Date(correctionBody.clockInAt),
        clockOutAt: new Date(correctionBody.clockOutAt),
        correctionReason: correctionBody.correctionReason,
      }),
    ).rejects.toThrow("injected audit failure");

    expect(await repository.findById(original.id)).toEqual(reviewed);
    expect(successfulEvents).toHaveLength(0);
  });
});
