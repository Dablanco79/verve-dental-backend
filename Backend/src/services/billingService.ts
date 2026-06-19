import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type {
  AddLineItemInput,
  CreateInvoiceInput,
  Invoice,
  InvoiceLineItem,
  ListInvoiceOptions,
  PaymentRecord,
  RecordPaymentInput,
} from "../types/billing.js";
import type { BillingRepository } from "../repositories/billingRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

// Narrow write-only audit dependency — keeps BillingService decoupled from the
// full AnalyticsRepository interface while supporting both Postgres and in-memory modes.
type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Custom billing error codes
// ─────────────────────────────────────────────────────────────────────────────
//
// BILLING_TENANT_VIOLATION  — token homeClinicId ≠ invoice clinicId (non-admin)
// BILLING_FORBIDDEN         — RBAC role is not permitted for this operation
// BILLING_INVOICE_NOT_FOUND — invoice not found within the clinic's scope
// BILLING_INVALID_STATUS    — operation not valid for the invoice's current status
// BILLING_LINE_ITEM_LOCKED  — line items cannot be mutated after invoice is issued
// BILLING_EMPTY_INVOICE     — cannot issue an invoice with no line items
// BILLING_PAYMENT_NEGATIVE  — amountCents must be > 0 for payments (use refund for credits)
// BILLING_VOID_RESTRICTED   — void is only permitted on draft or issued invoices
// BILLING_LINE_ITEM_NOT_FOUND — line item not found within the clinic/invoice scope

// ─────────────────────────────────────────────────────────────────────────────
// RBAC helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-tenant guard — explicit token-level check.
 *
 * Every BillingService operation calls this BEFORE any repository access.
 * `owner_admin` is granted global bypass access across all clinics.
 * All other roles must have their `homeClinicId` match the target `clinicId`.
 *
 * This runs at the service layer IN ADDITION to the `enforceTenantParam`
 * middleware check, providing defence-in-depth isolation.
 */
function assertTenantAccess(
  caller: AuthenticatedUser,
  clinicId: string,
): void {
  if (caller.role === "owner_admin") return;
  if (caller.homeClinicId === clinicId) return;
  throw new AppError(
    403,
    "BILLING_TENANT_VIOLATION",
    "Your token is not authorised to access billing records for this clinic",
  );
}

/**
 * Write-access guard — only `owner_admin` and `group_practice_manager` may
 * create or mutate billing records.  `clinical_staff` is read-only.
 */
function assertBillingWriteAccess(caller: AuthenticatedUser): void {
  if (
    caller.role === "owner_admin" ||
    caller.role === "group_practice_manager"
  ) {
    return;
  }
  throw new AppError(
    403,
    "BILLING_FORBIDDEN",
    "Only managers and admins can create or modify billing records",
  );
}

/**
 * Terminal-state guard — void and cancelled invoices are immutable.
 */
