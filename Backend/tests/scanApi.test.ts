import request from "supertest";

import { SEED_CLINIC_INVENTORY_IDS } from "../src/repositories/seed/inventorySeed.js";
import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type InventoryItem = {
  masterSku: string;
  quantityOnHand: number;
  isBelowReorderPoint: boolean;
};

type BarcodeMappingShape = {
  id: string;
  masterCatalogItemId: string;
  barcodeValue: string;
  barcodeFormat: string;
  isPrimary: boolean;
};

type ScanResponse = {
  item: InventoryItem;
  adjustment: { adjustmentType: string; quantityDelta: number; referenceId: string | null };
  barcode: { detectedFormat: string; lookupKey: string; mapping: BarcodeMappingShape };
  draftPoLineAdded: boolean;
  draftPoLine: { quantity: number; reason: string } | null;
};

describe("Scan API (Session 3)", () => {
  it("deducts stock for an EAN-13 scan by clinical staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "9301234567891" });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-BUR-001");
    expect(body.data.item.quantityOnHand).toBe(11);
    expect(body.data.adjustment.adjustmentType).toBe("scan_deduct");
    expect(body.data.adjustment.quantityDelta).toBe(-1);
    expect(body.data.barcode.detectedFormat).toBe("ean13");
    expect(body.data.draftPoLineAdded).toBe(false);
  });

  it("resolves GS1 barcodes via GTIN extraction", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "01093012345678901724123110" });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-GLV-001");
    expect(body.data.barcode.detectedFormat).toBe("gs1");
    expect(body.data.barcode.lookupKey).toBe("01093012345678901724123110");
  });

  it("resolves QR and Code128 barcode formats", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const qrResponse = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "VRV-CMP-001" });

    const code128Response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "VRVEJT001" });

    expect(qrResponse.status).toBe(200);
    expect((qrResponse.body as ApiData<ScanResponse>).data.item.masterSku).toBe("VRV-CMP-001");
    expect((qrResponse.body as ApiData<ScanResponse>).data.barcode.detectedFormat).toBe("qr");

    expect(code128Response.status).toBe(200);
    expect((code128Response.body as ApiData<ScanResponse>).data.item.masterSku).toBe(
      "VRV-EJT-001",
    );
    expect((code128Response.body as ApiData<ScanResponse>).data.barcode.detectedFormat).toBe(
      "code128",
    );
  });

  it("accepts an explicit data_matrix format hint", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "9301234567894", barcodeFormat: "data_matrix" });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-MSK-001");
    expect(body.data.barcode.detectedFormat).toBe("data_matrix");
  });

  it("creates a draft PO line when a scan crosses below reorder point", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        barcodeValue: "9301234567891",
        quantity: 9,
      });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-BUR-001");
    expect(body.data.item.quantityOnHand).toBe(3);
    expect(body.data.item.isBelowReorderPoint).toBe(true);
    expect(body.data.draftPoLineAdded).toBe(true);
    expect(body.data.draftPoLine).toEqual(
      expect.objectContaining({
        quantity: 1,
        reason: "below_reorder_point",
        clinicInventoryItemId: SEED_CLINIC_INVENTORY_IDS.clinicABurs,
      }),
    );
  });

  it("rejects scans that would cause negative stock", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        barcodeValue: "9301234567890",
        quantity: 100,
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("resolves a primary SKU when no barcode mapping matches the scanned value", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "VRV-GLV-001" });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-GLV-001");
    expect(body.data.item.quantityOnHand).toBe(2);
    expect(body.data.barcode.lookupKey).toBe("VRV-GLV-001");
    expect(body.data.barcode.mapping.barcodeValue).toBe("9301234567890");
  });

  it("resolves SKUs case-insensitively", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "vrv-bur-001" });

    const body = response.body as ApiData<ScanResponse>;

    expect(response.status).toBe(200);
    expect(body.data.item.masterSku).toBe("VRV-BUR-001");
    expect(body.data.barcode.lookupKey).toBe("VRV-BUR-001");
  });

  it("receives stock when the scan value is a primary SKU", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        barcodeValue: "VRV-MSK-001",
        mode: "receive",
        quantity: 2,
        reason: "PO-9001",
      });

    const body = response.body as ApiData<{
      mode: string;
      item: InventoryItem;
      adjustment: { adjustmentType: string; quantityDelta: number; reason: string | null };
      barcode: { lookupKey: string };
    }>;

    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("receive");
    expect(body.data.item.masterSku).toBe("VRV-MSK-001");
    expect(body.data.item.quantityOnHand).toBe(4);
    expect(body.data.adjustment.adjustmentType).toBe("receive");
    expect(body.data.barcode.lookupKey).toBe("VRV-MSK-001");
  });

  it("returns BARCODE_NOT_FOUND for unknown barcodes", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "9999999999999" });

    const body = response.body as ApiError;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BARCODE_NOT_FOUND");
  });

  it("receives stock when scan mode is receive", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        barcodeValue: "9301234567890",
        mode: "receive",
        quantity: 5,
        reason: "Delivery #4521",
      });

    const body = response.body as ApiData<{
      mode: string;
      item: InventoryItem;
      adjustment: { adjustmentType: string; quantityDelta: number; reason: string | null };
    }>;

    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("receive");
    expect(body.data.item.quantityOnHand).toBe(8);
    expect(body.data.adjustment.adjustmentType).toBe("receive");
    expect(body.data.adjustment.quantityDelta).toBe(5);
    expect(body.data.adjustment.reason).toBe("Delivery #4521");
  });

  it("blocks cross-tenant scan access", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "9301234567890" });

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("requires authentication for scan routes", async () => {
    const app = await createTestApp();

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .send({ barcodeValue: "9301234567890" });

    const body = response.body as ApiError;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
