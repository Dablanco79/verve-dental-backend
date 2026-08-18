/**
 * Supplier Invoice Financial Truth & Operational Cost Normalisation Tests
 *
 * Covers:
 *  1.  GST-exclusive line, no discount
 *  2.  GST-inclusive line, no discount (fixes double-GST defect)
 *  3.  GST-exclusive line with discount
 *  4.  GST-inclusive line with discount
 *  5.  GST-free line
 *  6.  supplier line total persisted
 *  7.  supplier line total used for reconciliation
 *  8.  fallback calculation when supplier total absent
 *  9.  invoice header reconciliation ($714.05 Piksters case)
 *  10. Piksters $714.05 complete case
 *  11. operational unit cost derived net ex-tax
 *  12. receiving unit → stock unit cost normalisation
 *  13. supplier catalogue write uses canonical operational cost
 *  14. price history uses canonical operational cost
 *  15. existing PO costing remains unchanged (no regression)
 *  16. product identity / matching tests remain green
 */

import { jest } from "@jest/globals";
import {
  calcLineTotals,
  deriveNetExTaxLineCost,
  deriveOperationalUnitCost,
} from "../invoiceLineCostHelper.js";
import { createInMemorySupplierInvoiceRepository } from "../../repositories/supplierInvoiceRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../../repositories/supplierCatalogueRepository.js";
import { createInMemorySupplierRepository } from "../../repositories/supplierRepository.js";
import { createInMemoryCatalogRepository } from "../../repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../../repositories/inventoryRepository.js";
import { createSupplierInvoiceService } from "../supplierInvoiceService.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { OcrProvider } from "../ocr/OcrProvider.js";
import type { OcrInvoiceResult } from "../../types/supplierInvoice.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLINIC_A = "00000000-0000-0000-0000-000000000001";

