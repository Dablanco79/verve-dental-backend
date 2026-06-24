/**
 * supplierIntelligenceService.test.ts
 *
 * Unit tests for createSupplierIntelligenceService using a mock DB pool.
 * No real database connection required — pool.query is stubbed per test.
 *
 * Coverage:
 *   1. No data state — clinic has inventory but no invoices or catalogue
 *   2. One supplier only — no comparison possible
 *   3. Multiple suppliers — saving opportunity detected
 *   4. Annual usage null when no scan_deduct records
 *   5. Annual saving calculated correctly
 *   6. Summary KPIs aggregated correctly
 *   7. Opportunities sorted by estimated annual saving DESC
 *   8. Products needing attention separated correctly
 */

import { jest } from "@jest/globals";
import { createSupplierIntelligenceService } from "../supplierIntelligenceService.js";
import type { DatabasePool } from "../../db/pool.js";

// ── Mock pool factory ─────────────────────────────────────────────────────────

function makeMockPool(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue(
    { rows, rowCount: rows.length } as never,
  );
  const pool = { query } as unknown as DatabasePool;
  return { pool, query };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLINIC_ID = "11111111-1111-4000-8000-000000000001";
const PRODUCT_A = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PRODUCT_B = "bbbbbbbb-bbbb-4000-8000-000000000002";
const SUPPLIER_X = "xxxxxxxx-xxxx-4000-8000-000000000001";
const SUPPLIER_Y = "yyyyyyyy-yyyy-4000-8000-000000000001";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("supplierIntelligenceService — no data state", () => {
  it("returns empty opportunities and needsAttention when pool returns no rows", async () => {
    const { pool } = makeMockPool([]);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    expect(result.clinicId).toBe(CLINIC_ID);
    expect(result.opportunities).toHaveLength(0);
    expect(result.needsAttention).toHaveLength(0);
    expect(result.summary.totalPotentialAnnualSavingCents).toBe(0);
    expect(result.summary.productsWithSaving).toBe(0);
    expect(result.summary.averagePriceVariancePct).toBeNull();
  });

  it("passes clinicId as the first query parameter", async () => {
    const { pool, query } = makeMockPool([]);
    const svc = createSupplierIntelligenceService(pool);
    await svc.getIntelligence(CLINIC_ID);
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0] ?? [];
    const params = call[1] as unknown[];
    expect(params[0]).toBe(CLINIC_ID);
  });
});

describe("supplierIntelligenceService — one supplier only", () => {
  it("returns catalogue_only with no saving when only one catalogue entry exists", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: null,
        current_supplier_name: null,
        current_unit_price_cents: null,
        best_supplier_id: SUPPLIER_X,
        best_supplier_name: "SupplierX",
        best_unit_cost_cents: "1000",
        supplier_catalogue_count: "1",
        annual_usage_units: null,
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    expect(result.opportunities).toHaveLength(0);
    expect(result.needsAttention).toHaveLength(1);

    const row = result.needsAttention[0];
    expect(row).toBeDefined();
    if (!row) return;

    expect(row.productId).toBe(PRODUCT_A);
    expect(row.savingPerUnit).toBeNull();
    expect(row.estimatedAnnualSaving).toBeNull();
    expect(row.confidence).toBe("catalogue_only");
  });
});

describe("supplierIntelligenceService — multiple suppliers with saving", () => {
  it("detects a saving when best catalogue price is lower than confirmed invoice price", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: SUPPLIER_X,
        current_supplier_name: "SupplierX",
        current_unit_price_cents: "1500",
        best_supplier_id: SUPPLIER_Y,
        best_supplier_name: "SupplierY",
        best_unit_cost_cents: "1000",
        supplier_catalogue_count: "2",
        annual_usage_units: "100",
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    expect(result.opportunities).toHaveLength(1);
    const opp = result.opportunities[0];
    expect(opp).toBeDefined();
    if (!opp) return;

    expect(opp.savingPerUnit).toBe(500);
    expect(opp.estimatedAnnualUsage).toBe(100);
    expect(opp.estimatedAnnualSaving).toBe(50_000);
    expect(opp.confidence).toBe("high");
    expect(opp.currentSupplierName).toBe("SupplierX");
    expect(opp.bestSupplierName).toBe("SupplierY");
  });

  it("does not set saving when best price equals current price", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: SUPPLIER_X,
        current_supplier_name: "SupplierX",
        current_unit_price_cents: "1000",
        best_supplier_id: SUPPLIER_X,
        best_supplier_name: "SupplierX",
        best_unit_cost_cents: "1000",
        supplier_catalogue_count: "2",
        annual_usage_units: "50",
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    // Should not appear in opportunities (no saving)
    expect(result.opportunities).toHaveLength(0);
  });
});

