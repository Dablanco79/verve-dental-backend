import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

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

// Two shifts 24 hours apart in the near future — used across several tests.
const SHIFT_START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const SHIFT_END = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString();

function buildCreatePayload(overrides: Partial<{
  staffUserId: string;
  rosteredClinicName: string;
  shiftStartAt: string;
  shiftEndAt: string;
  shiftType: string;
  notes: string | null;
}> = {}) {
  return {
    staffUserId: SEED_USER_IDS.clinicAStaff,
    rosteredClinicName: "Verve Dental Clinic A",
    shiftStartAt: SHIFT_START,
    shiftEndAt: SHIFT_END,
    shiftType: "standard",
    notes: null,
    ...overrides,
  };
}

describe("Roster API (Module 04)", () => {
  // ─── GET list ────────────────────────────────────────────────────────────────

  it("returns empty roster for a clinic with no shifts", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`);

    const body = res.body as ApiData<RosterEntryDto[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
  });

  it("blocks unauthenticated access to roster list", async () => {
    const app = await createTestApp();

    const res = await request(app).get(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`,
    );

    expect(res.status).toBe(401);
  });

  // ─── POST create ─────────────────────────────────────────────────────────────

  it("owner_admin can create a roster entry at any clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload());

    const body = res.body as ApiData<RosterEntryDto>;
    expect(res.status).toBe(201);
    expect(body.data.staffUserId).toBe(SEED_USER_IDS.clinicAStaff);
    expect(body.data.staffEmail).toBe("staff@clinic-a.au");
    expect(body.data.status).toBe("scheduled");
    expect(body.data.shiftType).toBe("standard");
    expect(body.data.rosteredClinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("group_practice_manager can create an entry at their own clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload({ notes: "Early shift" }));

    expect(res.status).toBe(201);
    const body = res.body as ApiData<RosterEntryDto>;
    expect(body.data.notes).toBe("Early shift");
  });

  it("group_practice_manager cannot create an entry at another clinic", async () => {
    const app = await createTestApp();
    // manager@clinic-a.au has homeClinicId = SEED_CLINIC_A_ID
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload({ rosteredClinicName: "Verve Dental Clinic B" }));

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("clinical_staff cannot create roster entries", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload());

    expect(res.status).toBe(403);
  });

  it("returns 404 when staffUserId does not match any user", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload({ staffUserId: "00000000-0000-4000-8000-000000000000" }));

    expect(res.status).toBe(404);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("returns 400 when shiftEndAt is before shiftStartAt", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send(buildCreatePayload({ shiftStartAt: SHIFT_END, shiftEndAt: SHIFT_START }));

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("INVALID_SHIFT_TIMES");
  });

  // ─── GET single + list after create ──────────────────────────────────────────

  it("returns a created entry by id", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const createRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCreatePayload());

    const { id } = (createRes.body as ApiData<RosterEntryDto>).data;

    const getRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect((getRes.body as ApiData<RosterEntryDto>).data.id).toBe(id);
  });

  it("clinical_staff can list roster entries at their home clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Admin creates an entry first.
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCreatePayload());

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<RosterEntryDto[]>).data).toHaveLength(1);
  });

  // ─── Cross-clinic access via roster membership ────────────────────────────

  it("clinical_staff at clinic-a cannot see clinic-b roster without a shift there", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("clinical_staff gains cross-clinic read access when rostered at that clinic", async () => {
    const app = await createTestApp();
    // Clinic-B admin creates a shift for clinic-A staff AT clinic-B.
    const clinicBAdminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${clinicBAdminToken}`)
      .send(
        buildCreatePayload({
          staffUserId: SEED_USER_IDS.clinicAStaff,
          rosteredClinicName: "Verve Dental Clinic B",
        }),
      );

    // Now clinic-A staff should be able to read clinic-B's roster.
    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<RosterEntryDto[]>).data.length).toBeGreaterThan(0);
  });

  // ─── GET /me ─────────────────────────────────────────────────────────────────

  it("GET /me returns only the caller's shifts at the requested clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Create a shift for staff member.
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCreatePayload({ staffUserId: SEED_USER_IDS.clinicAStaff }));

    // Create a shift for the admin themselves.
    await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCreatePayload({ staffUserId: SEED_USER_IDS.clinicAAdmin }));

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/me`)
      .set("Authorization", `Bearer ${staffToken}`);

    const body = res.body as ApiData<RosterEntryDto[]>;
    expect(res.status).toBe(200);
    // Only the staff member's own shift is returned, not the admin's.
    expect(body.data.every((e) => e.staffUserId === SEED_USER_IDS.clinicAStaff)).toBe(true);
  });

  // ─── PATCH update ─────────────────────────────────────────────────────────────

  it("manager can update a shift type and status", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const createRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(buildCreatePayload());

    const { id } = (createRes.body as ApiData<RosterEntryDto>).data;

    const patchRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ shiftType: "overtime", status: "confirmed" });

    const body = patchRes.body as ApiData<RosterEntryDto>;
    expect(patchRes.status).toBe(200);
    expect(body.data.shiftType).toBe("overtime");
    expect(body.data.status).toBe("confirmed");
  });

  // ─── DELETE cancel ────────────────────────────────────────────────────────────

  it("manager can cancel (DELETE) a roster entry", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const createRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(buildCreatePayload());

    const { id } = (createRes.body as ApiData<RosterEntryDto>).data;

    const deleteRes = await request(app)
      .delete(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${id}`)
      .set("Authorization", `Bearer ${managerToken}`);

    const body = deleteRes.body as ApiData<RosterEntryDto>;
    expect(deleteRes.status).toBe(200);
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 409 when trying to update a cancelled entry", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const createRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send(buildCreatePayload());

    const { id } = (createRes.body as ApiData<RosterEntryDto>).data;

    // Cancel first.
    await request(app)
      .delete(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${id}`)
      .set("Authorization", `Bearer ${managerToken}`);

    // Attempt to update the now-cancelled entry.
    const patchRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ shiftType: "overtime" });

    expect(patchRes.status).toBe(409);
    const body = patchRes.body as ApiError;
    expect(body.error.code).toBe("ENTRY_CANCELLED");
  });
});
