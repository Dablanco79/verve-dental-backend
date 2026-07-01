import request from "supertest";

import { SEED_CLINIC_INVENTORY_IDS } from "../src/repositories/seed/inventorySeed.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type InventoryItem = {
  id: string;
  masterSku: string;
  stockUnit: string;
  receivingUnit: string;
  unitsPerReceivingUnit: number;
  unitOfMeasure: string;
  quantityOnHand: number;
  isBelowReorderPoint: boolean;
};

describe("Inventory API (Session 2)", () => {
  it("lists clinic inventory for clinical staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiData<InventoryItem[]>;

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(5);
    expect(body.data.some((item) => item.masterSku === "VRV-GLV-001")).toBe(true);
    const gloves = body.data.find((item) => item.masterSku === "VRV-GLV-001");
    expect(gloves?.stockUnit).toBe("Box");
    expect(gloves?.receivingUnit).toBe("Carton");
    expect(gloves?.unitsPerReceivingUnit).toBe(10);
    expect(gloves?.unitOfMeasure).toBe("Box");
  });

  it("returns a single inventory item by id", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/${SEED_CLINIC_INVENTORY_IDS.clinicAGloves}`,
      )
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiData<InventoryItem>;

    expect(response.status).toBe(200);
    expect(body.data.masterSku).toBe("VRV-GLV-001");
    expect(body.data.isBelowReorderPoint).toBe(true);
  });

  it("blocks cross-tenant inventory access for clinical staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/inventory`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("allows owner admin cross-clinic inventory reads", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect((response.body as ApiData<InventoryItem[]>).data).toHaveLength(5);
  });

  it("allows owner admin to manually adjust stock and records audit entry", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const adjustResponse = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjust`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        itemId: SEED_CLINIC_INVENTORY_IDS.clinicAGloves,
        quantityDelta: 2,
        reason: "Received delivery",
      });

    const adjustBody = adjustResponse.body as ApiData<{
      item: InventoryItem;
      adjustment: { quantityDelta: number; adjustmentType: string };
    }>;

    expect(adjustResponse.status).toBe(200);
    expect(adjustBody.data.item.quantityOnHand).toBe(5);
    expect(adjustBody.data.adjustment.quantityDelta).toBe(2);
    expect(adjustBody.data.adjustment.adjustmentType).toBe("manual_adjust");

    const historyResponse = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments`)
      .set("Authorization", `Bearer ${token}`);

    const historyBody = historyResponse.body as ApiData<Array<{ reason: string | null }>>;

    expect(historyResponse.status).toBe(200);
    expect(historyBody.data.length).toBeGreaterThanOrEqual(1);
    expect(historyBody.data[0]?.reason).toBe("Received delivery");
  });

  it("allows group practice manager to adjust stock within their clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjust`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        itemId: SEED_CLINIC_INVENTORY_IDS.clinicAMasks,
        quantityDelta: 1,
        reason: "Cycle count correction",
      });

    const body = response.body as ApiData<{
      item: InventoryItem;
      adjustment: { quantityDelta: number };
    }>;

    expect(response.status).toBe(200);
    expect(body.data.adjustment.quantityDelta).toBe(1);
  });

  it("rejects manual adjustments from clinical staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjust`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        itemId: SEED_CLINIC_INVENTORY_IDS.clinicAGloves,
        quantityDelta: 1,
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects adjustments that would cause negative stock", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjust`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        itemId: SEED_CLINIC_INVENTORY_IDS.clinicAGloves,
        quantityDelta: -100,
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rejects clinical staff from viewing adjustment history", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requires authentication for inventory routes", async () => {
    const app = await createTestApp();

    const response = await request(app).get(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`,
    );

    const body = response.body as ApiError;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// UUID param validation (Sprint I — coverage pass)
// ---------------------------------------------------------------------------

describe("Inventory param validation", () => {
  it("returns 400 VALIDATION_ERROR for a malformed clinicId on GET /inventory", async () => {
    const app = await createTestApp();
    // Use owner_admin so enforceTenantParam passes through and validateParams fires
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get("/api/v1/clinics/not-a-uuid/inventory")
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a malformed itemId on GET /inventory/:itemId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for an invalid limit on GET /inventory/adjustments", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments?limit=-5`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error).toHaveProperty("details");
  });

  it("returns 400 VALIDATION_ERROR for a non-numeric limit on GET /inventory/adjustments", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments?limit=banana`)
      .set("Authorization", `Bearer ${token}`);

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("still returns 200 for a valid itemId on GET /inventory/:itemId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/${SEED_CLINIC_INVENTORY_IDS.clinicAGloves}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it("still returns 200 for a valid limit on GET /inventory/adjustments", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");

    const response = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments?limit=10`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
  });
});
