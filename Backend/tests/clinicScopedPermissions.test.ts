import type { NextFunction, Request, Response } from "express";
import request from "supertest";

import { createClinicScopeMiddleware } from "../src/middleware/authMiddleware.js";
import type { ClinicRepository } from "../src/repositories/clinicRepository.js";
import type { PermissionRepository } from "../src/repositories/permissionRepository.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import type { UserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import type { Clinic } from "../src/types/clinic.js";
import { AppError } from "../src/types/errors.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const MISSING_CLINIC_ID = "99999999-9999-4999-8999-999999999999";

describe("clinic-scoped authoritative permissions", () => {
  it(
    "uses a reassigned clinical staff home clinic with the same old token",
    async () => {
      const app = await createTestApp();
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const grantAtNewHome = await request(app)
        .post(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAStaff}/permissions`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ permission: "module:inventory" });
      expect(grantAtNewHome.status).toBe(201);

      const move = await request(app)
        .patch(
          `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAStaff}`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          homeClinicId: SEED_CLINIC_B_ID,
          homeClinicName: "Verve Dental Clinic B",
        });
      expect(move.status).toBe(200);

      const oldHome = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${staffToken}`);
      expect(oldHome.status).toBe(403);

      const newHome = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${staffToken}`);
      expect(newHome.status).toBe(200);
    },
    30_000,
  );

  it(
    "does not retain a GPM role or cross-clinic access after demotion with the same token",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const assignment = await request(app)
        .put(
          `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/clinic-access`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          assignments: [
            { clinicId: SEED_CLINIC_A_ID, canRoster: true, canOperate: true },
            { clinicId: SEED_CLINIC_B_ID, canRoster: true, canOperate: true },
          ],
        });
      expect(assignment.status).toBe(200);

      const grant = await request(app)
        .post(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ permission: "module:inventory" });
      expect(grant.status).toBe(201);

      const beforeDemotion = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(beforeDemotion.status).toBe(200);

      const demotion = await request(app)
        .patch(
          `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ role: "clinical_staff" });
      expect(demotion.status).toBe(200);

      const crossClinicAfterDemotion = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(crossClinicAfterDemotion.status).toBe(403);

      const privilegedRouteAfterDemotion = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(privilegedRouteAfterDemotion.status).toBe(403);
    },
    30_000,
  );

  it(
    "applies a home-clinic revocation to the same pre-revocation token",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const beforeRevoke = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(beforeRevoke.status).toBe(200);

      const revoke = await request(app)
        .delete(
          `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions/module%3Ainventory`,
        )
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(revoke.status).toBe(204);

      const afterRevoke = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(afterRevoke.status).toBe(403);
    },
    30_000,
  );

  it(
    "isolates grants by target clinic and applies grants/revocations to the same stale token",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const assignment = await request(app)
        .put(
          `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/clinic-access`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          assignments: [
            { clinicId: SEED_CLINIC_A_ID, canRoster: true, canOperate: true },
            { clinicId: SEED_CLINIC_B_ID, canRoster: true, canOperate: true },
          ],
        });
      expect(assignment.status).toBe(200);

      const clinicA = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(clinicA.status).toBe(200);

      const clinicBBeforeGrant = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(clinicBBeforeGrant.status).toBe(403);

      const grant = await request(app)
        .post(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ permission: "module:inventory" });
      expect(grant.status).toBe(201);

      const clinicBAfterGrant = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(clinicBAfterGrant.status).toBe(200);

      const revoke = await request(app)
        .delete(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions/module%3Ainventory`,
        )
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(revoke.status).toBe(204);

      const clinicBAfterRevoke = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(clinicBAfterRevoke.status).toBe(403);
    },
    30_000,
  );

  it(
    "denies a grant without operational assignment and rejects nonexistent clinic IDs",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const grant = await request(app)
        .post(
          `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ permission: "module:inventory" });
      expect(grant.status).toBe(201);

      const unassigned = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(unassigned.status).toBe(403);

      const missing = await request(app)
        .get(`/api/v1/clinics/${MISSING_CLINIC_ID}/inventory`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(missing.status).toBe(404);
    },
    30_000,
  );

  it(
    "allows an owner across same legacy organisation clinics",
    async () => {
      const app = await createTestApp();
      const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      const response = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(response.status).toBe(200);
    },
    30_000,
  );
});

describe("clinic scope organisation boundary", () => {
  const baseClinic = {
    name: "Clinic",
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Sydney",
    subscriptionTier: "standard" as const,
    isActive: true,
    preferredName: null,
    latitude: null,
    longitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("denies owner_admin access to a clinic in an unrelated organisation", async () => {
    const homeClinic = {
      ...baseClinic,
      id: SEED_CLINIC_A_ID,
      organisationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } satisfies Clinic;
    const targetClinic = {
      ...baseClinic,
      id: SEED_CLINIC_B_ID,
      organisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    } satisfies Clinic;
    const clinics = {
      findById: (id: string) =>
        Promise.resolve(id === homeClinic.id ? homeClinic : id === targetClinic.id ? targetClinic : null),
    } as ClinicRepository;
    const permissions = {} as PermissionRepository;
    const assignments = {} as UserClinicAssignmentsRepository;
    const middleware = createClinicScopeMiddleware(clinics, permissions, assignments);
    const req = {
      params: { clinicId: targetClinic.id },
      user: {
        id: SEED_USER_IDS.clinicAAdmin,
        email: "admin@clinic-a.au",
        role: "owner_admin",
        homeClinicId: homeClinic.id,
        homeClinicName: homeClinic.name,
        firstName: "Admin",
        lastName: "User",
        displayName: "Admin User",
        permissions: [],
      },
    } as unknown as Request;

    let error: unknown;
    await new Promise<void>((resolve) => {
      middleware(req, {} as Response, ((nextError?: unknown) => {
        error = nextError;
        resolve();
      }) as NextFunction);
    });

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
  });
});
