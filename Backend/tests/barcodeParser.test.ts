import {
  detectBarcodeFormat,
  parseBarcode,
} from "../src/utils/barcodeParser.js";

describe("barcodeParser (Session 3)", () => {
  it("detects EAN-13 format", () => {
    expect(detectBarcodeFormat("9301234567890")).toBe("ean13");
  });

  it("detects GS1 format with GTIN application identifier", () => {
    expect(detectBarcodeFormat("01093012345678901724123110")).toBe("gs1");
  });

  it("detects QR format for Verve SKU payloads", () => {
    expect(detectBarcodeFormat("VRV-CMP-001")).toBe("qr");
  });

  it("detects Code128 format for alphanumeric product codes", () => {
    expect(detectBarcodeFormat("VRVEJT001")).toBe("code128");
  });

  it("parses EAN-13 with a single lookup key", () => {
    const parsed = parseBarcode("9301234567890");

    expect(parsed).toEqual({
      rawValue: "9301234567890",
      detectedFormat: "ean13",
      lookupKeys: ["9301234567890"],
    });
  });

  it("parses GS1 and extracts EAN-13 GTIN fallback keys", () => {
    const parsed = parseBarcode("01093012345678901724123110");

    expect(parsed?.detectedFormat).toBe("gs1");
    expect(parsed?.lookupKeys).toEqual([
      "01093012345678901724123110",
      "09301234567890",
      "9301234567890",
    ]);
  });

  it("respects an explicit barcode format hint", () => {
    const parsed = parseBarcode("9301234567894", "data_matrix");

    expect(parsed).toEqual({
      rawValue: "9301234567894",
      detectedFormat: "data_matrix",
      lookupKeys: ["9301234567894"],
    });
  });

  it("returns null for empty input", () => {
    expect(parseBarcode("")).toBeNull();
    expect(parseBarcode("   ")).toBeNull();
  });
});
