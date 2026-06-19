/**
 * Supplier Catalogue API tests — Sprint O
 *
 * Covers:
 *   GET    /api/v1/suppliers/:id/catalogue               — list pricing
 *   POST   /api/v1/suppliers/:id/catalogue               — add price entry
 *   GET    /api/v1/suppliers/:id/catalogue/:entryId      — get entry
 *   PATCH  /api/v1/suppliers/:id/catalogue/:entryId      — update entry
 *   GET    /api/v1/suppliers/products/:productId/pricing — cross-supplier lookup
 *   RBAC, validation, conflict handling
 */
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import { buildMasterCatalogSeed } from "../src/repositories/seed/inventorySeed.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type SupplierEntry = {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  unitCostCents: number;
  unitOfMeasure: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

async function createSupplier(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  name = "Test Supplier",
) {
  const res = await request(app)
    .post("/api/v1/suppliers")
    .set("Authorization", `Bearer ${token}`)
    .send({ supplierName: name });
  expect(res.status).toBe(201);
  return (res.body as ApiData<{ id: string }>).data.id;
}

// ─── List supplier products ────────────────────────────────────────────────────

describe("GET /api/v1/suppliers/:id/catalogue — list", () => {
  it("returns empty array when no entries exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const res = await request(app)
      .get(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<SupplierEntry[]>).data).toHaveLength(0);
  });
});

// ─── Create supplier product ───────────────────────────────────────────────────

describe("POST /api/v1/suppliers/:id/catalogue — create", () => {
  it("creates a pricing entry for a valid product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    // Use a known seed product
    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items available");
    const productId = firstItem.id;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId,
        supplierSku: "SUPP-001",
        supplierDescription: "Nitrile Gloves Box/100",
        unitCostCents: 1250,
        unitOfMeasure: "BOX",
      });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<SupplierEntry>;
    expect(body.data.supplierId).toBe(supplierId);
    expect(body.data.productId).toBe(productId);
    expect(body.data.unitCostCents).toBe(1250);
    expect(body.data.supplierSku).toBe("SUPP-001");
    expect(body.data.active).toBe(true);
  });

  it("returns 409 when active entry already exists for the same product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1000 });

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1100 });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("CONFLICT");
  });

  it("returns 404 when product does not exist in master catalog", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId: "00000000-0000-0000-0000-000000000000",
        unitCostCents: 500,
      });

    expect(res.status).toBe(404);
  });

  it("returns 400 for negative unitCostCents", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: -1 });

    expect(res.status).toBe(400);
  });

  it("denies clinical_staff", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const supplierId = await createSupplier(app, managerToken);

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    const res = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ productId, unitCostCents: 500 });

    expect(res.status).toBe(403);
  });
});

// ─── Update supplier product ───────────────────────────────────────────────────

describe("PATCH /api/v1/suppliers/:id/catalogue/:entryId — update", () => {
  it("updates unitCostCents", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    const created = await request(app)
      .post(`/api/v1/suppliers/${supplierId}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1000 });
    const entryId = (created.body as ApiData<SupplierEntry>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}/catalogue/${entryId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ unitCostCents: 1100 });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<SupplierEntry>).data.unitCostCents).toBe(1100);
  });

  it("returns 404 for unknown entry", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const supplierId = await createSupplier(app, token);

    const res = await request(app)
      .patch(
        `/api/v1/suppliers/${supplierId}/catalogue/00000000-0000-0000-0000-000000000000`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ unitCostCents: 999 });

    expect(res.status).toBe(404);
  });
});

// ─── Cross-supplier pricing lookup ────────────────────────────────────────────

describe("GET /api/v1/suppliers/products/:productId/pricing — cross-supplier", () => {
  it("returns pricing from multiple suppliers", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const supplierA = await createSupplier(app, token, "Supplier A");
    const supplierB = await createSupplier(app, token, "Supplier B");
    const supplierC = await createSupplier(app, token, "Supplier C");

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    await request(app)
      .post(`/api/v1/suppliers/${supplierA}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1250 });
    await request(app)
      .post(`/api/v1/suppliers/${supplierB}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1320 });
    await request(app)
      .post(`/api/v1/suppliers/${supplierC}/catalogue`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, unitCostCents: 1195 });

    const res = await request(app)
      .get(`/api/v1/suppliers/products/${productId}/pricing`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<SupplierEntry[]>;
    expect(body.data).toHaveLength(3);
    const costs = body.data.map((e) => e.unitCostCents).sort((a, b) => a - b);
    expect(costs).toEqual([1195, 1250, 1320]);
  });

  it("returns empty array when no pricing exists for a product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const seedItems = buildMasterCatalogSeed();
    const firstItem = seedItems[0];
    if (!firstItem) throw new Error("No seed items");
    const productId = firstItem.id;

    const res = await request(app)
      .get(`/api/v1/suppliers/products/${productId}/pricing`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<SupplierEntry[]>).data).toHaveLength(0);
  });
});
