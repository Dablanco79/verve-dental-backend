/**
 * Master Product Library Import Service — Master Product Library Import Foundation.
 *
 * Imports a curated Dental Master Product Library (XLSX/CSV) into tenant-owned
 * master catalogue products. This is a catalogue-only import:
 *
 *   - Creates rows in master_catalog_items ONLY.
 *   - NEVER calls inventoryRepository.updateQuantity() or recordAdjustment().
 *   - NEVER calls the scan/receiving/adjustment services.
 *   - If a clinicId is supplied, also provisions a zero-quantity
 *     clinic_inventory_items row per newly created product so it appears in
 *     the clinic's Products/Inventory list — quantityOnHand is always 0.
 *
 * RLS: clinic_inventory_items is a RLS-protected table, but this router is
 * global (not nested under /clinics/:clinicId/*), so the request never gets
 * an RLS session context from rlsTenantContextMiddleware. provisionClinicInventory()
 * explicitly establishes one via runWithTenantContext() for the (already
 * access-checked) target clinicId before writing, and never bypasses RLS
 * globally — it only ever grants the context for the single clinic the
 * caller was authorised for.
 *
 * Expected columns (case-insensitive, order-independent, spaces/underscores
 * interchangeable):
 *   Required: display_name, category, status
 *   Optional: subcategory, brand, variant_attributes, default_unit, notes
 *
 * default_unit is mapped onto both master_catalog_items.stock_unit and
 * .receiving_unit (there is no separate "default unit" column). When absent,
 * blank, or whitespace-only it falls back to "Unit", matching the schema's
 * own column default so imported and manually-created products stay
 * consistent.
 *
 * Duplicate protection: rows are matched against existing master products by
 * normalised (trim + collapse whitespace + lowercase) display_name + category.
 * Duplicates found either in the database or earlier in the same file are
 * skipped, not overwritten.
 */

import type {
  CatalogRepository,
  CreateMasterCatalogItemInput,
} from "../repositories/catalogRepository.js";
import { normaliseMasterProductText } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { AuditService } from "./auditService.js";
import { runWithTenantContext } from "../db/tenantContext.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type { MasterCatalogItem } from "../types/inventory.js";

export type ImportFormat = "csv" | "xlsx";

export type MasterProductImportRowOutcome =
  | "imported"
  | "skipped_duplicate"
  | "skipped_invalid";

export type MasterProductImportRowResult = {
  rowNumber: number;
  displayName: string | null;
  category: string | null;
  outcome: MasterProductImportRowOutcome;
  masterProductId: string | null;
  errors: string[];
};

export type MasterProductImportResult = {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  clinicId: string | null;
  rows: MasterProductImportRowResult[];
};

// ─── Raw parsed row (pre-validation) ──────────────────────────────────────────

type RawRow = {
  rowNumber: number;
  displayName: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  variantAttributes: string | null;
  defaultUnit: string | null;
  status: string | null;
  notes: string | null;
};

// ─── CSV parsing (mirrors catalogueImportService's hand-rolled parser) ────────

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

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

type ColumnIndices = {
  displayName: number;
  category: number;
  status: number;
  subcategory: number | null;
  brand: number | null;
  variantAttributes: number | null;
  defaultUnit: number | null;
  notes: number | null;
};

const DISPLAY_NAME_ALIASES = ["display_name", "displayname", "name", "product_name"];
const CATEGORY_ALIASES = ["category"];
const STATUS_ALIASES = ["status"];
const SUBCATEGORY_ALIASES = ["subcategory", "sub_category"];
const BRAND_ALIASES = ["brand", "manufacturer"];
const VARIANT_ATTRIBUTES_ALIASES = ["variant_attributes", "variantattributes", "attributes", "variant"];
const DEFAULT_UNIT_ALIASES = ["default_unit", "unit", "uom", "unit_of_measure"];
const NOTES_ALIASES = ["notes", "note", "comment", "comments"];

function findColumn(headers: string[], aliases: string[]): number | null {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return null;
}

