/**
 * purchaseOrderCsvInjection.test.ts
 *
 * API-level tests proving the CSV export pipeline neutralizes formula-injection
 * characters (= + - @ TAB CR LF) in all exported field values.
 *
 * These tests build a minimal Express app wired with stub repositories whose
 * data contains formula-injection strings.  Requests go through the full HTTP
 * stack (Express router → auth stub → controller → service → CSV builder) so
 * that the sanitization is verified end-to-end, not just at the utility level.
 */

import express from "express";
import request from "supertest";

import { createPurchaseOrderService } from "../src/services/purchaseOrderService.js";
import { createPurchaseOrderHandlers } from "../src/controllers/purchaseOrderController.js";
import { asyncHandler } from "../src/utils/asyncHandler.js";
import type { InventoryRepository } from "../src/repositories/inventoryRepository.js";
import type { CatalogRepository } from "../src/repositories/catalogRepository.js";
import type { AuditService } from "../src/services/auditService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const PO_ID     = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_ID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INV_ID    = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CREATED   = new Date("2026-06-16T07:00:00.000Z");

// ─── Injection payloads ───────────────────────────────────────────────────────

const INJECTION_CASES: Array<{ label: string; sku: string; itemName: string; reason: string }> = [
  {
    label: "= formula in SKU and item name",
    sku: "=CMD",
    itemName: "=SUM(A1+A2)",
    reason: "below_reorder_point",
  },
  {
    label: "+ formula in SKU",
    sku: "+cmd|' /C calc'!A0",
    itemName: "Normal item",
    reason: "below_reorder_point",
  },
  {
    label: "- formula in item name",
    sku: "SAFE-SKU",
    itemName: "-2+3+cmd|'",
    reason: "below_reorder_point",
  },
  {
    label: "@ formula in item name",
    sku: "SAFE-SKU",
    itemName: "@SUM(1+1)",
    reason: "below_reorder_point",
  },
  {
    label: "TAB character in reason",
    sku: "SAFE-SKU",
    itemName: "Normal item",
    reason: "\tinjected",
  },
  {
    label: "CR character in reason",
    sku: "SAFE-SKU",
    itemName: "Normal item",
    reason: "\rinjected",
  },
  {
    label: "LF character in reason",
    sku: "SAFE-SKU",
    itemName: "Normal item",
    reason: "\ninjected",
  },
];

// ─── Minimal test-app builder ─────────────────────────────────────────────────

function buildInjectionApp(sku: string, itemName: string, reason: string) {
  const mockInventory = {
    listPurchaseOrders: () => Promise.resolve([
      {
        id: PO_ID,
        clinicId: CLINIC_ID,
        status: "draft" as const,
        createdByUserId: "user-1",
        createdAt: CREATED,
        updatedAt: CREATED,
      },
    ]),
    listDraftPoLines: () => Promise.resolve([
      {
        id: LINE_ID,
        draftPurchaseOrderId: PO_ID,
        masterCatalogItemId: ITEM_ID,
        clinicInventoryItemId: INV_ID,
        quantity: 3,
        reason,
        createdAt: CREATED,
      },
    ]),
  } as unknown as InventoryRepository;

  const mockCatalog = {
    findMasterItemById: () => Promise.resolve({
      id: ITEM_ID,
      sku,
      name: itemName,
      category: "consumables",
      unitOfMeasure: "pack",
      defaultUnitCostCents: 500,
    }),
  } as unknown as CatalogRepository;

  const mockAudit = {
    logEvent: () => { /* no-op */ },
    logAuthEvent: () => { /* no-op */ },
    logError: () => { /* no-op */ },
  } as unknown as AuditService;

  const service = createPurchaseOrderService(mockInventory, mockCatalog, mockAudit);
  const handlers = createPurchaseOrderHandlers(service);

  const app = express();
  app.use(express.json());

  // Stub auth: set req.user directly, bypassing JWT verification.
  app.use((req, _res, next) => {
    req.user = {
      id: "user-1",
      email: "test@clinic.au",
      role: "owner_admin",
      homeClinicId: CLINIC_ID,
      homeClinicName: "Test Clinic",
      firstName: null,
      lastName: null,
      displayName: null,
      permissions: [],
    };
    next();
  });

  app.get(
    "/clinics/:clinicId/purchase-orders/export.csv",
    asyncHandler((req, res) => handlers.exportPurchaseOrdersCsv(req, res)),
  );

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CSV export — formula injection neutralization (API level)", () => {
  it.each(INJECTION_CASES)(
    "neutralizes $label in exported CSV",
    async ({ sku, itemName, reason }) => {
      const app = buildInjectionApp(sku, itemName, reason);

      const res = await request(app)
        .get(`/clinics/${CLINIC_ID}/purchase-orders/export.csv`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);

      const csvText: string = res.text;
      const lines = csvText.split("\r\n");

      // Header row must be unmodified
      expect(lines[0]).toBe(
        "Line ID,PO ID,PO Reference,SKU,Item Name,Qty Needed,Trigger,Status,Created At",
      );

      // Data row must exist
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const dataRow = lines[1];
      if (!dataRow) return;

      // The data row must NOT contain any bare formula-trigger characters at
      // the start of an unquoted field.
      //
      // For a double-quoted field the sanitized value looks like "'=..." inside
      // quotes.  For an unquoted field it looks like "'=..." directly.
      // In both cases the raw trigger character must not be the first
      // non-quote character of the field (column) value.
      const FORMULA_TRIGGERS = /(?:^|,)(?:")?(=|\+|-|@|\t|\r|\n)/;
      expect(dataRow).not.toMatch(FORMULA_TRIGGERS);

      // The sanitized value must appear with the leading single-quote prefix.
      const TRIGGER_RE = /^[=+\-@\t\r\n]/;
      const dangerousValues = [sku, itemName, reason].filter((v) =>
        TRIGGER_RE.test(v),
      );
      for (const dangerous of dangerousValues) {
        // The CSV must contain a single-quote-prefixed version of the value,
        // either as a standalone field or inside double-quotes.
        expect(dataRow).toContain(`'${dangerous}`);
      }
    },
  );

  it("does not modify safe field values", async () => {
    const app = buildInjectionApp("VRV-BUR-001", "Diamond Burs", "below_reorder_point");

    const res = await request(app)
      .get(`/clinics/${CLINIC_ID}/purchase-orders/export.csv`);

    expect(res.status).toBe(200);
    const dataRow = res.text.split("\r\n")[1];
    if (!dataRow) return;

    expect(dataRow).toContain("VRV-BUR-001");
    expect(dataRow).toContain("Diamond Burs");
    expect(dataRow).toContain("below_reorder_point");
    // No unexpected single-quote prefix on safe values
    expect(dataRow).not.toContain("'VRV-BUR-001");
    expect(dataRow).not.toContain("'Diamond Burs");
  });

  it("returns correct HTTP metadata regardless of injection payload", async () => {
    const app = buildInjectionApp("=DANGEROUS", "=EVIL", "=INJECT");

    const res = await request(app)
      .get(`/clinics/${CLINIC_ID}/purchase-orders/export.csv`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.csv/);
  });
});
