/**
 * staffTimesheetAccess.test.ts — Sprint N (Internal Pilot Blockers)
 *
 * Verifies the GET /clinics/:clinicId/timesheets/me endpoint that unblocks
 * clinical_staff from receiving 403 on the Timesheets page.
 *
 * Coverage:
 *   - clinical_staff can list their own timesheets via /me (200)
 *   - clinical_staff is still blocked from the clinic-wide list (403)
 *   - manager can access the clinic-wide list (200, unchanged)
 *   - manager can also use /me to view personal history (200)
 *   - owner_admin can use /me (200)
 *   - unauthenticated request is rejected (401)
 *   - /me only returns entries belonging to the caller
 *
 * All tests use the in-memory test app (no DB, no Redis) so they are
 * isolated and deterministic.
 */

import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getMyTimesheets(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string = SEED_CLINIC_A_ID,
) {
  return request(app)
    .get(`/api/v1/clinics/${clinicId}/timesheets/me`)
    .set("Authorization", `Bearer ${token}`);
}

async function getClinicTimesheets(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string = SEED_CLINIC_A_ID,
) {
  return request(app)
    .get(`/api/v1/clinics/${clinicId}/timesheets`)
    .set("Authorization", `Bearer ${token}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /timesheets/me
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /clinics/:clinicId/timesheets/me", () => {
  it("returns 200 with an array for clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await getMyTimesheets(app, token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray((res.body as ApiData<unknown[]>).data)).toBe(true);
  });

  it("returns 200 with an array for group_practice_manager", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await getMyTimesheets(app, token);

    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as ApiData<unknown[]>).data)).toBe(true);
  });

  it("returns 200 with an array for owner_admin", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getMyTimesheets(app, token);

    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as ApiData<unknown[]>).data)).toBe(true);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const app = await createTestApp();

    const res = await request(app).get(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/me`,
    );

    expect(res.status).toBe(401);
  });

  it("rejects a staff member accessing a different clinic's /me route", async () => {
    const app = await createTestApp();
    // staff@clinic-a.au has homeClinicId = SEED_CLINIC_A_ID.
    // Accessing CLINIC_B_ID must be blocked by enforceTenantParam.
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await getMyTimesheets(app, token, "22222222-2222-4222-8222-222222222222");

    // enforceTenantParam returns 403 for cross-clinic access by non-owner_admin
    expect(res.status).toBe(403);
  });

  it("response entries all belong to the authenticated staff member", async () => {
    const app = await createTestApp();

    // First clock in as staff to create an entry.
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        rosterEntryId: null,
        shiftDate: "2026-06-19",
        shiftStartAt: "2026-06-19T08:00:00.000Z",
        shiftEndAt: "2026-06-19T17:00:00.000Z",
      });

    const res = await getMyTimesheets(app, staffToken);

    expect(res.status).toBe(200);

    const entries = (res.body as ApiData<Array<{ staffUserId: string }>>).data;
    for (const entry of entries) {
      expect(entry.staffUserId).toBe(SEED_USER_IDS.clinicAStaff);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC: clinic-wide list remains manager-only
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /clinics/:clinicId/timesheets — RBAC", () => {
  it("returns 403 for clinical_staff on the clinic-wide list", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await getClinicTimesheets(app, token);

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 200 for group_practice_manager on the clinic-wide list", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await getClinicTimesheets(app, token);

    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as ApiData<unknown[]>).data)).toBe(true);
  });

  it("returns 200 for owner_admin on the clinic-wide list", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getClinicTimesheets(app, token);

    expect(res.status).toBe(200);
  });
});
