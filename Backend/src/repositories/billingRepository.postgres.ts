import {
  calculateTaxCents,
  GST_RATE_BASIS_POINTS,
} from "../types/billing.js";
import type {
  AddLineItemInput,
  CreateInvoiceInput,
  Invoice,
  InvoiceLineItem,
  ListInvoiceOptions,
  PaymentRecord,
  RecordPaymentInput,
  UpdateInvoiceInput,
} from "../types/billing.js";
import type { BillingRepository } from "./billingRepository.js";
import type { DatabasePool } from "../db/pool.js";

// ─────────────────────────────────────────────────────────────────────────────
// Row mappers — DB snake_case → TypeScript camelCase
// ─────────────────────────────────────────────────────────────────────────────

type InvoiceRow = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  patient_name: string;
  invoice_number: string | null;
  status: string;
  issued_at: Date | null;
  due_at: Date | null;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  tax_rate_basis_points: number;
  notes: string | null;
  created_by_user_id: string;
  created_by_email: string;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

type LineItemRow = {
  id: string;
  clinic_id: string;
  invoice_id: string;
  line_item_type: string;
  description: string;
  catalogue_item_id: string | null;
  catalogue_sku: string | null;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
  tax_rate_basis_points: number;
  tax_cents: number;
  total_cents: number;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

type PaymentRow = {
  id: string;
  clinic_id: string;
  invoice_id: string;
  payment_method: string;
  status: string;
  amount_cents: number;
  reference_number: string | null;
  notes: string | null;
  recorded_by_user_id: string;
  recorded_by_email: string;
  transaction_at: Date;
  confirmed_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    invoiceNumber: row.invoice_number,
    status: row.status as Invoice["status"],
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    paidCents: row.paid_cents,
    outstandingCents: row.outstanding_cents,
    taxRateBasisPoints: row.tax_rate_basis_points,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    voidedByUserId: row.voided_by_user_id,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLineItem(row: LineItemRow): InvoiceLineItem {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    lineItemType: row.line_item_type as InvoiceLineItem["lineItemType"],
    description: row.description,
    catalogueItemId: row.catalogue_item_id,
    catalogueSku: row.catalogue_sku,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    subtotalCents: row.subtotal_cents,
    taxRateBasisPoints: row.tax_rate_basis_points,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    paymentMethod: row.payment_method as PaymentRecord["paymentMethod"],
    status: row.status as PaymentRecord["status"],
    amountCents: row.amount_cents,
    referenceNumber: row.reference_number,
    notes: row.notes,
    recordedByUserId: row.recorded_by_user_id,
    recordedByEmail: row.recorded_by_email,
    transactionAt: row.transaction_at,
    confirmedAt: row.confirmed_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL implementation
// ─────────────────────────────────────────────────────────────────────────────

export function createPostgresBillingRepository(
  pool: DatabasePool,
): BillingRepository {
  return {
    // ── Invoices ─────────────────────────────────────────────────────────────

    async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
      const taxRate = input.taxRateBasisPoints ?? GST_RATE_BASIS_POINTS;
      const { rows } = await pool.query<InvoiceRow>(
        `INSERT INTO invoices (
          clinic_id, patient_id, patient_name, status,
          due_at, tax_rate_basis_points, notes,
          created_by_user_id, created_by_email
        ) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          input.clinicId,
          input.patientId,
          input.patientName,
          input.dueAt,
          taxRate,
          input.notes,
          input.createdByUserId,
          input.createdByEmail,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("createInvoice: INSERT returned no row");
      return mapInvoice(row);
    },

    async findInvoiceById(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice | null> {
      const { rows } = await pool.query<InvoiceRow>(
        "SELECT * FROM invoices WHERE id = $1 AND clinic_id = $2",
        [invoiceId, clinicId],
      );
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async listInvoices(
      clinicId: string,
      options?: ListInvoiceOptions,
    ): Promise<Invoice[]> {
      const conditions: string[] = ["clinic_id = $1"];
      const params: unknown[] = [clinicId];
      let idx = 2;

      if (options?.status) {
        conditions.push(`status = $${String(idx++)}`);
        params.push(options.status);
      }
      if (options?.patientId) {
        conditions.push(`patient_id = $${String(idx++)}`);
        params.push(options.patientId);
      }
      if (options?.from) {
        conditions.push(`created_at::date >= $${String(idx++)}`);
        params.push(options.from);
      }
      if (options?.to) {
        conditions.push(`created_at::date <= $${String(idx++)}`);
        params.push(options.to);
      }

      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;
      params.push(limit, offset);

      const { rows } = await pool.query<InvoiceRow>(
        `SELECT * FROM invoices
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $${String(idx++)} OFFSET $${String(idx)}`,
        params,
      );
      return rows.map(mapInvoice);
    },

    async updateInvoice(
      clinicId: string,
      invoiceId: string,
      patch: UpdateInvoiceInput,
    ): Promise<Invoice> {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const add = (col: string, value: unknown) => {
        sets.push(`${col} = $${String(idx++)}`);
        params.push(value);
      };

      if (patch.status !== undefined) add("status", patch.status);
      if (patch.invoiceNumber !== undefined)
        add("invoice_number", patch.invoiceNumber);
      if (patch.issuedAt !== undefined) add("issued_at", patch.issuedAt);
      if (patch.dueAt !== undefined) add("due_at", patch.dueAt);
      if (patch.subtotalCents !== undefined)
        add("subtotal_cents", patch.subtotalCents);
      if (patch.taxCents !== undefined) add("tax_cents", patch.taxCents);
      if (patch.discountCents !== undefined)
        add("discount_cents", patch.discountCents);
      if (patch.totalCents !== undefined) add("total_cents", patch.totalCents);
      if (patch.paidCents !== undefined) add("paid_cents", patch.paidCents);
      if (patch.outstandingCents !== undefined)
        add("outstanding_cents", patch.outstandingCents);
      if (patch.notes !== undefined) add("notes", patch.notes);
      if (patch.voidedByUserId !== undefined)
        add("voided_by_user_id", patch.voidedByUserId);
      if (patch.voidedAt !== undefined) add("voided_at", patch.voidedAt);
      if (patch.voidReason !== undefined) add("void_reason", patch.voidReason);

      sets.push(`updated_at = now()`);

      const { rows } = await pool.query<InvoiceRow>(
        `UPDATE invoices SET ${sets.join(", ")}
         WHERE id = $${String(idx++)} AND clinic_id = $${String(idx)}
         RETURNING *`,
        [...params, invoiceId, clinicId],
      );
      const row = rows[0];
      if (!row) throw new Error("updateInvoice: invoice not found or UPDATE returned no row");
      return mapInvoice(row);
    },

    async refreshInvoiceTotals(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice> {
      // Compute line-item totals via aggregate SQL, then update the invoice row.
      const { rows: aggRows } = await pool.query<{
        subtotal: string;
        tax: string;
      }>(
        `SELECT
           COALESCE(SUM(subtotal_cents), 0)::text AS subtotal,
           COALESCE(SUM(tax_cents), 0)::text AS tax
         FROM invoice_line_items
         WHERE invoice_id = $1 AND clinic_id = $2`,
        [invoiceId, clinicId],
      );
      const subtotalCents = Number(aggRows[0]?.subtotal ?? "0");
      const taxCents = Number(aggRows[0]?.tax ?? "0");

      // Fetch current invoice to preserve discountCents and paidCents.
      const { rows: invRows } = await pool.query<InvoiceRow>(
        "SELECT discount_cents, paid_cents FROM invoices WHERE id = $1 AND clinic_id = $2",
        [invoiceId, clinicId],
      );
      const discountCents = invRows[0]?.discount_cents ?? 0;
      const paidCents = invRows[0]?.paid_cents ?? 0;
      const totalCents = subtotalCents + taxCents - discountCents;

      const { rows } = await pool.query<InvoiceRow>(
        `UPDATE invoices
         SET subtotal_cents = $1,
             tax_cents = $2,
             total_cents = $3,
             outstanding_cents = $4,
             updated_at = now()
         WHERE id = $5 AND clinic_id = $6
         RETURNING *`,
        [
          subtotalCents,
          taxCents,
          totalCents,
          totalCents - paidCents,
          invoiceId,
          clinicId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("refreshInvoiceTotals: UPDATE returned no row");
      return mapInvoice(row);
    },

    async nextInvoiceNumber(clinicId: string): Promise<string> {
      // Atomically upsert + increment the per-clinic sequence.
      // INSERT ... ON CONFLICT ensures the sequence row exists, then we UPDATE.
      await pool.query(
        `INSERT INTO invoice_number_sequences (clinic_id, last_seq)
         VALUES ($1, 0)
         ON CONFLICT (clinic_id) DO NOTHING`,
        [clinicId],
      );
      const { rows } = await pool.query<{ last_seq: string }>(
        `UPDATE invoice_number_sequences
         SET last_seq = last_seq + 1
         WHERE clinic_id = $1
         RETURNING last_seq`,
        [clinicId],
      );
      const seqRow = rows[0];
      if (!seqRow) throw new Error("nextInvoiceNumber: sequence UPDATE returned no row");
      const seq = Number(seqRow.last_seq);
      const year = new Date().getFullYear();
      return `INV-${String(year)}-${String(seq).padStart(6, "0")}`;
    },

    // ── Line items ────────────────────────────────────────────────────────────

    async addLineItem(input: AddLineItemInput): Promise<InvoiceLineItem> {
      // Fetch the parent invoice's tax rate so taxable lines use the snapshotted rate.
      const { rows: invRows } = await pool.query<{
        tax_rate_basis_points: number;
      }>(
        "SELECT tax_rate_basis_points FROM invoices WHERE id = $1 AND clinic_id = $2",
        [input.invoiceId, input.clinicId],
      );
      const invoiceTaxRate =
        invRows[0]?.tax_rate_basis_points ?? GST_RATE_BASIS_POINTS;
      const effectiveTaxRate = input.taxable ? invoiceTaxRate : 0;

      const subtotalCents = input.quantity * input.unitPriceCents;
      const taxCents = calculateTaxCents(subtotalCents, effectiveTaxRate);
      const totalCents = subtotalCents + taxCents;

      // Default sort_order to (max existing + 10) for natural append ordering.
      const { rows: sortRows } = await pool.query<{ max_sort: string | null }>(
        "SELECT MAX(sort_order) AS max_sort FROM invoice_line_items WHERE invoice_id = $1",
        [input.invoiceId],
      );
      const sortOrder =
        input.sortOrder ??
        ((sortRows[0]?.max_sort != null
          ? Number(sortRows[0].max_sort)
          : 0) + 10);

      const { rows } = await pool.query<LineItemRow>(
        `INSERT INTO invoice_line_items (
           clinic_id, invoice_id, line_item_type, description,
           catalogue_item_id, catalogue_sku,
           quantity, unit_price_cents, subtotal_cents,
           tax_rate_basis_points, tax_cents, total_cents, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          input.clinicId,
          input.invoiceId,
          input.lineItemType,
          input.description,
          input.catalogueItemId,
          input.catalogueSku,
          input.quantity,
          input.unitPriceCents,
          subtotalCents,
          effectiveTaxRate,
          taxCents,
          totalCents,
          sortOrder,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("addLineItem: INSERT returned no row");
      return mapLineItem(row);
    },

    async findLineItemById(
      clinicId: string,
      lineItemId: string,
    ): Promise<InvoiceLineItem | null> {
      const { rows } = await pool.query<LineItemRow>(
        "SELECT * FROM invoice_line_items WHERE id = $1 AND clinic_id = $2",
        [lineItemId, clinicId],
      );
      return rows[0] ? mapLineItem(rows[0]) : null;
    },

    async listLineItems(
      clinicId: string,
      invoiceId: string,
    ): Promise<InvoiceLineItem[]> {
      const { rows } = await pool.query<LineItemRow>(
        `SELECT * FROM invoice_line_items
         WHERE invoice_id = $1 AND clinic_id = $2
         ORDER BY sort_order ASC`,
        [invoiceId, clinicId],
      );
      return rows.map(mapLineItem);
    },

    async removeLineItem(
      clinicId: string,
      lineItemId: string,
      invoiceId: string,
    ): Promise<void> {
      await pool.query(
        `DELETE FROM invoice_line_items
         WHERE id = $1 AND clinic_id = $2 AND invoice_id = $3`,
        [lineItemId, clinicId, invoiceId],
      );
    },

    // ── Payments ──────────────────────────────────────────────────────────────

    async recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
      const { rows } = await pool.query<PaymentRow>(
        `INSERT INTO payment_records (
           clinic_id, invoice_id, payment_method, status, amount_cents,
           reference_number, notes, recorded_by_user_id, recorded_by_email,
           transaction_at, confirmed_at
         ) VALUES ($1,$2,$3,'confirmed',$4,$5,$6,$7,$8,$9,now())
         RETURNING *`,
        [
          input.clinicId,
          input.invoiceId,
          input.paymentMethod,
          input.amountCents,
          input.referenceNumber,
          input.notes,
          input.recordedByUserId,
          input.recordedByEmail,
          input.transactionAt,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("recordPayment: INSERT returned no row");
      return mapPayment(row);
    },

    async findPaymentById(
      clinicId: string,
      paymentId: string,
    ): Promise<PaymentRecord | null> {
      const { rows } = await pool.query<PaymentRow>(
        "SELECT * FROM payment_records WHERE id = $1 AND clinic_id = $2",
        [paymentId, clinicId],
      );
      return rows[0] ? mapPayment(rows[0]) : null;
    },

    async listPayments(
      clinicId: string,
      invoiceId: string,
    ): Promise<PaymentRecord[]> {
      const { rows } = await pool.query<PaymentRow>(
        `SELECT * FROM payment_records
         WHERE invoice_id = $1 AND clinic_id = $2
         ORDER BY transaction_at DESC`,
        [invoiceId, clinicId],
      );
      return rows.map(mapPayment);
    },

    async refreshInvoicePaymentTotals(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice> {
      const { rows: aggRows } = await pool.query<{ paid: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::text AS paid
         FROM payment_records
         WHERE invoice_id = $1 AND clinic_id = $2 AND status = 'confirmed'`,
        [invoiceId, clinicId],
      );
      const paidCents = Number(aggRows[0]?.paid ?? "0");

      const { rows } = await pool.query<InvoiceRow>(
        `UPDATE invoices
         SET paid_cents = $1,
             outstanding_cents = total_cents - $1,
             updated_at = now()
         WHERE id = $2 AND clinic_id = $3
         RETURNING *`,
        [paidCents, invoiceId, clinicId],
      );
      const row = rows[0];
      if (!row) throw new Error("refreshInvoicePaymentTotals: UPDATE returned no row");
      return mapInvoice(row);
    },
  };
}
