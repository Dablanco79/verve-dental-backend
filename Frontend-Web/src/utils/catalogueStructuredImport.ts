import { cleanImportText, normaliseImportRow } from "./catalogueImportNormalisation.js";

export type StructuredImportFormat = "csv" | "xlsx";

export type StructuredImportRow = {
  rowNumber: number;
  values: string[];
  supplierName: string | null;
  supplierSku: string | null;
  barcode: string | null;
  productName: string | null;
  quantity: string | null;
  unitPrice: string | null;
  gst: string | null;
  manufacturer: string | null;
};

export type StructuredSupplierGroup = {
  supplierName: string;
  rows: StructuredImportRow[];
};

export type StructuredImportAnalysis = {
  format: StructuredImportFormat;
  headers: string[];
  supplierColumnIndex: number | null;
  hasSupplierColumn: boolean;
  supplierGroups: StructuredSupplierGroup[];
  rows: StructuredImportRow[];
};

type ColumnLookup = {
  supplier: number | null;
  product: number | null;
  supplierSku: number | null;
  barcode: number | null;
  quantity: number | null;
  unitPrice: number | null;
  gst: number | null;
  manufacturer: number | null;
};

const SUPPLIER_ALIASES = ["supplier", "supplier_name", "vendor", "vendor_name", "manufacturer_supplier"];
const PRODUCT_ALIASES = ["product", "product_name", "description", "name", "item", "item_description"];
const SUPPLIER_SKU_ALIASES = ["supplier_sku", "sku", "supplier_code", "item_code", "code", "product_code"];
const BARCODE_ALIASES = ["barcode", "barcode_value", "ean", "gtin", "upc"];
const QUANTITY_ALIASES = ["quantity", "qty", "pack", "pack_text", "pack_size", "unit_of_measure", "uom"];
const UNIT_PRICE_ALIASES = ["unit_price", "unit_cost", "price", "cost", "unit_cost_(aud)", "unit_cost_(incl._gst)"];
const GST_ALIASES = ["gst", "tax", "tax_amount", "gst_amount"];
const MANUFACTURER_ALIASES = ["manufacturer", "brand", "maker"];

function normalizeHeader(value: string): string {
  return (cleanImportText(value) ?? "").toLowerCase().replace(/\s+/g, "_");
}

function findColumn(headers: string[], aliases: string[]): number | null {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index !== -1) return index;
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("The selected file could not be read as binary data."));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("The selected file could not be read."));
    };
    reader.readAsArrayBuffer(file);
  });
}

async function readCsv(file: File): Promise<string[][]> {
  const text = new TextDecoder("utf-8").decode(await readFileBuffer(file));
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

async function readXlsx(file: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const buffer = await readFileBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  return rows.map((row) =>
    Array.isArray(row)
      ? row.map((value) => {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return String(value).trim();
          }
          return "";
        })
      : [],
  );
}

function resolveColumns(headers: string[]): ColumnLookup {
  return {
    supplier: findColumn(headers, SUPPLIER_ALIASES),
    product: findColumn(headers, PRODUCT_ALIASES),
    supplierSku: findColumn(headers, SUPPLIER_SKU_ALIASES),
    barcode: findColumn(headers, BARCODE_ALIASES),
    quantity: findColumn(headers, QUANTITY_ALIASES),
    unitPrice: findColumn(headers, UNIT_PRICE_ALIASES),
    gst: findColumn(headers, GST_ALIASES),
    manufacturer: findColumn(headers, MANUFACTURER_ALIASES),
  };
}

function getCell(values: string[], index: number | null): string | null {
  if (index === null) return null;
  const value = values[index]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function groupRows(rows: StructuredImportRow[]): StructuredSupplierGroup[] {
  const groups = new Map<string, StructuredImportRow[]>();
  for (const row of rows) {
    const supplierName = row.supplierName?.trim();
    if (!supplierName) continue;
    const existing = groups.get(supplierName) ?? [];
    existing.push(row);
    groups.set(supplierName, existing);
  }
  return Array.from(groups.entries()).map(([supplierName, groupRows]) => ({
    supplierName,
    rows: groupRows,
  }));
}

export async function analyseStructuredImportFile(file: File): Promise<StructuredImportAnalysis> {
  const lowerFileName = file.name.toLowerCase();
  const format: StructuredImportFormat = lowerFileName.endsWith(".xlsx") || lowerFileName.endsWith(".xls") ? "xlsx" : "csv";
  const table = format === "xlsx" ? await readXlsx(file) : await readCsv(file);
  const headers = (table[0] ?? []).map((header) => cleanImportText(header) ?? "");
  if (headers.length === 0) {
    throw new Error("The selected structured catalogue file has no header row.");
  }

  const columns = resolveColumns(headers);
  const rows = table.slice(1).map((values, index) => {
    const normalized = normaliseImportRow({
      supplierName: getCell(values, columns.supplier),
      supplierSku: getCell(values, columns.supplierSku),
      barcode: getCell(values, columns.barcode),
      productName: getCell(values, columns.product),
      quantityText: getCell(values, columns.quantity),
      unitPrice: getCell(values, columns.unitPrice),
      gst: getCell(values, columns.gst),
      manufacturer: getCell(values, columns.manufacturer),
    });

    return {
      rowNumber: index + 2,
      values: values.map((value) => cleanImportText(value) ?? ""),
      supplierName: normalized.supplierName,
      supplierSku: normalized.supplierSku,
      barcode: normalized.barcode,
      productName: normalized.productName,
      quantity: normalized.quantityText,
      unitPrice: normalized.unitPrice,
      gst: normalized.gst,
      manufacturer: normalized.manufacturer,
    };
  });

  return {
    format,
    headers,
    supplierColumnIndex: columns.supplier,
    hasSupplierColumn: columns.supplier !== null,
    supplierGroups: groupRows(rows),
    rows,
  };
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export function buildSupplierSubsetFile(
  originalFileName: string,
  analysis: StructuredImportAnalysis,
  group: StructuredSupplierGroup,
): File {
  const supplierColumnIndex = analysis.supplierColumnIndex;
  const headers = analysis.headers.filter((_, index) => index !== supplierColumnIndex);
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...group.rows.map((row) =>
      row.values
        .filter((_, index) => index !== supplierColumnIndex)
        .map(escapeCsvField)
        .join(","),
    ),
  ];
  const baseName = originalFileName.replace(/\.[^.]+$/, "");
  const supplierSlug = group.supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new File([lines.join("\n")], `${baseName}-${supplierSlug || "supplier"}.csv`, { type: "text/csv" });
}
