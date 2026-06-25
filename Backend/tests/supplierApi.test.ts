/**
 * Supplier API tests — Sprint O
 *
 * Covers:
 *   GET  /api/v1/suppliers               — list
 *   POST /api/v1/suppliers               — create
 *   GET  /api/v1/suppliers/:id           — get by id
 *   PATCH /api/v1/suppliers/:id          — update
 *   RBAC — clinical_staff denied write access
 *   Validation — missing required fields, duplicate code
 *   Not found — 404 on unknown supplierId
 */
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type Supplier = {
  id: string;
  supplierName: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // Sprint 4C metadata
  legalName: string | null;
  tradingName: string | null;
  countryCode: string;
  currencyCode: string;
  industryCategory: string | null;
  healthcareSubcategory: string | null;
  supplierCategory: string | null;
  verified: boolean;
  apiAvailable: boolean;
  catalogueAvailable: boolean;
  livePricing: boolean;
  onlineOrdering: boolean;
  preferredCommMethod: string | null;
  logoStorageKey: string | null;
  createdByClinicId: string | null;
  isPublic: boolean;
};

// ─── List ──────────────────────────────────────────────────────────────────────

describe("GET /api/v1/suppliers — list", () => {
  it("returns an empty array when no suppliers exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<Supplier[]>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("filters by active=true", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create then deactivate a supplier
    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Active Supplies Co" });
    expect(created.status).toBe(201);
    const createdId = (created.body as ApiData<Supplier>).data.id;

    const deactivated = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Inactive Supplies Co" });
    expect(deactivated.status).toBe(201);
    const inactiveId = (deactivated.body as ApiData<Supplier>).data.id;

    await request(app)
      .patch(`/api/v1/suppliers/${inactiveId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });

    const res = await request(app)
      .get("/api/v1/suppliers?active=true")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<Supplier[]>;
    expect(body.data.some((s) => s.id === createdId)).toBe(true);
    expect(body.data.some((s) => s.id === inactiveId)).toBe(false);
  });

  it("requires authentication", async () => {
    const app = await createTestApp();
    const res = await request(app).get("/api/v1/suppliers");
    expect(res.status).toBe(401);
  });
});

// ─── Create ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/suppliers — create", () => {
  it("creates a supplier with full details", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierName: "Dental Direct Pty Ltd",
        supplierCode: "DD001",
        contactName: "Jane Smith",
        email: "jane@dentaldirect.com.au",
        phone: "+61 2 1234 5678",
        website: "https://dentaldirect.com.au",
        notes: "Preferred glove supplier",
      });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.supplierName).toBe("Dental Direct Pty Ltd");
    expect(body.data.supplierCode).toBe("DD001");
    expect(body.data.email).toBe("jane@dentaldirect.com.au");
    expect(body.data.active).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.createdAt).toBeDefined();
  });

  it("creates a minimal supplier (name only)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Minimal Supplier" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.supplierName).toBe("Minimal Supplier");
    expect(body.data.supplierCode).toBeNull();
  });

  it("returns 409 when supplier code already exists", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Supplier One", supplierCode: "DUPE" });

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Supplier Two", supplierCode: "DUPE" });

    expect(res.status).toBe(409);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 400 when supplierName is missing", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierCode: "ABC" });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid email", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Bad Email Supplier", email: "not-an-email" });

    expect(res.status).toBe(400);
  });

  it("denies clinical_staff from creating suppliers", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ supplierName: "Should Be Denied" });

    expect(res.status).toBe(403);
  });
});

// ─── Get by ID ─────────────────────────────────────────────────────────────────

describe("GET /api/v1/suppliers/:supplierId — get", () => {
  it("returns the supplier", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Lookup Test Supplier" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .get(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.id).toBe(supplierId);
    expect(body.data.supplierName).toBe("Lookup Test Supplier");
  });

  it("returns 404 for unknown supplierId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/suppliers/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-UUID supplierId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/suppliers/not-a-uuid")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

// ─── Update ────────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/suppliers/:supplierId — update", () => {
  it("updates supplier fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Original Name" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Updated Name", notes: "Updated notes" });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.supplierName).toBe("Updated Name");
    expect(body.data.notes).toBe("Updated notes");
  });

  it("deactivates a supplier", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "To Deactivate" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.active).toBe(false);
  });

  it("returns 404 for unknown supplierId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch("/api/v1/suppliers/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for unrecognised body fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Strict Test" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ unknownField: "should fail" });

    expect(res.status).toBe(400);
  });

  it("denies clinical_staff from updating suppliers", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ supplierName: "RBAC Test Supplier" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ supplierName: "Should Fail" });

    expect(res.status).toBe(403);
  });
});

// ─── Sprint 4C — Supplier Master metadata ────────────────────────────────────

describe("POST /api/v1/suppliers — create with Sprint 4C metadata", () => {
  it("creates supplier with full enterprise metadata", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierName: "Metro Dental Supplies Pty Ltd",
        legalName: "Metro Dental Holdings Pty Ltd",
        tradingName: "Metro Dental",
        countryCode: "AU",
        currencyCode: "AUD",
        supplierCategory: "Dental Consumables",
        industryCategory: "Healthcare",
        healthcareSubcategory: "Dental",
        verified: true,
        catalogueAvailable: true,
        apiAvailable: false,
        livePricing: false,
        onlineOrdering: false,
        isPublic: true,
      });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.supplierName).toBe("Metro Dental Supplies Pty Ltd");
    expect(body.data.legalName).toBe("Metro Dental Holdings Pty Ltd");
    expect(body.data.tradingName).toBe("Metro Dental");
    expect(body.data.countryCode).toBe("AU");
    expect(body.data.currencyCode).toBe("AUD");
    expect(body.data.supplierCategory).toBe("Dental Consumables");
    expect(body.data.verified).toBe(true);
    expect(body.data.catalogueAvailable).toBe(true);
    expect(body.data.isPublic).toBe(true);
  });

  it("creates supplier without metadata — defaults are applied", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Minimal Metadata Supplier" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.legalName).toBeNull();
    expect(body.data.tradingName).toBeNull();
    expect(body.data.countryCode).toBe("AU");
    expect(body.data.currencyCode).toBe("AUD");
    expect(body.data.verified).toBe(false);
    expect(body.data.apiAvailable).toBe(false);
    expect(body.data.catalogueAvailable).toBe(false);
    expect(body.data.livePricing).toBe(false);
    expect(body.data.onlineOrdering).toBe(false);
    expect(body.data.isPublic).toBe(true);
    expect(body.data.supplierCategory).toBeNull();
    expect(body.data.industryCategory).toBeNull();
    expect(body.data.preferredCommMethod).toBeNull();
  });
});

describe("PATCH /api/v1/suppliers/:supplierId — update Sprint 4C metadata", () => {
  it("updates enterprise metadata fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Metadata Update Test" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        legalName: "Updated Legal Name Pty Ltd",
        supplierCategory: "Lab Equipment",
        verified: true,
        catalogueAvailable: true,
      });

    expect(res.status).toBe(200);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.legalName).toBe("Updated Legal Name Pty Ltd");
    expect(body.data.supplierCategory).toBe("Lab Equipment");
    expect(body.data.verified).toBe(true);
    expect(body.data.catalogueAvailable).toBe(true);
  });

  it("can set metadata fields back to null", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierName: "Nullable Metadata Test",
        legalName: "Temp Legal Name",
      });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ legalName: null });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.legalName).toBeNull();
  });

  it("list and get responses include metadata fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierName: "Include Metadata In List",
        supplierCategory: "Orthodontics",
        verified: true,
      });

    const listRes = await request(app)
      .get("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const listBody = listRes.body as ApiData<Supplier[]>;
    const found = listBody.data.find((s) => s.supplierName === "Include Metadata In List");
    expect(found).toBeDefined();
    expect(found?.supplierCategory).toBe("Orthodontics");
    expect(found?.verified).toBe(true);
    expect(found?.countryCode).toBe("AU");
  });
});
