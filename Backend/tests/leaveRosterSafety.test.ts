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
  cancellationSelfReviewExceptionUsed?: boolean;
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

function requestCancellation(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  leaveId: string,
  requestReason = "Plans changed",
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests`)
    .set("Authorization", `Bearer ${token}`)
    .send({ requestReason });
}

describe("Leave → roster pilot safety", () => {
  it("lets an employee request cancellation and a manager approve it atomically", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const shift = await createShift(app, auth.owner).expect(201);
    const leave = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);
    const created = await requestCancellation(app, auth.staff, leaveId, "Family plans changed").expect(201);
    const cancellation = data(created) as { id: string; status: string };
    expect(cancellation.status).toBe("pending");

    const approved = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${cancellation.id}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Confirmed with employee" })
      .expect(200);
    expect(data(approved)).toMatchObject({
      request: { status: "approved", reviewNotes: "Confirmed with employee" },
      leave: { status: "cancelled", cancellationReason: "Family plans changed" },
    });

    const persistedShift = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${(data(shift) as ShiftData).id}`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .expect(200);
    expect(data(persistedShift)).toMatchObject({
      id: (data(shift) as ShiftData).id,
      status: "scheduled",
    });
  });

  it("derives cancellation ownership from the caller and rejects client-authored identity", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);

    await requestCancellation(app, auth.staff, leaveId, "   ").expect(400);
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests`)
      .set("Authorization", `Bearer ${auth.staff}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAManager,
        requestReason: "Attempted identity override",
      })
      .expect(400);

    const notOwner = await requestCancellation(app, auth.manager, leaveId).expect(403);
    expect(errorCode(notOwner)).toBe("FORBIDDEN");
    const created = await requestCancellation(app, auth.staff, leaveId).expect(201);
    expect(data(created)).toMatchObject({
      staffUserId: SEED_USER_IDS.clinicAStaff,
      requestedByUserId: SEED_USER_IDS.clinicAStaff,
    });
  });

  it("enforces manager review, clinic scope, and self-review prohibition", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);
    const created = await requestCancellation(app, auth.staff, leaveId).expect(201);
    const cancellationId = (data(created) as { id: string }).id;

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${cancellationId}/approve`)
      .set("Authorization", `Bearer ${auth.staff}`)
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/leave/${leaveId}/cancellation-requests/${cancellationId}/approve`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({})
      .expect(404);

    const ownerLeave = await createLeave(app, auth.owner, {
      startDate: "2027-02-01",
      endDate: "2027-02-01",
    }).expect(201);
    const ownerLeaveId = (data(ownerLeave) as LeaveData).id;
    await approve(app, auth.manager, ownerLeaveId).expect(200);
    const ownerCancellation = await requestCancellation(
      app,
      auth.owner,
      ownerLeaveId,
      "Owner plans changed",
    ).expect(201);
    const selfReview = await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${ownerLeaveId}/cancellation-requests/${(data(ownerCancellation) as { id: string }).id}/approve`,
      )
      .set("Authorization", `Bearer ${auth.owner}`)
      .send({})
      .expect(403);
    expect(errorCode(selfReview)).toBe("SELF_REVIEW_FORBIDDEN");
  });

  it("keeps a GPM-owned cancellation pending after both self-review attempts", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const shift = await createShift(
      app,
      auth.owner,
      SEED_CLINIC_A_ID,
      "2027-03-09T21:00:00.000Z",
      "2027-03-10T06:00:00.000Z",
      SEED_USER_IDS.clinicAManager,
    ).expect(201);
    const shiftId = (data(shift) as ShiftData).id;
    const clockIn = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({
        rosterEntryId: shiftId,
        shiftStartAt: "2027-03-09T21:00:00.000Z",
        shiftEndAt: "2027-03-10T06:00:00.000Z",
      })
      .expect(201);
    const timesheetBefore = data(clockIn);

    const leave = await createLeave(app, auth.manager, {
      startDate: "2027-03-10",
      endDate: "2027-03-10",
      reason: "Manager leave",
    }).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.owner, leaveId).expect(200);
    const cancellation = await requestCancellation(
      app,
      auth.manager,
      leaveId,
      "Manager plans changed",
    ).expect(201);
    const cancellationId = (data(cancellation) as { id: string }).id;

    const selfApprove = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${cancellationId}/approve`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({})
      .expect(403);
    expect(errorCode(selfApprove)).toBe("SELF_REVIEW_FORBIDDEN");

    const selfDecline = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${cancellationId}/decline`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Self decline attempt" })
      .expect(403);
    expect(errorCode(selfDecline)).toBe("SELF_REVIEW_FORBIDDEN");

    const leaveAfter = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/me`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .expect(200);
    expect((data(leaveAfter) as LeaveData[]).find((item) => item.id === leaveId)).toMatchObject({
      status: "approved",
      cancelledByUserId: null,
      cancelledAt: null,
      cancellationReason: null,
      cancellationSelfReviewExceptionUsed: false,
    });

    const cancellationsAfter = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/cancellation-requests`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .expect(200);
    expect(
      (data(cancellationsAfter) as Array<{
        id: string;
        status: string;
        reviewedByUserId: string | null;
        reviewedAt: string | null;
        reviewNotes: string | null;
        selfReviewExceptionUsed: boolean;
      }>).find((item) => item.id === cancellationId),
    ).toMatchObject({
      status: "pending",
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNotes: null,
      selfReviewExceptionUsed: false,
    });

    const shiftAfter = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${shiftId}`)
      .set("Authorization", `Bearer ${auth.owner}`)
      .expect(200);
    expect(data(shiftAfter)).toMatchObject({ id: shiftId, status: "scheduled" });
    const timesheetsAfter = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/me`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .expect(200);
    expect(
      (data(timesheetsAfter) as Array<{ id: string }>).find(
        (item) => item.id === (timesheetBefore as { id: string }).id,
      ),
    ).toEqual(timesheetBefore);
  });

  it("rejects duplicate requests and direct cancellation while one is pending", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);
    await requestCancellation(app, auth.staff, leaveId).expect(201);
    const duplicate = await requestCancellation(app, auth.staff, leaveId).expect(409);
    expect(errorCode(duplicate)).toBe("DUPLICATE_PENDING_CANCELLATION");
    const direct = await cancelApprovedLeave(app, auth.manager, leaveId).expect(409);
    expect(errorCode(direct)).toBe("PENDING_CANCELLATION_REQUEST");
  });

  it("keeps roster blocking after decline and removes it only after approval", async () => {
    const app = await createTestApp();
    const auth = await tokens(app);
    const leave = await createLeave(app, auth.staff).expect(201);
    const leaveId = (data(leave) as LeaveData).id;
    await approve(app, auth.manager, leaveId).expect(200);
    const pending = await requestCancellation(app, auth.staff, leaveId).expect(201);
    const pendingId = (data(pending) as { id: string }).id;

    await createShift(app, auth.owner).expect(409);
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${pendingId}/decline`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "   " })
      .expect(400);
    const declined = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${pendingId}/decline`)
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({ reviewNotes: "Coverage still required" })
      .expect(200);
    expect(data(declined)).toMatchObject({
      status: "declined",
      reviewNotes: "Coverage still required",
    });
    await createShift(app, auth.owner).expect(409);

    const replacement = await requestCancellation(app, auth.staff, leaveId).expect(201);
    await request(app)
      .post(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${leaveId}/cancellation-requests/${(data(replacement) as { id: string }).id}/approve`,
      )
      .set("Authorization", `Bearer ${auth.manager}`)
      .send({})
      .expect(200);
    await createShift(app, auth.owner).expect(201);
  });

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
