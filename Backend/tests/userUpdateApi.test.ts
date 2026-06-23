/**
 * Sprint 2 — User Update API tests
 *
 * Coverage:
 *   - PATCH returns 400 when body is empty
 *   - PATCH returns 400 when homeClinicId is supplied without homeClinicName
 *   - PATCH returns 404 when userId does not exist
 *   - PATCH returns 404 when userId belongs to a different clinic
 *   - owner_admin can update firstName / lastName / displayName
 *   - owner_admin can update payrollTrack
 *   - owner_admin can change role
 *   - owner_admin can move a user to another clinic (homeClinicId + homeClinicName)
 *   - owner_admin PATCH returns the updated user including payrollTrack
 *   - group_practice_manager can update firstName/lastName/displayName/payrollTrack for clinical_staff
 *   - group_practice_manager returns 403 when attempting to change role
 *   - group_practice_manager returns 403 when attempting to change homeClinicId
 *   - group_practice_manager returns 403 when targeting a non-clinical_staff user
 *   - group_practice_manager returns 403 when targeting a user in a different clinic (via middleware)
 *   - clinical_staff is blocked by requireRoles middleware (403)
 *   - audit event user.updated is written after a successful PATCH
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };
type ApiEnvelope<T> = { data: T };
type UserPayload = {
  id: string;
  email: string;
  role: string;
  homeClinicId: string;
  homeClinicName: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  payrollTrack: string;
};

type AuditEventDto = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
};
type AuditEventsPage = { events: AuditEventDto[]; total: number };

const PATCH_URL = (clinicId: string, userId: string) =>
  `/api/v1/clinics/${clinicId}/users/${userId}`;

const AUDIT_URL = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/analytics/audit-events?entityType=user`;

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /users/:userId — validation", () => {
  it("returns 400 VALIDATION_ERROR when the body is empty", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when homeClinicId is provided without homeClinicName", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ homeClinicId: SEED_CLINIC_B_ID });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 NOT_FOUND when the userId does not exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, "00000000-0000-4000-8000-000000000000"))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Ghost" });

    expect(res.status).toBe(404);
    expect((res.body as ApiError).error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND when userId belongs to a different clinic than the URL", async () => {
    const app = await createTestApp();
    // Clinic B admin tries to patch a clinic-A user via the clinic-A URL but
    // the seed user is in clinic A and the URL is also clinic A — this passes.
    // Instead we test clinic-B user via clinic-A URL.
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicBAdmin))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Cross" });

    expect(res.status).toBe(404);
    expect((res.body as ApiError).error.code).toBe("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /users/:userId — owner_admin capabilities", () => {
  it("can update firstName, lastName, and displayName", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Updated", lastName: "Name", displayName: "Updated Name" });

    expect(res.status).toBe(200);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.firstName).toBe("Updated");
    expect(body.data.lastName).toBe("Name");
    expect(body.data.displayName).toBe("Updated Name");
  });

  it("can update payrollTrack", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ payrollTrack: "commission" });

    expect(res.status).toBe(200);
    expect((res.body as ApiEnvelope<UserPayload>).data.payrollTrack).toBe("commission");
  });

  it("can change a user's role", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "group_practice_manager" });

    expect(res.status).toBe(200);
    expect((res.body as ApiEnvelope<UserPayload>).data.role).toBe("group_practice_manager");
  });

  it("can move a user to another clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({
        homeClinicId: SEED_CLINIC_B_ID,
        homeClinicName: "Verve Dental Clinic B",
      });

    expect(res.status).toBe(200);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.homeClinicId).toBe(SEED_CLINIC_B_ID);
    expect(body.data.homeClinicName).toBe("Verve Dental Clinic B");
  });

  it("response includes payrollTrack in the user payload", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Payroll" });

    expect(res.status).toBe(200);
    expect((res.body as ApiEnvelope<UserPayload>).data).toHaveProperty("payrollTrack");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /users/:userId — group_practice_manager RBAC", () => {
  it("can update firstName/lastName/displayName/payrollTrack for clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Managed", lastName: "Staff", payrollTrack: "commission" });

    expect(res.status).toBe(200);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.firstName).toBe("Managed");
    expect(body.data.payrollTrack).toBe("commission");
  });

  it("returns 403 FORBIDDEN when attempting to change role", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "group_practice_manager" });

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN when attempting to change homeClinicId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ homeClinicId: SEED_CLINIC_B_ID, homeClinicName: "Verve Dental Clinic B" });

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN when targeting an owner_admin user", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAAdmin))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Sneaky" });

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 TENANT_ACCESS_DENIED when targeting a user in a different clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // enforceTenantParam blocks PMs from the clinic-B URL
    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_B_ID, SEED_USER_IDS.clinicBAdmin))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "CrossClinic" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /users/:userId — clinical_staff access", () => {
  it("returns 403 FORBIDDEN for clinical_staff (blocked by requireRoles middleware)", async () => {
    const app = await createTestApp();
    // clinical_staff email — no MFA enrolled, so direct token
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: "staff@clinic-a.au",
      password: "password123",
    });
    const token = (loginRes.body as { data: { accessToken?: string } }).data.accessToken;

    const res = await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${String(token)}`)
      .send({ firstName: "SelfEdit" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /users/:userId — audit event", () => {
  it("writes a user.updated audit event after a successful update", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app)
      .patch(PATCH_URL(SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff))
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "AuditTest" });

    const auditRes = await request(app)
      .get(AUDIT_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(auditRes.status).toBe(200);
    const page = (auditRes.body as ApiEnvelope<AuditEventsPage>).data;
    const updated = page.events.find((e) => e.action === "user.updated");
    expect(updated).toBeDefined();
    expect(updated?.entityType).toBe("user");
    expect(updated?.entityId).toBe(SEED_USER_IDS.clinicAStaff);
  });
});
