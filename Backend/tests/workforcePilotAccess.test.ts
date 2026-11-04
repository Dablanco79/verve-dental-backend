import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const FAKE_UUID = "00000000-0000-4000-8000-000000000001";

async function revoke(
  app: Awaited<ReturnType<typeof createTestApp>>,
  adminToken: string,
  userId: string,
  permission: string,
): Promise<void> {
  const response = await request(app)
    .delete(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${userId}/permissions/${encodeURIComponent(permission)}`,
    )
    .set("Authorization", `Bearer ${adminToken}`);
  expect(response.status).toBe(204);
}

describe("Workforce pilot platform access", () => {
  it(
    "denies every deferred route family to a Workforce-only manager while preserving Workforce",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      for (const permission of [
        "module:inventory",
        "module:stocktakes",
        "module:procurement",
        "module:receiving",
        "module:reports",
      ]) {
        await revoke(
          app,
          adminToken,
          SEED_USER_IDS.clinicAManager,
          permission,
        );
      }

      const deferredResponses = await Promise.all([
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`).set("Authorization", `Bearer ${managerToken}`).send({}),
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`).set("Authorization", `Bearer ${managerToken}`).send({}),
        request(app).get("/api/v1/suppliers").set("Authorization", `Bearer ${managerToken}`),
        request(app).get("/api/v1/master-products").set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-invoices`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-intelligence`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-relationships`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/supplier-relationships/${FAKE_UUID}`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/procurement-policies`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/procurement-policies/${FAKE_UUID}`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/supplier-contracts/${FAKE_UUID}`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/supplier-contract-prices/${FAKE_UUID}`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/forecast/materials`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/forecast/labor`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`).set("Authorization", `Bearer ${managerToken}`),
      ]);

      deferredResponses.forEach((response) => {
        expect(response.status).toBe(403);
      });

      const workforceResponses = await Promise.all([
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/me`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`).set("Authorization", `Bearer ${managerToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`).set("Authorization", `Bearer ${managerToken}`),
      ]);

      workforceResponses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    },
    60_000,
  );

  it(
    "denies deferred route families to Workforce-only clinical staff",
    async () => {
      const app = await createTestApp();
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      for (const permission of ["module:inventory", "module:stocktakes"]) {
        await revoke(app, adminToken, SEED_USER_IDS.clinicAStaff, permission);
      }

      const responses = await Promise.all([
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`).set("Authorization", `Bearer ${staffToken}`).send({}),
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`).set("Authorization", `Bearer ${staffToken}`).send({}),
        request(app).get("/api/v1/suppliers").set("Authorization", `Bearer ${staffToken}`),
        request(app).get("/api/v1/master-products").set("Authorization", `Bearer ${staffToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-intelligence`).set("Authorization", `Bearer ${staffToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/forecast/materials`).set("Authorization", `Bearer ${staffToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`).set("Authorization", `Bearer ${staffToken}`),
      ]);

      responses.forEach((response) => {
        expect(response.status).toBe(403);
      });
    },
    45_000,
  );

  it(
    "keeps owner_admin as the MFA-protected deferred-module exception",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const responses = await Promise.all([
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`).set("Authorization", `Bearer ${adminToken}`).send({}),
        request(app).post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`).set("Authorization", `Bearer ${adminToken}`).send({}),
        request(app).get("/api/v1/suppliers").set("Authorization", `Bearer ${adminToken}`),
        request(app).get("/api/v1/master-products").set("Authorization", `Bearer ${adminToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-invoices`).set("Authorization", `Bearer ${adminToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-intelligence`).set("Authorization", `Bearer ${adminToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/forecast/materials`).set("Authorization", `Bearer ${adminToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/forecast/labor`).set("Authorization", `Bearer ${adminToken}`),
        request(app).get("/api/v1/forecast/labor/group").set("Authorization", `Bearer ${adminToken}`),
        request(app).get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`).set("Authorization", `Bearer ${adminToken}`),
      ]);

      responses.forEach((response) => {
        expect(response.status).not.toBe(403);
      });
    },
    60_000,
  );

  it(
    "requires receiving in addition to procurement for supplier-invoice receiving",
    async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      await revoke(
        app,
        adminToken,
        SEED_USER_IDS.clinicAManager,
        "module:receiving",
      );

      const response = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-invoices/${FAKE_UUID}/receive`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ lines: [] });

      expect(response.status).toBe(403);
    },
    30_000,
  );
});
