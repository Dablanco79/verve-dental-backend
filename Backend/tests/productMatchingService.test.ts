/**
 * Product Matching Service unit tests — Sprint O
 *
 * Tests the four matching strategies:
 *   1. barcode match
 *   2. SKU match
 *   3. exact name match (case-insensitive)
 *   4. manual productId override
 *   5. unmatched — no strategy succeeds
 */
import { createProductMatchingService } from "../src/services/productMatchingService.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { buildMasterCatalogSeed, buildBarcodeMappingSeed } from "../src/repositories/seed/inventorySeed.js";

describe("ProductMatchingService", () => {
  function buildService() {
    const repo = createInMemoryCatalogRepository();
    return createProductMatchingService(repo);
  }

  it("matches by barcode (strategy 1)", async () => {
    const service = buildService();

    const barcodes = buildBarcodeMappingSeed();
    const firstBarcode = barcodes[0];
    if (!firstBarcode) return; // No barcode seed data

    const result = await service.matchProduct({
      barcodeValue: firstBarcode.barcodeValue,
    });

    expect(result.matchStatus).toBe("barcode");
    expect(result.productId).toBe(firstBarcode.masterCatalogItemId);
    expect(result.productId).not.toBeNull();
  });

  it("matches by SKU (strategy 2)", async () => {
    const service = buildService();

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items");

    const result = await service.matchProduct({
      supplierSku: item.sku,
    });

    expect(result.matchStatus).toBe("sku");
    expect(result.productId).toBe(item.id);
  });

  it("matches by SKU case-insensitively", async () => {
    const service = buildService();
    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items");

    const result = await service.matchProduct({
      supplierSku: item.sku.toLowerCase(),
    });

    expect(result.matchStatus).toBe("sku");
    expect(result.productId).toBe(item.id);
  });

  it("matches by exact name (strategy 3)", async () => {
    const service = buildService();
    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items");

    const result = await service.matchProduct({
      description: item.name,
    });

    expect(result.matchStatus).toBe("name");
    expect(result.productId).toBe(item.id);
  });

  it("matches by name case-insensitively", async () => {
    const service = buildService();
    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items");

    const result = await service.matchProduct({
      description: item.name.toUpperCase(),
    });

    expect(result.matchStatus).toBe("name");
    expect(result.productId).toBe(item.id);
  });

  it("manual mapping takes priority over barcode (strategy 4)", async () => {
    const service = buildService();
    const items = buildMasterCatalogSeed();
    const manualItem = items[1];
    if (!manualItem) return; // Not enough seed items

    const barcodes = buildBarcodeMappingSeed();
    const barcode = barcodes[0];
    if (!barcode || manualItem.id === barcode.masterCatalogItemId) {
      // Would not test priority correctly — skip
      return;
    }

    const result = await service.matchProduct({
      barcodeValue: barcode.barcodeValue,
      manualProductId: manualItem.id,
    });

    expect(result.matchStatus).toBe("manual");
    expect(result.productId).toBe(manualItem.id);
  });

  it("returns unmatched when nothing matches (strategy 5)", async () => {
    const service = buildService();

    const result = await service.matchProduct({
      supplierSku: "NONEXISTENT-SKU-12345",
      description: "A product that does not exist in any catalog",
    });

    expect(result.matchStatus).toBe("unmatched");
    expect(result.productId).toBeNull();
  });

  it("returns unmatched when row has no identifying information", async () => {
    const service = buildService();

    const result = await service.matchProduct({});

    expect(result.matchStatus).toBe("unmatched");
    expect(result.productId).toBeNull();
  });

  it("prefers barcode over SKU when both match different items", async () => {
    const service = buildService();

    const barcodes = buildBarcodeMappingSeed();
    const barcode = barcodes[0];
    if (!barcode) return;

    const items = buildMasterCatalogSeed();
    // Pick an item that is NOT the barcoded one for the SKU match
    const skuItem = items.find((i) => i.id !== barcode.masterCatalogItemId);
    if (!skuItem) return;

    const result = await service.matchProduct({
      barcodeValue: barcode.barcodeValue,
      supplierSku: skuItem.sku,
    });

    // Strategy 1 (barcode) should win
    expect(result.matchStatus).toBe("barcode");
    expect(result.productId).toBe(barcode.masterCatalogItemId);
  });
});
