import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string } };

type LeaveRecord = {
  id: string;
  status: string;
  staffUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
};

type TimesheetRecord = {
  id: string;
  rosterEntryId: string | null;
  staffUserId: string;
  payrollType: string;
  timesheetStatus: string | null;
  attendanceStatus: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  commissionNote: string | null;
};

function data(response: request.Response): unknown {
  return (response.body as ApiData<unknown>).data;
}

function errorCode(response: request.Response): string {
  return (response.body as ApiError).error.code;
}

async function tokens(app: Awaited<ReturnType<typeof createTestApp>>) {
  const [owner, manager, staff, otherClinicOwner] = await Promise.all([
    loginAndGetAccessToken(app, "admin@clinic-a.au"),
    loginAndGetAccessToken(app, "manager@clinic-a.au"),
    loginAndGetAccessToken(app, "staff@clinic-a.au"),
    loginAndGetAccessToken(app, "admin@clinic-b.au"),
  ]);
  return { owner, manager, staff, otherClinicOwner };
}

function createManagerLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  managerToken: string,
  startDate: string,
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({
      leaveType: "annual",
      startDate,
      endDate: startDate,
      reason: "Manager personal leave",
    });
}

function createManualTimesheet(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  staffUserId: string,
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      staffUserId,
      rosterEntryId: null,
      shiftDate: "2028-02-01",
      shiftStartAt: "2028-01-31T21:00:00.000Z",
      shiftEndAt: "2028-02-01T05:00:00.000Z",
      clockInAt: "2028-01-31T21:02:00.000Z",
      clockOutAt: "2028-02-01T05:01:00.000Z",
      breakDurationMinutes: 30,
    });
}

async function findOwnTimesheet(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  id: string,
): Promise<TimesheetRecord> {
  const response = await request(app)
    .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/me`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  const record = (data(response) as TimesheetRecord[]).find((entry) => entry.id === id);
  if (!record) throw new Error(`Timesheet ${id} not found`);
  return record;
}

async function createCommissionEntryForOwner(
  app: Awaited<ReturnType<typeof createTestApp>>,
  managerToken: string,
): Promise<TimesheetRecord> {
  const roster = await request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({
      staffUserId: SEED_USER_IDS.clinicAAdmin,
      shiftStartAt: "2028-03-01T21:00:00.000Z",
      shiftEndAt: "2028-03-02T05:00:00.000Z",
      shiftType: "standard",
    })
    .expect(201);
  const rosterId = (data(roster) as { id: string }).id;

  await request(app)
    .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${rosterId}`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({ status: "completed" })
    .expect(200);

  const list = await request(app)
    .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
    .set("Authorization", `Bearer ${managerToken}`)
    .query({ payrollType: "commission_log" })
    .expect(200);
  const entry = (data(list) as TimesheetRecord[]).find(
    (candidate) => candidate.rosterEntryId === rosterId,
  );
  if (!entry) throw new Error("Generated commission entry not found");
  return entry;
}

describe("WF-01 workforce self-review controls", () => {
  it("forbids a manager from approving their own leave and preserves the pending record", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const created = await createManagerLeave(app, auth.manager, "2028-01-10").expect(201);
    const leave = data(created) as LeaveRecord;

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leave.id}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Self approval attempt" })
      .expect(403);
    expect(errorCode(response)).toBe("SELF_REVIEW_FORBIDDEN");

    const mine = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/me`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .expect(200);
    expect(data(mine) as LeaveRecord[]).toContainEqual(
      expect.objectContaining({
        id: leave.id,
        status: "pending",
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNotes: null,
      }),
    );
  });

  it("forbids a manager from rejecting their own leave while an authorised reviewer can approve it", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const created = await createManagerLeave(app, auth.manager, "2028-01-11").expect(201);
    const leave = data(created) as LeaveRecord;

    const selfReject = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leave.id}/reject`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Self rejection attempt" })
      .expect(403);
    expect(errorCode(selfReject)).toBe("SELF_REVIEW_FORBIDDEN");

    const approved = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leave.id}/approve`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ reviewNotes: "Independently reviewed" })
      .expect(200);
    expect((data(approved) as { leave: LeaveRecord }).leave).toMatchObject({
      id: leave.id,
      status: "approved",
      staffUserId: SEED_USER_IDS.clinicAManager,
      reviewedByUserId: SEED_USER_IDS.clinicAAdmin,
      reviewNotes: "Independently reviewed",
    });
  });

  it("forbids a manager from approving or rejecting their own timesheet without mutating it", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const created = await createManualTimesheet(
      app,
      auth.manager,
      SEED_USER_IDS.clinicAManager,
    ).expect(201);
    const entry = data(created) as TimesheetRecord;

    const selfApprove = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ approvalNotes: "Self approval attempt" })
      .expect(403);
    expect(errorCode(selfApprove)).toBe("SELF_REVIEW_FORBIDDEN");

    const selfReject = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/reject`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ approvalNotes: "Self rejection attempt" })
      .expect(403);
    expect(errorCode(selfReject)).toBe("SELF_REVIEW_FORBIDDEN");

    expect(await findOwnTimesheet(app, auth.manager, entry.id)).toMatchObject({
      timesheetStatus: "submitted",
      approvedByUserId: null,
      approvedAt: null,
      approvalNotes: null,
    });
  });

  it("allows an authorised separate reviewer to approve another employee's timesheet", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const created = await createManualTimesheet(
      app,
      auth.manager,
      SEED_USER_IDS.clinicAManager,
    ).expect(201);
    const entry = data(created) as TimesheetRecord;

    const approved = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/approve`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ approvalNotes: "Independent payroll review" })
      .expect(200);
    expect(data(approved) as TimesheetRecord).toMatchObject({
      id: entry.id,
      timesheetStatus: "approved",
      approvedByUserId: SEED_USER_IDS.clinicAAdmin,
      approvalNotes: "Independent payroll review",
    });
  });

  it("forbids commission self-verification and allows a separate authorised reviewer", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const entry = await createCommissionEntryForOwner(app, auth.manager);

    const selfVerify = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/verify-attendance`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ attendanceStatus: "present", commissionNote: "Self verification attempt" })
      .expect(403);
    expect(errorCode(selfVerify)).toBe("SELF_REVIEW_FORBIDDEN");

    expect(await findOwnTimesheet(app, auth.owner, entry.id)).toMatchObject({
      attendanceStatus: "pending_verification",
      approvedByUserId: null,
      approvedAt: null,
      commissionNote: null,
    });

    const verified = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/verify-attendance`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ attendanceStatus: "present", commissionNote: "Attendance confirmed" })
      .expect(200);
    expect(data(verified) as TimesheetRecord).toMatchObject({
      attendanceStatus: "present",
      approvedByUserId: SEED_USER_IDS.clinicAManager,
      commissionNote: "Attendance confirmed",
    });
  });

  it("keeps cross-clinic review blocked and exposes no bulk-review bypass", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const unknownId = "99999999-9999-4999-8999-999999999999";

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/${unknownId}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({})
      .expect(403);

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/leave/${unknownId}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({})
      .expect(403);

    const bulkTimesheets = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/bulk-approve`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ ids: [unknownId] });
    expect(bulkTimesheets.status).toBeGreaterThanOrEqual(400);

    const bulkLeave = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/bulk-approve`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ ids: [unknownId] });
    expect(bulkLeave.status).toBeGreaterThanOrEqual(400);
  });
});