function resolveColumnIndices(headers: string[]): ColumnIndices {
  const displayNameIdx = findColumn(headers, DISPLAY_NAME_ALIASES);
  const categoryIdx = findColumn(headers, CATEGORY_ALIASES);
  const statusIdx = findColumn(headers, STATUS_ALIASES);

  if (displayNameIdx === null) {
    throw new AppError(
      400,
      "IMPORT_MISSING_COLUMN",
      `File is missing a required column. Expected one of: ${DISPLAY_NAME_ALIASES.join(", ")}`,
    );
  }
  if (categoryIdx === null) {
    throw new AppError(
      400,
      "IMPORT_MISSING_COLUMN",
      `File is missing a required column. Expected one of: ${CATEGORY_ALIASES.join(", ")}`,
    );
  }
  if (statusIdx === null) {
    throw new AppError(
      400,
      "IMPORT_MISSING_COLUMN",
      `File is missing a required column. Expected one of: ${STATUS_ALIASES.join(", ")}`,
    );
  }

  return {
    displayName: displayNameIdx,
    category: categoryIdx,
    status: statusIdx,
    subcategory: findColumn(headers, SUBCATEGORY_ALIASES),
    brand: findColumn(headers, BRAND_ALIASES),
    variantAttributes: findColumn(headers, VARIANT_ATTRIBUTES_ALIASES),
    defaultUnit: findColumn(headers, DEFAULT_UNIT_ALIASES),
    notes: findColumn(headers, NOTES_ALIASES),
  };
}

function extractRawRow(rowNumber: number, fields: string[], colIdx: ColumnIndices): RawRow {
  const get = (idx: number | null): string | null => {
    if (idx === null) return null;
    const val = fields[idx]?.trim() ?? "";
    return val.length > 0 ? val : null;
  };

  return {
    rowNumber,
    displayName: get(colIdx.displayName),
    category: get(colIdx.category),
    status: get(colIdx.status),
    subcategory: get(colIdx.subcategory),
    brand: get(colIdx.brand),
    variantAttributes: get(colIdx.variantAttributes),
    defaultUnit: get(colIdx.defaultUnit),
    notes: get(colIdx.notes),
  };
}

function isBlankRow(row: RawRow): boolean {
  return (
    row.displayName === null &&
    row.category === null &&
    row.status === null &&
    row.subcategory === null &&
    row.brand === null &&
    row.variantAttributes === null &&
    row.defaultUnit === null &&
    row.notes === null
  );
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
  const headers = parseCsvLine(headerLine).map(normaliseHeader);
  const colIdx = resolveColumnIndices(headers);

  return lines.slice(1).map((line, idx) => {
    const rowNumber = idx + 2; // 1-indexed, row 1 = header
    const fields = parseCsvLine(line);
    return extractRawRow(rowNumber, fields, colIdx);
  });
}

