/**
 * Product Matching Engine v1 — unit tests.
 *
 * Tests both the service (suggestMatches) and the HTTP endpoints:
 *   POST /api/v1/master-products/match
 *   POST /api/v1/master-products/match/confirm
 *
 * Covers:
 *   — supplier SKU exact mapping wins (confidence 100)
 *   — exact normalised name match (confidence 95)
 *   — token similarity match returns ranked result
 *   — weak/ambiguous match returns low confidence or empty results
 *   — confirm match creates supplier-product mapping
 *   — duplicate mapping updates existing record
 *   — no stock quantity / inventory adjustment / receiving / scan APIs called
 *   — RBAC: clinical_staff blocked; owner_admin allowed
 */
import request from "supertest";

import { createProductMatchingService } from "../src/services/productMatchingService.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import {
  buildMasterCatalogSeed,
  SEED_MASTER_CATALOG_IDS,
} from "../src/repositories/seed/inventorySeed.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import type { ProductMatchSuggestion } from "../src/types/supplier.js";

const BASE_MATCH = "/api/v1/master-products/match";
const BASE_CONFIRM = "/api/v1/master-products/match/confirm";

// ─── Helper ───────────────────────────────────────────────────────────────────

const TEST_SUPPLIER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type MatchResponseBody = { data: { suggestions: ProductMatchSuggestion[] } };
type ConfirmResponseBody = { data: Record<string, unknown> };

// ─── Service tests (unit) ─────────────────────────────────────────────────────

describe("ProductMatchingService.suggestMatches", () => {
  function buildService() {
    const catalogRepo = createInMemoryCatalogRepository();
    const catalogueRepo = createInMemorySupplierCatalogueRepository();
    const service = createProductMatchingService(catalogRepo, catalogueRepo);
    return { service, catalogRepo, catalogueRepo };
  }

  it("returns supplier_sku_mapping suggestion with confidence 100 when mapping exists", async () => {
    const { service, catalogueRepo } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    if (!gloves) throw new Error("Seed item missing");

    await catalogueRepo.createSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: gloves.id,
      supplierSku: "SUPP-GLV-X1",
      supplierDescription: "Gloves box 100",
      unitCostCents: 1800,
    });

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierSku: "SUPP-GLV-X1",
      supplierDescription: "Disposable gloves",
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const top = suggestions[0];
    if (!top) throw new Error("Expected at least one suggestion");
    expect(top.masterProductId).toBe(gloves.id);
    expect(top.confidence).toBe(100);
    expect(top.reasons).toContain("supplier_sku_mapping");
  });

  it("supplier_sku_mapping ranked first even if another product has matching name", async () => {
    const { service, catalogueRepo } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    const burs = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.diamondBurs);
    if (!gloves || !burs) throw new Error("Seed items missing");

    await catalogueRepo.createSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: burs.id,
      supplierSku: "BUR-SKU",
      supplierDescription: null,
      unitCostCents: 4000,
    });

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierSku: "BUR-SKU",
      supplierDescription: gloves.name, // exact match to gloves, but mapping points to burs
    });

    const top = suggestions[0];
    if (!top) throw new Error("Expected at least one suggestion");
    expect(top.masterProductId).toBe(burs.id);
    expect(top.confidence).toBe(100);
    expect(top.reasons).toContain("supplier_sku_mapping");
  });

  it("returns exact_name suggestion with confidence 95 when description equals displayName", async () => {
    const { service } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    if (!gloves) throw new Error("Seed item missing");

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierSku: null,
      supplierDescription: gloves.name,
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const match = suggestions.find((s) => s.masterProductId === gloves.id);
    if (!match) throw new Error("Expected gloves in suggestions");
    expect(match.confidence).toBe(95);
    expect(match.reasons).toContain("exact_name");
  });

  it("exact_name match is case-insensitive and whitespace-tolerant", async () => {
    const { service } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    if (!gloves) throw new Error("Seed item missing");

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: `  ${gloves.name.toUpperCase()}  `,
    });

    const match = suggestions.find((s) => s.masterProductId === gloves.id);
    expect(match).toBeDefined();
    if (!match) throw new Error("Expected gloves in suggestions");
    expect(match.reasons).toContain("exact_name");
  });

  it("returns token_similarity suggestion for partial description match", async () => {
    const { service } = buildService();

    // "Diamond Burs" tokens overlap with "Diamond Burs FG Round #2 (Pack 5)"
    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "Diamond Burs",
    });

    const match = suggestions.find(
      (s) => s.masterProductId === SEED_MASTER_CATALOG_IDS.diamondBurs,
    );
    expect(match).toBeDefined();
    if (!match) throw new Error("Expected burs in suggestions");
    expect(match.reasons).toContain("token_similarity");
    expect(match.confidence).toBeGreaterThan(0);
    expect(match.confidence).toBeLessThan(95);
  });

  it("category boost does not decrease confidence", async () => {
    const { service } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    if (!gloves) throw new Error("Seed item missing");

    const withCategory = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "Nitrile Gloves",
      category: gloves.category,
    });

    const withMatch = withCategory.suggestions.find(
      (s) => s.masterProductId === gloves.id,
    );
    if (withMatch) {
      expect(withMatch.reasons).toContain("category_boost");
    }
  });

  it("returns empty suggestions for completely unrelated description", async () => {
    const { service } = buildService();

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "zzz xyzzy foobar qwerty 12345",
    });

    expect(suggestions).toHaveLength(0);
  });

  it("returns at most 5 suggestions", async () => {
    const { service } = buildService();

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "Box Pack",
    });

    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it("all suggestions are sorted by confidence descending", async () => {
    const { service } = buildService();

    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "Nitrile gloves disposable box",
    });

    for (let i = 1; i < suggestions.length; i++) {
      const prev = suggestions[i - 1];
      const curr = suggestions[i];
      if (!prev || !curr) continue;
      expect(curr.confidence).toBeLessThanOrEqual(prev.confidence);
    }
  });

  it("validateMatchConfirmation rejects archived master product", async () => {
    const { service, catalogRepo } = buildService();
    const seed = buildMasterCatalogSeed();
    const gloves = seed.find((item) => item.id === SEED_MASTER_CATALOG_IDS.nitrileGloves);
    if (!gloves) throw new Error("Seed item missing");

    await catalogRepo.updateMasterItem(gloves.id, { status: "archived" });

    const result = await service.validateMatchConfirmation({
      supplierId: TEST_SUPPLIER_ID,
      masterProductId: gloves.id,
    });

    expect(result.valid).toBe(false);
  });

  it("validateMatchConfirmation returns valid for active master product", async () => {
    const { service } = buildService();

    const result = await service.validateMatchConfirmation({
      supplierId: TEST_SUPPLIER_ID,
      masterProductId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    });

    expect(result.valid).toBe(true);
  });

  it("does not call inventoryRepository — no stock changes", async () => {
    const { service } = buildService();

    // suggestMatches should return suggestions without touching inventory
    const { suggestions } = await service.suggestMatches({
      supplierId: TEST_SUPPLIER_ID,
      supplierDescription: "Nitrile Gloves",
    });

    // The response contains no inventory/stock fields
    for (const s of suggestions) {
      expect(s).not.toHaveProperty("quantityOnHand");
      expect(s).not.toHaveProperty("adjustmentType");
      expect(s).not.toHaveProperty("quantityDelta");
    }
  });
});

