import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const root = `/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`;

type DataResponse<T> = { data: T };
type Group = {
  id: string;
  clinicId: string;
  name: string;
  memberUserIds: string[];
};
type Warning = {
  enabled: boolean;
  status: string;
  overlappingColleagueCount: number;
  affectedGroups: Array<{ clinicId: string; groupId: string; groupName: string }>;
};

function bodyData<T>(response: request.Response, _typeHint?: T): T {
  void _typeHint;
  return (response.body as DataResponse<T>).data;
}

async function createGroup(
  app: Awaited<ReturnType<typeof createTestApp>>,
  managerToken: string,
  name: string,
  memberUserIds: string[],
): Promise<Group> {
  const created = await request(app)
    .post(`${root}/coverage-groups`)
    .set(auth(managerToken))
    .send({ name })
    .expect(201);
  const group = bodyData<Group>(created);
  const members = await request(app)
    .put(`${root}/coverage-groups/${group.id}/members`)
    .set(auth(managerToken))
    .send({ memberUserIds })
    .expect(200);
  return bodyData<Group>(members);
}

async function createLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  const response = await request(app)
    .post(root)
    .set(auth(token))
    .send({ leaveType: "annual", startDate, endDate, reason: "must stay private" })
    .expect(201);
  return bodyData<{ id: string }>(response).id;
}

async function approveLeave(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  leaveId: string,
): Promise<void> {
  await request(app)
    .post(`${root}/${leaveId}/approve`)
    .set(auth(token))
    .send({})
    .expect(200);
}