async function parseXlsxBuffer(buffer: Buffer): Promise<RawRow[]> {
  // Dynamic import handles CJS/ESM interop for the xlsx package.
  const XLSX = await import("xlsx");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError(400, "IMPORT_EMPTY", "The Excel file contains no worksheets");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new AppError(400, "IMPORT_EMPTY", "The Excel file worksheet could not be read");
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
    throw new AppError(400, "IMPORT_INVALID", "The Excel file does not have a valid header row");
  }

  const headers = headerRow.map((h: unknown) => {
    const str = typeof h === "string" || typeof h === "number" ? String(h) : "";
    return normaliseHeader(str);
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

// ─── Slug / SKU helpers ────────────────────────────────────────────────────────

function slugSku(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "MPL";
}

async function buildUniqueSku(
  catalogRepository: CatalogRepository,
  displayName: string,
  rowNumber: number,
): Promise<string> {
  const base = slugSku(`MPL-${displayName}`);
  const candidates = [
    base,
    `${base}-${String(rowNumber)}`,
    `${base}-${String(rowNumber)}-${String(Date.now()).slice(-6)}`,
  ];

  for (const candidate of candidates) {
    const existing = await catalogRepository.findMasterItemBySku(candidate);
    if (!existing) return candidate;
  }

  return `${base.slice(0, 30)}-${String(rowNumber)}-${String(Date.now()).slice(-6)}`;
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createMasterProductImportService(
  catalogRepository: CatalogRepository,
  inventoryRepository: InventoryRepository,
  auditService: AuditService,
) {
  async function parseFile(buffer: Buffer, format: ImportFormat): Promise<RawRow[]> {
    if (format === "csv") {
      return parseCsvBuffer(buffer);
    }
    return parseXlsxBuffer(buffer);
  }

  function validateRow(row: RawRow): string[] {
    const errors: string[] = [];
    if (!row.displayName?.trim()) errors.push("display_name is required");
    if (!row.category?.trim()) errors.push("category is required");
    if (!row.status?.trim()) errors.push("status is required");
    return errors;
  }

  function assertClinicAccess(caller: AuthenticatedUser, clinicId: string): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(403, "MASTER_PRODUCT_IMPORT_FORBIDDEN", "Access denied for this clinic");
    }
  }

  async function provisionClinicInventory(
    caller: AuthenticatedUser,
    clinicId: string,
    masterItem: MasterCatalogItem,
  ): Promise<void> {
    // clinic_inventory_items is RLS-protected (app_is_owner_admin() OR
    // clinic_id = app_current_clinic_id()). This route is global — it is
    // NOT nested under /clinics/:clinicId/*, so rlsTenantContextMiddleware
    // never runs and no AsyncLocalStorage context would otherwise exist.
    // Without runWithTenantContext, the INSERT below is executed with no
    // RLS session variables set and Postgres rejects it with "new row
    // violates row-level security policy for table clinic_inventory_items".
    //
    // assertClinicAccess() (called by importLibrary before any rows are
    // processed) has already confirmed the caller is authorised for
    // clinicId, so it is safe to establish that exact context here.
    const ownerAdmin = caller.role === "owner_admin";

    try {
      await runWithTenantContext(clinicId, ownerAdmin, async () => {
        // Rule: any clinic inventory row created by this import MUST start
        // at quantityOnHand = 0. No updateQuantity() or recordAdjustment()
        // call is ever made — this is the only inventory write this
        // service performs.
        await inventoryRepository.createClinicInventoryItem({
          clinicId,
          masterCatalogItemId: masterItem.id,
          quantityOnHand: 0,
          reorderPoint: 0,
          unitCostOverrideCents: null,
          supplierPreference: null,
        });
      });
    } catch (err) {
      // Convert any provisioning failure (RLS rejection, connection error,
      // constraint violation, ...) into a well-defined AppError so callers
      // get a clear, actionable message instead of a generic "unexpected
      // error occurred" 500 response.
      const reason = err instanceof Error ? err.message : "an unknown error occurred";
      throw new AppError(
        500,
        "MASTER_PRODUCT_PROVISION_FAILED",
        `"${masterItem.name}" was added to the master catalogue, but could not be provisioned into the clinic's inventory: ${reason}`,
      );
    }
  }

  return {
    /**
     * Imports a curated Master Product Library file into master_catalog_items.
     *
     * @param caller    — authenticated actor, used for audit + clinic access checks
     * @param buffer    — raw uploaded file bytes
     * @param format    — "csv" | "xlsx"
     * @param clinicId  — optional clinic to provision zero-quantity inventory
     *                    rows into for each newly created product, so imported
     *                    products immediately appear in that clinic's
     *                    Products/Inventory list.
     */
    async importLibrary(
      caller: AuthenticatedUser,
      buffer: Buffer,
      format: ImportFormat,
      clinicId?: string | null,
    ): Promise<MasterProductImportResult> {
      if (clinicId) {
        assertClinicAccess(caller, clinicId);
      }

      const rawRows = await parseFile(buffer, format);
      const dataRows = rawRows.filter((r) => !isBlankRow(r));

      if (dataRows.length === 0) {
        throw new AppError(400, "IMPORT_EMPTY", "No data rows found in the uploaded file");
      }

      const rows: MasterProductImportRowResult[] = [];
      // Tracks normalised (name + category) keys already imported within this
      // same file so intra-file duplicates are also caught, not just rows
      // that duplicate pre-existing database records.
      const seenInBatch = new Set<string>();

      let imported = 0;
      let skippedDuplicates = 0;
      let skippedInvalid = 0;

      for (const raw of dataRows) {
        const errors = validateRow(raw);

        if (errors.length > 0) {
          skippedInvalid++;
          rows.push({
            rowNumber: raw.rowNumber,
            displayName: raw.displayName,
            category: raw.category,
            outcome: "skipped_invalid",
            masterProductId: null,
            errors,
          });
          continue;
        }

        // Non-null asserted by validateRow above.
        const displayName = raw.displayName?.trim() ?? "";
        const category = raw.category?.trim() ?? "";
        const status = raw.status?.trim() ?? "";
        const batchKey = `${normaliseMasterProductText(displayName)}::${normaliseMasterProductText(category)}`;

        if (seenInBatch.has(batchKey)) {
          skippedDuplicates++;
          rows.push({
            rowNumber: raw.rowNumber,
            displayName,
            category,
            outcome: "skipped_duplicate",
            masterProductId: null,
            errors: ["Duplicate display_name + category earlier in this file"],
          });
          auditService.logEvent("master_product.import_skipped", {
            userId: caller.id,
            email: caller.email,
            role: caller.role,
            reason: "duplicate_in_file",
          });
          continue;
        }

        const existing = await catalogRepository.findMasterItemByNormalisedNameAndCategory(
          displayName,
          category,
        );

        if (existing) {
          seenInBatch.add(batchKey);
          skippedDuplicates++;
          rows.push({
            rowNumber: raw.rowNumber,
            displayName,
            category,
            outcome: "skipped_duplicate",
            masterProductId: existing.id,
            errors: ["A master product with this display_name and category already exists"],
          });
          auditService.logEvent("master_product.import_skipped", {
            userId: caller.id,
            email: caller.email,
            role: caller.role,
            resourceId: existing.id,
            reason: "duplicate_existing",
          });
          continue;
        }

        // default_unit maps to both stockUnit and receivingUnit (master_catalog_items
        // has no separate "default unit" column). unitsPerReceivingUnit stays 1 since
        // the curated library does not distinguish stock vs. receiving pack sizes.
        // Truncated to the stock_unit/receiving_unit varchar(32) column limit.
        const defaultUnit = (raw.defaultUnit?.trim() || "Unit").slice(0, 32);
        const sku = await buildUniqueSku(catalogRepository, displayName, raw.rowNumber);

        const createInput: CreateMasterCatalogItemInput = {
          sku,
          name: displayName,
          description: null,
          category,
          stockUnit: defaultUnit,
          receivingUnit: defaultUnit,
          unitsPerReceivingUnit: 1,
          defaultUnitCostCents: 0,
          subcategory: raw.subcategory?.trim() || null,
          brand: raw.brand?.trim() || null,
          variantAttributes: raw.variantAttributes?.trim() || null,
          notes: raw.notes?.trim() || null,
          status,
        };

        const masterItem = await catalogRepository.createMasterItem(createInput);
        seenInBatch.add(batchKey);

        if (clinicId) {
          await provisionClinicInventory(caller, clinicId, masterItem);
        }

        imported++;
        rows.push({
          rowNumber: raw.rowNumber,
          displayName,
          category,
          outcome: "imported",
          masterProductId: masterItem.id,
          errors: [],
        });

        auditService.logEvent("master_product.imported", {
          userId: caller.id,
          email: caller.email,
          role: caller.role,
          clinicId: clinicId ?? undefined,
          resourceId: masterItem.id,
        });
      }

      return {
        totalRows: rows.length,
        imported,
        skippedDuplicates,
        skippedInvalid,
        clinicId: clinicId ?? null,
        rows,
      };
    },
  };
}

export type MasterProductImportService = ReturnType<typeof createMasterProductImportService>;
