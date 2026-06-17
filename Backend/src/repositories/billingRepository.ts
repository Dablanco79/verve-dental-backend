import { randomUUID } from "node:crypto";

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

// ─────────────────────────────────────────────────────────────────────────────
// BillingRepository interface
//
// Every method that reads a single record is scoped to (clinicId, id) to
// enforce tenant isolation at the data layer.  A caller who guesses a valid
// invoice UUID cannot retrieve it without also supplying the matching clinicId.
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingRepository {
  // ── Invoices ───────────────────────────────────────────────────────────────
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  findInvoiceById(clinicId: string, invoiceId: string): Promise<Invoice | null>;
  listInvoices(clinicId: string, options?: ListInvoiceOptions): Promise<Invoice[]>;
  updateInvoice(
    clinicId: string,
    invoiceId: string,
    patch: UpdateInvoiceInput,
  ): Promise<Invoice>;

  /**
   * Recomputes subtotalCents, taxCents, totalCents, and outstandingCents from
   * the current set of line items and confirmed payments.
   * Called by the service layer after every add/remove line-item mutation.
   */
  refreshInvoiceTotals(clinicId: string, invoiceId: string): Promise<Invoice>;

  /**
   * Atomically increments the per-clinic invoice sequence and returns a
   * formatted invoice number string (e.g. "INV-2026-000001").
   * Postgres implementation uses the invoice_number_sequences table with
   * UPDATE ... RETURNING for serialized increments under concurrent load.
   */
  nextInvoiceNumber(clinicId: string): Promise<string>;

  // ── Line items ─────────────────────────────────────────────────────────────
  addLineItem(input: AddLineItemInput): Promise<InvoiceLineItem>;
  findLineItemById(
    clinicId: string,
    lineItemId: string,
  ): Promise<InvoiceLineItem | null>;
  listLineItems(
    clinicId: string,
    invoiceId: string,
  ): Promise<InvoiceLineItem[]>;
  removeLineItem(
    clinicId: string,
    lineItemId: string,
    invoiceId: string,
  ): Promise<void>;

  // ── Payments ───────────────────────────────────────────────────────────────
  recordPayment(input: RecordPaymentInput): Promise<PaymentRecord>;
  findPaymentById(
    clinicId: string,
    paymentId: string,
  ): Promise<PaymentRecord | null>;
  listPayments(clinicId: string, invoiceId: string): Promise<PaymentRecord[]>;

  /**
   * Recomputes paidCents and outstandingCents on the invoice from all
   * `confirmed` payment records.  Called by the service after every
   * payment confirmation.
   */
  refreshInvoicePaymentTotals(
    clinicId: string,
    invoiceId: string,
  ): Promise<Invoice>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation (used when DATABASE_URL is absent)
// ─────────────────────────────────────────────────────────────────────────────

export function createInMemoryBillingRepository(): BillingRepository {
  const invoices: Invoice[] = [];
  const lineItems: InvoiceLineItem[] = [];
  const payments: PaymentRecord[] = [];
  // Per-clinic sequential counters for invoice number generation.
  const invoiceSequences = new Map<string, number>();

  // ── Internal helpers ───────────────────────────────────────────────────────

  function computeInvoiceTotals(invoiceId: string): {
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
  } {
    const lines = lineItems.filter((l) => l.invoiceId === invoiceId);
    const subtotalCents = lines.reduce((s, l) => s + l.subtotalCents, 0);
    const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
    return {
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
    };
  }

  function computePaidCents(clinicId: string, invoiceId: string): number {
    return payments
      .filter(
        (p) =>
          p.invoiceId === invoiceId &&
          p.clinicId === clinicId &&
          p.status === "confirmed",
      )
      .reduce((s, p) => s + p.amountCents, 0);
  }

  return {
    // ── Invoices ─────────────────────────────────────────────────────────────

    createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
      const now = new Date();
      const invoice: Invoice = {
        id: randomUUID(),
        clinicId: input.clinicId,
        patientId: input.patientId,
        patientName: input.patientName,
        invoiceNumber: null,
        status: "draft",
        issuedAt: null,
        dueAt: input.dueAt,
        subtotalCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 0,
        paidCents: 0,
        outstandingCents: 0,
        taxRateBasisPoints: input.taxRateBasisPoints ?? GST_RATE_BASIS_POINTS,
        notes: input.notes,
        createdByUserId: input.createdByUserId,
        createdByEmail: input.createdByEmail,
        voidedByUserId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: now,
        updatedAt: now,
      };
      invoices.push(invoice);
      return Promise.resolve({ ...invoice });
    },

    findInvoiceById(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice | null> {
      const found = invoices.find(
        (i) => i.id === invoiceId && i.clinicId === clinicId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listInvoices(
      clinicId: string,
      options?: ListInvoiceOptions,
    ): Promise<Invoice[]> {
      return Promise.resolve(
        invoices
          .filter((i) => {
            if (i.clinicId !== clinicId) return false;
            if (options?.status && i.status !== options.status) return false;
            if (options?.patientId && i.patientId !== options.patientId)
              return false;
            const createdDate = i.createdAt.toISOString().slice(0, 10);
            if (options?.from && createdDate < options.from) return false;
            if (options?.to && createdDate > options.to) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 50))
          .map((i) => ({ ...i })),
      );
    },

    updateInvoice(
      clinicId: string,
      invoiceId: string,
      patch: UpdateInvoiceInput,
    ): Promise<Invoice> {
      const index = invoices.findIndex(
        (i) => i.id === invoiceId && i.clinicId === clinicId,
      );
      const existing = invoices[index];
      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Invoice not found: ${invoiceId}`));
      }
      const updated: Invoice = {
        ...existing,
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.invoiceNumber !== undefined && {
          invoiceNumber: patch.invoiceNumber,
        }),
        ...(patch.issuedAt !== undefined && { issuedAt: patch.issuedAt }),
        ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
        ...(patch.subtotalCents !== undefined && {
          subtotalCents: patch.subtotalCents,
        }),
        ...(patch.taxCents !== undefined && { taxCents: patch.taxCents }),
        ...(patch.discountCents !== undefined && {
          discountCents: patch.discountCents,
        }),
        ...(patch.totalCents !== undefined && { totalCents: patch.totalCents }),
        ...(patch.paidCents !== undefined && { paidCents: patch.paidCents }),
        ...(patch.outstandingCents !== undefined && {
          outstandingCents: patch.outstandingCents,
        }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.voidedByUserId !== undefined && {
          voidedByUserId: patch.voidedByUserId,
        }),
        ...(patch.voidedAt !== undefined && { voidedAt: patch.voidedAt }),
        ...(patch.voidReason !== undefined && { voidReason: patch.voidReason }),
        updatedAt: new Date(),
      };
      invoices[index] = updated;
      return Promise.resolve({ ...updated });
    },

    refreshInvoiceTotals(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice> {
      const index = invoices.findIndex(
        (i) => i.id === invoiceId && i.clinicId === clinicId,
      );
      const existing = invoices[index];
      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Invoice not found: ${invoiceId}`));
      }
      const { subtotalCents, taxCents, totalCents } =
        computeInvoiceTotals(invoiceId);
      const discountCents = existing.discountCents;
      const adjustedTotal = totalCents - discountCents;
      const paidCents = existing.paidCents;
      const updated: Invoice = {
        ...existing,
        subtotalCents,
        taxCents,
        discountCents,
        totalCents: adjustedTotal,
        outstandingCents: adjustedTotal - paidCents,
        updatedAt: new Date(),
      };
      invoices[index] = updated;
      return Promise.resolve({ ...updated });
    },

    nextInvoiceNumber(clinicId: string): Promise<string> {
      const current = invoiceSequences.get(clinicId) ?? 0;
      const next = current + 1;
      invoiceSequences.set(clinicId, next);
      const year = new Date().getFullYear();
      return Promise.resolve(`INV-${String(year)}-${String(next).padStart(6, "0")}`);
    },

    // ── Line items ────────────────────────────────────────────────────────────

    addLineItem(input: AddLineItemInput): Promise<InvoiceLineItem> {
      const now = new Date();
      const subtotalCents = input.quantity * input.unitPriceCents;
      const effectiveTaxRate = input.taxable
        ? (invoices.find((i) => i.id === input.invoiceId)?.taxRateBasisPoints ??
          GST_RATE_BASIS_POINTS)
        : 0;
      const taxCents = calculateTaxCents(subtotalCents, effectiveTaxRate);
      const existingCount = lineItems.filter(
        (l) => l.invoiceId === input.invoiceId,
      ).length;
      const lineItem: InvoiceLineItem = {
        id: randomUUID(),
        clinicId: input.clinicId,
        invoiceId: input.invoiceId,
        lineItemType: input.lineItemType,
        description: input.description,
        catalogueItemId: input.catalogueItemId,
        catalogueSku: input.catalogueSku,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        subtotalCents,
        taxRateBasisPoints: effectiveTaxRate,
        taxCents,
        totalCents: subtotalCents + taxCents,
        sortOrder: input.sortOrder ?? (existingCount + 1) * 10,
        createdAt: now,
        updatedAt: now,
      };
      lineItems.push(lineItem);
      return Promise.resolve({ ...lineItem });
    },

    findLineItemById(
      clinicId: string,
      lineItemId: string,
    ): Promise<InvoiceLineItem | null> {
      const found = lineItems.find(
        (l) => l.id === lineItemId && l.clinicId === clinicId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listLineItems(
      clinicId: string,
      invoiceId: string,
    ): Promise<InvoiceLineItem[]> {
      return Promise.resolve(
        lineItems
          .filter((l) => l.invoiceId === invoiceId && l.clinicId === clinicId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((l) => ({ ...l })),
      );
    },

    removeLineItem(
      clinicId: string,
      lineItemId: string,
      invoiceId: string,
    ): Promise<void> {
      const index = lineItems.findIndex(
        (l) =>
          l.id === lineItemId &&
          l.clinicId === clinicId &&
          l.invoiceId === invoiceId,
      );
      if (index === -1) {
        return Promise.reject(new Error(`Line item not found: ${lineItemId}`));
      }
      lineItems.splice(index, 1);
      return Promise.resolve();
    },

    // ── Payments ──────────────────────────────────────────────────────────────

    recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
      const now = new Date();
      const payment: PaymentRecord = {
        id: randomUUID(),
        clinicId: input.clinicId,
        invoiceId: input.invoiceId,
        paymentMethod: input.paymentMethod,
        status: "confirmed",
        amountCents: input.amountCents,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
        recordedByUserId: input.recordedByUserId,
        recordedByEmail: input.recordedByEmail,
        transactionAt: input.transactionAt,
        confirmedAt: now,
        failedAt: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      };
      payments.push(payment);
      return Promise.resolve({ ...payment });
    },

    findPaymentById(
      clinicId: string,
      paymentId: string,
    ): Promise<PaymentRecord | null> {
      const found = payments.find(
        (p) => p.id === paymentId && p.clinicId === clinicId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listPayments(
      clinicId: string,
      invoiceId: string,
    ): Promise<PaymentRecord[]> {
      return Promise.resolve(
        payments
          .filter((p) => p.invoiceId === invoiceId && p.clinicId === clinicId)
          .sort((a, b) => b.transactionAt.getTime() - a.transactionAt.getTime())
          .map((p) => ({ ...p })),
      );
    },

    refreshInvoicePaymentTotals(
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice> {
      const index = invoices.findIndex(
        (i) => i.id === invoiceId && i.clinicId === clinicId,
      );
      const existing = invoices[index];
      if (index === -1 || !existing) {
        return Promise.reject(new Error(`Invoice not found: ${invoiceId}`));
      }
      const paidCents = computePaidCents(clinicId, invoiceId);
      const totalCents = existing.totalCents;
      const outstandingCents = totalCents - paidCents;
      const updated: Invoice = {
        ...existing,
        paidCents,
        outstandingCents,
        updatedAt: new Date(),
      };
      invoices[index] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
