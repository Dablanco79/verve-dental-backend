import type { BarcodeFormat } from "../types/inventory.js";

const GS1_GTIN_AI_PATTERN = /^01(\d{14})/;
const EAN13_PATTERN = /^\d{13}$/;
const SKU_PATTERN = /^VRV-[A-Z0-9-]+$/i;

export type ParsedBarcode = {
  rawValue: string;
  detectedFormat: BarcodeFormat;
  lookupKeys: string[];
};

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const key of keys) {
    const normalized = key.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function gtin14ToLookupKeys(gtin14: string): string[] {
  const keys = [gtin14];

  if (gtin14.length === 14 && gtin14.startsWith("0")) {
    keys.push(gtin14.slice(1));
  }

  return keys;
}

function extractGs1LookupKeys(value: string): string[] {
  const match = GS1_GTIN_AI_PATTERN.exec(value);

  if (!match?.[1]) {
    return [value];
  }

  return uniqueKeys([value, ...gtin14ToLookupKeys(match[1])]);
}

export function detectBarcodeFormat(value: string): BarcodeFormat {
  const trimmed = value.trim();

  if (GS1_GTIN_AI_PATTERN.test(trimmed)) {
    return "gs1";
  }

  if (EAN13_PATTERN.test(trimmed)) {
    return "ean13";
  }

  if (SKU_PATTERN.test(trimmed)) {
    return "qr";
  }

  if (/^[A-Z0-9]+$/i.test(trimmed)) {
    return "code128";
  }

  return "qr";
}

function buildLookupKeys(value: string, format: BarcodeFormat): string[] {
  switch (format) {
    case "gs1":
      return uniqueKeys(extractGs1LookupKeys(value));
    case "ean13":
    case "data_matrix":
      return uniqueKeys([value]);
    case "code128":
    case "qr":
      return uniqueKeys([value]);
    default:
      return uniqueKeys([value]);
  }
}

export function parseBarcode(
  rawValue: string,
  hintFormat?: BarcodeFormat,
): ParsedBarcode | null {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  const detectedFormat = hintFormat ?? detectBarcodeFormat(trimmed);

  return {
    rawValue: trimmed,
    detectedFormat,
    lookupKeys: buildLookupKeys(trimmed, detectedFormat),
  };
}
