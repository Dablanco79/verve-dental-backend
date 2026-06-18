/**
 * User API — param validation tests (Sprint I coverage pass)
 *
 * Verifies that UUID format validation fires on the user routes before
 * requests reach the service/repository layer.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };

const USERS_BASE = (clinicId: string) => `/api/v1/clinics/${clinicId}/users`;

describe("User API — UUID param validation", () => {
  it("returns 400 VALIDATION_ERROR for a malformed clinicId on GET /users", async () => {
    const app = await createTestApp();
    // owner_admin bypasses enforceTenantParam so validateParams is the first rejection
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .get("/api/v1/clinics/not-a-uuid/users")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a malformed clinicId on POST /users", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post("/api/v1/clinics/not-a-uuid/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "new@example.com", role: "clinical_staff" });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a malformed userId on POST /users/:userId/reset-password", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(`${USERS_BASE(SEED_CLINIC_A_ID)}/not-a-uuid/reset-password`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a malformed clinicId on POST /users/:userId/reset-password", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const validUserId = "00000000-0000-0000-0000-000000000001";

    const res = await request(app)
      .post(`/api/v1/clinics/not-a-uuid/users/${validUserId}/reset-password`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("still returns 200 for a valid GET /users request", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .get(USERS_BASE(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
