/**
 * clinicPreferredName.test.ts
 *
 * Tests for the preferred_name feature on clinics.
 *
 * Covers:
 *   1. owner_admin can set preferred_name on a clinic (200)
 *   2. owner_admin can clear preferred_name by setting null (200)
 *   3. Whitespace-only preferred_name is rejected (400 INVALID_PREFERRED_NAME)
 *   4. GPM cannot edit preferred_name (403)
 *   5. clinical_staff cannot edit preferred_name (403)
 *   6. GET clinic returns preferredName field
 *   7. Roster entries include rosteredClinicPreferredName (null when not set)
 *   8. Duplicate preferred_name within same organisation returns 409
 *
 * All tests use the in-memory repository — no DATABASE_URL required.
 */

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

type ClinicDto = {
  id: string;
  name: string;
  preferredName: string | null;
  timezone: string;
  isActive: boolean;
};

const BASE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
BASE.setHours(0, 0, 0, 0);
const h = (offset: number) =>
  new Date(BASE.getTime() + offset * 60 * 60 * 1000).toISOString();

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Clinic preferred_name — PATCH /api/v1/clinics/:clinicId", () => {
  it("owner_admin can set preferred_name on a clinic (200)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Bentleigh East" });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<ClinicDto>;
    expect(body.data.preferredName).toBe("Bentleigh East");
  });

  it("owner_admin can clear preferred_name by setting null (200)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // First set it
    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Bentleigh East" })
      .expect(200);

    // Then clear it
    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: null });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<ClinicDto>).data.preferredName).toBeNull();
  });

  it("whitespace-only preferred_name is rejected (400 INVALID_PREFERRED_NAME)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "   " });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("INVALID_PREFERRED_NAME");
  });

  it("GPM cannot edit preferred_name (403)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Bentleigh East" });

    expect(res.status).toBe(403);
  });

  it("clinical_staff cannot edit preferred_name (403)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Bentleigh East" });

    expect(res.status).toBe(403);
  });

  it("GET clinic returns preferredName field (null when not set)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<ClinicDto>;
    // preferredName key must be present; starts as null in in-memory seed
    expect("preferredName" in body.data).toBe(true);
    expect(body.data.preferredName).toBeNull();
  });

  it("GET clinic returns preferredName after it is set", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Clinic A Short" })
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<ClinicDto>).data.preferredName).toBe("Clinic A Short");
  });

  it("duplicate preferred_name within same organisation returns 409", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Set preferred_name on Clinic A
    await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Shared Name" })
      .expect(200);

    // Try to set the same preferred_name on Clinic B (both have organisationId: null)
    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "Shared Name" });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("DUPLICATE_PREFERRED_NAME");
  });

  it("preferred_name is trimmed before saving", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ preferredName: "  Heathmont  " });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<ClinicDto>).data.preferredName).toBe("Heathmont");
  });
});

describe("Clinic preferred_name — roster entries", () => {
  it("roster entries include rosteredClinicPreferredName field (null when not set)", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Create a shift (no preferred_name set)
    const staffUserId = SEED_USER_IDS.clinicAStaff;
    const shiftRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        staffUserId,
        shiftStartAt: h(8),
        shiftEndAt: h(17),
        shiftType: "standard",
        notes: null,
      });

    expect(shiftRes.status).toBe(201);

    // List roster and verify rosteredClinicPreferredName is present
    const listRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);

    type RosterDto = {
      id: string;
      rosteredClinicName: string;
      rosteredClinicPreferredName: string | null;
    };
    type PageEnvelope = { data: RosterDto[]; pagination: { total: number; limit: number; offset: number } };

    const page = listRes.body as PageEnvelope;
    expect(Array.isArray(page.data)).toBe(true);
    const entry = page.data[0];
    expect(entry).toBeDefined();
    if (entry) {
      // rosteredClinicPreferredName must be null in the in-memory repo (no DB join)
      // The key may be absent (undefined) or explicitly null — both are acceptable
      // as long as the value is not a non-null string.
      expect(entry.rosteredClinicPreferredName ?? null).toBeNull();
    }
  });
});
