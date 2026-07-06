/**
 * Master Product Library Import API tests —
 * Master Product Library Import Foundation.
 *
 * Tests the HTTP endpoint:
 *   POST /api/v1/master-products/import
 *
 * Uses multipart/form-data file upload via supertest .attach()
 */
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type ImportRowResult = {
  rowNumber: number;
  displayName: string | null;
  category: string | null;
  outcome: string;
  masterProductId: string | null;
  errors: string[];
};

type ImportResult = {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  clinicId: string | null;
  rows: ImportRowResult[];
};

describe("POST /api/v1/master-products/import", () => {
  it("imports valid rows for an owner_admin (no clinicId)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const csv =
      "display_name,category,subcategory,brand,variant_attributes,default_unit,status,notes\n" +
      "Endo Files 21mm,Endodontics,Files,Dentsply,21mm,Pack,active,Sterile\n";

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<ImportResult>;
    expect(body.data.totalRows).toBe(1);
    expect(body.data.imported).toBe(1);
    expect(body.data.skippedInvalid).toBe(0);
    expect(body.data.rows[0]?.outcome).toBe("imported");
    expect(body.data.rows[0]?.masterProductId).toBeTruthy();
  });

  it("provisions zero-quantity clinic inventory when clinicId is supplied", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    const clinicId = (meRes.body as ApiData<{ homeClinicId: string }>).data.homeClinicId;

    const csv = "display_name,category,default_unit,status\nCotton Rolls,Consumables,Pack,active\n";

    const importRes = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .field("clinicId", clinicId)
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(importRes.status).toBe(200);
    const importBody = importRes.body as ApiData<ImportResult>;
    expect(importBody.data.imported).toBe(1);
    const productId = importBody.data.rows[0]?.masterProductId;
    expect(productId).toBeTruthy();

    const inventoryRes = await request(app)
      .get(`/api/v1/clinics/${clinicId}/inventory`)
      .set("Authorization", `Bearer ${token}`);

    expect(inventoryRes.status).toBe(200);
    const inventoryBody = inventoryRes.body as ApiData<
      Array<{
        masterCatalogItemId: string;
        quantityOnHand: number;
        stockUnit: string;
        receivingUnit: string;
      }>
    >;
    const createdRow = inventoryBody.data.find(
      (item) => item.masterCatalogItemId === productId,
    );
    expect(createdRow).toBeDefined();
    // default_unit ("Pack") must be mapped onto both stockUnit and receivingUnit.
    expect(createdRow?.stockUnit).toBe("Pack");
    expect(createdRow?.receivingUnit).toBe("Pack");
    expect(createdRow?.quantityOnHand).toBe(0);
  });

  it("skips duplicate display_name + category rows", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const csv1 = "display_name,category,status\nSurgical Suction Tips,Surgical,active\n";
    const first = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv1), { filename: "library1.csv", contentType: "text/csv" });
    expect((first.body as ApiData<ImportResult>).data.imported).toBe(1);

    const csv2 = "display_name,category,status\nsurgical  suction tips ,SURGICAL,active\n";
    const second = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv2), { filename: "library2.csv", contentType: "text/csv" });

    expect(second.status).toBe(200);
    const secondBody = second.body as ApiData<ImportResult>;
    expect(secondBody.data.imported).toBe(0);
    expect(secondBody.data.skippedDuplicates).toBe(1);
  });

  it("returns validation results for rows missing required fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const csv = "display_name,category,status\n,Missing Name Category,active\n";

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<ImportResult>;
    expect(body.data.imported).toBe(0);
    expect(body.data.skippedInvalid).toBe(1);
    expect(body.data.rows[0]?.outcome).toBe("skipped_invalid");
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const app = await createTestApp();

    const res = await request(app).post("/api/v1/master-products/import");
    expect(res.status).toBe(401);
  });

  it("denies clinical_staff", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const csv = "display_name,category,status\nGloves,PPE,active\n";

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${staffToken}`)
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(res.status).toBe(403);
  });

  it("allows owner_admin to provision a clinic that is not their home clinic", async () => {
    const app = await createTestApp();
    const ownerToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    // admin@clinic-a.au's home clinic is Clinic A; target Clinic B explicitly
    // to prove owner_admin can provision ANY authorised clinic, not just home.
    const otherClinicId = "22222222-2222-4222-8222-222222222222";
    const csv = "display_name,category,status\nBite Blocks,Restorative,active\n";

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("clinicId", otherClinicId)
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<ImportResult>;
    expect(body.data.imported).toBe(1);
    const productId = body.data.rows[0]?.masterProductId;

    const inventoryRes = await request(app)
      .get(`/api/v1/clinics/${otherClinicId}/inventory`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(inventoryRes.status).toBe(200);
    const inventoryBody = inventoryRes.body as ApiData<
      Array<{ masterCatalogItemId: string; quantityOnHand: number }>
    >;
    const createdRow = inventoryBody.data.find(
      (item) => item.masterCatalogItemId === productId,
    );
    expect(createdRow).toBeDefined();
    expect(createdRow?.quantityOnHand).toBe(0);
  });

  it("denies a group_practice_manager provisioning a clinic they do not belong to", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const csv = "display_name,category,status\nGloves,PPE,active\n";

    const res = await request(app)
      .post("/api/v1/master-products/import")
      .set("Authorization", `Bearer ${token}`)
      .field("clinicId", "00000000-0000-0000-0000-000000000000")
      .attach("file", Buffer.from(csv), { filename: "library.csv", contentType: "text/csv" });

    expect(res.status).toBe(403);
  });
});
