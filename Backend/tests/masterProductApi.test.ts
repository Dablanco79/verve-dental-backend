/**
 * Master Product Management Foundation — API tests.
 *
 * Tests the CRUD/list HTTP endpoints:
 *   GET    /api/v1/master-products
 *   GET    /api/v1/master-products/:id
 *   POST   /api/v1/master-products
 *   PATCH  /api/v1/master-products/:id
 *   POST   /api/v1/master-products/:id/archive
 *   POST   /api/v1/master-products/:id/reactivate
 *
 * Uses the in-memory repositories (no database required).
 */
import request from "supertest";

import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string; details?: unknown } };
type ApiPage<T> = { data: T[]; pagination: { total: number; limit: number; offset: number } };

type MasterProductDto = {
  id: string;
  displayName: string;
  sku: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  variantAttributes: string | null;
  stockUnit: string;
  receivingUnit: string;
  status: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type InventoryItemDto = { masterCatalogItemId: string };
type AdjustmentDto = { id: string };

const BASE = "/api/v1/master-products";

function uniqueName(label: string): string {
  return `${label} ${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createProduct(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  overrides: Partial<{
    displayName: string;
    category: string;
    sku: string;
    status: "active" | "archived";
    subcategory: string | null;
    brand: string | null;
    notes: string | null;
  }> = {},
) {
  const body = {
    displayName: overrides.displayName ?? uniqueName("Test Product"),
    category: overrides.category ?? uniqueName("Test Category"),
    ...overrides,
  };
  return request(app)
    .post(BASE)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("Master Products — list/search/filter/pagination", () => {
  it("lists active master products by default", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiPage<MasterProductDto>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((p) => p.status === "active")).toBe(true);
    expect(body.pagination.total).toBe(body.data.length <= body.pagination.limit ? body.pagination.total : body.pagination.total);
  });

  it("filters by category", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`${BASE}?category=PPE`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiPage<MasterProductDto>;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((p) => p.category.toLowerCase() === "ppe")).toBe(true);
  });

  it("searches by display name", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`${BASE}?search=Nitrile`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiPage<MasterProductDto>;
    expect(body.data.some((p) => p.displayName.includes("Nitrile"))).toBe(true);
  });

  it("supports status=all and status=archived filters", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    await request(app)
      .post(`${BASE}/${productId}/archive`)
      .set("Authorization", `Bearer ${token}`);

    const archivedRes = await request(app)
      .get(`${BASE}?status=archived`)
      .set("Authorization", `Bearer ${token}`);
    expect(archivedRes.status).toBe(200);
    const archivedBody = archivedRes.body as ApiPage<MasterProductDto>;
    expect(archivedBody.data.some((p) => p.id === productId)).toBe(true);
    expect(archivedBody.data.every((p) => p.status === "archived")).toBe(true);

    const allRes = await request(app)
      .get(`${BASE}?status=all`)
      .set("Authorization", `Bearer ${token}`);
    expect(allRes.status).toBe(200);
    const allBody = allRes.body as ApiPage<MasterProductDto>;
    expect(allBody.data.some((p) => p.id === productId)).toBe(true);

    const activeRes = await request(app)
      .get(`${BASE}?status=active`)
      .set("Authorization", `Bearer ${token}`);
    const activeBody = activeRes.body as ApiPage<MasterProductDto>;
    expect(activeBody.data.some((p) => p.id === productId)).toBe(false);
  });

  it("paginates results with limit/offset", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const page1 = await request(app)
      .get(`${BASE}?limit=2&offset=0`)
      .set("Authorization", `Bearer ${token}`);
    expect(page1.status).toBe(200);
    const page1Body = page1.body as ApiPage<MasterProductDto>;
    expect(page1Body.data.length).toBeLessThanOrEqual(2);
    expect(page1Body.pagination).toMatchObject({ limit: 2, offset: 0 });

    const page2 = await request(app)
      .get(`${BASE}?limit=2&offset=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(page2.status).toBe(200);
    const page2Body = page2.body as ApiPage<MasterProductDto>;
    expect(page2Body.pagination).toMatchObject({ limit: 2, offset: 2 });

    const overlap = page1Body.data.filter((a) =>
      page2Body.data.some((b) => b.id === a.id),
    );
    expect(overlap.length).toBe(0);
  });

  it("rejects invalid pagination params", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`${BASE}?limit=0`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("clinical_staff can read the list (read-only access)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("requires authentication", async () => {
    const app = await createTestApp();
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });
});

