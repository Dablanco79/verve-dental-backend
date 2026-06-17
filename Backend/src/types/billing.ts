// ─────────────────────────────────────────────────────────────────────────────
// Module 07 — Core Billing, Invoicing, and Multi-Tenant Payment Integrations
//
// All monetary fields are stored as INTEGER CENTS (AUD) to eliminate
// floating-point drift.  GST is expressed in basis points (1000 = 10%).
//
// The `as const` arrays are the single source of truth for each DB ENUM —
// Zod validators in controllers derive from them directly so no string
// duplication exists in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

// ── ENUMs ─────────────────────────────────────────────────────────────────────

/**
 * Invoice lifecycle:
 *   draft         → line items can be added/removed; not yet visible to patient.
 *   issued        → locked; no further line item changes; payment can be recorded.
 *   partially_paid → at least one payment confirmed; outstanding_cents > 0.
 *   paid          → outstanding_cents ≤ 0; all confirmed payments cover total.
 *   overdue       → issued + due_at has passed + unpaid (set by scheduled job — Module 07 Session 3+).
 *   void          → cancelled by manager with mandatory reason; terminal state.
 *   cancelled     → draft discarded before issue; terminal state.
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
 * Line item categories for rendering, reporting, and accounting adapter mapping.
 *
 * consultation_fee → standard patient consultation charge.
 * procedure_fee    → specific clinical procedure (e.g. filling, extraction).
 * material_fee     → consumable materials charged to the patient.
 * catalogue_item   → directly linked to a master_catalog_items SKU.
 * tax              → explicit tax line (Australian GST — usually computed).
 * adjustment       → discount, write-off, or price correction (typically negative).
 * other            → catch-all for uncategorised charges.
 */
export const LINE_ITEM_TYPES = [
  "consultation_fee",
  "procedure_fee",
  "material_fee",
  "catalogue_item",
  "tax",
  "adjustment",
  "other",
] as const;

export type LineItemType = (typeof LINE_ITEM_TYPES)[number];

/**
 * Payment methods accepted at the clinic.
 * insurance_claim covers Medicare, private health fund, and DVA bulk-bill claims.
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

/**
 * Payment record lifecycle.
 * pending   → recorded but not yet bank-confirmed (e.g. pending EFTPOS batch).
 * confirmed → bank/gateway confirmed; contributes to invoice paid_cents total.
 * failed    → payment attempt failed; does NOT reduce outstanding_cents.
 * refunded  → negative amount_cents record representing a refund to the patient.
 */