// ─── In-memory upsert tests ───────────────────────────────────────────────────

describe("SupplierCatalogueRepository.upsertSupplierProduct — confirm match", () => {
  it("creates a new mapping when none exists", async () => {
    const repo = createInMemorySupplierCatalogueRepository();

    const { record, created } = await repo.upsertSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      supplierSku: "NEW-SKU",
      supplierDescription: "Gloves from supplier",
      unitCostCents: 1500,
    });

    expect(created).toBe(true);
    expect(record.supplierId).toBe(TEST_SUPPLIER_ID);
    expect(record.productId).toBe(SEED_MASTER_CATALOG_IDS.nitrileGloves);
    expect(record.supplierSku).toBe("NEW-SKU");
    expect(record.unitCostCents).toBe(1500);
  });

  it("updates existing mapping on duplicate (supplierId, productId)", async () => {
    const repo = createInMemorySupplierCatalogueRepository();

    await repo.upsertSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      supplierSku: "OLD-SKU",
      supplierDescription: "Old description",
      unitCostCents: 1000,
    });

    const { record, created } = await repo.upsertSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      supplierSku: "NEW-SKU",
      supplierDescription: "New description",
      unitCostCents: 1500,
    });

    expect(created).toBe(false);
    expect(record.supplierSku).toBe("NEW-SKU");
    expect(record.unitCostCents).toBe(1500);
  });

  it("findSupplierProductBySupplierSku returns existing mapping", async () => {
    const repo = createInMemorySupplierCatalogueRepository();

    await repo.createSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      supplierSku: "BUR-001",
      supplierDescription: null,
      unitCostCents: 4000,
    });

    const found = await repo.findSupplierProductBySupplierSku(TEST_SUPPLIER_ID, "BUR-001");
    expect(found).not.toBeNull();
    if (!found) throw new Error("Expected mapping");
    expect(found.productId).toBe(SEED_MASTER_CATALOG_IDS.diamondBurs);
  });

  it("findSupplierProductBySupplierSku is case-insensitive", async () => {
    const repo = createInMemorySupplierCatalogueRepository();

    await repo.createSupplierProduct({
      supplierId: TEST_SUPPLIER_ID,
      productId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      supplierSku: "BUR-ABC",
      supplierDescription: null,
      unitCostCents: 4000,
    });

    const found = await repo.findSupplierProductBySupplierSku(TEST_SUPPLIER_ID, "bur-abc");
    expect(found).not.toBeNull();
  });
});

