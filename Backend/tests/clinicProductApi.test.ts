/**
 * Clinic Product Maintenance API — Sprint 2.0 regression tests.
 *
 * Covers:
 *  1. PATCH /clinics/:clinicId/products/:inventoryItemId
 *     - Updates reorder point
 *     - Updates preferred supplier
 *     - Rejects clinical_staff (403)
 *     - Rejects invalid reorderPoint (400)
 *     - Rejects empty body (400)
 *     - Rejects unauthenticated requests (401)
 *  2. GET /master-products/categories
 *     - Returns canonical category list
 *     - Does NOT include "Imported Catalogue"
 */

import request from "supertest";
import type { Express } from "express";

import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import { SEED_CLINIC_INVENTORY_IDS } from "../src/repositories/seed/inventorySeed.js";
import { MASTER_PRODUCT_CATEGORIES } from "../src/types/inventory.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

const GLOVES_ITEM_ID = SEED_CLINIC_INVENTORY_IDS.clinicAGloves;

describe("Clinic Product Maintenance API", () => {
  // ── PATCH /clinics/:clinicId/products/:inventoryItemId ─────────────────────

  describe("PATCH /clinics/:clinicId/products/:inventoryItemId", () => {
    it("allows owner_admin to update reorder point", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 15 });

      expect(response.status).toBe(200);
      const body = response.body as ApiData<{ clinicItem: { reorderPoint: number } }>;
      expect(body.data.clinicItem.reorderPoint).toBe(15);
    });

    it("allows group_practice_manager to update reorder point", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 7 });

      expect(response.status).toBe(200);
      const body = response.body as ApiData<{ clinicItem: { reorderPoint: number } }>;
      expect(body.data.clinicItem.reorderPoint).toBe(7);
    });

    it("returns full clinic item view after reorder point update", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 20 });

      expect(response.status).toBe(200);
      const body = response.body as ApiData<{
        clinicItem: {
          id: string;
          reorderPoint: number;
          name: string;
          category: string;
          masterSku: string;
        };
      }>;
      expect(body.data.clinicItem.id).toBe(GLOVES_ITEM_ID);
      expect(body.data.clinicItem.reorderPoint).toBe(20);
      expect(body.data.clinicItem.name).toBeTruthy();
      expect(body.data.clinicItem.category).toBeTruthy();
      expect(body.data.clinicItem.masterSku).toBeTruthy();
    });

    it("allows updating preferred supplier", async () => {
      const app = await createTestApp();
      const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      // Create a supplier to use as preferred
      const supplierResponse = await request(app)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ supplierName: "Preferred Supplier for Test" });
      expect(supplierResponse.status).toBe(201);
      const supplierId = (supplierResponse.body as ApiData<{ id: string }>).data.id;

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ supplierId });

      expect(response.status).toBe(200);
      const body = response.body as ApiData<{
        clinicItem: { preferredSupplierId: string | null };
      }>;
      expect(body.data.clinicItem.preferredSupplierId).toBe(supplierId);
    });

    it("rejects clinical_staff with 403", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 5 });

      const body = response.body as ApiError;
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("rejects unauthenticated request with 401", async () => {
      const app = await createTestApp();

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .send({ reorderPoint: 5 });

      expect(response.status).toBe(401);
    });

    it("rejects negative reorderPoint with 400", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: -1 });

      expect(response.status).toBe(400);
    });

    it("rejects non-integer reorderPoint with 400", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 3.5 });

      expect(response.status).toBe(400);
    });

    it("rejects empty body (no fields) with 400", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it("rejects cross-clinic update with 403", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      // Use clinic B inventory item ID while authenticated as clinic A manager
      const clinicBItemId = SEED_CLINIC_INVENTORY_IDS.clinicBGloves;

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${clinicBItemId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reorderPoint: 10 });

      // clinicBItemId does not belong to clinic A → service returns 404
      expect([403, 404]).toContain(response.status);
    });

    it("rejects invalid supplier UUID with 400", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierId: "not-a-uuid" });

      expect(response.status).toBe(400);
    });
  });

  // ── GET /master-products/categories ───────────────────────────────────────

  describe("GET /master-products/categories", () => {
    it("returns the canonical category list when authenticated", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const response = await request(app)
        .get("/api/v1/master-products/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as ApiData<string[]>;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("returns all canonical categories in the expected constant", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .get("/api/v1/master-products/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as ApiData<string[]>;
      // Every item in MASTER_PRODUCT_CATEGORIES must appear in the response
      for (const cat of MASTER_PRODUCT_CATEGORIES) {
        expect(body.data).toContain(cat);
      }
    });

    it("does NOT include 'Imported Catalogue' in the category list", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const response = await request(app)
        .get("/api/v1/master-products/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as ApiData<string[]>;
      expect(body.data).not.toContain("Imported Catalogue");
    });

    it("requires authentication (401 when no token)", async () => {
      const app = await createTestApp();

      const response = await request(app)
        .get("/api/v1/master-products/categories");

      expect(response.status).toBe(401);
    });

    it("is accessible to clinical_staff (read-only endpoint)", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const response = await request(app)
        .get("/api/v1/master-products/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });

  // ── Category validation on POST /clinics/:id/products ─────────────────────
  // Tests 7–11: backend rejects invalid categories and accepts valid ones.
  // Note (Test 13): these tests run against the live DB.  They do NOT update
  // historical products categorised as "Uncategorised" or "Imported Catalogue"
  // — those records remain unchanged (no bulk migration).

  describe("POST /clinics/:clinicId/products — category validation", () => {
    const VALID_PRODUCT_BASE = {
      sku: `TEST-CAT-${String(Date.now())}`,
      name: "Category Validation Product",
      category: "Consumables",
      stockUnit: "unit",
      receivingUnit: "unit",
      unitsPerReceivingUnit: 1,
      defaultUnitCostCents: 1000,
      barcodeValue: `9300000${String(Date.now()).slice(-6)}`,
      barcodeFormat: "ean13",
      initialQuantity: 0,
      reorderPoint: 0,
    };

    let app: Express;
    let supplierId: string;
    let adminToken: string;

    beforeAll(async () => {
      app = await createTestApp();
      adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      // Create a test supplier once for this suite
      const supRes = await request(app)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ supplierName: "Cat-Validation-Supplier" });
      supplierId = (supRes.body as ApiData<{ id: string }>).data.id;
    });

    function productPayload(category: string, skuSuffix = "") {
      return {
        ...VALID_PRODUCT_BASE,
        sku: `TEST-CAT-${String(Date.now())}${skuSuffix}`,
        barcodeValue: `93000${String(Date.now()).slice(-8)}${skuSuffix.slice(0, 2)}`,
        category,
        supplierId,
      };
    }

    // Test 11 — accepts valid canonical category
    it("accepts a valid canonical category (Consumables)", async () => {
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(productPayload("Consumables", "a"));

      expect(res.status).toBe(201);
      const body = res.body as ApiData<{ masterItem: { category: string } }>;
      expect(body.data.masterItem.category).toBe("Consumables");
    });

    // Test 7 — rejects missing category
    it("rejects empty category with 400", async () => {
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(productPayload("", "b"));

      expect(res.status).toBe(400);
    });

    // Test 8 — rejects "Imported Catalogue"
    it("rejects 'Imported Catalogue' category with 400", async () => {
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(productPayload("Imported Catalogue", "c"));

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    // Test 9 — rejects "Uncategorised"
    it("rejects 'Uncategorised' category with 400", async () => {
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(productPayload("Uncategorised", "d"));

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    // Test 10 — rejects arbitrary non-canonical category
    it("rejects arbitrary free-text category with 400", async () => {
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(productPayload("My Custom Category", "e"));

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    // Test 13 — categories API returns no "Uncategorised"
    it("GET /master-products/categories does not include 'Uncategorised'", async () => {
      const res = await request(app)
        .get("/api/v1/master-products/categories")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiData<string[]>;
      expect(body.data).not.toContain("Uncategorised");
      expect(body.data).not.toContain("Imported Catalogue");
    });
  });

  // ── Preferred Supplier regression — Bugs 1 & 2 ────────────────────────────
  // Bug 1: PATCH with a supplierId that has never been in product_suppliers
  //        previously threw HTTP 500 (ON CONFLICT clause had no matching
  //        unique constraint).  These tests confirm 200 is returned and the
  //        correct preferredSupplierId is reflected.
  //
  // Bug 2: OCR product creation did not create a product_suppliers row, so
  //        preferredSupplierId was always null after import.

  describe("Preferred Supplier integration (Bug 1 & 2 regression)", () => {
    it("PATCH sets preferred supplier to a brand-new supplier (was HTTP 500)", async () => {
      const testApp = await createTestApp();
      const token = await loginAndGetAccessToken(testApp, "admin@clinic-a.au");

      // Create a supplier that has never been linked to this product
      const supplierRes = await request(testApp)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierName: "Bug1 Fresh Supplier" });
      expect(supplierRes.status).toBe(201);
      const freshSupplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

      // PATCH preferred supplier — previously returned 500, must now return 200
      const patchRes = await request(testApp)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierId: freshSupplierId });

      expect(patchRes.status).toBe(200);
      const body = patchRes.body as ApiData<{
        clinicItem: { preferredSupplierId: string | null; preferredSupplierName: string | null };
      }>;
      expect(body.data.clinicItem.preferredSupplierId).toBe(freshSupplierId);
    });

    it("PATCH updates preferred supplier when product already has a different preferred supplier", async () => {
      const testApp = await createTestApp();
      const token = await loginAndGetAccessToken(testApp, "admin@clinic-a.au");

      const s1Res = await request(testApp)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierName: "Bug1 Supplier A" });
      expect(s1Res.status).toBe(201);
      const suppA = (s1Res.body as ApiData<{ id: string }>).data.id;

      const s2Res = await request(testApp)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierName: "Bug1 Supplier B" });
      expect(s2Res.status).toBe(201);
      const suppB = (s2Res.body as ApiData<{ id: string }>).data.id;

      // Set supplier A as preferred first
      const patchA = await request(testApp)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierId: suppA });
      expect(patchA.status).toBe(200);
      expect(
        (patchA.body as ApiData<{ clinicItem: { preferredSupplierId: string | null } }>).data.clinicItem.preferredSupplierId,
      ).toBe(suppA);

      // Now switch to supplier B — verifies clearing the old preferred flag
      const patchB = await request(testApp)
        .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products/${GLOVES_ITEM_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierId: suppB });
      expect(patchB.status).toBe(200);
      expect(
        (patchB.body as ApiData<{ clinicItem: { preferredSupplierId: string | null } }>).data.clinicItem.preferredSupplierId,
      ).toBe(suppB);
    });

    it("manual product creation sets preferred supplier on the created item", async () => {
      const testApp = await createTestApp();
      const token = await loginAndGetAccessToken(testApp, "admin@clinic-a.au");

      const supplierRes = await request(testApp)
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${token}`)
        .send({ supplierName: "Manual Creation Supplier" });
      expect(supplierRes.status).toBe(201);
      const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

      const ts = String(Date.now());
      const createRes = await request(testApp)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/products`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          sku: `PREF-SUP-${ts}`,
          name: "Preferred Supplier Test Product",
          category: "Consumables",
          stockUnit: "Each",
          receivingUnit: "Box",
          unitsPerReceivingUnit: 10,
          defaultUnitCostCents: 500,
          barcodeValue: `930${ts.slice(-10)}`,
          barcodeFormat: "ean13",
          initialQuantity: 0,
          reorderPoint: 5,
          supplierId,
        });

      expect(createRes.status).toBe(201);
      const body = createRes.body as ApiData<{
        clinicItem: { preferredSupplierId: string | null };
      }>;
      expect(body.data.clinicItem.preferredSupplierId).toBe(supplierId);
    });
  });
});