function assertNotTerminal(invoice: Invoice): void {
  if (invoice.status === "void" || invoice.status === "cancelled") {
    throw new AppError(
      409,
      "BILLING_INVALID_STATUS",
      `Invoice ${invoice.invoiceNumber ?? invoice.id} is in a terminal state (${invoice.status}) and cannot be modified`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────────────

export type BillingService = ReturnType<typeof createBillingService>;

export function createBillingService(
  billingRepository: BillingRepository,
  auditWriter?: AuditWriter,
) {
  return {
    // ── Draft invoice creation ─────────────────────────────────────────────────

    /**
     * Creates a new draft invoice scoped to `clinicId`.
     *
     * The invoice is invisible to patients and cannot receive payments until
     * `issueInvoice()` transitions it to the `issued` state.
     * Tax rate is snapshotted at creation time to prevent retrospective GST
     * recalculation if the rate changes in the future.
     */
    async createDraftInvoice(
      caller: AuthenticatedUser,
      clinicId: string,
      input: Omit<
        CreateInvoiceInput,
        "clinicId" | "createdByUserId" | "createdByEmail"
      >,
    ): Promise<Invoice> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      const invoice = await billingRepository.createInvoice({
        clinicId,
        createdByUserId: caller.id,
        createdByEmail: caller.email,
        ...input,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "invoice",
        entityId: invoice.id,
        action: "created",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: { status: invoice.status, patientName: invoice.patientName },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return invoice;
    },

    // ── Line item management ──────────────────────────────────────────────────

    /**
     * Adds an itemized fee line to a draft invoice and recalculates totals.
     *
     * Line items are locked once the invoice transitions to `issued`.
     * Tax per line = round(subtotalCents × taxRateBasisPoints / 10_000).
     * The invoice's snapshotted `taxRateBasisPoints` is used for taxable lines.
     */
    async addLineItem(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
      input: Omit<AddLineItemInput, "clinicId" | "invoiceId">,
    ): Promise<{ lineItem: InvoiceLineItem; invoice: Invoice }> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      assertNotTerminal(invoice);

      if (invoice.status !== "draft") {
        throw new AppError(
          409,
          "BILLING_LINE_ITEM_LOCKED",
          "Line items can only be added to draft invoices — issue status locks the invoice",
        );
      }

      if (input.quantity < 1) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "quantity must be at least 1",
        );
      }
      if (input.unitPriceCents < 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "unitPriceCents cannot be negative",
        );
      }

      const lineItem = await billingRepository.addLineItem({
        clinicId,
        invoiceId,
        ...input,
      });
      const updatedInvoice = await billingRepository.refreshInvoiceTotals(
        clinicId,
        invoiceId,
      );

      auditWriter?.recordEvent({
        clinicId,
        entityType: "line_item",
        entityId: lineItem.id,
        action: "added",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          invoiceId,
          description: lineItem.description,
          quantity: lineItem.quantity,
          unitPriceCents: lineItem.unitPriceCents,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return { lineItem, invoice: updatedInvoice };
    },

    /**
     * Removes a line item from a draft invoice and recalculates totals.
     * Locked once the invoice is issued.
     */
    async removeLineItem(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
      lineItemId: string,
    ): Promise<Invoice> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      assertNotTerminal(invoice);

      if (invoice.status !== "draft") {
        throw new AppError(
          409,
          "BILLING_LINE_ITEM_LOCKED",
          "Line items can only be removed from draft invoices",
        );
      }

      const lineItem = await billingRepository.findLineItemById(
        clinicId,
        lineItemId,
      );
      if (!lineItem || lineItem.invoiceId !== invoiceId) {
        throw new AppError(
          404,
          "BILLING_LINE_ITEM_NOT_FOUND",
          "Line item not found on this invoice",
        );
      }

      await billingRepository.removeLineItem(clinicId, lineItemId, invoiceId);
      const refreshedInvoice = await billingRepository.refreshInvoiceTotals(clinicId, invoiceId);

      auditWriter?.recordEvent({
        clinicId,
        entityType: "line_item",
        entityId: lineItemId,
        action: "removed",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          invoiceId,
          description: lineItem.description,
          unitPriceCents: lineItem.unitPriceCents,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return refreshedInvoice;
    },

    // ── Invoice issuance ──────────────────────────────────────────────────────

    /**
     * Transitions a draft invoice to `issued` status.
     *
     * Pre-conditions:
     *   • Invoice must be in `draft` state.
     *   • At least one line item must exist (no zero-total invoices).
     *
     * On issue:
     *   • `invoiceNumber` is generated atomically from the per-clinic sequence.
     *   • `issuedAt` is stamped with the current UTC timestamp.
     *   • Line items are locked — no further add/remove is permitted.
     */
    async issueInvoice(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
    ): Promise<Invoice> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      if (invoice.status !== "draft") {
        throw new AppError(
          409,
          "BILLING_INVALID_STATUS",
          `Cannot issue an invoice in '${invoice.status}' status — only draft invoices can be issued`,
        );
      }

      const lineItems = await billingRepository.listLineItems(
        clinicId,
        invoiceId,
      );
      if (lineItems.length === 0) {
        throw new AppError(
          400,
          "BILLING_EMPTY_INVOICE",
          "Cannot issue an invoice with no line items",
        );
      }

      const invoiceNumber = await billingRepository.nextInvoiceNumber(clinicId);

      const issuedInvoice = await billingRepository.updateInvoice(clinicId, invoiceId, {
        status: "issued",
        invoiceNumber,
        issuedAt: new Date(),
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "invoice",
        entityId: invoiceId,
        action: "issued",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          invoiceNumber,
          totalCents: issuedInvoice.totalCents,
          patientName: issuedInvoice.patientName,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return issuedInvoice;
    },

    // ── Payment recording ─────────────────────────────────────────────────────

    /**
     * Records a confirmed payment against an issued, partially-paid, or
     * overdue invoice and recalculates the outstanding balance.
     *
     * Invoice status transitions:
     *   issued / partially_paid / overdue → partially_paid (if still outstanding)
     *   issued / partially_paid / overdue → paid (if outstandingCents ≤ 0)
     *
     * Positive `amountCents` = payment received from patient.
     * Negative `amountCents` = refund issued (reduces paidCents / increases outstanding).
     *
     * All payment records are append-only — no edits or deletions.
     */
    async recordPayment(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
      input: Omit<
        RecordPaymentInput,
        "clinicId" | "invoiceId" | "recordedByUserId" | "recordedByEmail"
      >,
    ): Promise<{ payment: PaymentRecord; invoice: Invoice }> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      if (input.amountCents === 0) {
        throw new AppError(
          400,
          "BILLING_PAYMENT_NEGATIVE",
          "amountCents must be non-zero",
        );
      }

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      // Payments (positive) and refunds (negative) are accepted on all
      // non-terminal, non-draft statuses.  A `paid` invoice can still receive
      // a refund which would raise outstanding_cents back above zero.
      const payableStatuses: Invoice["status"][] = [
        "issued",
        "partially_paid",
        "overdue",
        "paid",
      ];
      if (!payableStatuses.includes(invoice.status)) {
        throw new AppError(
          409,
          "BILLING_INVALID_STATUS",
          `Payments and refunds can only be recorded against issued, partially_paid, overdue, or paid invoices — current status: '${invoice.status}'`,
        );
      }

      const payment = await billingRepository.recordPayment({
        ...input,
        clinicId,
        invoiceId,
        recordedByUserId: caller.id,
        recordedByEmail: caller.email,
      });

      // Recompute paidCents and outstandingCents from the full payment ledger.
      let updatedInvoice = await billingRepository.refreshInvoicePaymentTotals(
        clinicId,
        invoiceId,
      );

      // Advance invoice status based on new outstanding balance.
      let newStatus: Invoice["status"] | undefined;
      if (updatedInvoice.outstandingCents <= 0) {
        newStatus = "paid";
      } else if (updatedInvoice.paidCents > 0) {
        newStatus = "partially_paid";
      }

      if (newStatus && newStatus !== updatedInvoice.status) {
        updatedInvoice = await billingRepository.updateInvoice(
          clinicId,
          invoiceId,
          { status: newStatus },
        );
      }

      auditWriter?.recordEvent({
        clinicId,
        entityType: "payment",
        entityId: payment.id,
        action: input.amountCents > 0 ? "payment_recorded" : "refund_recorded",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          invoiceId,
          amountCents: payment.amountCents,
          method: payment.paymentMethod,
          invoiceStatus: updatedInvoice.status,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return { payment, invoice: updatedInvoice };
    },

    // ── Invoice voiding ───────────────────────────────────────────────────────

    /**
     * Voids an invoice with a mandatory reason.
     * Terminal action — a voided invoice cannot be re-opened.
     *
     * Void is permitted only on `draft` and `issued` invoices.
     * Paid or partially-paid invoices must be refunded before voiding.
     */
    async voidInvoice(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
      reason: string,
    ): Promise<Invoice> {
      assertTenantAccess(caller, clinicId);
      assertBillingWriteAccess(caller);

      if (!reason.trim()) {
        throw new AppError(
          400,
          "BILLING_VOID_RESTRICTED",
          "A void reason is required",
        );
      }

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      if (invoice.status !== "draft" && invoice.status !== "issued") {
        throw new AppError(
          409,
          "BILLING_VOID_RESTRICTED",
          `Only draft or issued invoices can be voided — current status: '${invoice.status}'`,
        );
      }

      const voidedInvoice = await billingRepository.updateInvoice(clinicId, invoiceId, {
        status: "void",
        voidedByUserId: caller.id,
        voidedAt: new Date(),
        voidReason: reason,
      });

      auditWriter?.recordEvent({
        clinicId,
        entityType: "invoice",
        entityId: invoiceId,
        action: "void",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: {
          invoiceNumber: voidedInvoice.invoiceNumber,
          reason,
        },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return voidedInvoice;
    },

    // ── Read operations ───────────────────────────────────────────────────────

    async getInvoice(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
    ): Promise<{
      invoice: Invoice;
      lineItems: InvoiceLineItem[];
      payments: PaymentRecord[];
    }> {
      assertTenantAccess(caller, clinicId);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      const [lineItems, payments] = await Promise.all([
        billingRepository.listLineItems(clinicId, invoiceId),
        billingRepository.listPayments(clinicId, invoiceId),
      ]);

      return { invoice, lineItems, payments };
    },

    async listInvoices(
      caller: AuthenticatedUser,
      clinicId: string,
      options?: ListInvoiceOptions,
    ): Promise<Invoice[]> {
      assertTenantAccess(caller, clinicId);
      return billingRepository.listInvoices(clinicId, options);
    },

    async listLineItems(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
    ): Promise<InvoiceLineItem[]> {
      assertTenantAccess(caller, clinicId);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      return billingRepository.listLineItems(clinicId, invoiceId);
    },

    async listPayments(
      caller: AuthenticatedUser,
      clinicId: string,
      invoiceId: string,
    ): Promise<PaymentRecord[]> {
      assertTenantAccess(caller, clinicId);

      const invoice = await billingRepository.findInvoiceById(
        clinicId,
        invoiceId,
      );
      if (!invoice) {
        throw new AppError(
          404,
          "BILLING_INVOICE_NOT_FOUND",
          "Invoice not found",
        );
      }

      return billingRepository.listPayments(clinicId, invoiceId);
    },
  };
}
