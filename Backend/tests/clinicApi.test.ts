/**
 * Clinic API — POST /clinics and GET /clinics (Sprint Q0.1)
 *
 * Covers:
 *   POST /api/v1/clinics
 *     - owner_admin can create a clinic (201)
 *     - group_practice_manager cannot create a clinic (403)
 *     - clinical_staff cannot create a clinic (403)
 *     - unauthenticated request is rejected (401)
 *     - missing required field `name` returns 400 VALIDATION_ERROR
 *     - invalid timezone value returns 400 VALIDATION_ERROR
 *     - unknown field in body is rejected (strict mode)
 *     - timezone defaults to Australia/Melbourne when omitted
 *     - explicit timezone is persisted as supplied
 *     - subscriptionTier is persisted when provided
 *     - created clinic appears in subsequent GET /clinics for owner_admin
 *
 *   GET /api/v1/clinics
 *     - owner_admin receives all active clinics
 *     - group_practice_manager receives only their home clinic
 *     - clinical_staff receives only their home clinic
 *     - unauthenticated request is rejected (401)
 *
 * All tests run against the in-memory repository — no database required.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };
type ClinicData = {
  id: string;
  name: string;
  timezone: string;
  subscriptionTier: string;
  isActive: boolean;
};
type ApiData<T> = { data: T };

const CLINICS_URL = "/api/v1/clinics";

// ─── POST /clinics ────────────────────────────────────────────────────────────

describe("POST /api/v1/clinics", () => {
  describe("RBAC — role access", () => {
    it("returns 201 when owner_admin creates a clinic", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Melbourne CBD" });

      expect(res.status).toBe(201);
    });

    it("returns 403 when group_practice_manager attempts to create a clinic", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "New Clinic" });

      expect(res.status).toBe(403);
      expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when clinical_staff attempts to create a clinic", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "New Clinic" });

      expect(res.status).toBe(403);
      expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
    });

    it("returns 401 when no token is supplied", async () => {
      const app = await createTestApp();

      const res = await request(app)
        .post(CLINICS_URL)
        .send({ name: "New Clinic" });

      expect(res.status).toBe(401);
      expect((res.body as ApiError).error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("response shape", () => {
    it("returns a full clinic object on success", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Heathmont" });

      const body = res.body as ApiData<ClinicData>;
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe("Heathmont");
      expect(body.data.isActive).toBe(true);
      expect(typeof body.data.id).toBe("string");
    });

    it("defaults timezone to Australia/Melbourne when not provided", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Bentleigh East" });

      expect(res.status).toBe(201);
      expect((res.body as ApiData<ClinicData>).data.timezone).toBe(
        "Australia/Melbourne",
      );
    });

    it("persists an explicitly supplied timezone", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Perth Clinic", timezone: "Australia/Perth" });

      expect(res.status).toBe(201);
      expect((res.body as ApiData<ClinicData>).data.timezone).toBe(
        "Australia/Perth",
      );
    });

    it("persists subscriptionTier when supplied", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Premium Clinic", subscriptionTier: "premium" });

      expect(res.status).toBe(201);
      expect((res.body as ApiData<ClinicData>).data.subscriptionTier).toBe(
        "premium",
      );
    });

    it("generates a unique UUID id for each created clinic", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const [res1, res2] = await Promise.all([
        request(app)
          .post(CLINICS_URL)
          .set("Authorization", `Bearer ${token}`)
          .send({ name: "Clinic Alpha" }),
        request(app)
          .post(CLINICS_URL)
          .set("Authorization", `Bearer ${token}`)
          .send({ name: "Clinic Beta" }),
      ]);

      const id1 = (res1.body as ApiData<ClinicData>).data.id;
      const id2 = (res2.body as ApiData<ClinicData>).data.id;
      expect(id1).not.toBe(id2);
    });
  });

  describe("validation", () => {
    it("returns 400 VALIDATION_ERROR when name is absent", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ timezone: "Australia/Melbourne" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR when name is an empty string", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for an invalid timezone value", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Injected Clinic", timezone: "America/New_York" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for an unknown body field (strict mode)", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Clinic X", id: "injected-uuid" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for an invalid subscriptionTier", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Clinic X", subscriptionTier: "enterprise-plus" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("list integration — created clinic appears in GET /clinics", () => {
    it("owner_admin can immediately retrieve the created clinic via GET /clinics", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      const newClinicName = "Cheltenham";

      await request(app)
        .post(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: newClinicName });

      const listRes = await request(app)
        .get(CLINICS_URL)
        .set("Authorization", `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      const clinics = (listRes.body as ApiData<ClinicData[]>).data;
      expect(clinics.some((c) => c.name === newClinicName)).toBe(true);
    });
  });
});

// ─── GET /clinics ─────────────────────────────────────────────────────────────

describe("GET /api/v1/clinics", () => {
  it("returns 401 without a token", async () => {
    const app = await createTestApp();
    const res = await request(app).get(CLINICS_URL);
    expect(res.status).toBe(401);
  });

  it("owner_admin receives all active clinics", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(CLINICS_URL)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const clinics = (res.body as ApiData<ClinicData[]>).data;
    // Seed contains Clinic A and Clinic B
    expect(clinics.length).toBeGreaterThanOrEqual(2);
    const ids = clinics.map((c) => c.id);
    expect(ids).toContain(SEED_CLINIC_A_ID);
    expect(ids).toContain(SEED_CLINIC_B_ID);
  });

  it("group_practice_manager receives only their home clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(CLINICS_URL)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const clinics = (res.body as ApiData<ClinicData[]>).data;
    expect(clinics).toHaveLength(1);
    expect(clinics[0]?.id).toBe(SEED_CLINIC_A_ID);
  });

  it("clinical_staff receives only their home clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .get(CLINICS_URL)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const clinics = (res.body as ApiData<ClinicData[]>).data;
    expect(clinics).toHaveLength(1);
    expect(clinics[0]?.id).toBe(SEED_CLINIC_A_ID);
  });

  it("returns an array under the data key", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(CLINICS_URL)
      .set("Authorization", `Bearer ${token}`);

    expect(Array.isArray((res.body as ApiData<ClinicData[]>).data)).toBe(true);
  });
});
