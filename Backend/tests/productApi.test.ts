import request from "supertest";
import { randomUUID } from "node:crypto";

import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

describe("Product API", () => {
  async function createSupplier(app: Awaited<ReturnType<typeof createTestApp>>, token: string) {
    const response = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierName: `Product Test Supplier ${randomUUID()}`,
      });

    expect(response.status).toBe(201);
    return (response.body as ApiData<{ id: string; supplierName: string }>).data;
  }

  it("allows managers to add a new product with barcode and clinic stock", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplier = await createSupplier(app, token);

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-ANE-001",
        name: "Dental Anaesthetic Cartridges (Box 50)",
        description: "Lidocaine 2% with epinephrine",
        category: "Pharmacy",
        unitOfMeasure: "box",
        defaultUnitCostCents: 8999,
        barcodeValue: "9301234567899",
        barcodeFormat: "ean13",
        initialQuantity: 6,
        reorderPoint: 3,
        supplierId: supplier.id,
      });

    const body = response.body as ApiData<{
      masterItem: { sku: string };
      barcodeMapping: { barcodeValue: string };
      clinicItem: {
        masterSku: string;
        quantityOnHand: number;
        preferredSupplierId: string;
        preferredSupplierName: string;
      };
    }>;

    expect(response.status).toBe(201);
    expect(body.data.masterItem.sku).toBe("VRV-ANE-001");
    expect(body.data.barcodeMapping.barcodeValue).toBe("9301234567899");
    expect(body.data.clinicItem.quantityOnHand).toBe(6);
    expect(body.data.clinicItem.preferredSupplierId).toBe(supplier.id);
    expect(body.data.clinicItem.preferredSupplierName).toBe(supplier.supplierName);
  });

  it("rejects duplicate SKU on product creation", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplier = await createSupplier(app, token);

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-GLV-001",
        name: "Duplicate gloves",
        category: "PPE",
        unitOfMeasure: "box",
        defaultUnitCostCents: 1000,
        barcodeValue: "9999999999991",
        barcodeFormat: "ean13",
        initialQuantity: 1,
        reorderPoint: 1,
        supplierId: supplier.id,
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("DUPLICATE_SKU");
  });

  it("rejects product creation from clinical staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-NEW-001",
        name: "Unauthorized product",
        category: "PPE",
        unitOfMeasure: "box",
        defaultUnitCostCents: 1000,
        barcodeValue: "9999999999992",
        barcodeFormat: "ean13",
        initialQuantity: 1,
        reorderPoint: 1,
        supplierId: "11111111-1111-4111-8111-111111111111",
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("blocks cross-tenant product creation", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-NEW-002",
        name: "Cross-tenant product",
        category: "PPE",
        unitOfMeasure: "box",
        defaultUnitCostCents: 1000,
        barcodeValue: "9999999999993",
        barcodeFormat: "ean13",
        initialQuantity: 1,
        reorderPoint: 1,
        supplierId: "11111111-1111-4111-8111-111111111111",
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("TENANT_ACCESS_DENIED");
  });

  it("rejects missing supplierId on product creation", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-MISS-SUP-001",
        name: "Missing supplier product",
        category: "PPE",
        unitOfMeasure: "box",
        defaultUnitCostCents: 1000,
        barcodeValue: "9999999999994",
        barcodeFormat: "ean13",
        initialQuantity: 1,
        reorderPoint: 1,
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid supplierId on product creation", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const response = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "VRV-BAD-SUP-001",
        name: "Invalid supplier product",
        category: "PPE",
        unitOfMeasure: "box",
        defaultUnitCostCents: 1000,
        barcodeValue: "9999999999995",
        barcodeFormat: "ean13",
        initialQuantity: 1,
        reorderPoint: 1,
        supplierId: "99999999-9999-4999-8999-999999999999",
      });

    const body = response.body as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_SUPPLIER");
  });
});
