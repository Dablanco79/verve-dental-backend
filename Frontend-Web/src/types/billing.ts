/**
 * Module 07 — Internal Billing & Ledger Dashboard (Frontend types)
 *
 * Mirrors Backend/src/types/billing.ts.  All monetary values are integer AUD
 * cents.  Dates arrive from the API as ISO-8601 strings (not Date objects).
 *
 * B2B internal operations only — no patient/consumer surface.
 */

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "cancelled",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Payment methods accepted by the billing API.
 * B2B settlement UI exposes "bank_transfer" (Internal Transfer) and
 * "other" (Bank Wire) — see SettlementModal for label mapping.
 */
export const PAYMENT_METHODS = [
  "cash",
  "eftpos",
  "credit_card",
  "bank_transfer",
  "insurance_claim",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Invoice header returned by GET /clinics/:clinicId/billing/invoices */
export type Invoice = {
  id: string;
  clinicId: string;
  /** In a B2B context this holds the vendor / counterparty name. */
  patientName: string;
  patientId: string | null;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string | null;
  // ── Integer cents (AUD) ────────────────────────────────────────────────
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  taxRateBasisPoints: number;
  notes: string | null;
  createdByUserId: string;
  createdByEmail: string;
  voidedByUserId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Body sent to POST /clinics/:clinicId/billing/invoices/:invoiceId/payments */
export type RecordPaymentRequest = {
  paymentMethod: PaymentMethod;
  /** Integer AUD cents — must be > 0. */
  amountCents: number;
  referenceNumber: string | null;
  notes: string | null;
  /** ISO-8601 datetime string. */
  transactionAt: string;
};

/** Query filters for the invoice list. */
export type InvoiceFilters = {
  status?: InvoiceStatus | "";
  from?: string;
  to?: string;
};
