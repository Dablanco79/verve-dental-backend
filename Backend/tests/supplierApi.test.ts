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
  abn: string | null;
  address: string | null;
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

// ─── Website normalisation ────────────────────────────────────────────────────

describe("POST /api/v1/suppliers — website normalisation", () => {
  it("1. normalises bare www.domain.com to https://www.domain.com", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Normalise WWW Test", website: "www.piksters.com" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.website).toBe("https://www.piksters.com");
  });

  it("2. normalises bare domain.com to https://domain.com", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Normalise Bare Domain Test", website: "piksters.com" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.website).toBe("https://piksters.com");
  });

  it("3. leaves https://www.piksters.com unchanged", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Https Unchanged Test", website: "https://www.piksters.com" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.website).toBe("https://www.piksters.com");
  });

  it("4. rejects obviously malformed website input (no dot, not a domain)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Malformed Website Test", website: "not a website at all" });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("5. allows null/missing website", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "No Website Test" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.website).toBeNull();
  });

  it("website normalisation also applies on PATCH update", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Patch Website Normalise Test" });
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ website: "oral-care.com.au" });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.website).toBe("https://oral-care.com.au");
  });
});

// ─── ABN duplicate protection ─────────────────────────────────────────────────

describe("POST /api/v1/suppliers — ABN duplicate protection", () => {
  it("8. duplicate normalised ABN returns 409 DUPLICATE_ABN with existing supplier details", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create the first supplier with ABN
    const first = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Piksters Pty Ltd", abn: "81 056 223 897" });
    expect(first.status).toBe(201);
    const firstId = (first.body as ApiData<Supplier>).data.id;

    // Attempt to create a second supplier with the same ABN
    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Erskine Oral Care", abn: "81 056 223 897" });

    expect(res.status).toBe(409);
    const body = res.body as ApiError & { error: { details?: Array<{ field: string; message: string }> } };
    expect(body.error.code).toBe("DUPLICATE_ABN");
    expect(body.error.message).toContain("81 056 223 897");
    const details = body.error.details ?? [];
    const supplierIdDetail = details.find((d) => d.field === "existingSupplierId");
    const supplierNameDetail = details.find((d) => d.field === "existingSupplierName");
    expect(supplierIdDetail?.message).toBe(firstId);
    expect(supplierNameDetail?.message).toBe("Piksters Pty Ltd");
  });

  it("9. differently formatted equivalent ABNs are treated as identical", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create with spaced ABN
    const first = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "ABN Format Test A", abn: "81 056 223 897" });
    expect(first.status).toBe(201);

    // Attempt with no-space ABN (should normalise to same value)
    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "ABN Format Test B", abn: "81056223897" });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("DUPLICATE_ABN");
  });

  it("10. no ABN allows normal supplier creation", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "No ABN Supplier" });

    expect(res.status).toBe(201);
    const body = res.body as ApiData<Supplier>;
    expect(body.data.supplierName).toBe("No ABN Supplier");
    expect(body.data.abn).toBeNull();
  });

  it("11. hyphenated ABN is treated as identical to the spaced/compact form", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const first = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Hyphen ABN Test A", abn: "81 056 223 897" });
    expect(first.status).toBe(201);

    const res = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Hyphen ABN Test B", abn: "81-056-223-897" });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("DUPLICATE_ABN");
  });
});

// ─── ABN duplicate protection on UPDATE ────────────────────────────────────────

describe("PATCH /api/v1/suppliers/:id — ABN duplicate protection", () => {
  it("12. updating a supplier's ABN persists the new value correctly", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "ABN Update Test" });
    expect(created.status).toBe(201);
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ abn: "81 056 223 897" });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.abn).toBe("81 056 223 897");
  });

  it("13. updating ABN to another supplier's equivalent normalised ABN returns 409", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create two suppliers
    const first = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Owner Of ABN", abn: "81 056 223 897" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Would Be Duplicate" });
    expect(second.status).toBe(201);
    const secondId = (second.body as ApiData<Supplier>).data.id;

    // Attempt to PATCH the second supplier to use the same ABN (different format)
    const res = await request(app)
      .patch(`/api/v1/suppliers/${secondId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ abn: "81056223897" });

    expect(res.status).toBe(409);
    expect((res.body as ApiError).error.code).toBe("DUPLICATE_ABN");
  });

  it("14. supplier does not conflict with its own unchanged ABN on update", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Self ABN Test", abn: "81 056 223 897" });
    expect(created.status).toBe(201);
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    // Patching other fields while ABN is unchanged — must not conflict with self
    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Self ABN Test Updated", abn: "81 056 223 897" });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.supplierName).toBe("Self ABN Test Updated");
    expect((res.body as ApiData<Supplier>).data.abn).toBe("81 056 223 897");
  });

  it("15. clearing ABN to null on update is allowed", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const created = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Clear ABN Test", abn: "81 056 223 897" });
    expect(created.status).toBe(201);
    const supplierId = (created.body as ApiData<Supplier>).data.id;

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ abn: null });

    expect(res.status).toBe(200);
    expect((res.body as ApiData<Supplier>).data.abn).toBeNull();
  });
});
