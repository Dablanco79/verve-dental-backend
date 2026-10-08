import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const LEAVE_DATE = "2027-01-15";
const SHIFT_START = "2027-01-14T21:00:00.000Z"; // 08:00 Melbourne
const SHIFT_END = "2027-01-15T06:00:00.000Z";   // 17:00 Melbourne

type Tokens = { staff: string; manager: string; owner: string };
type LeaveData = {
  id: string;
  status: string;
  totalDays: number;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  cancelledByUserId?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
};
type ShiftData = { id: string; status: string };
type ApprovalData = {
  leave: LeaveData;
  conflicts: Array<{ rosterEntryId: string }>;
};

function data(response: request.Response): unknown {
  return (response.body as { data: unknown }).data;
}

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

async function tokens(app: Awaited<ReturnType<typeof createTestApp>>): Promise<Tokens> {
  return {
    staff: await loginAndGetAccessToken(app, "staff@clinic-a.au"),
    manager: await loginAndGetAccessToken(app, "manager@clinic-a.au"),
    owner: await loginAndGetAccessToken(app, "admin@clinic-a.au"),
  };
}

function createLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      leaveType: "annual",
      startDate: LEAVE_DATE,
      endDate: LEAVE_DATE,
      reason: "Pilot safety test",
      ...overrides,
    });
}

function createShift(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string = SEED_CLINIC_A_ID,
  start: string = SHIFT_START,
  end: string = SHIFT_END,
  staffUserId: string = SEED_USER_IDS.clinicAStaff,
) {
  return request(app)
    .post(`/api/v1/clinics/${clinicId}/roster`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      staffUserId,
      shiftStartAt: start,
      shiftEndAt: end,
      shiftType: "standard",
      notes: null,
    });
}

function approve(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  leaveId: string,
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/approve`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
}

function cancelApprovedLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  leaveId: string,
  cancellationReason: string = "Leave no longer required",
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancel`)
    .set("Authorization", `Bearer ${token}`)
    .send({ cancellationReason });
}

