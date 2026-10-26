import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const clinicBLeaveRoot = `/api/v1/clinics/${SEED_CLINIC_B_ID}/leave`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const data = (response: request.Response): unknown =>
  (response.body as { data: unknown }).data;

async function grantClinicBLeave(
  app: TestApp,
  ownerToken: string,
  userId: string = SEED_USER_IDS.clinicAManager,
): Promise<void> {
  await request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${userId}/permissions`)
    .set(auth(ownerToken))
    .send({ permission: "module:leave" })
    .expect(201);
}

async function setManagerClinicBAccess(
  app: TestApp,
  ownerToken: string,
  clinicB: { canRoster: boolean; canOperate: boolean } | null,
): Promise<void> {
  const assignments = [
    { clinicId: SEED_CLINIC_A_ID, canRoster: true, canOperate: true },
    ...(clinicB ? [{ clinicId: SEED_CLINIC_B_ID, ...clinicB }] : []),
  ];
  await request(app)
    .put(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/clinic-access`,
    )
    .set(auth(ownerToken))
    .send({ assignments })
    .expect(200);
}

async function createClinicBLeave(
  app: TestApp,
  clinicBOwnerToken: string,
  date: string,
): Promise<string> {
  const response = await request(app)
    .post(clinicBLeaveRoot)
    .set(auth(clinicBOwnerToken))
    .send({
      leaveType: "annual",
      startDate: date,
      endDate: date,
      reason: "Cross-clinic leave authorization regression",
    })
    .expect(201);
  return (data(response) as { id: string }).id;
}

describe("cross-clinic leave management", () => {
  it("requires can_operate in addition to the target-clinic leave grant and observes revocation immediately", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await grantClinicBLeave(app, owner);

    await request(app).get(clinicBLeaveRoot).set(auth(manager)).expect(403);

    await setManagerClinicBAccess(app, owner, {
      canRoster: true,
      canOperate: false,
    });
    await request(app).get(clinicBLeaveRoot).set(auth(manager)).expect(403);

    await setManagerClinicBAccess(app, owner, {
      canRoster: true,
      canOperate: true,
    });
    await request(app).get(clinicBLeaveRoot).set(auth(manager)).expect(200);
    await request(app)
      .get(`${clinicBLeaveRoot}/coverage-settings`)
      .set(auth(manager))
      .expect(200);
    await request(app)
      .get(`${clinicBLeaveRoot}/coverage-overlaps`)
      .query({ startDate: "2037-01-01", endDate: "2037-01-02" })
      .set(auth(manager))
      .expect(200);

    await setManagerClinicBAccess(app, owner, null);
    await request(app).get(clinicBLeaveRoot).set(auth(manager)).expect(403);
  });

  it("allows an operational GPM to review and cancel leave at the assigned clinic", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const clinicBOwner = await loginAndGetAccessToken(app, "admin@clinic-b.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await grantClinicBLeave(app, owner);
    await setManagerClinicBAccess(app, owner, {
      canRoster: true,
      canOperate: true,
    });

    const approvedId = await createClinicBLeave(app, clinicBOwner, "2037-01-10");
    await request(app)
      .post(`${clinicBLeaveRoot}/${approvedId}/approve`)
      .set(auth(manager))
      .send({ reviewNotes: "Approved across clinics" })
      .expect(200);
    await request(app)
      .post(`${clinicBLeaveRoot}/${approvedId}/cancel`)
      .set(auth(manager))
      .send({ cancellationReason: "Plans changed" })
      .expect(200);

    const rejectedId = await createClinicBLeave(app, clinicBOwner, "2037-01-11");
    await request(app)
      .post(`${clinicBLeaveRoot}/${rejectedId}/reject`)
      .set(auth(manager))
      .send({ reviewNotes: "Coverage unavailable" })
      .expect(200);

    const cancellationId = await createClinicBLeave(app, clinicBOwner, "2037-01-12");
    await request(app)
      .post(`${clinicBLeaveRoot}/${cancellationId}/approve`)
      .set(auth(manager))
      .send({})
      .expect(200);
    const cancellation = await request(app)
      .post(`${clinicBLeaveRoot}/${cancellationId}/cancellation-requests`)
      .set(auth(clinicBOwner))
      .send({ requestReason: "No longer needed" })
      .expect(201);
    await request(app)
      .get(`${clinicBLeaveRoot}/cancellation-requests`)
      .set(auth(manager))
      .expect(200);
    await request(app)
      .post(
        `${clinicBLeaveRoot}/${cancellationId}/cancellation-requests/${(data(cancellation) as { id: string }).id}/approve`,
      )
      .set(auth(manager))
      .send({ reviewNotes: "Cancellation reviewed across clinics" })
      .expect(200);
  });

  it("preserves independent review rules for a GPM's cross-clinic leave", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await grantClinicBLeave(app, owner);
    await setManagerClinicBAccess(app, owner, {
      canRoster: true,
      canOperate: true,
    });

    const approveAttempt = await request(app)
      .post(clinicBLeaveRoot)
      .set(auth(manager))
      .send({
        leaveType: "annual",
        startDate: "2037-01-20",
        endDate: "2037-01-20",
      })
      .expect(201);
    const selfApprove = await request(app)
      .post(`${clinicBLeaveRoot}/${(data(approveAttempt) as { id: string }).id}/approve`)
      .set(auth(manager))
      .send({})
      .expect(403);
    expect((selfApprove.body as { error: { code: string } }).error.code)
      .toBe("SELF_REVIEW_FORBIDDEN");

    const rejectAttempt = await request(app)
      .post(clinicBLeaveRoot)
      .set(auth(manager))
      .send({
        leaveType: "annual",
        startDate: "2037-01-21",
        endDate: "2037-01-21",
      })
      .expect(201);
    const selfReject = await request(app)
      .post(`${clinicBLeaveRoot}/${(data(rejectAttempt) as { id: string }).id}/reject`)
      .set(auth(manager))
      .send({ reviewNotes: "Self-review must remain forbidden" })
      .expect(403);
    expect((selfReject.body as { error: { code: string } }).error.code)
      .toBe("SELF_REVIEW_FORBIDDEN");
  });

  it("keeps clinical staff leave submission restricted to their home clinic", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    await grantClinicBLeave(app, owner, SEED_USER_IDS.clinicAStaff);

    await request(app)
      .post(clinicBLeaveRoot)
      .set(auth(staff))
      .send({
        leaveType: "annual",
        startDate: "2037-02-01",
        endDate: "2037-02-01",
        reason: "Must remain home scoped",
      })
      .expect(403);
  });
});
