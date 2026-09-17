/**
 * rosterAuthorisation.test.ts
 *
 * GAP 4: Server-side clinic authorisation tests for the roster module.
 * Uses in-memory app via createTestApp() so no database is required.
 *
 * Covers:
 *   1.  owner_admin can create a roster entry at any clinic
 *   2.  GPM can create a shift at their home clinic
 *   3.  GPM cannot create a shift at an unassigned clinic
 *   4.  clinical_staff cannot create a shift at any clinic
 *   5.  GPM cannot update a shift to move it to an unassigned clinic
 *   6.  owner_admin can move a shift to any clinic
 *   7.  GET /roster/accessible-clinics — GPM returns only their assigned clinics
 *   8.  GET /roster/accessible-clinics — owner_admin returns all active clinics
 *   9.  GET /roster/accessible-clinics — clinical_staff gets 403
 */
import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

// ── Time constants ────────────────────────────────────────────────────────────

// Use a date 30 days in the future to avoid collision with conflict tests
const BASE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
BASE.setHours(0, 0, 0, 0);

const h = (offset: number) =>
  new Date(BASE.getTime() + offset * 60 * 60 * 1000).toISOString();

const AUTH_START = h(8);   // 08:00
const AUTH_END   = h(17);  // 17:00

// ── Types ─────────────────────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type RosterEntryDto = {
  id: string;
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  shiftStartAt: string;
  shiftEndAt: string;
  shiftType: string;
  status: string;
  notes: string | null;
  createdByUserId: string;
};

// ── Helper ────────────────────────────────────────────────────────────────────

async function mkShiftAt(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string,
  staffUserId: string,
  startAt: string,
  endAt: string,
  expectStatus = 201,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/clinics/${clinicId}/roster`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      staffUserId,
      shiftStartAt: startAt,
      shiftEndAt: endAt,
      shiftType: "standard",
      notes: null,
    })
    .expect(expectStatus);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Roster authorisation — create / update access control", () => {
  // ─── Test 1: owner_admin can create at any clinic ─────────────────────────

  it("owner_admin can create a roster entry at any clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Create at clinic A
    const resA = await mkShiftAt(
      app, token, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff, AUTH_START, AUTH_END,
    );
    expect(resA.status).toBe(201);

    // Create at clinic B (different staff to avoid conflict)
    const resB = await mkShiftAt(
      app, token, SEED_CLINIC_B_ID, SEED_USER_IDS.clinicBAdmin, AUTH_START, AUTH_END,
    );
    expect(resB.status).toBe(201);
  });

  // ─── Test 2: GPM can create a shift at their home clinic ─────────────────

  it("GPM can create a shift at their home clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await mkShiftAt(
      app, token, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff, AUTH_START, AUTH_END,
    );
    expect(res.status).toBe(201);
  });

  // ─── Test 3: GPM cannot create at an unassigned clinic ────────────────────

  it("GPM cannot create a shift at an unassigned clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Expect 403 — either FORBIDDEN (service layer) or TENANT_ACCESS_DENIED
    // (tenant middleware) depending on which layer catches the violation first.
    const res = await mkShiftAt(
      app, token, SEED_CLINIC_B_ID, SEED_USER_IDS.clinicAStaff, AUTH_START, AUTH_END, 403,
    );
    const code = (res.body as ApiError).error.code;
    expect(["FORBIDDEN", "TENANT_ACCESS_DENIED"]).toContain(code);
  });

  // ─── Test 4: clinical_staff cannot create a shift at any clinic ───────────

  it("clinical_staff cannot create a shift at any clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        shiftStartAt: AUTH_START,
        shiftEndAt: AUTH_END,
        shiftType: "standard",
        notes: null,
      })
      .expect(403);
  });

  // ─── Test 5: GPM cannot move a shift to an unassigned clinic ─────────────

  it("GPM cannot update a shift to move it to an unassigned clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const gpmToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create shift at clinic A as owner_admin
    const seedRes = await mkShiftAt(
      app, adminToken, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff, AUTH_START, AUTH_END,
    );
    const created = (seedRes.body as ApiData<RosterEntryDto>).data;

    // GPM attempts to move it to clinic B (unassigned)
    const patchRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${created.id}`)
      .set("Authorization", `Bearer ${gpmToken}`)
      .send({ rosteredClinicId: SEED_CLINIC_B_ID })
      .expect(403);

    expect((patchRes.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  // ─── Test 6: owner_admin can move a shift to any clinic ───────────────────

  it("owner_admin can move a shift to any clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Create shift at clinic A for clinicAStaff
    const seedRes = await mkShiftAt(
      app, token, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff, AUTH_START, AUTH_END,
    );
    const created = (seedRes.body as ApiData<RosterEntryDto>).data;

    // owner_admin bypasses eligibility checks → can move to clinic B
    const patchRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rosteredClinicId: SEED_CLINIC_B_ID })
      .expect(200);

    const updated = (patchRes.body as ApiData<RosterEntryDto>).data;
    expect(updated.rosteredClinicId).toBe(SEED_CLINIC_B_ID);
  });
});

// ── Accessible clinics endpoint ───────────────────────────────────────────────

describe("Roster authorisation — GET /roster/accessible-clinics", () => {
  // ─── Test 7: GPM returns only their assigned clinics ─────────────────────

  it("GPM returns only their assigned clinics", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/roster/accessible-clinics")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const clinics = (res.body as ApiData<{ id: string; name: string }[]>).data;

    // Home clinic A should be present
    expect(clinics.some((c) => c.id === SEED_CLINIC_A_ID)).toBe(true);
    // Clinic B should NOT be present (GPM has no can_operate at B)
    expect(clinics.some((c) => c.id === SEED_CLINIC_B_ID)).toBe(false);
  });

  // ─── Test 8: owner_admin returns all active clinics ───────────────────────

  it("owner_admin returns all active clinics", async () => {
    const app = await createTestApp();
    // admin@clinic-a.au has owner_admin role
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/roster/accessible-clinics")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const clinics = (res.body as ApiData<{ id: string; name: string }[]>).data;

    // Both seed clinics should be present
    expect(clinics.some((c) => c.id === SEED_CLINIC_A_ID)).toBe(true);
    expect(clinics.some((c) => c.id === SEED_CLINIC_B_ID)).toBe(true);
  });

  // ─── Test 9: clinical_staff gets 403 ─────────────────────────────────────

  it("clinical_staff gets 403 from accessible-clinics", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    await request(app)
      .get("/api/v1/roster/accessible-clinics")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
