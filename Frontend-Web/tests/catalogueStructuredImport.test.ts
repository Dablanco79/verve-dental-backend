import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { analyseStructuredImportFile } from "../src/utils/catalogueStructuredImport.js";

function buildSpreadsheetFile(
  bookType: "xlsx" | "xls",
  fileName: string,
): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Supplier", "Product", "Quantity", "Unit Price", "GST", "supplier_sku"],
      ["Dentàvision", "Céramique Polishing Kit", "2 kits", "12.50", "1.25", "CER-100"],
    ]),
    "Catalogue",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer;
  return new File([bytes], fileName);
}

describe("structured catalogue spreadsheet compatibility", () => {
  it.each([
    ["xlsx", "catalogue.xlsx"],
    ["xls", "catalogue.xls"],
  ] as const)("parses a valid %s file in the browser workflow", async (bookType, fileName) => {
    const analysis = await analyseStructuredImportFile(
      buildSpreadsheetFile(bookType, fileName),
    );

    expect(analysis.format).toBe("xlsx");
    expect(analysis.hasSupplierColumn).toBe(true);
    expect(analysis.rows).toHaveLength(1);
    expect(analysis.rows[0]).toMatchObject({
      supplierName: "Dentàvision",
      productName: "Céramique Polishing Kit",
      quantity: "2 kits",
      unitPrice: "12.50",
      gst: "1.25",
      supplierSku: "CER-100",
    });
  });

  it("preserves CSV ingestion", async () => {
    const file = new File(
      [
        "Supplier,Product,Quantity,Unit Price,GST,supplier_sku\n" +
          "Dentavision,Polishing Kit,2 kits,12.50,1.25,CER-100\n",
      ],
      "catalogue.csv",
      { type: "text/csv" },
    );

    const analysis = await analyseStructuredImportFile(file);

    expect(analysis.format).toBe("csv");
    expect(analysis.rows[0]).toMatchObject({
      supplierName: "Dentavision",
      productName: "Polishing Kit",
      supplierSku: "CER-100",
    });
  });

  it("rejects a malformed XLSX container", async () => {
    const malformed = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03])],
      "malformed.xlsx",
    );

    await expect(analyseStructuredImportFile(malformed)).rejects.toThrow();
  });
});
