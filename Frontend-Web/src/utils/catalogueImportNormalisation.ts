export type ImportNormalisationInput = {
  productName?: string | null;
  supplierSku?: string | null;
  barcode?: string | null;
  unitPrice?: string | null;
  gst?: string | null;
  quantityText?: string | null;
  manufacturer?: string | null;
  supplierName?: string | null;
};

export type ImportNormalisationResult = {
  productName: string | null;
  supplierSku: string | null;
  barcode: string | null;
  unitPrice: string | null;
  gst: string | null;
  quantityText: string | null;
  manufacturer: string | null;
  supplierName: string | null;
  extractedSupplierSku: string | null;
};

function blankToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

export function cleanImportText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return blankToNull(
    value
      .replace(/\t+/g, " ")
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/^[\s:;,.|/\\-]+|[\s:;,.|/\\-]+$/g, "")
      .replace(/\s*([|:])\s*/g, " $1 ")
      .replace(/\s*-{2,}\s*/g, " -- ")
      .replace(/\s+-\s+/g, " - ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function cleanMoneyText(value: string | null | undefined): string | null {
  const cleaned = cleanImportText(value);
  if (!cleaned) return null;
  return blankToNull(cleaned.replace(/[$,]/g, "").replace(/\s+/g, ""));
}

function looksLikeSupplierSku(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\d/.test(value) && /^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/.test(value);
}

export function extractEmbeddedSupplierSku(productName: string | null | undefined): {
  supplierSku: string | null;
  productName: string | null;
} {
  const cleaned = cleanImportText(productName);
  if (!cleaned) return { supplierSku: null, productName: null };

  const parenthesized = cleaned.match(/^(.+?)\s*\(([^()]{2,40})\)$/);
  if (parenthesized?.[1] && parenthesized[2] && looksLikeSupplierSku(parenthesized[2].trim())) {
    return {
      supplierSku: parenthesized[2].trim(),
      productName: cleanImportText(parenthesized[1]),
    };
  }

  const separated = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{1,39})\s*(?:--+|-|:|\|)\s*(.+)$/);
  if (separated?.[1] && separated[2] && looksLikeSupplierSku(separated[1].trim())) {
    return {
      supplierSku: separated[1].trim(),
      productName: cleanImportText(separated[2]),
    };
  }

  const leading = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{1,39})\s+(.+)$/);
  if (leading?.[1] && leading[2] && looksLikeSupplierSku(leading[1].trim())) {
    return {
      supplierSku: leading[1].trim(),
      productName: cleanImportText(leading[2]),
    };
  }

  return { supplierSku: null, productName: cleaned };
}

export function normaliseImportRow(input: ImportNormalisationInput): ImportNormalisationResult {
  const suppliedSku = cleanImportText(input.supplierSku);
  const extracted = suppliedSku
    ? { supplierSku: null, productName: cleanImportText(input.productName) }
    : extractEmbeddedSupplierSku(input.productName);

  return {
    productName: extracted.productName,
    supplierSku: suppliedSku ?? extracted.supplierSku,
    barcode: cleanImportText(input.barcode),
    unitPrice: cleanMoneyText(input.unitPrice),
    gst: cleanMoneyText(input.gst),
    quantityText: cleanImportText(input.quantityText),
    manufacturer: cleanImportText(input.manufacturer),
    supplierName: cleanImportText(input.supplierName),
    extractedSupplierSku: suppliedSku ? null : extracted.supplierSku,
  };
}
