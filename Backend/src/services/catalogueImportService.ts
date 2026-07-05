/**
 * Catalogue Import Service — Sprint O.
 *
 * Two-phase workflow:
 *   1. preview()  — parse file, match products, return rows with status
 *   2. confirm()  — upsert supplier catalogue entries for matched rows
 *
 * Supports CSV and Excel (.xlsx) file formats.
 *
 * Expected columns (case-insensitive, order-independent):
 *   Required: description (or name), unit_cost (or cost, price)
 *   Optional: supplier_sku (or sku), unit_of_measure (or uom), barcode
 *
 * unit_cost is interpreted as decimal dollars (e.g. 12.50 = $12.50 = 1250 cents).
 */

import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { ProductMatchingService } from "./productMatchingService.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type {
  ImportConfirmResult,
  ImportPreviewResult,
  ImportRow,
  ReviewedCatalogueImportResult,
  ReviewedCatalogueImportRow,
} from "../types/supplier.js";
import { normaliseImportRow } from "./catalogueImportNormalisation.js";

// ─── Supported file formats ───────────────────────────────────────────────────

export type ImportFormat = "csv" | "xlsx";

// ─── Raw parsed row (pre-match) ───────────────────────────────────────────────

type RawRow = {
  rowNumber: number;
  supplierSku: string | null;
  description: string | null;
  rawUnitCost: string | null;
  unitCostCents: number | null;
  unitOfMeasure: string | null;
  barcodeValue: string | null;
  parseError: string | null;
};

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
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

function parseCsvBuffer(buffer: Buffer): RawRow[] {
  const text = buffer.toString("utf-8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new AppError(400, "IMPORT_EMPTY", "The uploaded file contains no data");
  }

  const headerLine = lines[0] ?? "";
  const headers = parseCsvLine(headerLine).map((h) => h.toLowerCase().replace(/\s+/g, "_"));

  const colIdx = resolveColumnIndices(headers);

  return lines.slice(1).map((line, idx) => {
    const rowNumber = idx + 2; // 1-indexed, row 1 = header
    const fields = parseCsvLine(line);
    return extractRawRow(rowNumber, fields, colIdx);
  });
}

// ─── XLSX parsing ─────────────────────────────────────────────────────────────

async function parseXlsxBuffer(buffer: Buffer): Promise<RawRow[]> {
  // Dynamic import handles CJS/ESM interop for the xlsx package.
  const XLSX = await import("xlsx");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError(
      400,
      "IMPORT_EMPTY",
      "The Excel file contains no worksheets",
    );
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new AppError(
      400,
      "IMPORT_EMPTY",
      "The Excel file worksheet could not be read",
    );
  }

  const rawData = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (rawData.length === 0) {
    throw new AppError(400, "IMPORT_EMPTY", "The Excel file contains no data");
  }

  const headerRow = rawData[0];
  if (!Array.isArray(headerRow)) {
    throw new AppError(
      400,
      "IMPORT_INVALID",
      "The Excel file does not have a valid header row",
    );
  }

  const headers = headerRow.map((h: unknown) => {
    const str = typeof h === "string" || typeof h === "number" ? String(h) : "";
    return str.toLowerCase().replace(/\s+/g, "_");
  });

  const colIdx = resolveColumnIndices(headers);

  return rawData.slice(1).map((row, idx) => {
    const rowNumber = idx + 2;
    const fields = Array.isArray(row)
      ? (row as unknown[]).map((v) => {
          if (typeof v === "string") return v.trim();
          if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
          return "";
        })
      : [];
    return extractRawRow(rowNumber, fields, colIdx);
  });
}

// ─── Column resolution ────────────────────────────────────────────────────────

type ColumnIndices = {
  description: number;
  unitCost: number;
  supplierSku: number | null;
  unitOfMeasure: number | null;
  barcode: number | null;
};

