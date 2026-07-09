/**
 * PostgreSQL implementation of SupplierInvoiceRepository — Sprint OCR-1.
 *
 * Follows the same patterns as billingRepository.postgres.ts:
 *   - Row mapper functions (snake_case → camelCase)
 *   - Parameterised queries only (no string interpolation of user values)
 *   - clinic_id on every tenant-scoped query for defence-in-depth
 *   - AppError(404) on missing rows for write operations
 */

import type { DatabasePool } from "../db/pool.js";
import { withTenantContext } from "../db/tenantContext.js";
import { AppError } from "../types/errors.js";
import type {
  AddSupplierInvoiceLineInput,
  CreateSupplierInvoiceInput,
  DuplicateFileWarning,
  DuplicateInvoiceNumberWarning,
  ListSupplierInvoicesOptions,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  SupplierPriceHistory,
  UpdateSupplierInvoiceInput,
  UpdateSupplierInvoiceLineInput,
} from "../types/supplierInvoice.js";
import type { SupplierInvoiceRepository } from "./supplierInvoiceRepository.js";

// ── Row types ─────────────────────────────────────────────────────────────────

type InvoiceRow = {
  id: string;
  clinic_id: string;
  supplier_id: string | null;
  supplier_name_raw: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  status: string;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string;
  ocr_provider: string;
  ocr_confidence: string | null;
  ocr_raw_response: unknown;
  original_filename: string;
  file_mime_type: string;
  file_sha256: string | null;
  storage_key: string | null;
  imported_by_user_id: string;
  imported_by_email: string;
  confirmed_by_user_id: string | null;
  confirmed_at: Date | null;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

type LineRow = {
  id: string;
  clinic_id: string;
  supplier_invoice_id: string;
  master_catalog_item_id: string | null;
  master_product_name: string | null;
  supplier_catalogue_id: string | null;
  ocr_description: string;
  ocr_sku: string | null;
  ocr_confidence: string | null;
  quantity: string;
  unit_price_cents: number;
  subtotal_cents: number;
  tax_rate_basis_points: number;
  tax_cents: number;
  total_cents: number;
  sort_order: number;
  is_matched: boolean;
  match_method: string | null;
  created_at: Date;
  updated_at: Date;
};

type PriceHistoryRow = {
  id: string;
  supplier_catalogue_id: string;
  supplier_id: string;
  master_catalog_item_id: string;
  old_unit_cost_cents: number | null;
  new_unit_cost_cents: number;
  source: string;
  source_reference_id: string | null;
  changed_by_user_id: string;
  changed_by_email: string;
  effective_date: string;
  created_at: Date;
};

// ── Row mappers ───────────────────────────────────────────────────────────────

function mapInvoice(row: InvoiceRow): SupplierInvoice {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    supplierId: row.supplier_id,
    supplierNameRaw: row.supplier_name_raw,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    status: row.status as SupplierInvoiceStatus,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    ocrProvider: row.ocr_provider,
    ocrConfidence: row.ocr_confidence !== null ? Number(row.ocr_confidence) : null,
    ocrRawResponse: row.ocr_raw_response,
    originalFilename: row.original_filename,
    fileMimeType: row.file_mime_type,
    fileSha256: row.file_sha256,
    storageKey: row.storage_key,
    importedByUserId: row.imported_by_user_id,
    importedByEmail: row.imported_by_email,
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedAt: row.confirmed_at,
    voidedByUserId: row.voided_by_user_id,
    voidedAt: row.voided_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLine(row: LineRow): SupplierInvoiceLine {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    supplierInvoiceId: row.supplier_invoice_id,
    masterCatalogItemId: row.master_catalog_item_id,
    masterProductName: row.master_product_name ?? null,
    supplierCatalogueId: row.supplier_catalogue_id,
    ocrDescription: row.ocr_description,
    ocrSku: row.ocr_sku,
    ocrConfidence: row.ocr_confidence !== null ? Number(row.ocr_confidence) : null,
    quantity: Number(row.quantity),
    unitPriceCents: row.unit_price_cents,
    subtotalCents: row.subtotal_cents,
    taxRateBasisPoints: row.tax_rate_basis_points,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    sortOrder: row.sort_order,
    isMatched: row.is_matched,
    matchMethod: row.match_method as SupplierInvoiceLine["matchMethod"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPriceHistory(row: PriceHistoryRow): SupplierPriceHistory {
  return {
    id: row.id,
    supplierCatalogueId: row.supplier_catalogue_id,
    supplierId: row.supplier_id,
    masterCatalogItemId: row.master_catalog_item_id,
    oldUnitCostCents: row.old_unit_cost_cents,
    newUnitCostCents: row.new_unit_cost_cents,
    source: row.source as SupplierPriceHistory["source"],
    sourceReferenceId: row.source_reference_id,
    changedByUserId: row.changed_by_user_id,
    changedByEmail: row.changed_by_email,
    effectiveDate: row.effective_date,
    createdAt: row.created_at,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPostgresSupplierInvoiceRepository(
  pool: DatabasePool,
): SupplierInvoiceRepository {
  return {
    // ── Invoice header CRUD ────────────────────────────────────────────────

    async createSupplierInvoice(
      input: CreateSupplierInvoiceInput,
    ): Promise<SupplierInvoice> {
      const { rows } = await withTenantContext(
        pool,
        input.clinicId,
        (client) =>
          client.query<InvoiceRow>(
            `INSERT INTO supplier_invoices (
               clinic_id, supplier_id, supplier_name_raw, invoice_number,
               invoice_date, due_date, subtotal_cents, tax_cents, total_cents,
               ocr_provider, ocr_confidence, ocr_raw_response,
               original_filename, file_mime_type, file_sha256,
               imported_by_user_id, imported_by_email,
               status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING *`,
            [
              input.clinicId,
              input.supplierId,
              input.supplierNameRaw,
              input.invoiceNumber,
              input.invoiceDate,
              input.dueDate,
              input.subtotalCents,
              input.taxCents,
              input.totalCents,
              input.ocrProvider,
              input.ocrConfidence,
              JSON.stringify(input.ocrRawResponse),
              input.originalFilename,
              input.fileMimeType,
              input.fileSha256,
              input.importedByUserId,
              input.importedByEmail,
              "ready_for_review",
            ],
          ),
      );
      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create supplier invoice");
      return mapInvoice(row);
    },

    async findById(
      clinicId: string,
      id: string,
    ): Promise<SupplierInvoice | null> {
      const { rows } = await pool.query<InvoiceRow>(
        "SELECT * FROM supplier_invoices WHERE id = $1 AND clinic_id = $2",
        [id, clinicId],
      );
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async listSupplierInvoices(
      clinicId: string,
      options: ListSupplierInvoicesOptions = {},
    ): Promise<SupplierInvoice[]> {
      const conditions: string[] = ["clinic_id = $1"];
      const params: unknown[] = [clinicId];
      let idx = 2;

      const add = (cond: string, val: unknown) => {
        conditions.push(cond.replace("?", `$${String(idx++)}`));
        params.push(val);
      };

      if (options.status) add("status = ?", options.status);
      if (options.supplierId) add("supplier_id = ?", options.supplierId);
      if (options.from) add("created_at::date >= ?", options.from);
      if (options.to) add("created_at::date <= ?", options.to);

      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      params.push(limit, offset);

      const { rows } = await pool.query<InvoiceRow>(
        `SELECT * FROM supplier_invoices
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $${String(idx++)} OFFSET $${String(idx)}`,
        params,
      );
      return rows.map(mapInvoice);
    },

    async updateSupplierInvoice(
      clinicId: string,
      id: string,
      patch: UpdateSupplierInvoiceInput,
    ): Promise<SupplierInvoice | null> {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const add = (col: string, value: unknown) => {
        sets.push(`${col} = $${String(idx++)}`);
        params.push(value);
      };

      if (patch.supplierId !== undefined) add("supplier_id", patch.supplierId);
      if (patch.supplierNameRaw !== undefined) add("supplier_name_raw", patch.supplierNameRaw);
      if (patch.invoiceNumber !== undefined) add("invoice_number", patch.invoiceNumber);
      if (patch.invoiceDate !== undefined) add("invoice_date", patch.invoiceDate);
      if (patch.dueDate !== undefined) add("due_date", patch.dueDate);
      if (patch.notes !== undefined) add("notes", patch.notes);

      if (sets.length === 0) {
        return this.findById(clinicId, id);
      }

      sets.push("updated_at = now()");

      const { rows } = await pool.query<InvoiceRow>(
        `UPDATE supplier_invoices
         SET ${sets.join(", ")}
         WHERE id = $${String(idx++)} AND clinic_id = $${String(idx)}
         RETURNING *`,
        [...params, id, clinicId],
      );
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async setStatus(
      clinicId: string,
      id: string,
      status: SupplierInvoiceStatus,
      extra: {
        confirmedByUserId?: string;
        confirmedAt?: Date;
        voidedByUserId?: string;
        voidedAt?: Date;
      } = {},
    ): Promise<SupplierInvoice | null> {
      const sets: string[] = ["status = $1", "updated_at = now()"];
      const params: unknown[] = [status];
      let idx = 2;

      const add = (col: string, value: unknown) => {
        sets.push(`${col} = $${String(idx++)}`);
        params.push(value);
      };

      if (extra.confirmedByUserId !== undefined) add("confirmed_by_user_id", extra.confirmedByUserId);
      if (extra.confirmedAt !== undefined) add("confirmed_at", extra.confirmedAt);
      if (extra.voidedByUserId !== undefined) add("voided_by_user_id", extra.voidedByUserId);
      if (extra.voidedAt !== undefined) add("voided_at", extra.voidedAt);

      const { rows } = await pool.query<InvoiceRow>(
        `UPDATE supplier_invoices
         SET ${sets.join(", ")}
         WHERE id = $${String(idx++)} AND clinic_id = $${String(idx)}
         RETURNING *`,
        [...params, id, clinicId],
      );
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async clearTemporaryExtractionData(
      clinicId: string,
      invoiceId: string,
    ): Promise<void> {
      await pool.query(
        `UPDATE supplier_invoices
         SET ocr_confidence = NULL,
             ocr_raw_response = '{}'::jsonb,
             storage_key = NULL,
             updated_at = now()
         WHERE id = $1 AND clinic_id = $2`,
        [invoiceId, clinicId],
      );
    },

    // ── Duplicate detection ────────────────────────────────────────────────

    async findDuplicateFile(
      clinicId: string,
      sha256: string,
      excludeId?: string,
    ): Promise<DuplicateFileWarning | null> {
      const params: unknown[] = [clinicId, sha256];
      let excludeClause = "";
      if (excludeId) {
        excludeClause = " AND id <> $3";
        params.push(excludeId);
      }

      const { rows } = await pool.query<{ id: string; created_at: Date }>(
        `SELECT id, created_at FROM supplier_invoices
         WHERE clinic_id = $1 AND file_sha256 = $2${excludeClause}
         ORDER BY created_at DESC LIMIT 1`,
        params,
      );
      if (!rows[0]) return null;
      return { existingInvoiceId: rows[0].id, importedAt: rows[0].created_at };
    },

    async findDuplicateInvoiceNumber(
      clinicId: string,
      supplierId: string,
      invoiceNumber: string,
      excludeId?: string,
    ): Promise<DuplicateInvoiceNumberWarning | null> {
      const params: unknown[] = [clinicId, supplierId, invoiceNumber];
      let excludeClause = "";
      if (excludeId) {
        excludeClause = " AND id <> $4";
        params.push(excludeId);
      }

      const { rows } = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM supplier_invoices
         WHERE clinic_id = $1 AND supplier_id = $2 AND invoice_number = $3
           AND status NOT IN ('voided', 'cancelled')${excludeClause}
         ORDER BY created_at DESC LIMIT 1`,
        params,
      );
      if (!rows[0]) return null;
      return {
        existingInvoiceId: rows[0].id,
        existingStatus: rows[0].status as SupplierInvoiceStatus,
      };
    },

    // ── Line items ─────────────────────────────────────────────────────────

    async addLine(
      input: AddSupplierInvoiceLineInput,
    ): Promise<SupplierInvoiceLine> {
      const subtotalCents = Math.round(input.quantity * input.unitPriceCents);
      const taxCents = Math.round(
        (subtotalCents * input.taxRateBasisPoints) / 10_000,
      );
      const totalCents = subtotalCents + taxCents;

      const { rows } = await withTenantContext(
        pool,
        input.clinicId,
        (client) =>
          client.query<LineRow>(
            `INSERT INTO supplier_invoice_lines (
               clinic_id, supplier_invoice_id,
               master_catalog_item_id, supplier_catalogue_id,
               ocr_description, ocr_sku, ocr_confidence,
               quantity, unit_price_cents, subtotal_cents,
               tax_rate_basis_points, tax_cents, total_cents,
               sort_order, is_matched, match_method
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
              input.clinicId,
              input.supplierInvoiceId,
              input.masterCatalogItemId,
              input.supplierCatalogueId,
              input.ocrDescription,
              input.ocrSku,
              input.ocrConfidence,
              input.quantity,
              input.unitPriceCents,
              subtotalCents,
              input.taxRateBasisPoints,
              taxCents,
              totalCents,
              input.sortOrder,
              input.isMatched,
              input.matchMethod,
            ],
          ),
      );
      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to add supplier invoice line");
      return mapLine(row);
    },

    async findLineById(
      clinicId: string,
      lineId: string,
    ): Promise<SupplierInvoiceLine | null> {
      const { rows } = await pool.query<LineRow>(
        `SELECT sil.*, mci.name AS master_product_name
         FROM supplier_invoice_lines sil
         LEFT JOIN master_catalog_items mci ON mci.id = sil.master_catalog_item_id
         WHERE sil.id = $1 AND sil.clinic_id = $2`,
        [lineId, clinicId],
      );
      return rows[0] ? mapLine(rows[0]) : null;
    },

    async listLines(
      clinicId: string,
      invoiceId: string,
    ): Promise<SupplierInvoiceLine[]> {
      const { rows } = await pool.query<LineRow>(
        `SELECT sil.*, mci.name AS master_product_name
         FROM supplier_invoice_lines sil
         LEFT JOIN master_catalog_items mci ON mci.id = sil.master_catalog_item_id
         WHERE sil.supplier_invoice_id = $1 AND sil.clinic_id = $2
         ORDER BY sil.sort_order ASC`,
        [invoiceId, clinicId],
      );
      return rows.map(mapLine);
    },

    async updateLine(
      clinicId: string,
      lineId: string,
      patch: UpdateSupplierInvoiceLineInput,
    ): Promise<SupplierInvoiceLine | null> {
      // Fetch the existing line first so we can recalculate totals.
      const { rows: existingRows } = await pool.query<LineRow>(
        `SELECT sil.*, mci.name AS master_product_name
         FROM supplier_invoice_lines sil
         LEFT JOIN master_catalog_items mci ON mci.id = sil.master_catalog_item_id
         WHERE sil.id = $1 AND sil.clinic_id = $2`,
        [lineId, clinicId],
      );
      const existing = existingRows[0];
      if (!existing) return null;

      const quantity =
        patch.quantity !== undefined ? patch.quantity : Number(existing.quantity);
      const unitPriceCents =
        patch.unitPriceCents !== undefined
          ? patch.unitPriceCents
          : existing.unit_price_cents;
      const taxRateBasisPoints =
        patch.taxRateBasisPoints !== undefined
          ? patch.taxRateBasisPoints
          : existing.tax_rate_basis_points;

      const subtotalCents = Math.round(quantity * unitPriceCents);
      const taxCents = Math.round(
        (subtotalCents * taxRateBasisPoints) / 10_000,
      );
      const totalCents = subtotalCents + taxCents;

      const sets: string[] = [
        "quantity = $1",
        "unit_price_cents = $2",
        "subtotal_cents = $3",
        "tax_rate_basis_points = $4",
        "tax_cents = $5",
        "total_cents = $6",
        "updated_at = now()",
      ];
      const params: unknown[] = [
        quantity,
        unitPriceCents,
        subtotalCents,
        taxRateBasisPoints,
        taxCents,
        totalCents,
      ];
      let idx = 7;

      const add = (col: string, value: unknown) => {
        sets.push(`${col} = $${String(idx++)}`);
        params.push(value);
      };

      if (patch.ocrDescription !== undefined) add("ocr_description", patch.ocrDescription);
      if (patch.ocrSku !== undefined) add("ocr_sku", patch.ocrSku);
      if (patch.masterCatalogItemId !== undefined) add("master_catalog_item_id", patch.masterCatalogItemId);
      if (patch.supplierCatalogueId !== undefined) add("supplier_catalogue_id", patch.supplierCatalogueId);
      if (patch.isMatched !== undefined) add("is_matched", patch.isMatched);
      if (patch.matchMethod !== undefined) add("match_method", patch.matchMethod);

      const updateIdx = idx;
      const { rows: updatedRows } = await pool.query<{ id: string }>(
        `UPDATE supplier_invoice_lines
         SET ${sets.join(", ")}
         WHERE id = $${String(updateIdx)} AND clinic_id = $${String(updateIdx + 1)}
         RETURNING id`,
        [...params, lineId, clinicId],
      );
      if (!updatedRows[0]) return null;
      // Re-fetch with master product name JOIN to return the complete record.
      const { rows } = await pool.query<LineRow>(
        `SELECT sil.*, mci.name AS master_product_name
         FROM supplier_invoice_lines sil
         LEFT JOIN master_catalog_items mci ON mci.id = sil.master_catalog_item_id
         WHERE sil.id = $1 AND sil.clinic_id = $2`,
        [lineId, clinicId],
      );
      return rows[0] ? mapLine(rows[0]) : null;
    },

    async removeLine(clinicId: string, lineId: string): Promise<void> {
      await pool.query(
        "DELETE FROM supplier_invoice_lines WHERE id = $1 AND clinic_id = $2",
        [lineId, clinicId],
      );
    },

    async removeLinesForInvoice(clinicId: string, invoiceId: string): Promise<void> {
      await pool.query(
        "DELETE FROM supplier_invoice_lines WHERE supplier_invoice_id = $1 AND clinic_id = $2",
        [invoiceId, clinicId],
      );
    },

    // ── Supplier catalogue pricing upsert ──────────────────────────────────

    async upsertSupplierCataloguePrice(
      supplierId: string,
      masterCatalogItemId: string,
      newUnitCostCents: number,
      supplierSku: string | null,
    ): Promise<{ catalogueId: string; oldUnitCostCents: number | null }> {
      // Fetch the existing active entry (if any) to record old price.
      const { rows: existing } = await pool.query<{
        id: string;
        unit_cost_cents: number;
      }>(
        `SELECT id, unit_cost_cents
         FROM supplier_catalogue
         WHERE supplier_id = $1 AND master_catalog_item_id = $2 AND active = true
         LIMIT 1`,
        [supplierId, masterCatalogItemId],
      );

      const old = existing[0] ?? null;

      if (old) {
        await pool.query(
          `UPDATE supplier_catalogue
           SET unit_cost_cents = $1,
               supplier_sku = COALESCE($2, supplier_sku),
               updated_at = now()
           WHERE id = $3`,
          [newUnitCostCents, supplierSku, old.id],
        );
        return {
          catalogueId: old.id,
          oldUnitCostCents: old.unit_cost_cents,
        };
      }

      // Create a new entry.
      const { rows: created } = await pool.query<{ id: string }>(
        `INSERT INTO supplier_catalogue
           (supplier_id, master_catalog_item_id, supplier_sku,
            unit_cost_cents, active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [supplierId, masterCatalogItemId, supplierSku, newUnitCostCents],
      );
      const newRow = created[0];
      if (!newRow) throw new AppError(500, "INTERNAL_ERROR", "Failed to upsert supplier catalogue price");

      return { catalogueId: newRow.id, oldUnitCostCents: null };
    },

    // ── Price history ──────────────────────────────────────────────────────

    async insertPriceHistory(
      record: Omit<SupplierPriceHistory, "id" | "createdAt">,
    ): Promise<SupplierPriceHistory> {
      const { rows } = await pool.query<PriceHistoryRow>(
        `INSERT INTO supplier_price_history (
           supplier_catalogue_id, supplier_id, master_catalog_item_id,
           old_unit_cost_cents, new_unit_cost_cents, source,
           source_reference_id, changed_by_user_id, changed_by_email,
           effective_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          record.supplierCatalogueId,
          record.supplierId,
          record.masterCatalogItemId,
          record.oldUnitCostCents,
          record.newUnitCostCents,
          record.source,
          record.sourceReferenceId,
          record.changedByUserId,
          record.changedByEmail,
          record.effectiveDate,
        ],
      );
      const row = rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to insert price history");
      return mapPriceHistory(row);
    },
  };
}