describe("supplierIntelligenceService — annual usage null when unavailable", () => {
  it("returns null estimatedAnnualSaving when annual usage is null", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: SUPPLIER_X,
        current_supplier_name: "SupplierX",
        current_unit_price_cents: "1500",
        best_supplier_id: SUPPLIER_Y,
        best_supplier_name: "SupplierY",
        best_unit_cost_cents: "1000",
        supplier_catalogue_count: "2",
        annual_usage_units: null,   // ← no scan_deduct records
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    // Saving per unit is still calculated
    const opp = result.opportunities[0];
    expect(opp).toBeDefined();
    if (!opp) return;

    expect(opp.savingPerUnit).toBe(500);
    expect(opp.estimatedAnnualUsage).toBeNull();
    expect(opp.estimatedAnnualSaving).toBeNull();  // null because usage unknown
  });
});

describe("supplierIntelligenceService — summary KPIs", () => {
  it("aggregates total saving and product count correctly", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: SUPPLIER_X,
        current_supplier_name: "SupplierX",
        current_unit_price_cents: "1500",
        best_supplier_id: SUPPLIER_Y,
        best_supplier_name: "SupplierY",
        best_unit_cost_cents: "1000",
        supplier_catalogue_count: "2",
        annual_usage_units: "100",
      },
      {
        product_id: PRODUCT_B,
        product_name: "Masks",
        product_sku: "MSK-01",
        current_supplier_id: SUPPLIER_X,
        current_supplier_name: "SupplierX",
        current_unit_price_cents: "800",
        best_supplier_id: SUPPLIER_Y,
        best_supplier_name: "SupplierY",
        best_unit_cost_cents: "600",
        supplier_catalogue_count: "2",
        annual_usage_units: "200",
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    // Product A: saving = 500 × 100 = 50,000 cents
    // Product B: saving = 200 × 200 = 40,000 cents
    expect(result.summary.totalPotentialAnnualSavingCents).toBe(90_000);
    expect(result.summary.productsWithSaving).toBe(2);
    expect(result.opportunities).toHaveLength(2);
    // Sorted by annual saving DESC: A first (50k > 40k)
    expect(result.opportunities[0]?.productId).toBe(PRODUCT_A);
    expect(result.opportunities[1]?.productId).toBe(PRODUCT_B);
  });

  it("counts products needing attention correctly", async () => {
    const rows = [
      {
        product_id: PRODUCT_A,
        product_name: "Gloves M",
        product_sku: "GLV-M",
        current_supplier_id: null,
        current_supplier_name: null,
        current_unit_price_cents: null,
        best_supplier_id: null,
        best_supplier_name: null,
        best_unit_cost_cents: null,
        supplier_catalogue_count: "0",
        annual_usage_units: null,
      },
    ];

    const { pool } = makeMockPool(rows);
    const svc = createSupplierIntelligenceService(pool);
    const result = await svc.getIntelligence(CLINIC_ID);

    expect(result.summary.productsNeedingAttention).toBe(1);
    expect(result.needsAttention).toHaveLength(1);
    expect(result.needsAttention[0]?.confidence).toBe("insufficient_data");
  });
});

describe("supplierIntelligenceService — role/access behaviour", () => {
  it("scopes query to the provided clinicId only", async () => {
    const OTHER_CLINIC = "22222222-2222-4000-8000-000000000002";
    const { pool, query } = makeMockPool([]);
    const svc = createSupplierIntelligenceService(pool);

    await svc.getIntelligence(OTHER_CLINIC);

    const call = query.mock.calls[0] ?? [];
    const params = call[1] as unknown[];
    expect(params[0]).toBe(OTHER_CLINIC);
    expect(params[0]).not.toBe(CLINIC_ID);
  });
});