describe("Leave → roster pilot safety", () => {
  it("derives whole-day totalDays and rejects client-authored duration", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);

    const valid = await createLeave(app, auth.staff, {
      startDate: "2027-01-15",
      endDate: "2027-01-17",
    }).expect(201);
    expect((data(valid) as LeaveData).totalDays).toBe(3);

    const invalid = await createLeave(app, auth.staff, { totalDays: 0.5 }).expect(400);
    expect(errorCode(invalid)).toBe("VALIDATION_ERROR");
  });

  it("request before roster: approved person-wide leave rejects later shift creation", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    await approve(app, auth.manager, (data(leave) as LeaveData).id).expect(200);

    const result = await createShift(app, auth.owner).expect(409);
    expect(errorCode(result)).toBe("APPROVED_LEAVE_CONFLICT");
  });

  it("request after roster: approval reports conflict and never modifies the shift", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const shift = await createShift(app, auth.owner).expect(201);
    await createShift(
      app,
      auth.owner,
      SEED_CLINIC_A_ID,
      SHIFT_START,
      SHIFT_END,
      SEED_USER_IDS.clinicAManager,
    ).expect(201);
    const leave = await createLeave(app, auth.staff).expect(201);

    const approval = await approve(app, auth.manager, (data(leave) as LeaveData).id).expect(200);
    expect((data(approval) as ApprovalData).leave.status).toBe("approved");
    expect((data(approval) as ApprovalData).conflicts).toHaveLength(1);
    expect((data(approval) as ApprovalData).conflicts[0]?.rosterEntryId)
      .toBe((data(shift) as ShiftData).id);

    const persisted = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${(data(shift) as ShiftData).id}`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .expect(200);
    expect((data(persisted) as ShiftData).status).toBe("scheduled");

    const discoverable = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${(data(leave) as LeaveData).id}/conflicts`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .expect(200);
    expect(data(discoverable) as unknown[]).toHaveLength(1);
  });

  it("rejects editing an existing shift into approved leave", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const shift = await createShift(
      app,
      auth.owner,
      SEED_CLINIC_A_ID,
      "2027-01-15T21:00:00.000Z",
      "2027-01-16T06:00:00.000Z",
    ).expect(201);
    const leave = await createLeave(app, auth.staff).expect(201);
    await approve(app, auth.manager, (data(leave) as LeaveData).id).expect(200);

    const result = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${(data(shift) as ShiftData).id}`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({ shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END })
      .expect(409);
    expect(errorCode(result)).toBe("APPROVED_LEAVE_CONFLICT");
  });

  it("enforces approved leave at another clinic for the same person", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    await approve(app, auth.manager, (data(leave) as LeaveData).id).expect(200);

    const result = await createShift(
      app,
      auth.owner,
      SEED_CLINIC_B_ID,
    ).expect(409);
    expect(errorCode(result)).toBe("APPROVED_LEAVE_CONFLICT");
  });

  it("rejected and withdrawn leave do not block roster creation", async () => {
    const rejectedApp = await createTestApp();
    const rejectedAuth = await tokens(rejectedApp);
    const rejectedLeave = await createLeave(rejectedApp, rejectedAuth.staff).expect(201);
    await request(rejectedApp)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${(data(rejectedLeave) as LeaveData).id}/reject`)
      .set("Authorization", `Bearer ${rejectedAuth.manager}`)
      .send({ reviewNotes: "Coverage unavailable" })
      .expect(200);
    await createShift(rejectedApp, rejectedAuth.owner).expect(201);

    const withdrawnApp = await createTestApp();
    const withdrawnAuth = await tokens(withdrawnApp);
    const withdrawnLeave = await createLeave(withdrawnApp, withdrawnAuth.staff).expect(201);
    await request(withdrawnApp)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${(data(withdrawnLeave) as LeaveData).id}/withdraw`)
      .set("Authorization", `Bearer ${withdrawnAuth.staff}`)
      .expect(200);
    await createShift(withdrawnApp, withdrawnAuth.owner).expect(201);
  });

  it("cancels approved leave, preserves approval history and removes roster blocking", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const shift = await createShift(app, auth.owner).expect(201);
    const leaveResponse = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leaveResponse) as LeaveData).id;
    const approval = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Original approval note" })
      .expect(200);
    const approved = (data(approval) as ApprovalData).leave;

    const cancellation = await cancelApprovedLeave(
      app,
      auth.manager,
      leaveId,
      "Employee changed plans",
    ).expect(200);
    const cancelled = data(cancellation) as LeaveData;
    expect(cancelled).toMatchObject({
      status: "cancelled",
      reviewedByUserId: approved.reviewedByUserId,
      reviewedAt: approved.reviewedAt,
      reviewNotes: "Original approval note",
      cancelledByUserId: SEED_USER_IDS.clinicAManager,
      cancellationReason: "Employee changed plans",
    });
    expect(cancelled.cancelledAt).toEqual(expect.any(String));

    const persistedShift = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${(data(shift) as ShiftData).id}`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .expect(200);
    expect(data(persistedShift)).toMatchObject({
      id: (data(shift) as ShiftData).id,
      status: "scheduled",
    });

    const leaveBlocks = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/leave-blocks`)
      .query({ from: SHIFT_START, to: SHIFT_END })
      .set("Authorization", `Bearer ${auth.owner}`)
      .expect(200);
    expect(data(leaveBlocks)).toEqual([]);

    await createShift(
      app,
      auth.owner,
      SEED_CLINIC_B_ID,
      "2027-01-15T07:00:00.000Z",
      "2027-01-15T08:00:00.000Z",
    ).expect(201);

    const staffHistory = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/me`)
      .set("Authorization", `Bearer ${auth.staff}`)
      .expect(200);
    expect(data(staffHistory)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: leaveId,
        status: "cancelled",
        cancellationReason: "Employee changed plans",
      }),
    ]));
  });

  it("requires a cancellation reason and rejects invalid or duplicate transitions", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const pending = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(pending) as LeaveData).id;

    const pendingCancel = await cancelApprovedLeave(app, auth.manager, leaveId).expect(409);
    expect(errorCode(pendingCancel)).toBe("INVALID_STATUS_TRANSITION");

    await approve(app, auth.manager, leaveId).expect(200);
    const blankReason = await cancelApprovedLeave(app, auth.manager, leaveId, "   ").expect(400);
    expect(errorCode(blankReason)).toBe("VALIDATION_ERROR");

    await cancelApprovedLeave(app, auth.manager, leaveId).expect(200);
    const duplicate = await cancelApprovedLeave(app, auth.manager, leaveId).expect(409);
    expect(errorCode(duplicate)).toBe("INVALID_STATUS_TRANSITION");

    const rejectedResponse = await createLeave(app, auth.staff, {
      startDate: "2027-01-20",
      endDate: "2027-01-20",
    }).expect(201);
    const rejectedId = (data(rejectedResponse) as LeaveData).id;
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${rejectedId}/reject`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Not approved" })
      .expect(200);
    await cancelApprovedLeave(app, auth.manager, rejectedId).expect(409);
  });

  it("enforces manager role and home-clinic scope for cancellation", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const pending = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(pending) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);

    await cancelApprovedLeave(app, auth.staff, leaveId).expect(403);

    const wrongClinic = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/leave/${leaveId}/cancel`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ cancellationReason: "Out of scope" })
      .expect(403);
    expect(errorCode(wrongClinic)).toBe("TENANT_ACCESS_DENIED");
  });

  it("uses Melbourne calendar dates at DST boundaries and respects midnight-exclusive ends", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff, {
      startDate: "2026-10-04",
      endDate: "2026-10-04",
    }).expect(201);
    await approve(app, auth.manager, (data(leave) as LeaveData).id).expect(200);

    // Ends exactly at Melbourne midnight starting the leave date: allowed.
    await createShift(
      app,
      auth.owner,
      SEED_CLINIC_A_ID,
      "2026-10-03T12:00:00.000Z",
      "2026-10-03T14:00:00.000Z",
    ).expect(201);

    // Crosses into 4 October in Melbourne during the DST transition: blocked.
    const blocked = await createShift(
      app,
      auth.owner,
      SEED_CLINIC_A_ID,
      "2026-10-03T14:30:00.000Z",
      "2026-10-03T15:30:00.000Z",
    ).expect(409);
    expect(errorCode(blocked)).toBe("APPROVED_LEAVE_CONFLICT");
  });
});