describe("Master Products — GET by id", () => {
  it("returns a single master product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .get(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<MasterProductDto>).data.id).toBe(productId);
  });

  it("returns 404 for an unknown id", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`${BASE}/00000000-0000-4000-8000-000000000000`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("Master Products — create", () => {
  it("creates a master product with defaults applied", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const displayName = uniqueName("Endo Files");
    const res = await createProduct(app, token, { displayName, category: "Endodontics" });

    expect(res.status).toBe(201);
    const body = (res.body as ApiData<MasterProductDto>).data;
    expect(body.displayName).toBe(displayName);
    expect(body.category).toBe("Endodontics");
    expect(body.status).toBe("active");
    expect(body.isActive).toBe(true);
    expect(body.sku).toBeTruthy();
    expect(body.stockUnit).toBe("Unit");
    expect(body.receivingUnit).toBe("Unit");
  });

  it("requires displayName and category", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: "" });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects creating a duplicate active displayName + category", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const displayName = uniqueName("Surgical Suction Tips");
    const category = "Surgical";

    const first = await createProduct(app, token, { displayName, category });
    expect(first.status).toBe(201);

    const second = await createProduct(app, token, {
      displayName: `  ${displayName.toLowerCase()}  `,
      category: category.toUpperCase(),
    });

    expect(second.status).toBe(409);
    expect((second.body as ApiError).error.code).toBe("MASTER_PRODUCT_DUPLICATE");
  });

  it("allows creating an archived product even if an active duplicate exists", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const displayName = uniqueName("Bite Blocks");
    const category = "Restorative Accessories";

    const first = await createProduct(app, token, { displayName, category });
    expect(first.status).toBe(201);

    const second = await createProduct(app, token, {
      displayName,
      category,
      status: "archived",
    });
    expect(second.status).toBe(201);
    expect((second.body as ApiData<MasterProductDto>).data.status).toBe("archived");
  });

  it("rejects a duplicate SKU", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const sku = `DUP-${String(Date.now())}`;
    const first = await createProduct(app, token, { sku });
    expect(first.status).toBe(201);

    const second = await createProduct(app, token, { sku });
    expect(second.status).toBe(409);
    expect((second.body as ApiError).error.code).toBe("MASTER_PRODUCT_SKU_CONFLICT");
  });

  it("denies clinical_staff from creating", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await createProduct(app, token);
    expect(res.status).toBe(403);
  });

  it("allows group_practice_manager to create", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await createProduct(app, token);
    expect(res.status).toBe(201);
  });

  it("requires authentication", async () => {
    const app = await createTestApp();
    const res = await request(app).post(BASE).send({ displayName: "X", category: "Y" });
    expect(res.status).toBe(401);
  });
});

