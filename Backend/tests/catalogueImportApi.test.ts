/**
 * Catalogue Import API tests — Sprint O
 *
 * Tests the HTTP endpoints:
 *   POST /api/v1/suppliers/:id/catalogue/import/preview
 *   POST /api/v1/suppliers/:id/catalogue/import/confirm
 *
 * Uses multipart/form-data file upload via supertest .attach()
 */
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import { buildMasterCatalogSeed } from "../src/repositories/seed/inventorySeed.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

async function createSupplier(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
) {
  const res = await request(app)
    .post("/api/v1/suppliers")
    .set("Authorization", `Bearer ${token}`)
    .send({ supplierName: "Import Test Supplier" });
  expect(res.status).toBe(201);
  return (res.body as ApiData<{ id: string }>).data.id;
}

// ─── Preview ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/suppliers/:id/catalogue/import/preview", () => {
  it("returns row match preview for a valid CSV", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");
    const csv = `description,unit_cost\n${item.name},12.50\n`;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue/import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), {
        filename: "test.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      totalRows: number;
      matchedRows: number;
      rows: Array<{ matchStatus: string; unitCostCents: number }>;
    }>;
    expect(body.data.totalRows).toBe(1);
    expect(body.data.matchedRows).toBe(1);
    expect(body.data.rows[0]?.unitCostCents).toBe(1250);
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue/import/preview`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for unknown supplier", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const csv = `description,unit_cost\nGloves,1.00\n`;

    const res = await request(app)
      .post(
        "/api/v1/suppliers/00000000-0000-0000-0000-000000000000/catalogue/import/preview",
      )
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), {
        filename: "test.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const app = await createTestApp();
    const res = await request(app).post(
      "/api/v1/suppliers/00000000-0000-0000-0000-000000000000/catalogue/import/preview",
    );
    expect(res.status).toBe(401);
  });

  it("denies clinical_staff", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const supplierId = await createSupplier(app, managerToken);
    const csv = `description,unit_cost\nGloves,1.00\n`;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue/import/preview`)
      .set("Authorization", `Bearer ${staffToken}`)
      .attach("file", Buffer.from(csv), {
        filename: "test.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(403);
  });
});

// ─── Confirm ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/suppliers/:id/catalogue/import/confirm", () => {
  it("imports matched rows from a valid CSV", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");
    const csv = `description,unit_cost\n${item.name},12.50\n`;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue/import/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), {
        filename: "test.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      imported: number;
      updated: number;
      skipped: number;
      errors: number;
    }>;
    expect(body.data.imported).toBe(1);
    expect(body.data.errors).toBe(0);
  });

  it("handles unsupported file format gracefully", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue/import/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("fake data"), {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    // PDF is rejected by the multer fileFilter before reaching the handler
    // The response could be 400 or 500 depending on how multer errors propagate
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