const DESCRIPTION_ALIASES = ["description", "name", "product_name", "product"];
const UNIT_COST_ALIASES = ["unit_cost", "cost", "price", "unit_price", "unit_cost_(aud)", "unit_cost_(incl._gst)"];
const SKU_ALIASES = ["supplier_sku", "sku", "supplier_code", "item_code", "code"];
const UOM_ALIASES = ["unit_of_measure", "uom", "unit", "units"];
const BARCODE_ALIASES = ["barcode", "barcode_value", "ean", "gtin"];

function findColumn(headers: string[], aliases: string[]): number | null {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return null;
}

function resolveColumnIndices(headers: string[]): ColumnIndices {
  const descriptionIdx = findColumn(headers, DESCRIPTION_ALIASES);
  const unitCostIdx = findColumn(headers, UNIT_COST_ALIASES);

  if (descriptionIdx === null) {
    throw new AppError(
      400,
      "IMPORT_MISSING_COLUMN",
      `File is missing a required column. Expected one of: ${DESCRIPTION_ALIASES.join(", ")}`,
    );
  }
  if (unitCostIdx === null) {
    throw new AppError(
      400,
      "IMPORT_MISSING_COLUMN",
      `File is missing a required column. Expected one of: ${UNIT_COST_ALIASES.join(", ")}`,
    );
  }

  return {
    description: descriptionIdx,
    unitCost: unitCostIdx,
    supplierSku: findColumn(headers, SKU_ALIASES),
    unitOfMeasure: findColumn(headers, UOM_ALIASES),
    barcode: findColumn(headers, BARCODE_ALIASES),
  };
}