describe("WF-02 leave coverage API", () => {
  it("enforces manager permissions and cross-clinic isolation", async () => {
    const app = await createTestApp();
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app).get(`${root}/coverage-settings`).set(auth(staff)).expect(403);
    await request(app)
      .post(`${root}/coverage-groups`)
      .set(auth(staff))
      .send({ name: "No access" })
      .expect(403);
    await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/leave/coverage-settings`)
      .set(auth(manager))
      .expect(403);
    await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/leave/coverage-overlaps`)
      .query({ startDate: "2036-01-01", endDate: "2036-01-01" })
      .set(auth(staff))
      .expect(403);
  });

  it("supports settings and group/member configuration with state transitions", async () => {
    const app = await createTestApp();
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const disabled = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-02-01", endDate: "2036-02-01" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(disabled)).toMatchObject({ enabled: false, status: "disabled" });

    await request(app)
      .patch(`${root}/coverage-settings`)
      .set(auth(manager))
      .send({ enabled: true })
      .expect(200);
    const unconfigured = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-02-01", endDate: "2036-02-01" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(unconfigured).status).toBe("unconfigured");

    const created = await request(app)
      .post(`${root}/coverage-groups`)
      .set(auth(manager))
      .send({ name: "  Clinical team  " })
      .expect(201);
    const group = bodyData<Group>(created);
    expect(group.name).toBe("Clinical team");

    const unassigned = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-02-01", endDate: "2036-02-01" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(unassigned).status).toBe("staff_unassigned");

    await request(app)
      .patch(`${root}/coverage-groups/${group.id}`)
      .set(auth(manager))
      .send({ name: "Nursing team" })
      .expect(200);
    const members = await request(app)
      .put(`${root}/coverage-groups/${group.id}/members`)
      .set(auth(manager))
      .send({ memberUserIds: [SEED_USER_IDS.clinicAStaff, SEED_USER_IDS.clinicAManager] })
      .expect(200);
    expect(bodyData<Group>(members)).toMatchObject({
      name: "Nursing team",
      memberUserIds: expect.arrayContaining([
        SEED_USER_IDS.clinicAStaff,
        SEED_USER_IDS.clinicAManager,
      ]) as unknown,
    });
    const listed = await request(app)
      .get(`${root}/coverage-groups`)
      .set(auth(manager))
      .expect(200);
    expect(bodyData<Group[]>(listed)).toHaveLength(1);

    await request(app)
      .put(`${root}/coverage-groups/${group.id}/members`)
      .set(auth(manager))
      .send({ memberUserIds: ["99999999-9999-4999-8999-999999999999"] })
      .expect(400);
  });

  it("deduplicates an approved peer across groups, includes date boundaries, and exposes no leave details", async () => {
    const app = await createTestApp();
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app).patch(`${root}/coverage-settings`).set(auth(manager)).send({ enabled: true }).expect(200);
    const members = [SEED_USER_IDS.clinicAStaff, SEED_USER_IDS.clinicAManager];
    const first = await createGroup(app, manager, "Group one", members);
    const second = await createGroup(app, manager, "Group two", members);
    const leaveId = await createLeave(app, manager, "2036-03-02", "2036-03-04");

    const pendingExcluded = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-03-01", endDate: "2036-03-02" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(pendingExcluded).overlappingColleagueCount).toBe(0);

    await approveLeave(app, owner, leaveId);
    const boundary = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-03-01", endDate: "2036-03-02" })
      .set(auth(staff))
      .expect(200);
    const warning = bodyData<Warning>(boundary);
    expect(warning).toMatchObject({
      enabled: true,
      status: "ready",
      overlappingColleagueCount: 1,
    });
    expect(warning.affectedGroups).toHaveLength(2);
    expect(warning.affectedGroups.map((group) => group.groupId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(JSON.stringify(boundary.body)).not.toMatch(
      /manager@clinic-a|must stay private|annual|leaveId|startDate|endDate|2036-03/,
    );

    await request(app)
      .post(`${root}/${leaveId}/cancellation-requests`)
      .set(auth(manager))
      .send({ requestReason: "Pending cancellation" })
      .expect(201);
    const stillIncluded = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-03-04", endDate: "2036-03-04" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(stillIncluded).overlappingColleagueCount).toBe(1);
  });

  it("separates groups, excludes cancelled leave, and uses persisted pending leave dates for managers", async () => {
    const app = await createTestApp();
    const staff = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const manager = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const owner = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app).patch(`${root}/coverage-settings`).set(auth(manager)).send({ enabled: true }).expect(200);
    await createGroup(app, manager, "Staff only", [SEED_USER_IDS.clinicAStaff]);
    await createGroup(app, manager, "Manager only", [SEED_USER_IDS.clinicAManager]);
    const peerLeave = await createLeave(app, manager, "2036-04-10", "2036-04-10");
    await approveLeave(app, owner, peerLeave);

    const differentGroup = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-04-10", endDate: "2036-04-10" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(differentGroup).overlappingColleagueCount).toBe(0);

    const shared = await createGroup(app, manager, "Shared", [
      SEED_USER_IDS.clinicAStaff,
      SEED_USER_IDS.clinicAManager,
    ]);
    const staffLeave = await createLeave(app, staff, "2036-04-10", "2036-04-10");
    const persisted = await request(app)
      .get(`${root}/${staffLeave}/coverage-overlaps`)
      .set(auth(manager))
      .expect(200);
    expect(bodyData<Warning>(persisted)).toMatchObject({
      overlappingColleagueCount: 1,
      affectedGroups: [{ clinicId: SEED_CLINIC_A_ID, groupId: shared.id, groupName: "Shared" }],
    });

    await approveLeave(app, manager, staffLeave);
    const wrongState = await request(app)
      .get(`${root}/${staffLeave}/coverage-overlaps`)
      .set(auth(manager))
      .expect(409);
    expect((wrongState.body as { error: { code: string } }).error.code)
      .toBe("INVALID_STATUS_TRANSITION");

    await request(app)
      .post(`${root}/${peerLeave}/cancel`)
      .set(auth(owner))
      .send({ cancellationReason: "No longer away" })
      .expect(200);
    const cancelledExcluded = await request(app)
      .get(`${root}/coverage-overlaps`)
      .query({ startDate: "2036-04-10", endDate: "2036-04-10" })
      .set(auth(staff))
      .expect(200);
    expect(bodyData<Warning>(cancelledExcluded).overlappingColleagueCount).toBe(0);
  });
});