export const PAYMENT_STATUSES = [
  "pending",
  "confirmed",
  "failed",
  "refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ── Tax configuration ─────────────────────────────────────────────────────────

/** Australian GST rate: 10% expressed as basis points (1000 bp = 10%). */
export const GST_RATE_BASIS_POINTS = 1_000 as const;

/** Helper: calculates integer cents of tax from a subtotal and a rate in basis points. */
export function calculateTaxCents(
  subtotalCents: number,
  taxRateBasisPoints: number,
): number {
  return Math.round((subtotalCents * taxRateBasisPoints) / 10_000);
}

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Invoice header record.
 *
 * Multi-tenancy: `clinicId` is the non-nullable tenant anchor.
 * The BillingService asserts `caller.homeClinicId === clinicId` (or owner_admin)
 * before any read or write — defence in depth beyond middleware `enforceTenantParam`.
 *
 * Monetary totals are derived by `refreshInvoiceTotals()` after every line-item
 * mutation and after every payment confirmation, ensuring consistency.
 */
export type Invoice = {
  id: string;
  /** Non-nullable tenant discriminator — every invoice belongs to exactly one clinic. */
  clinicId: string;
  /** Nullable until Module 08 introduces the canonical patients table. */
  patientId: string | null;
  /** Denormalized patient display name; snapshot at invoice creation time. */
  patientName: string;
  /**
   * Human-readable sequential number (e.g. INV-2026-000001).
   * NULL until `issueInvoice()` is called — draft invoices have no public number.
   */
  invoiceNumber: string | null;
  status: InvoiceStatus;
  /** Timestamp when the invoice was issued (status transitioned from draft → issued). */
  issuedAt: Date | null;
  /** Optional due date for payment; used by the overdue scheduler. */
  dueAt: Date | null;
  // ── Monetary totals (integer cents, AUD) ─────────────────────────────────
  /** Sum of all line-item subtotalCents (pre-tax, pre-discount). */
  subtotalCents: number;
  /** Sum of all line-item taxCents. */
  taxCents: number;
  /** Aggregate discount applied at invoice level (future — adjustment lines used today). */
  discountCents: number;
  /** subtotalCents + taxCents − discountCents. */
  totalCents: number;
  /** Sum of all `confirmed` payment_records.amount_cents. */
  paidCents: number;
  /** totalCents − paidCents. May be negative if patient is in credit. */
  outstandingCents: number;
  // ── Tax snapshot ─────────────────────────────────────────────────────────
  /** GST rate in basis points at the time this invoice was created. Snapshot prevents
   *  retrospective recalculation if the rate changes. Default: 1000 (10% GST). */
  taxRateBasisPoints: number;
  notes: string | null;
  createdByUserId: string;
  /** Denormalized for display without a users JOIN. */
  createdByEmail: string;
  voidedByUserId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Itemized fee line on an invoice.
 *
 * `clinicId` mirrors the parent invoice's clinicId and is stored redundantly
 * for defence-in-depth tenant isolation — a crafted invoiceId cannot reach a
 * line item from a different clinic without also satisfying the clinicId check.
 */
export type InvoiceLineItem = {
  id: string;
  /** Redundant clinicId — defence-in-depth tenant anchor. */
  clinicId: string;
  invoiceId: string;
  lineItemType: LineItemType;
  description: string;
  /** Optional FK to master_catalog_items.id — populated for catalogue_item type. */
  catalogueItemId: string | null;
  /** Denormalized SKU for display without a catalog JOIN. */
  catalogueSku: string | null;
  quantity: number;
  unitPriceCents: number;
  /** quantity × unitPriceCents */
  subtotalCents: number;
  /** Snapshot of the tax rate at line creation time (basis points). */
  taxRateBasisPoints: number;
  /** calculateTaxCents(subtotalCents, taxRateBasisPoints) */
  taxCents: number;
  /** subtotalCents + taxCents */
  totalCents: number;
  /** Display ordering within the invoice. */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Append-only payment record.
 *
 * Positive `amountCents` = payment received.
 * Negative `amountCents` = refund issued to patient.
 * Only `confirmed` records contribute to `invoice.paidCents`.
 *
 * `clinicId` is redundant (mirrored from parent invoice) for defence-in-depth.
 */
export type PaymentRecord = {
  id: string;
  /** Redundant clinicId — defence-in-depth tenant anchor. */
  clinicId: string;
  invoiceId: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  /** Positive for payment; negative for refund. Integer AUD cents. */
  amountCents: number;
  /** External transaction ID, receipt number, or health fund claim reference. */
  referenceNumber: string | null;
  notes: string | null;
  recordedByUserId: string;
  /** Denormalized for display without a users JOIN. */
  recordedByEmail: string;
  /** When the payment actually occurred — may predate createdAt for reconciliation entries. */
  transactionAt: Date;
  confirmedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Input shapes ──────────────────────────────────────────────────────────────

export type CreateInvoiceInput = {
  clinicId: string;
  patientId: string | null;
  patientName: string;
  dueAt: Date | null;
  /** Defaults to GST_RATE_BASIS_POINTS (1000) if omitted. */
  taxRateBasisPoints?: number;
  notes: string | null;
  createdByUserId: string;
  createdByEmail: string;
};

export type AddLineItemInput = {
  clinicId: string;
  invoiceId: string;
  lineItemType: LineItemType;
  description: string;
  catalogueItemId: string | null;
  catalogueSku: string | null;
  quantity: number;
  unitPriceCents: number;
  /** When false, taxRateBasisPoints is forced to 0 for this line. */
  taxable: boolean;
  /** Display ordering. Defaults to (current line count + 1) × 10 if omitted. */
  sortOrder?: number;
};

export type RecordPaymentInput = {
  clinicId: string;
  invoiceId: string;
  paymentMethod: PaymentMethod;
  /** Positive for payment; negative for refund. */
  amountCents: number;
  referenceNumber: string | null;
  notes: string | null;
  recordedByUserId: string;
  recordedByEmail: string;
  transactionAt: Date;
};

export type UpdateInvoiceInput = Partial<{
  status: InvoiceStatus;
  invoiceNumber: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  notes: string | null;
  voidedByUserId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
}>;

export type ListInvoiceOptions = {
  status?: InvoiceStatus;
  /** YYYY-MM-DD — filter invoices created on or after this date. */
  from?: string;
  /** YYYY-MM-DD — filter invoices created on or before this date. */
  to?: string;
  patientId?: string;
  limit?: number;
  offset?: number;
};
