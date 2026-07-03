import {
  cleanImportText,
  extractEmbeddedSupplierSku,
  normaliseImportRow,
} from "../src/services/catalogueImportNormalisation.js";

describe("catalogue import normalisation", () => {
  it.each([
    ["DL2371 Clinicare Alcohol Free Instrument Grade Flat Pack", "DL2371", "Clinicare Alcohol Free Instrument Grade Flat Pack"],
    ["3M5914A3B -- FILTEK SUPREME XTE", "3M5914A3B", "FILTEK SUPREME XTE"],
    ["ADA201 - Ozbibs Dental Bibs Blue", "ADA201", "Ozbibs Dental Bibs Blue"],
    ["ADA201: Ozbibs Dental Bibs Blue", "ADA201", "Ozbibs Dental Bibs Blue"],
    ["ADA201 | Ozbibs Dental Bibs Blue", "ADA201", "Ozbibs Dental Bibs Blue"],
    ["Ozbibs Dental Bibs Blue (ADA201)", "ADA201", "Ozbibs Dental Bibs Blue"],
  ])("extracts embedded supplier SKU from %s", (input, supplierSku, productName) => {
    expect(extractEmbeddedSupplierSku(input)).toEqual({ supplierSku, productName });
  });

  it("cleans whitespace, tabs, OCR punctuation and repeated separators", () => {
    expect(cleanImportText("  ADA201\t--\t  Ozbibs   Dental   Bibs  ")).toBe(
      "ADA201 -- Ozbibs Dental Bibs",
    );
  });

  it("does not overwrite an existing supplier SKU column", () => {
    expect(
      normaliseImportRow({
        supplierSku: "EXISTING-1",
        productName: "ADA201 - Ozbibs Dental Bibs Blue",
        unitPrice: "$1,234.50",
        gst: "$12.30",
      }),
    ).toMatchObject({
      supplierSku: "EXISTING-1",
      productName: "ADA201 - Ozbibs Dental Bibs Blue",
      unitPrice: "1234.50",
      gst: "12.30",
      extractedSupplierSku: null,
    });
  });
});
