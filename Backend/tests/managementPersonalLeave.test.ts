import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const root = `/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`;
const clinicBRoot = `/api/v1/clinics/${SEED_CLINIC_B_ID}/leave`;
const MISSING_CLINIC_ID = "99999999-9999-4999-8999-999999999999";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const data = <T>(response: request.Response & { body: { data: T } }): T =>
  (response.body as { data: T }).data;
const errorCode = (response: request.Response): string =>
  (response.body as { error: { code: string } }).error.code;

function createPersonalLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  date: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post(root)
    .set(auth(token))
    .send({
      leaveType: "annual",
      startDate: date,
      endDate: date,
      reason: "WF08 personal leave",
      ...overrides,
    });
}

describe("WF08 management personal leave", () => {
  it("binds GPM and Owner/Admin submissions and history to authenticated identity", async () => {
    const app = await createTestApp();
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const managerCreated = await createPersonalLeave(app, manager, "2038-01-10").expect(201);
    expect(data<{ staffUserId: string; clinicId: string }>(managerCreated)).toMatchObject({
      staffUserId: SEED_USER_IDS.clinicAManager,
      clinicId: SEED_CLINIC_A_ID,
    });

    const ownerCreated = await createPersonalLeave(app, owner, "2038-01-11").expect(201);
    expect(data<{ staffUserId: string; clinicId: string }>(ownerCreated)).toMatchObject({
      staffUserId: SEED_USER_IDS.clinicAAdmin,
      clinicId: SEED_CLINIC_A_ID,
    });

    const managerMine = await request(app).get(`${root}/me`).set(auth(manager)).expect(200);
    expect(data<Array<{ staffUserId: string }>>(managerMine)).toEqual([
      expect.objectContaining({ staffUserId: SEED_USER_IDS.clinicAManager }),
    ]);

    const ownerMine = await request(app).get(`${root}/me`).set(auth(owner)).expect(200);
    expect(data<Array<{ staffUserId: string }>>(ownerMine)).toEqual([
      expect.objectContaining({ staffUserId: SEED_USER_IDS.clinicAAdmin }),
    ]);
  }, 30_000);

  it("rejects identity overrides and non-home personal clinic scopes", async () => {
    const app = await createTestApp();
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await createPersonalLeave(app, manager, "2038-02-10", {
      staffUserId: SEED_USER_IDS.clinicAStaff,
    }).expect(400);
    await createPersonalLeave(app, owner, "2038-02-11", {
      staffEmail: "staff@clinic-a.au",
    }).expect(400);

    const ownerCrossClinicCreate = await request(app)
      .post(clinicBRoot)
      .set(auth(owner))
      .send({
        leaveType: "annual",
        startDate: "2038-02-12",
        endDate: "2038-02-12",
      })
      .expect(403);
    expect(errorCode(ownerCrossClinicCreate)).toBe("TENANT_ACCESS_DENIED");

    const ownerCrossClinicMine = await request(app)
      .get(`${clinicBRoot}/me`)
      .set(auth(owner))
      .expect(403);
    expect(errorCode(ownerCrossClinicMine)).toBe("TENANT_ACCESS_DENIED");

    const ownerCrossClinicCancellations = await request(app)
      .get(`${clinicBRoot}/cancellation-requests/me`)
      .set(auth(owner))
      .expect(403);
    expect(errorCode(ownerCrossClinicCancellations)).toBe("TENANT_ACCESS_DENIED");

    await createPersonalLeave(app, manager, "2038-02-13").expect(201);
    const spoofedMine = await request(app)
      .get(`${root}/me`)
      .query({ staffUserId: SEED_USER_IDS.clinicAStaff })
      .set(auth(manager))
      .expect(200);
    expect(data<Array<{ staffUserId: string }>>(spoofedMine)).toEqual([
      expect.objectContaining({ staffUserId: SEED_USER_IDS.clinicAManager }),
    ]);
  }, 30_000);

  it("keeps personal cancellation history self-scoped for managers", async () => {
    const app = await createTestApp();
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const managerLeave = data<{ id: string }>(
      await createPersonalLeave(app, manager, "2038-03-10").expect(201),
    );
    await request(app)
      .post(`${root}/${managerLeave.id}/approve`)
      .set(auth(owner))
      .send({})
      .expect(200);
    const managerCancellation = data<{ id: string }>(
      await request(app)
        .post(`${root}/${managerLeave.id}/cancellation-requests`)
        .set(auth(manager))
        .send({ requestReason: "Manager plans changed" })
        .expect(201),
    );

    const selfApproveCancellation = await request(app)
      .post(
        `${root}/${managerLeave.id}/cancellation-requests/${managerCancellation.id}/approve`,
      )
      .set(auth(manager))
      .send({})
      .expect(403);
    expect(errorCode(selfApproveCancellation)).toBe("SELF_REVIEW_FORBIDDEN");

    const staffLeave = data<{ id: string }>(
      await request(app)
        .post(root)
        .set(auth(staff))
        .send({
          leaveType: "annual",
          startDate: "2038-03-11",
          endDate: "2038-03-11",
        })
        .expect(201),
    );
    await request(app)
      .post(`${root}/${staffLeave.id}/approve`)
      .set(auth(manager))
      .send({})
      .expect(200);
    await request(app)
      .post(`${root}/${staffLeave.id}/cancellation-requests`)
      .set(auth(staff))
      .send({ requestReason: "Staff plans changed" })
      .expect(201);

    const mine = await request(app)
      .get(`${root}/cancellation-requests/me`)
      .set(auth(manager))
      .expect(200);
    expect(data<Array<{ id: string; staffUserId: string }>>(mine)).toEqual([
      expect.objectContaining({
        id: managerCancellation.id,
        staffUserId: SEED_USER_IDS.clinicAManager,
      }),
    ]);

    const managed = await request(app)
      .get(`${root}/cancellation-requests`)
      .set(auth(manager))
      .expect(200);
    expect(data<unknown[]>(managed)).toHaveLength(2);
  }, 30_000);

  it("blocks personal cancellation history after module:leave is revoked", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .delete(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}` +
          "/permissions/module%3Aleave",
      )
      .set(auth(owner))
      .expect(204);

    const denied = await request(app)
      .get(`${root}/cancellation-requests/me`)
      .set(auth(manager))
      .expect(403);
    expect(errorCode(denied)).toBe("FORBIDDEN");
  }, 30_000);

  it("fails through HTTP middleware when the authoritative home clinic no longer exists", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}`,
      )
      .set(auth(owner))
      .send({
        homeClinicId: MISSING_CLINIC_ID,
        homeClinicName: "Deleted clinic",
      })
      .expect(200);

    const denied = await request(app)
      .get(`${root}/me`)
      .set(auth(manager))
      .expect(403);
    expect(errorCode(denied)).toBe("TENANT_ACCESS_DENIED");
  }, 30_000);

  it("preserves backend self-approval and self-rejection prohibitions for Owner/Admin", async () => {
    const app = await createTestApp();
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const leave = data<{ id: string }>(
      await createPersonalLeave(app, owner, "2038-04-10").expect(201),
    );

    const selfApprove = await request(app)
      .post(`${root}/${leave.id}/approve`)
      .set(auth(owner))
      .send({})
      .expect(403);
    expect(errorCode(selfApprove)).toBe("SELF_REVIEW_FORBIDDEN");

    const selfReject = await request(app)
      .post(`${root}/${leave.id}/reject`)
      .set(auth(owner))
      .send({ reviewNotes: "Must remain independently reviewed" })
      .expect(403);
    expect(errorCode(selfReject)).toBe("SELF_REVIEW_FORBIDDEN");
  }, 30_000);
});