function extractRawRow(
  rowNumber: number,
  fields: string[],
  colIdx: ColumnIndices,
): RawRow {
  const get = (idx: number | null): string | null => {
    if (idx === null) return null;
    const val = fields[idx]?.trim() ?? "";
    return val.length > 0 ? val : null;
  };

  const normalized = normaliseImportRow({
    supplierSku: get(colIdx.supplierSku),
    barcode: get(colIdx.barcode),
    productName: get(colIdx.description),
    unitPrice: get(colIdx.unitCost),
    quantityText: get(colIdx.unitOfMeasure),
  });
  const description = normalized.productName;
  const rawUnitCost = normalized.unitPrice;

  let unitCostCents: number | null = null;
  let parseError: string | null = null;

  if (!description && !rawUnitCost) {
    // Completely empty row — skip silently
    return {
      rowNumber,
      supplierSku: null,
      description: null,
      rawUnitCost: null,
      unitCostCents: null,
      unitOfMeasure: null,
      barcodeValue: null,
      parseError: "Empty row",
    };
  }

  if (!description) {
    parseError = "Missing description/name";
  }

  if (rawUnitCost !== null) {
    const cleaned = rawUnitCost.replace(/[$,\s]/g, "");
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed) || parsed < 0) {
      parseError = `Invalid unit cost: "${rawUnitCost}"`;
    } else {
      unitCostCents = Math.round(parsed * 100);
    }
  } else {
    parseError = "Missing unit cost";
  }

  return {
    rowNumber,
    supplierSku: normalized.supplierSku,
    description,
    rawUnitCost,
    unitCostCents,
    unitOfMeasure: normalized.quantityText,
    barcodeValue: normalized.barcode,
    parseError,
  };
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createCatalogueImportService(
  supplierCatalogueRepository: SupplierCatalogueRepository,
  supplierRepository: SupplierRepository,
  productMatchingService: ProductMatchingService,
  catalogRepository?: CatalogRepository,
  inventoryRepository?: InventoryRepository,
) {
  async function parseFile(
    buffer: Buffer,
    format: ImportFormat,
  ): Promise<RawRow[]> {
    if (format === "csv") {
      return parseCsvBuffer(buffer);
    }
    return parseXlsxBuffer(buffer);
  }

  async function assertSupplierActive(supplierId: string): Promise<void> {
    const supplier = await supplierRepository.findSupplierById(supplierId);
    if (!supplier) {
      throw new AppError(404, "NOT_FOUND", "Supplier not found");
    }
    if (!supplier.active) {
      throw new AppError(422, "SUPPLIER_INACTIVE", "Supplier is not active");
    }
  }

  function assertClinicAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(403, "CATALOGUE_IMPORT_FORBIDDEN", "Access denied for this clinic");
    }
  }

  function slugSku(value: string): string {
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized.slice(0, 48) || "IMPORTED";
  }

  async function buildUniqueImportedSku(row: ReviewedCatalogueImportRow): Promise<string> {
    if (!catalogRepository) {
      throw new AppError(500, "INTERNAL_ERROR", "Catalogue product creation is not configured");
    }

    const base = slugSku(row.supplierSku ?? row.description ?? `ROW-${String(row.rowNumber)}`);
    const candidates = [
      base,
      `${base}-${String(row.rowNumber)}`,
      `${base}-${String(Date.now()).slice(-6)}`,
    ];

    for (const candidate of candidates) {
      const existing = await catalogRepository.findMasterItemBySku(candidate);
      if (!existing) return candidate;
    }

    return `${base.slice(0, 39)}-${String(row.rowNumber)}-${String(Date.now()).slice(-6)}`;
  }

  async function createProductForReviewedRow(
    clinicId: string,
    supplierId: string,
    row: ReviewedCatalogueImportRow,
  ): Promise<string> {
    if (!catalogRepository || !inventoryRepository) {
      throw new AppError(500, "INTERNAL_ERROR", "Catalogue product creation is not configured");
    }
    if (!row.description?.trim()) {
      throw new AppError(422, "VALIDATION_ERROR", "Product description is required to create a catalogue product");
    }

    const stockUnit = row.unitOfMeasure?.trim() || "unit";
    const sku = await buildUniqueImportedSku(row);
    const masterItem = await catalogRepository.createMasterItem({
      sku,
      name: row.description.trim(),
      description: row.description.trim(),
      category: "Imported Catalogue",
      stockUnit,
      receivingUnit: stockUnit,
      unitsPerReceivingUnit: 1,
      defaultUnitCostCents: row.unitCostCents ?? 0,
    });

    await inventoryRepository.createClinicInventoryItem({
      clinicId,
      masterCatalogItemId: masterItem.id,
      quantityOnHand: 0,
      reorderPoint: 0,
      unitCostOverrideCents: null,
      supplierPreference: null,
    });

    await inventoryRepository.createProductSupplier({
      clinicId,
      productId: masterItem.id,
      supplierId,
      supplierName: null,
      supplierSku: row.supplierSku,
      supplierBarcode: null,
      unitCostCents: row.unitCostCents,
      packSize: null,
      isPreferred: true,
      active: true,
    });

    return masterItem.id;
  }

  return {
    /**
     * Phase 1: parse the file and run product matching.
     * No database writes — returns rows with match status for review.
     */
    async preview(
      supplierId: string,
      buffer: Buffer,
      format: ImportFormat,
    ): Promise<ImportPreviewResult> {
      await assertSupplierActive(supplierId);

      const rawRows = await parseFile(buffer, format);

      // Filter completely empty rows
      const dataRows = rawRows.filter(
        (r) => r.description !== null || r.rawUnitCost !== null,
      );

      if (dataRows.length === 0) {
        throw new AppError(
          400,
          "IMPORT_EMPTY",
          "No data rows found in the uploaded file",
        );
      }

      const rows: ImportRow[] = await Promise.all(
        dataRows.map(async (raw): Promise<ImportRow> => {
          if (raw.parseError) {
            return {
              rowNumber: raw.rowNumber,
              supplierSku: raw.supplierSku,
              description: raw.description,
              rawUnitCost: raw.rawUnitCost,
              unitCostCents: null,
              unitOfMeasure: raw.unitOfMeasure,
              matchedProductId: null,
              matchedProductName: null,
              matchedProductSku: null,
              matchStatus: "unmatched",
              error: raw.parseError,
            };
          }

          const match = await productMatchingService.matchProduct({
            supplierSku: raw.supplierSku,
            description: raw.description,
            barcodeValue: raw.barcodeValue,
          });

          return {
            rowNumber: raw.rowNumber,
            supplierSku: raw.supplierSku,
            description: raw.description,
            rawUnitCost: raw.rawUnitCost,
            unitCostCents: raw.unitCostCents,
            unitOfMeasure: raw.unitOfMeasure,
            matchedProductId: match.productId,
            matchedProductName: match.productName,
            matchedProductSku: match.productSku,
            matchStatus: match.matchStatus,
            error: null,
          };
        }),
      );

      const matchedRows = rows.filter((r) => r.matchStatus !== "unmatched" && !r.error).length;
      const unmatchedRows = rows.filter((r) => r.matchStatus === "unmatched" && !r.error).length;
      const errorRows = rows.filter((r) => r.error !== null).length;

      return {
        supplierId,
        totalRows: rows.length,
        matchedRows,
        unmatchedRows,
        errorRows,
        rows,
      };
    },

    /**
     * Phase 2: persist catalogue entries for all successfully matched rows.
     * Rows with errors or unmatched status are skipped (not partial-imported).
     *
     * @param manualMappings  — caller-supplied productId overrides for unmatched rows
     *                          keyed by rowNumber.
     */
    async confirm(
      supplierId: string,
      buffer: Buffer,
      format: ImportFormat,
      manualMappings?: Record<number, string>,
    ): Promise<ImportConfirmResult> {
      await assertSupplierActive(supplierId);

      const rawRows = await parseFile(buffer, format);
      const dataRows = rawRows.filter(
        (r) => r.description !== null || r.rawUnitCost !== null,
      );

      if (dataRows.length === 0) {
        throw new AppError(
          400,
          "IMPORT_EMPTY",
          "No data rows found in the uploaded file",
        );
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      const rows: ImportRow[] = [];

      for (const raw of dataRows) {
        if (raw.parseError) {
          errors++;
          rows.push({
            rowNumber: raw.rowNumber,
            supplierSku: raw.supplierSku,
            description: raw.description,
            rawUnitCost: raw.rawUnitCost,
            unitCostCents: null,
            unitOfMeasure: raw.unitOfMeasure,
            matchedProductId: null,
            matchedProductName: null,
            matchedProductSku: null,
            matchStatus: "unmatched",
            error: raw.parseError,
          });
          continue;
        }

        const manualProductId = manualMappings?.[raw.rowNumber] ?? null;
        const match = await productMatchingService.matchProduct({
          supplierSku: raw.supplierSku,
          description: raw.description,
          barcodeValue: raw.barcodeValue,
          manualProductId,
        });

        if (match.matchStatus === "unmatched") {
          skipped++;
          rows.push({
            rowNumber: raw.rowNumber,
            supplierSku: raw.supplierSku,
            description: raw.description,
            rawUnitCost: raw.rawUnitCost,
            unitCostCents: raw.unitCostCents,
            unitOfMeasure: raw.unitOfMeasure,
            matchedProductId: null,
            matchedProductName: null,
            matchedProductSku: null,
            matchStatus: "unmatched",
            error: "No product match found — skipped",
          });
          continue;
        }

        // Both productId and unitCostCents are guaranteed non-null here:
        // productId is set (matchStatus !== "unmatched"), and unitCostCents
        // is non-null (parse error rows are handled above).
        const productId = match.productId ?? "";
        const unitCostCents = raw.unitCostCents ?? 0;

        try {
          const result = await supplierCatalogueRepository.upsertSupplierProduct({
            supplierId,
            productId,
            supplierSku: raw.supplierSku,
            supplierDescription: raw.description,
            unitCostCents,
            unitOfMeasure: raw.unitOfMeasure,
          });

          if (result.created) {
            imported++;
          } else {
            updated++;
          }

          rows.push({
            rowNumber: raw.rowNumber,
            supplierSku: raw.supplierSku,
            description: raw.description,
            rawUnitCost: raw.rawUnitCost,
            unitCostCents: raw.unitCostCents,
            unitOfMeasure: raw.unitOfMeasure,
            matchedProductId: match.productId,
            matchedProductName: match.productName,
            matchedProductSku: match.productSku,
            matchStatus: match.matchStatus,
            error: null,
          });
        } catch (err) {
          errors++;
          const message =
            err instanceof Error ? err.message : "Unknown import error";
          rows.push({
            rowNumber: raw.rowNumber,
            supplierSku: raw.supplierSku,
            description: raw.description,
            rawUnitCost: raw.rawUnitCost,
            unitCostCents: raw.unitCostCents,
            unitOfMeasure: raw.unitOfMeasure,
            matchedProductId: match.productId,
            matchedProductName: match.productName,
            matchedProductSku: match.productSku,
            matchStatus: match.matchStatus,
            error: message,
          });
        }
      }

      return {
        supplierId,
        imported,
        updated,
        skipped,
        errors,
        rows,
      };
    },

    async confirmReviewedRows(
      caller: AuthenticatedUser,
      supplierId: string,
      clinicId: string,
      reviewedRows: ReviewedCatalogueImportRow[],
    ): Promise<ReviewedCatalogueImportResult> {
      assertClinicAccess(caller, clinicId);
      await assertSupplierActive(supplierId);

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      let createdProducts = 0;
      const rows: ImportRow[] = [];

      for (const row of reviewedRows) {
        if (row.state === "Skipped") {
          skipped++;
          rows.push({
            rowNumber: row.rowNumber,
            supplierSku: row.supplierSku,
            description: row.description,
            rawUnitCost: row.unitCostCents === null ? null : (row.unitCostCents / 100).toFixed(2),
            unitCostCents: row.unitCostCents,
            unitOfMeasure: row.unitOfMeasure,
            matchedProductId: row.matchedProductId,
            matchedProductName: null,
            matchedProductSku: null,
            matchStatus: "unmatched",
            error: "Skipped by reviewer",
          });
          continue;
        }

        try {
          const productId = row.state === "Ready to Create"
            ? await createProductForReviewedRow(clinicId, supplierId, row)
            : row.matchedProductId;

          if (!productId) {
            throw new AppError(422, "VALIDATION_ERROR", "Reviewed row is not matched to a product");
          }

          const result = await supplierCatalogueRepository.upsertSupplierProduct({
            supplierId,
            productId,
            supplierSku: row.supplierSku,
            supplierDescription: row.description,
            unitCostCents: row.unitCostCents ?? 0,
            unitOfMeasure: row.unitOfMeasure,
          });

          if (row.state === "Ready to Create") {
            createdProducts++;
            imported++;
          } else if (result.created) {
            imported++;
          } else {
            updated++;
          }

          rows.push({
            rowNumber: row.rowNumber,
            supplierSku: row.supplierSku,
            description: row.description,
            rawUnitCost: row.unitCostCents === null ? null : (row.unitCostCents / 100).toFixed(2),
            unitCostCents: row.unitCostCents,
            unitOfMeasure: row.unitOfMeasure,
            matchedProductId: productId,
            matchedProductName: null,
            matchedProductSku: null,
            matchStatus: row.state === "Ready to Create" ? "manual" : "manual",
            error: null,
          });
        } catch (err) {
          errors++;
          rows.push({
            rowNumber: row.rowNumber,
            supplierSku: row.supplierSku,
            description: row.description,
            rawUnitCost: row.unitCostCents === null ? null : (row.unitCostCents / 100).toFixed(2),
            unitCostCents: row.unitCostCents,
            unitOfMeasure: row.unitOfMeasure,
            matchedProductId: row.matchedProductId,
            matchedProductName: null,
            matchedProductSku: null,
            matchStatus: "unmatched",
            error: err instanceof Error ? err.message : "Unknown import error",
          });
        }
      }

      return {
        supplierId,
        imported,
        updated,
        skipped,
        errors,
        rows,
        createdProducts,
      };
    },
  };
}

export type CatalogueImportService = ReturnType<
  typeof createCatalogueImportService
>;
