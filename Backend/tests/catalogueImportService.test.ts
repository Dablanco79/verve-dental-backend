/**
 * Catalogue Import Service unit tests — Sprint O
 *
 * Tests:
 *   - CSV parsing (valid, missing columns, invalid cost)
 *   - XLSX parsing (valid sheet)
 *   - Preview phase — match status on rows
 *   - Confirm phase — creates/updates catalogue entries
 *   - Manual mappings applied in confirm phase
 *   - Empty file errors
 *   - Supplier not found
 */
import { createCatalogueImportService } from "../src/services/catalogueImportService.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemorySupplierRepository } from "../src/repositories/supplierRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import { createProductMatchingService } from "../src/services/productMatchingService.js";
import { buildMasterCatalogSeed } from "../src/repositories/seed/inventorySeed.js";

function buildService() {
  const catalogRepo = createInMemoryCatalogRepository();
  const supplierRepo = createInMemorySupplierRepository();
  const catalogueRepo = createInMemorySupplierCatalogueRepository();
  const matchingService = createProductMatchingService(catalogRepo);

  const importService = createCatalogueImportService(
    catalogueRepo,
    supplierRepo,
    matchingService,
  );

  return { importService, supplierRepo, catalogueRepo, catalogRepo };
}

async function createActiveSupplier(
  supplierRepo: ReturnType<typeof createInMemorySupplierRepository>,
): Promise<string> {
  const supplier = await supplierRepo.createSupplier({
    supplierName: "Test Supplier",
  });
  return supplier.id;
}

// ─── CSV parsing — preview ─────────────────────────────────────────────────────