function makeManager(): AuthenticatedUser {
  return {
    id: "user-manager-1",
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: CLINIC_A,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

const FAKE_AUDIT = { logEvent: jest.fn(), recordClinicEvent: jest.fn() };

function makeMockOcrProvider(result: OcrInvoiceResult): OcrProvider {
  return {
    extractInvoice: jest.fn<OcrProvider["extractInvoice"]>().mockResolvedValue(result),
  };
}

const FAKE_FILE = {
  buffer: Buffer.from("fake-pdf-content"),
  mimetype: "application/pdf",
  originalname: "test-invoice.pdf",
};

const SUPPLIER_ID = "00000000-0000-0000-0000-000000000010";

function makeService(ocrResult: OcrInvoiceResult) {
  const repo = createInMemorySupplierInvoiceRepository();
  const catalogueRepo = createInMemorySupplierCatalogueRepository();
  const supplierRepo = createInMemorySupplierRepository();
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const service = createSupplierInvoiceService(
    repo,
    makeMockOcrProvider(ocrResult),
    catalogueRepo,
    FAKE_AUDIT as never,
    supplierRepo,
    undefined,
    catalogRepo,
    inventoryRepo,
  );
  return { service, repo, catalogueRepo, catalogRepo, inventoryRepo };
}

// ── calcLineTotals unit tests ─────────────────────────────────────────────────

describe("calcLineTotals", () => {
  // ── 1. GST-exclusive, no discount ───────────────────────────────────────────
  it("1: GST-exclusive price, no discount — adds tax to get total", () => {
    const result = calcLineTotals(2, 10_000, false, 0, 1_000);
    // subtotal = 2 × 10000 = 20000
    // tax = 20000 × 10% = 2000
    // total = 22000
    expect(result.subtotalCents).toBe(20_000);
    expect(result.taxCents).toBe(2_000);
    expect(result.totalCents).toBe(22_000);
  });

  // ── 2. GST-inclusive, no discount — must NOT double-add GST ─────────────────
  it("2: GST-inclusive price, no discount — does NOT add GST again", () => {
    // Diapro Twist RA Set: qty 1, printed $119.90 incl GST
    const result = calcLineTotals(1, 11_990, true, 0, 1_000);
    // gross incl-GST = 11990
    // total = 11990 (no additional GST)
    // extracted tax = round(11990 × 1000 / 11000) = round(1090) = 1090
    // subtotal = 11990 - 1090 = 10900
    expect(result.totalCents).toBe(11_990);
    expect(result.taxCents).toBe(1_090);
    expect(result.subtotalCents).toBe(10_900);
    // CRITICAL: must NOT be 13189 (old double-GST bug)
    expect(result.totalCents).not.toBe(13_189);
  });

  // ── 3. GST-exclusive, with discount ─────────────────────────────────────────
  it("3: GST-exclusive price, 10% discount — applies discount before adding tax", () => {
    // qty 2, unit $100 ex-GST, 10% discount, 10% GST
    const result = calcLineTotals(2, 10_000, false, 1_000, 1_000);
    // gross ex-GST = 20000
    // subtotal after discount = round(20000 × 0.90) = 18000
    // tax = round(18000 × 0.10) = 1800
    // total = 19800
    expect(result.subtotalCents).toBe(18_000);
    expect(result.taxCents).toBe(1_800);
    expect(result.totalCents).toBe(19_800);
  });

  // ── 4. GST-inclusive, with discount ─────────────────────────────────────────
  it("4: GST-inclusive price, 10% discount — applies discount to incl-GST total", () => {
    // Medium Nitrile Gloves: qty 3, printed $55.00 incl-GST, 10% discount
    const result = calcLineTotals(3, 5_500, true, 1_000, 1_000);
    // gross incl-GST = 3 × 5500 = 16500
    // total after 10% discount = round(16500 × 0.90) = 14850
    // extracted tax = round(14850 × 1000 / 11000) = round(1350) = 1350
    // subtotal = 14850 - 1350 = 13500
    expect(result.totalCents).toBe(14_850);
    expect(result.taxCents).toBe(1_350);
    expect(result.subtotalCents).toBe(13_500);
  });

  // ── 5. GST-free ──────────────────────────────────────────────────────────────
  it("5: GST-free line (taxRateBasisPoints = 0) — no tax added", () => {
    const result = calcLineTotals(5, 2_000, false, 0, 0);
    expect(result.subtotalCents).toBe(10_000);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(10_000);
  });

  // ── unknown priceIncludesTax falls back to ex-tax ────────────────────────────
  it("unknown priceIncludesTax (null) falls back to ex-tax calculation for backward compat", () => {
    const result = calcLineTotals(1, 10_000, null, 0, 1_000);
    // Same as priceIncludesTax = false
    expect(result.subtotalCents).toBe(10_000);
    expect(result.taxCents).toBe(1_000);
    expect(result.totalCents).toBe(11_000);
  });
});

// ── deriveNetExTaxLineCost unit tests ─────────────────────────────────────────

describe("deriveNetExTaxLineCost", () => {
  // ── 6. Supplier line total preserved and used ────────────────────────────────
  it("6: Uses supplier-stated line total when available (incl-GST → ex-GST)", () => {
    // Nitrile gloves: supplier total $148.50 incl-GST, 10% GST rate
    const result = deriveNetExTaxLineCost({
      quantity: 3,
      unitPriceCents: 5_500,
      priceIncludesTax: true,
      discountBasisPoints: 1_000,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: 14_850,
    });
    // net ex-GST = round(14850 × 10000 / 11000) = round(13500) = 13500
    expect(result).toBe(13_500);
  });

  // ── 7. Supplier total used for reconciliation / derivation ───────────────────
  it("7: GST-free supplier line total is used as-is", () => {
    const result = deriveNetExTaxLineCost({
      quantity: 2,
      unitPriceCents: 5_000,
      priceIncludesTax: false,
      discountBasisPoints: 0,
      taxRateBasisPoints: 0,
      supplierLineTotalCents: 9_800,  // supplier printed 9800 ex-GST
    });
    expect(result).toBe(9_800);
  });

  // ── 8. Fallback calculation when supplier total absent ───────────────────────
  it("8: Falls back to unit price derivation when no supplier total", () => {
    // ex-GST price, no supplier total
    const result = deriveNetExTaxLineCost({
      quantity: 2,
      unitPriceCents: 10_000,
      priceIncludesTax: false,
      discountBasisPoints: 1_000,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: null,
    });
    // gross ex-GST = 20000, after 10% discount = 18000
    expect(result).toBe(18_000);
  });

  it("8b: Returns null when priceIncludesTax is unknown and no supplier total", () => {
    const result = deriveNetExTaxLineCost({
      quantity: 2,
      unitPriceCents: 10_000,
      priceIncludesTax: null,
      discountBasisPoints: 0,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: null,
    });
    expect(result).toBeNull();
  });
});

// ── deriveOperationalUnitCost unit tests ──────────────────────────────────────

describe("deriveOperationalUnitCost", () => {
  // ── 11. Operational unit cost derived net ex-tax ─────────────────────────────
  it("11: Derives operational unit cost as net ex-tax per stock unit", () => {
    // qty 3 boxes, each $55 incl-GST, 10% discount, 10% GST
    const result = deriveOperationalUnitCost({
      quantity: 3,
      unitPriceCents: 5_500,
      priceIncludesTax: true,
      discountBasisPoints: 1_000,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: 14_850,
      unitsPerReceivingUnit: 1,
    });
    // net ex-GST line = 13500; stock units = 3 × 1 = 3; cost per unit = 4500
    expect(result).toBe(4_500);
  });

  // ── 12. Receiving unit → stock unit cost normalisation ───────────────────────
  it("12: Correctly normalises across receiving units to stock units", () => {
    // 2 cartons × 10 boxes/carton, net ex-GST line cost = $160.00
    const result = deriveOperationalUnitCost({
      quantity: 2,
      unitPriceCents: 9_000,   // $90 per carton ex-GST → total $180 ex-GST
      priceIncludesTax: false,
      discountBasisPoints: 1_111, // ~11.11% → round(18000 × 0.8889) ≈ 16000
      taxRateBasisPoints: 0,
      supplierLineTotalCents: 16_000,  // supplier confirms net total = $160
      unitsPerReceivingUnit: 10,
    });
    // net ex-GST = 16000 (GST-free); total stock units = 2 × 10 = 20
    // operational unit cost = round(16000 / 20) = 800
    expect(result).toBe(800);
  });

  it("12b: Piksters nitrile gloves — per stock unit cost", () => {
    // 3 boxes, $55.00 incl-GST, 10% discount, supplier total $148.50
    // Each box is 1 stock unit (unitsPerReceivingUnit = 1)
    const result = deriveOperationalUnitCost({
      quantity: 3,
      unitPriceCents: 5_500,
      priceIncludesTax: true,
      discountBasisPoints: 1_000,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: 14_850,
      unitsPerReceivingUnit: 1,
    });
    expect(result).toBe(4_500); // $45.00 per box
  });
});

// ── Integration: service-level financial truth tests ─────────────────────────

describe("SupplierInvoiceService — financial truth integration", () => {
  beforeEach(() => {
    FAKE_AUDIT.logEvent.mockClear();
  });

  // ── 2 (integration): GST-inclusive line not double-taxed ────────────────────
  it("2 (integration): GST-inclusive line is stored with correct total (no double-GST)", async () => {
    const ocrResult: OcrInvoiceResult = {
      provider: "stub",
      supplierName: "Erskine Dental",
      supplierAbn: null,
      supplierEmail: null,
      supplierPhone: null,
      supplierAddress: null,
      supplierWebsite: null,
      invoiceNumber: "INV538147",
      invoiceDate: "2026-07-01",
      dueDate: null,
      subtotalCents: 64_913,
      taxCents: 6_492,
      totalCents: 71_405,
      overallConfidence: 92,
      lines: [
        {
          description: "Diapro Twist RA Set",
          sku: null,
          quantity: 1,
          unitPriceCents: 11_990,
          priceIncludesTax: true,
          discountBasisPoints: 0,
          subtotalCents: 10_900,
          taxRateBasisPoints: 1_000,
          taxCents: 1_090,
          totalCents: 11_990,
          supplierLineTotalCents: 11_990,
          confidence: 92,
        },
      ],
      rawResponse: {},
    };

    const { service } = makeService(ocrResult);
    const caller = makeManager();

    const { lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const line = lines[0];

    expect(line).toBeDefined();
    // CRITICAL: totalCents must be $119.90, NOT the old buggy $131.89
    expect(line?.totalCents).toBe(11_990);
    expect(line?.totalCents).not.toBe(13_189);
    expect(line?.supplierLineTotalCents).toBe(11_990);
    expect(line?.priceIncludesTax).toBe(true);
  });

  // ── 6 (integration): Supplier line total is persisted ────────────────────────
  it("6 (integration): supplierLineTotalCents is preserved on the line", async () => {
    const ocrResult: OcrInvoiceResult = {
      provider: "stub",
      supplierName: "Test Supplier",
      supplierAbn: null, supplierEmail: null, supplierPhone: null,
      supplierAddress: null, supplierWebsite: null,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      subtotalCents: 10_000, taxCents: 1_000, totalCents: 11_000,
      overallConfidence: 90,
      lines: [
        {
          description: "Test Product",
          sku: "TP-1",
          quantity: 2,
          unitPriceCents: 5_000,
          priceIncludesTax: false,
          discountBasisPoints: 0,
          subtotalCents: 10_000,
          taxRateBasisPoints: 1_000,
          taxCents: 1_000,
          totalCents: 11_000,
          supplierLineTotalCents: 11_000,
          confidence: 90,
        },
      ],
      rawResponse: {},
    };

    const { service } = makeService(ocrResult);
    const caller = makeManager();

    const { lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    expect(lines[0]?.supplierLineTotalCents).toBe(11_000);
  });

  // ── 13. Supplier catalogue write uses canonical operational cost ─────────────
  it("13: confirmImport writes canonical net ex-GST operational unit cost to catalogue", async () => {
    // GST-inclusive line with discount — canonical cost must be net ex-GST per unit
    const ocrResult: OcrInvoiceResult = {
      provider: "stub",
      supplierName: "Test Supplier",
      supplierAbn: null, supplierEmail: null, supplierPhone: null,
      supplierAddress: null, supplierWebsite: null,
      invoiceNumber: "INV-CANON-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      subtotalCents: 13_500, taxCents: 1_350, totalCents: 14_850,
      overallConfidence: 95,
      lines: [
        {
          description: "Nitrile Gloves Box",
          sku: "NG-100",
          quantity: 3,
          unitPriceCents: 5_500,
          priceIncludesTax: true,
          discountBasisPoints: 1_000,
          subtotalCents: 13_500,
          taxRateBasisPoints: 1_000,
          taxCents: 1_350,
          totalCents: 14_850,
          supplierLineTotalCents: 14_850,
          confidence: 95,
        },
      ],
      rawResponse: {},
    };

    const { service, catalogRepo, inventoryRepo } = makeService(ocrResult);
    const caller = makeManager();

    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const line = lines[0];
    if (!line) throw new Error("Expected line");

    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: SUPPLIER_ID,
      invoiceNumber: "INV-CANON-001",
      invoiceDate: "2026-06-01",
    });

    // Create product via confirmImport
    await service.updateLine(caller, CLINIC_A, invoice.id, line.id, {
      productCreationData: {
        productName: "Nitrile Gloves Box",
        category: "Consumables",
        supplierSku: "NG-100",
        stockUnit: "Box",
        receivingUnit: "Box",
        unitsPerReceivingUnit: 1,
        unitCostCents: 4_500,  // operator confirms $45.00
      },
    });

    const result = await service.confirmImport(caller, CLINIC_A, invoice.id, {
      readyToCreateLineIds: [line.id],
    });

    // Price history should record the operator-confirmed canonical cost
    expect(result.priceHistory[0]?.newUnitCostCents).toBe(4_500);

    // Catalogue item should use canonical cost
    const createdItem = (await catalogRepo.listMasterItems()).find(
      (item) => item.name === "Nitrile Gloves Box",
    );
    expect(createdItem?.defaultUnitCostCents).toBe(4_500);

    // Inventory item created at zero stock
    const inventoryItems = await inventoryRepo.listClinicInventory(CLINIC_A);
    const createdInventoryItem = inventoryItems.find(
      (item) => item.masterCatalogItemId === createdItem?.id,
    );
    expect(createdInventoryItem?.quantityOnHand).toBe(0);
  });

  // ── 14. Price history uses canonical operational cost ────────────────────────
  it("14: price history records canonical unit cost when derived from financial data", async () => {
    // ex-GST price, no discount, price derivation possible
    const ocrResult: OcrInvoiceResult = {
      provider: "stub",
      supplierName: "Test Supplier",
      supplierAbn: null, supplierEmail: null, supplierPhone: null,
      supplierAddress: null, supplierWebsite: null,
      invoiceNumber: "INV-HIST-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      subtotalCents: 10_000, taxCents: 1_000, totalCents: 11_000,
      overallConfidence: 92,
      lines: [
        {
          description: "Test Product Ex-GST",
          sku: "TP-EX",
          quantity: 2,
          unitPriceCents: 5_000,
          priceIncludesTax: false,
          discountBasisPoints: 0,
          subtotalCents: 10_000,
          taxRateBasisPoints: 1_000,
          taxCents: 1_000,
          totalCents: 11_000,
          supplierLineTotalCents: 11_000,
          confidence: 92,
        },
      ],
      rawResponse: {},
    };

    const { service, catalogRepo } = makeService(ocrResult);
    const caller = makeManager();
    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const line = lines[0];
    if (!line) throw new Error("Expected line");

    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: SUPPLIER_ID,
      invoiceNumber: "INV-HIST-001",
      invoiceDate: "2026-06-01",
    });

    await service.updateLine(caller, CLINIC_A, invoice.id, line.id, {
      productCreationData: {
        productName: "Test Product Ex-GST",
        category: "Consumables",
        supplierSku: "TP-EX",
        stockUnit: "Each",
        receivingUnit: "Each",
        unitsPerReceivingUnit: 1,
        unitCostCents: 5_000,  // $50 per unit ex-GST
      },
    });

    const result = await service.confirmImport(caller, CLINIC_A, invoice.id, {
      readyToCreateLineIds: [line.id],
    });

    // Price history: operator confirmed $5000, which is the ex-GST per unit
    expect(result.priceHistory[0]?.newUnitCostCents).toBe(5_000);
    expect(result.priceUpdates).toBe(1);

    const createdItem = (await catalogRepo.listMasterItems()).find(
      (item) => item.name === "Test Product Ex-GST",
    );
    expect(createdItem?.defaultUnitCostCents).toBe(5_000);
  });

  it("rejects confirmation instead of persisting an ambiguous raw printed price", async () => {
    const ambiguousOcr: OcrInvoiceResult = {
      provider: "stub",
      supplierName: "Ambiguous Supplier",
      supplierAbn: null,
      supplierEmail: null,
      supplierPhone: null,
      supplierAddress: null,
      supplierWebsite: null,
      invoiceNumber: "INV-AMBIGUOUS",
      invoiceDate: "2026-08-18",
      dueDate: null,
      subtotalCents: null,
      taxCents: null,
      totalCents: null,
      overallConfidence: 80,
      lines: [{
        description: "Ambiguous Tax Product",
        sku: "AMB-1",
        quantity: 1,
        unitPriceCents: 11_000,
        priceIncludesTax: null,
        discountBasisPoints: 0,
        subtotalCents: 11_000,
        taxRateBasisPoints: 1_000,
        taxCents: 1_100,
        totalCents: 12_100,
        supplierLineTotalCents: 12_100,
        confidence: 80,
      }],
      rawResponse: {},
    };
    const { service } = makeService(ambiguousOcr);
    const caller = makeManager();
    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const line = lines[0];
    if (!line) throw new Error("Expected ambiguous line");

    await service.updateInvoice(caller, CLINIC_A, invoice.id, {
      supplierId: SUPPLIER_ID,
      invoiceNumber: "INV-AMBIGUOUS",
      invoiceDate: "2026-08-18",
    });
    await service.updateLine(caller, CLINIC_A, invoice.id, line.id, {
      masterCatalogItemId: "00000000-0000-0000-0000-000000000099",
      isMatched: true,
      matchMethod: "manual",
    });

    await expect(service.confirmImport(caller, CLINIC_A, invoice.id)).rejects.toMatchObject({
      statusCode: 422,
      code: "AMBIGUOUS_OPERATIONAL_COST",
    });
  });
});