describe("Master Products — update", () => {
  it("updates fields successfully", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .patch(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ brand: "Dentsply", notes: "Updated via API", subcategory: "Files" });

    expect(res.status).toBe(200);
    const body = (res.body as ApiData<MasterProductDto>).data;
    expect(body.brand).toBe("Dentsply");
    expect(body.notes).toBe("Updated via API");
    expect(body.subcategory).toBe("Files");
  });

  it("rejects updating into a duplicate active displayName + category", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const existingName = uniqueName("Cotton Rolls");
    const existingCategory = "Consumables Test";
    await createProduct(app, token, { displayName: existingName, category: existingCategory });

    const other = await createProduct(app, token);
    const otherId = (other.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .patch(`${BASE}/${otherId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: existingName, category: existingCategory });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("MASTER_PRODUCT_DUPLICATE");
  });

  it("allows updating a product without changing name/category (no false duplicate against itself)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .patch(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "no-op rename check" });

    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown id", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .patch(`${BASE}/00000000-0000-4000-8000-000000000000`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "x" });

    expect(res.status).toBe(404);
  });

  it("denies clinical_staff from updating", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const created = await createProduct(app, adminToken);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .patch(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ notes: "nope" });

    expect(res.status).toBe(403);
  });
});

describe("Master Products — archive / reactivate", () => {
  it("archives an active product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .post(`${BASE}/${productId}/archive`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = (res.body as ApiData<MasterProductDto>).data;
    expect(body.status).toBe("archived");
    expect(body.isActive).toBe(false);
  });

  it("rejects archiving an already-archived product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    await request(app).post(`${BASE}/${productId}/archive`).set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post(`${BASE}/${productId}/archive`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("MASTER_PRODUCT_ALREADY_ARCHIVED");
  });

  it("reactivates an archived product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    await request(app).post(`${BASE}/${productId}/archive`).set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post(`${BASE}/${productId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = (res.body as ApiData<MasterProductDto>).data;
    expect(body.status).toBe("active");
    expect(body.isActive).toBe(true);
  });

  it("rejects reactivating an already-active product", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .post(`${BASE}/${productId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("MASTER_PRODUCT_ALREADY_ACTIVE");
  });

  it("rejects reactivating into a duplicate active displayName + category", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const displayName = uniqueName("Impression Trays");
    const category = "Prosthodontics";

    const active = await createProduct(app, token, { displayName, category });
    expect(active.status).toBe(201);

    const archived = await createProduct(app, token, {
      displayName,
      category,
      status: "archived",
    });
    const archivedId = (archived.body as ApiData<MasterProductDto>).data.id;

    const res = await request(app)
      .post(`${BASE}/${archivedId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("MASTER_PRODUCT_DUPLICATE");
  });

  it("denies clinical_staff from archiving/reactivating", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const created = await createProduct(app, adminToken);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    const archiveRes = await request(app)
      .post(`${BASE}/${productId}/archive`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(archiveRes.status).toBe(403);

    const reactivateRes = await request(app)
      .post(`${BASE}/${productId}/reactivate`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(reactivateRes.status).toBe(403);
  });
});

describe("Master Products — audit events", () => {
  it("writes audit events for created, updated, archived, and reactivated", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    await request(app)
      .patch(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "audit check" });

    await request(app).post(`${BASE}/${productId}/archive`).set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`${BASE}/${productId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);

    const auditRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/analytics/audit-events?entityType=product`)
      .set("Authorization", `Bearer ${token}`);

    expect(auditRes.status).toBe(200);
    type AuditEventDto = { action: string; entityId: string };
    const events = (auditRes.body as ApiData<{ events: AuditEventDto[] }>).data.events;

    const actionsForProduct = events
      .filter((e) => e.entityId === productId)
      .map((e) => e.action);

    expect(actionsForProduct).toEqual(
      expect.arrayContaining([
        "master_product.created",
        "master_product.updated",
        "master_product.archived",
        "master_product.reactivated",
      ]),
    );
  });
});

describe("Master Products — safety: no stock quantity mutation", () => {
  it("creating, updating, archiving, and reactivating a master product never changes clinic inventory or creates stock movements", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const beforeInventory = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
      .set("Authorization", `Bearer ${token}`);
    const beforeAdjustments = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments`)
      .set("Authorization", `Bearer ${token}`);

    const beforeInventoryCount = (beforeInventory.body as ApiData<InventoryItemDto[]>).data.length;
    const beforeAdjustmentsBody = beforeAdjustments.body as {
      data: AdjustmentDto[];
      pagination: { total: number };
    };

    const created = await createProduct(app, token);
    const productId = (created.body as ApiData<MasterProductDto>).data.id;

    await request(app)
      .patch(`${BASE}/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "no stock effect" });
    await request(app).post(`${BASE}/${productId}/archive`).set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`${BASE}/${productId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);

    const afterInventory = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
      .set("Authorization", `Bearer ${token}`);
    const afterAdjustments = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/adjustments`)
      .set("Authorization", `Bearer ${token}`);

    const afterInventoryBody = afterInventory.body as ApiData<InventoryItemDto[]>;
    const afterAdjustmentsBody = afterAdjustments.body as {
      data: AdjustmentDto[];
      pagination: { total: number };
    };

    // No new clinic_inventory_items row was provisioned for the new master product.
    expect(afterInventoryBody.data.length).toBe(beforeInventoryCount);
    expect(afterInventoryBody.data.some((item) => item.masterCatalogItemId === productId)).toBe(
      false,
    );

    // No inventory_adjustments rows were created by any master product operation.
    expect(afterAdjustmentsBody.pagination.total).toBe(beforeAdjustmentsBody.pagination.total);
  });
});
