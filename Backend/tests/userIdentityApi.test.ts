/**
 * Sprint 1 — User Identity API tests
 *
 * Coverage:
 *   - POST /users requires firstName and lastName
 *   - POST /users returns firstName, lastName, displayName in the response
 *   - displayName defaults to "First Last" when not provided
 *   - displayName is stored as provided when explicitly supplied
 *   - owner_admin can create any role (owner_admin, group_practice_manager, clinical_staff)
 *   - owner_admin can create a user in a clinic other than their own
 *   - group_practice_manager can create clinical_staff only
 *   - group_practice_manager cannot create owner_admin (403)
 *   - group_practice_manager cannot create group_practice_manager (403)
 *   - group_practice_manager cannot create a user in a different clinic (403)
 *   - GET /users response includes name fields
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
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
};

const USERS_URL = (clinicId: string) => `/api/v1/clinics/${clinicId}/users`;

/** Minimal valid payload for POST /users. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: `test-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "password123",
    role: "clinical_staff",
    clinicName: "Verve Dental Clinic A",
    firstName: "Jane",
    lastName: "Smith",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("User Identity API — name field validation", () => {
  it("returns 400 VALIDATION_ERROR when firstName is missing", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({ firstName: undefined }),
      );

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when lastName is missing", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ lastName: undefined }));

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when firstName is an empty string", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ firstName: "" }));

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("User Identity API — name fields in response", () => {
  it("returns firstName and lastName in the created user payload", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ firstName: "Jane", lastName: "Smith" }));

    expect(res.status).toBe(201);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.firstName).toBe("Jane");
    expect(body.data.lastName).toBe("Smith");
  });

  it("defaults displayName to 'First Last' when not provided", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ firstName: "Alice", lastName: "Jones" }));

    expect(res.status).toBe(201);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.displayName).toBe("Alice Jones");
  });

  it("stores a custom displayName when explicitly provided", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          firstName: "Robert",
          lastName: "Johnson",
          displayName: "Bob Johnson",
        }),
      );

    expect(res.status).toBe(201);
    const body = res.body as ApiEnvelope<UserPayload>;
    expect(body.data.displayName).toBe("Bob Johnson");
  });

  it("includes name fields in GET /users list response", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Create a named user in Clinic A first.
    await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          email: `list-test-${Date.now().toString()}@example.com`,
          firstName: "List",
          lastName: "Test",
        }),
      );

    const listRes = await request(app)
      .get(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const body = listRes.body as ApiEnvelope<UserPayload[]>;
    // At least one entry should have firstName / lastName / displayName fields
    // present (even if null for seed users).
    for (const u of body.data) {
      expect(u).toHaveProperty("firstName");
      expect(u).toHaveProperty("lastName");
      expect(u).toHaveProperty("displayName");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("User Identity API — owner_admin RBAC", () => {
  it("can create an owner_admin", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ role: "owner_admin" }));

    expect(res.status).toBe(201);
    expect((res.body as ApiEnvelope<UserPayload>).data.role).toBe("owner_admin");
  });

  it("can create a group_practice_manager", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          role: "group_practice_manager",
          clinicName: "Verve Dental Clinic A",
        }),
      );

    expect(res.status).toBe(201);
    expect((res.body as ApiEnvelope<UserPayload>).data.role).toBe(
      "group_practice_manager",
    );
  });

  it("can create a user in a clinic other than their own (cross-clinic)", async () => {
    const app = await createTestApp();
    // Clinic B admin creates a user in Clinic A.
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          clinicName: "Verve Dental Clinic A",
        }),
      );

    expect(res.status).toBe(201);
    expect((res.body as ApiEnvelope<UserPayload>).data.homeClinicId).toBe(
      SEED_CLINIC_A_ID,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("User Identity API — group_practice_manager RBAC", () => {
  it("can create clinical_staff in their own clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          clinicName: "Verve Dental Clinic A",
        }),
      );

    expect(res.status).toBe(201);
    expect((res.body as ApiEnvelope<UserPayload>).data.role).toBe("clinical_staff");
  });

  it("returns 403 FORBIDDEN when attempting to create an owner_admin", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ role: "owner_admin" }));

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN when attempting to create a group_practice_manager", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload({ role: "group_practice_manager" }));

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 TENANT_ACCESS_DENIED when attempting to create a user in a different clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(USERS_URL(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload({
          clinicName: "Verve Dental Clinic B",
        }),
      );

    // enforceTenantParam blocks PMs from accessing other clinic URLs
    expect(res.status).toBe(403);
  });
});