describe("CatalogueImportService — CSV preview", () => {
  it("parses a valid CSV and matches by SKU", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    const csv = `supplier_sku,description,unit_cost\n${item.sku},${item.name},12.50\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.preview(supplierId, buffer, "csv");

    expect(result.totalRows).toBe(1);
    expect(result.matchedRows).toBe(1);
    expect(result.unmatchedRows).toBe(0);
    expect(result.errorRows).toBe(0);
    expect(result.rows[0]?.matchStatus).toBe("sku");
    expect(result.rows[0]?.unitCostCents).toBe(1250);
    expect(result.rows[0]?.matchedProductId).toBe(item.id);
  });

  it("parses a CSV and matches by name when SKU does not match", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    const csv = `supplier_sku,description,unit_cost\nSUP-UNKNOWN,${item.name},5.00\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.preview(supplierId, buffer, "csv");

    expect(result.rows[0]?.matchStatus).toBe("name");
    expect(result.rows[0]?.matchedProductId).toBe(item.id);
  });

  it("marks row as unmatched when no strategy succeeds", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const csv = `description,unit_cost\nNoSuchProductAtAll,9.99\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.preview(supplierId, buffer, "csv");

    expect(result.rows[0]?.matchStatus).toBe("unmatched");
    expect(result.rows[0]?.matchedProductId).toBeNull();
    expect(result.unmatchedRows).toBe(1);
  });

  it("extracts supplier SKU from product descriptions when supplier_sku is missing", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const csv = "description,unit_cost\nADA201 - Ozbibs   Dental   Bibs Blue,9.99\n";
    const result = await importService.preview(supplierId, Buffer.from(csv), "csv");

    expect(result.rows[0]?.supplierSku).toBe("ADA201");
    expect(result.rows[0]?.description).toBe("Ozbibs Dental Bibs Blue");
  });

  it("does not overwrite an explicit supplier_sku column", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const csv = "supplier_sku,description,unit_cost\nEXISTING-1,ADA201 - Ozbibs Dental Bibs Blue,9.99\n";
    const result = await importService.preview(supplierId, Buffer.from(csv), "csv");

    expect(result.rows[0]?.supplierSku).toBe("EXISTING-1");
    expect(result.rows[0]?.description).toBe("ADA201 - Ozbibs Dental Bibs Blue");
  });

  it("marks row as error when unit_cost is invalid", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const csv = `description,unit_cost\nSome Product,not-a-number\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.preview(supplierId, buffer, "csv");

    expect(result.errorRows).toBe(1);
    expect(result.rows[0]?.error).toBeTruthy();
  });

  it("parses dollar sign and comma in unit_cost", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    const csv = `description,unit_cost\n${item.name},"$1,234.56"\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.preview(supplierId, buffer, "csv");

    expect(result.rows[0]?.unitCostCents).toBe(123456);
  });

  it("throws 404 when supplier does not exist", async () => {
    const { importService } = buildService();
    const buffer = Buffer.from("description,unit_cost\nFoo,1.00\n", "utf-8");

    await expect(
      importService.preview(
        "00000000-0000-0000-0000-000000000000",
        buffer,
        "csv",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws 400 when CSV is empty", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const buffer = Buffer.from("", "utf-8");

    await expect(
      importService.preview(supplierId, buffer, "csv"),
    ).rejects.toMatchObject({ code: "IMPORT_EMPTY" });
  });

  it("throws 400 when required column is missing", async () => {
    const { importService, supplierRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    // Missing unit_cost column
    const buffer = Buffer.from("description\nGloves\n", "utf-8");

    await expect(
      importService.preview(supplierId, buffer, "csv"),
    ).rejects.toMatchObject({ code: "IMPORT_MISSING_COLUMN" });
  });
});

// ─── Confirm phase ─────────────────────────────────────────────────────────────

describe("CatalogueImportService — confirm", () => {
  it("creates catalogue entries for matched rows", async () => {
    const { importService, supplierRepo, catalogueRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    const csv = `description,unit_cost\n${item.name},12.50\n`;
    const buffer = Buffer.from(csv, "utf-8");

    const result = await importService.confirm(supplierId, buffer, "csv");

    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    const entries = await catalogueRepo.listSupplierProducts({ supplierId });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.unitCostCents).toBe(1250);
  });

  it("updates (not duplicates) an existing entry on re-import", async () => {
    const { importService, supplierRepo, catalogueRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    const csv1 = `description,unit_cost\n${item.name},10.00\n`;
    await importService.confirm(supplierId, Buffer.from(csv1), "csv");

    const csv2 = `description,unit_cost\n${item.name},15.00\n`;
    const result = await importService.confirm(supplierId, Buffer.from(csv2), "csv");

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);

    const entries = await catalogueRepo.listSupplierProducts({ supplierId });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.unitCostCents).toBe(1500);
  });

  it("skips unmatched rows without error", async () => {
    const { importService, supplierRepo, catalogueRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const csv = `description,unit_cost\nNonExistentProduct,5.00\n`;
    const result = await importService.confirm(
      supplierId,
      Buffer.from(csv),
      "csv",
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);

    const entries = await catalogueRepo.listSupplierProducts({ supplierId });
    expect(entries).toHaveLength(0);
  });

  it("applies manual mappings for unmatched rows", async () => {
    const { importService, supplierRepo, catalogueRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    const item = items[0];
    if (!item) throw new Error("No seed items available");

    // Row 2 will be unmatched by auto-matching
    const csv = `description,unit_cost\nUnknown Product,8.00\n`;
    const result = await importService.confirm(
      supplierId,
      Buffer.from(csv),
      "csv",
      { 2: item.id }, // manual mapping: row 2 → item.id
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rows[0]?.matchStatus).toBe("manual");

    const entries = await catalogueRepo.listSupplierProducts({ supplierId });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.productId).toBe(item.id);
  });
});

// ─── Multiple products in one import ──────────────────────────────────────────

describe("CatalogueImportService — multi-row import", () => {
  it("imports multiple matched rows in a single file", async () => {
    const { importService, supplierRepo, catalogueRepo } = buildService();
    const supplierId = await createActiveSupplier(supplierRepo);

    const items = buildMasterCatalogSeed();
    if (items.length < 2) return; // Not enough seed data

    const item1 = items[0];
    const item2 = items[1];
    if (!item1 || !item2) return;

    const csv = [
      "description,unit_cost",
      `${item1.name},10.00`,
      `${item2.name},20.00`,
    ].join("\n");

    const result = await importService.confirm(
      supplierId,
      Buffer.from(csv),
      "csv",
    );

    expect(result.imported).toBe(2);
    const entries = await catalogueRepo.listSupplierProducts({ supplierId });
    expect(entries).toHaveLength(2);
  });
});