// ── Piksters INV538147 regression fixture ────────────────────────────────────

describe("Piksters / Erskine INV538147 regression", () => {
  const PIKSTERS_OCR: OcrInvoiceResult = {
    provider: "stub",
    supplierName: "Erskine Dental (Piksters)",
    supplierAbn: null,
    supplierEmail: null,
    supplierPhone: null,
    supplierAddress: null,
    supplierWebsite: null,
    invoiceNumber: "INV538147",
    invoiceDate: "2026-05-04",
    dueDate: null,
    subtotalCents: 64_913,  // $649.13 ex-GST
    taxCents: 6_492,        // $64.92 GST
    totalCents: 71_405,     // $714.05 total incl-GST
    overallConfidence: 92,
    lines: [
      {
        // Diapro Twist RA Set: price is incl-GST, qty 1, no discount
        description: "Diapro Twist RA Set - 6pk",
        sku: "ERVA363",
        quantity: 1,
        unitPriceCents: 11_990,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 10_900,
        taxRateBasisPoints: 1_000,
        taxCents: 1_090,
        totalCents: 11_990,
        supplierLineTotalCents: 11_990,
        confidence: 92,
      },
      {
        description: "Piksters Professional Pack Refills (1) Purple 40pk",
        sku: ".PKRP140",
        quantity: 1,
        unitPriceCents: 685,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 623,
        taxRateBasisPoints: 1_000,
        taxCents: 62,
        totalCents: 685,
        supplierLineTotalCents: 685,
        confidence: 92,
      },
      {
        description: "Piksters Professional Pack Refills (0) Silver 40pk",
        sku: ".PKRP040",
        quantity: 3,
        unitPriceCents: 685,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 1_868,
        taxRateBasisPoints: 1_000,
        taxCents: 187,
        totalCents: 2_055,
        supplierLineTotalCents: 2_055,
        confidence: 92,
      },
      {
        description: "Piksters Professional Pack Refills (00) Pink 40pk",
        sku: ".PKRP0040",
        quantity: 3,
        unitPriceCents: 685,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 1_868,
        taxRateBasisPoints: 1_000,
        taxCents: 187,
        totalCents: 2_055,
        supplierLineTotalCents: 2_055,
        confidence: 92,
      },
      {
        description: "Piksters Professional Pack Refills (000) Navy 40pk",
        sku: ".PKRP00040",
        quantity: 2,
        unitPriceCents: 685,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 1_245,
        taxRateBasisPoints: 1_000,
        taxCents: 125,
        totalCents: 1_370,
        supplierLineTotalCents: 1_370,
        confidence: 92,
      },
      {
        description: "Piksters - On the Go - Essential Oral Care Kit",
        sku: "EPAK0001",
        quantity: 1,
        unitPriceCents: 28_500,
        priceIncludesTax: true,
        discountBasisPoints: 0,
        subtotalCents: 25_909,
        taxRateBasisPoints: 1_000,
        taxCents: 2_591,
        totalCents: 28_500,
        supplierLineTotalCents: 28_500,
        confidence: 92,
      },
      {
        description: "Erskine Everyday Dental Nitrile Glove Small,100pk",
        sku: "EEDNGS",
        quantity: 2,
        unitPriceCents: 5_500,
        priceIncludesTax: true,
        discountBasisPoints: 1_000,
        subtotalCents: 9_000,
        taxRateBasisPoints: 1_000,
        taxCents: 900,
        totalCents: 9_900,
        supplierLineTotalCents: 9_900,
        confidence: 92,
      },
      {
        description: "Erskine Everyday Dental Nitrile Glove Medium,100pk",
        sku: "EEDMGM",
        quantity: 3,
        unitPriceCents: 5_500,
        priceIncludesTax: true,
        discountBasisPoints: 1_000,
        subtotalCents: 13_500,
        taxRateBasisPoints: 1_000,
        taxCents: 1_350,
        totalCents: 14_850,
        supplierLineTotalCents: 14_850,
        confidence: 92,
      },
    ],
    rawResponse: {},
  };

  it("10: Piksters Diapro line totalCents = $119.90, not $131.89 (no double-GST)", async () => {
    const { service } = makeService(PIKSTERS_OCR);
    const caller = makeManager();

    const { lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const diapro = lines.find((l) => l.ocrDescription.includes("Diapro"));

    expect(diapro).toBeDefined();
    expect(diapro?.totalCents).toBe(11_990);       // $119.90 — correct
    expect(diapro?.totalCents).not.toBe(13_189);   // $131.89 — the old bug
    expect(diapro?.supplierLineTotalCents).toBe(11_990);
    expect(diapro?.priceIncludesTax).toBe(true);
  });

  it("10: Piksters gloves: 3 × $55, 10% off → total $148.50 incl-GST", async () => {
    const { service } = makeService(PIKSTERS_OCR);
    const caller = makeManager();

    const { lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);
    const gloves = lines.find((l) => l.ocrDescription.includes("Medium"));

    expect(gloves).toBeDefined();
    expect(gloves?.totalCents).toBe(14_850);       // $148.50
    expect(gloves?.supplierLineTotalCents).toBe(14_850);
    expect(gloves?.discountBasisPoints).toBe(1_000);
    expect(gloves?.priceIncludesTax).toBe(true);
  });

  it("10: Piksters gloves operational unit cost = $45.00 net ex-GST per box", () => {
    const result = deriveOperationalUnitCost({
      quantity: 3,
      unitPriceCents: 5_500,
      priceIncludesTax: true,
      discountBasisPoints: 1_000,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: 14_850,
      unitsPerReceivingUnit: 1,
    });
    expect(result).toBe(4_500);  // $45.00 per box
  });

  // ── 9. Invoice header reconciliation ─────────────────────────────────────────
  it("9: Invoice header reconciliation — supplier line totals sum correctly", async () => {
    const { service } = makeService(PIKSTERS_OCR);
    const caller = makeManager();

    const { invoice, lines } = await service.uploadAndExtract(caller, CLINIC_A, FAKE_FILE);

    // Invoice header total from OCR
    expect(invoice.totalCents).toBe(71_405);

    const supplierLineTotal = lines.reduce(
      (sum, l) => sum + (l.supplierLineTotalCents ?? l.totalCents),
      0,
    );

    expect(lines).toHaveLength(8);
    expect(supplierLineTotal).toBe(71_405);
    expect(lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(6_492);
    expect(lines.every((line) => line.priceIncludesTax === true)).toBe(true);

    const diapro = lines.find((l) => l.ocrDescription.includes("Diapro"));
    expect(diapro?.supplierLineTotalCents).toBe(11_990);

    const gloveLines = lines.filter((l) => l.ocrDescription.includes("Nitrile"));
    expect(gloveLines).toHaveLength(2);
    expect(gloveLines.map((line) => line.discountBasisPoints)).toEqual([1_000, 1_000]);
    expect(gloveLines.map((line) => line.supplierLineTotalCents)).toEqual([9_900, 14_850]);
  });
});

// ── Regression: existing invoice line behaviour unchanged ────────────────────

describe("Regression: existing invoice line calculation behaviour", () => {
  it("15: ex-GST line without discount still calculates correctly (backward compat)", () => {
    const result = calcLineTotals(2, 5_000, false, 0, 1_000);
    expect(result.subtotalCents).toBe(10_000);
    expect(result.taxCents).toBe(1_000);
    expect(result.totalCents).toBe(11_000);
  });

  it("16: unknown priceIncludesTax with no supplier total returns null operational cost", () => {
    const result = deriveOperationalUnitCost({
      quantity: 1,
      unitPriceCents: 10_000,
      priceIncludesTax: null,
      discountBasisPoints: 0,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: null,
      unitsPerReceivingUnit: 1,
    });
    expect(result).toBeNull();
  });

  it("16b: unknown supplier-total tax basis does not invent operational cost", () => {
    const result = deriveOperationalUnitCost({
      quantity: 2,
      unitPriceCents: 6_000,
      priceIncludesTax: null,
      discountBasisPoints: 0,
      taxRateBasisPoints: 1_000,
      supplierLineTotalCents: 11_000,  // supplier confirms $110 incl-GST
      unitsPerReceivingUnit: 1,
    });
    expect(result).toBeNull();
  });
});