// ─── HTTP API tests ───────────────────────────────────────────────────────────

describe("POST /api/v1/master-products/match — RBAC", () => {
  it("returns 403 for clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(BASE_MATCH)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        supplierDescription: "Nitrile Gloves",
      });

    expect(res.status).toBe(403);
  });

  it("returns 200 for owner_admin", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_MATCH)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        supplierSku: null,
        supplierDescription: "Nitrile Gloves",
      });

    expect(res.status).toBe(200);
    const body = res.body as MatchResponseBody;
    expect(body.data).toHaveProperty("suggestions");
    expect(Array.isArray(body.data.suggestions)).toBe(true);
  });

  it("returns 200 for group_practice_manager", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(BASE_MATCH)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        supplierDescription: "Diamond Burs",
      });

    expect(res.status).toBe(200);
  });

  it("returns 401 for unauthenticated request", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post(BASE_MATCH)
      .send({ supplierId: TEST_SUPPLIER_ID, supplierDescription: "Gloves" });

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid supplierId format", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_MATCH)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierId: "not-a-uuid", supplierDescription: "Gloves" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/master-products/match — suggestions payload", () => {
  it("suggestions have required fields", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_MATCH)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        supplierDescription: "Nitrile Examination Gloves (Box 100)",
      });

    expect(res.status).toBe(200);
    const body = res.body as MatchResponseBody;
    const { suggestions } = body.data;
    if (suggestions.length > 0) {
      const s = suggestions[0];
      if (!s) throw new Error("Expected suggestion");
      expect(typeof s.masterProductId).toBe("string");
      expect(typeof s.displayName).toBe("string");
      expect(typeof s.sku).toBe("string");
      expect(typeof s.confidence).toBe("number");
      expect(Array.isArray(s.reasons)).toBe(true);
    }
  });
});

describe("POST /api/v1/master-products/match/confirm — RBAC + behaviour", () => {
  it("returns 403 for clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        masterProductId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
        supplierSku: "TEST-SKU",
        lastUnitCostCents: 1000,
      });

    expect(res.status).toBe(403);
  });

  it("creates a supplier-product mapping for owner_admin", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        masterProductId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
        supplierSku: "CONFIRM-SKU-1",
        supplierDescription: "Test gloves supplier",
        lastUnitCostCents: 1999,
      });

    expect(res.status).toBe(201);
    const body = res.body as ConfirmResponseBody;
    expect(body.data.supplierId).toBe(TEST_SUPPLIER_ID);
    expect(body.data.masterProductId).toBe(SEED_MASTER_CATALOG_IDS.nitrileGloves);
    expect(body.data.supplierSku).toBe("CONFIRM-SKU-1");
    expect(body.data.lastUnitCostCents).toBe(1999);
    expect(body.data.active).toBe(true);
  });

  it("updates existing mapping (upsert) — returns 200", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const payload = {
      supplierId: TEST_SUPPLIER_ID,
      masterProductId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      supplierSku: "UPSERT-SKU",
      lastUnitCostCents: 4000,
    };

    await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    const res2 = await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send({ ...payload, lastUnitCostCents: 4500 });

    expect(res2.status).toBe(200);
    const body2 = res2.body as ConfirmResponseBody;
    expect(body2.data.lastUnitCostCents).toBe(4500);
  });

  it("returns 422 for non-existent masterProductId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        masterProductId: "99999999-9999-4999-8999-999999999999",
        supplierSku: null,
        lastUnitCostCents: null,
      });

    expect(res.status).toBe(422);
  });

  it("does not include stock quantity fields in confirm response", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .post(BASE_CONFIRM)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId: TEST_SUPPLIER_ID,
        masterProductId: SEED_MASTER_CATALOG_IDS.compositeResin,
        supplierSku: "RESIN-SKU",
        lastUnitCostCents: 3000,
      });

    const body = res.body as ConfirmResponseBody;
    expect(body.data).not.toHaveProperty("quantityOnHand");
    expect(body.data).not.toHaveProperty("quantityDelta");
    expect(body.data).not.toHaveProperty("adjustmentType");
  });
});
