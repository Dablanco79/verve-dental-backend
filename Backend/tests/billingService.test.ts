/**
 * BillingService integration tests.
 *
 * All tests use the in-memory BillingRepository — no PostgreSQL connection
 * required.  Each test gets a fresh repository instance via beforeEach.
 *
 * Coverage:
 *   1.  createDraftInvoice — success path
 *   2.  createDraftInvoice — clinical_staff RBAC rejection
 *   3.  createDraftInvoice — cross-clinic tenant violation (non-admin)
 *   4.  createDraftInvoice — owner_admin bypasses tenant guard
 *   5.  addLineItem — taxable line; tax + totals calculated correctly
 *   6.  addLineItem — non-taxable line; zero tax
 *   7.  addLineItem — multiple lines; invoice totals accumulate
 *   8.  addLineItem — fails on issued invoice (locked)
 *   9.  addLineItem — quantity < 1 rejected
 *   10. addLineItem — unitPriceCents < 0 rejected
 *   11. removeLineItem — reduces invoice totals
 *   12. removeLineItem — fails on issued invoice
 *   13. removeLineItem — fails for non-existent line item
 *   14. issueInvoice — transitions draft → issued with invoice number
 *   15. issueInvoice — fails when no line items exist
 *   16. issueInvoice — fails when invoice is already issued
 *   17. recordPayment — partial payment → partially_paid
 *   18. recordPayment — full payment → paid + outstanding = 0
 *   19. recordPayment — refund (negative) raises outstanding
 *   20. recordPayment — fails on draft invoice
 *   21. recordPayment — amountCents = 0 rejected
 *   22. voidInvoice — draft invoice voided with reason
 *   23. voidInvoice — issued invoice voided with reason
 *   24. voidInvoice — fails on paid invoice
 *   25. voidInvoice — empty reason rejected
 *   26. getInvoice — returns invoice + line items + payments
 *   27. listInvoices — returns only invoices for the caller's clinic
 *   28. invoice number sequencing — sequential numbers per clinic
 */

import { createInMemoryBillingRepository } from "../src/repositories/billingRepository.js";
import { createBillingService } from "../src/services/billingService.js";
import { AppError } from "../src/types/errors.js";
import { GST_RATE_BASIS_POINTS } from "../src/types/billing.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_A = "00000000-0000-0000-0000-000000000001";
const CLINIC_B = "00000000-0000-0000-0000-000000000002";

function makeAdmin(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-admin-1",
    email: "admin@clinic-a.au",
    role: "owner_admin",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeManager(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-manager-1",
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeStaff(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-staff-1",
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: clinicId,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeService() {
  const repo = createInMemoryBillingRepository();
  const service = createBillingService(repo);
  return { repo, service };
}

async function createDraftWithOneLine(
  service: ReturnType<typeof createBillingService>,
  caller: AuthenticatedUser,
  clinicId: string,
  unitPriceCents = 10_000,
  taxable = true,
) {
  const invoice = await service.createDraftInvoice(caller, clinicId, {
    patientId: null,
    patientName: "Jane Smith",
    dueAt: null,
    notes: null,
  });

  const { lineItem, invoice: updated } = await service.addLineItem(
    caller,
    clinicId,
    invoice.id,
    {
      lineItemType: "consultation_fee",
      description: "Initial consultation",
      catalogueItemId: null,
      catalogueSku: null,
      quantity: 1,
      unitPriceCents,
      taxable,
    },
  );

  return { invoice: updated, lineItem };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("BillingService", () => {
  // ── 1. createDraftInvoice — success ────────────────────────────────────────
  it("creates a draft invoice with correct initial state", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "John Doe",
      dueAt: null,
      notes: "First visit",
    });

    expect(invoice.status).toBe("draft");
    expect(invoice.clinicId).toBe(CLINIC_A);
    expect(invoice.patientName).toBe("John Doe");
    expect(invoice.invoiceNumber).toBeNull();
    expect(invoice.subtotalCents).toBe(0);
    expect(invoice.taxCents).toBe(0);
    expect(invoice.totalCents).toBe(0);
    expect(invoice.paidCents).toBe(0);
    expect(invoice.outstandingCents).toBe(0);
    expect(invoice.taxRateBasisPoints).toBe(GST_RATE_BASIS_POINTS);
    expect(invoice.createdByEmail).toBe(caller.email);
  });

  // ── 2. createDraftInvoice — clinical_staff RBAC rejection ─────────────────
  it("rejects clinical_staff from creating invoices", async () => {
    const { service } = makeService();
    const caller = makeStaff();

    await expect(
      service.createDraftInvoice(caller, CLINIC_A, {
        patientId: null,
        patientName: "Patient",
        dueAt: null,
        notes: null,
      }),
    ).rejects.toMatchObject({
      code: "BILLING_FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  // ── 3. tenant violation — non-admin cross-clinic ───────────────────────────
  it("rejects a manager accessing a different clinic's billing", async () => {
    const { service } = makeService();
    // Manager belongs to CLINIC_A but targets CLINIC_B.
    const caller = makeManager(CLINIC_A);

    await expect(
      service.createDraftInvoice(caller, CLINIC_B, {
        patientId: null,
        patientName: "Patient",
        dueAt: null,
        notes: null,
      }),
    ).rejects.toMatchObject({
      code: "BILLING_TENANT_VIOLATION",
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  // ── 4. owner_admin bypasses tenant guard ───────────────────────────────────
  it("allows owner_admin to access any clinic's billing", async () => {
    const { service } = makeService();
    // owner_admin's homeClinicId is CLINIC_A but they access CLINIC_B.
    const caller = makeAdmin(CLINIC_A);

    const invoice = await service.createDraftInvoice(caller, CLINIC_B, {
      patientId: null,
      patientName: "Cross-clinic patient",
      dueAt: null,
      notes: null,
    });

    expect(invoice.clinicId).toBe(CLINIC_B);
    expect(invoice.status).toBe("draft");
  });

  // ── 5. addLineItem — taxable; tax calculated correctly ────────────────────
  it("adds a taxable line item and calculates 10% GST correctly", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice, lineItem } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      10_000,
      true,
    );

    // subtotal = 1 × $100.00 = 10,000 cents
    // tax = round(10,000 × 1000 / 10,000) = 1,000 cents ($10.00)
    // total = 11,000 cents ($110.00)
    expect(lineItem.subtotalCents).toBe(10_000);
    expect(lineItem.taxCents).toBe(1_000);
    expect(lineItem.totalCents).toBe(11_000);
    expect(lineItem.taxRateBasisPoints).toBe(GST_RATE_BASIS_POINTS);

    expect(invoice.subtotalCents).toBe(10_000);
    expect(invoice.taxCents).toBe(1_000);
    expect(invoice.totalCents).toBe(11_000);
    expect(invoice.outstandingCents).toBe(11_000);
  });

  // ── 6. addLineItem — non-taxable; zero tax ────────────────────────────────
  it("adds a non-taxable line item with zero tax", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { lineItem, invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      5_000,
      false,
    );

    expect(lineItem.taxRateBasisPoints).toBe(0);
    expect(lineItem.taxCents).toBe(0);
    expect(lineItem.totalCents).toBe(5_000);
    expect(invoice.taxCents).toBe(0);
    expect(invoice.totalCents).toBe(5_000);
  });

  // ── 7. addLineItem — multiple lines accumulate correctly ──────────────────
  it("accumulates totals correctly across multiple line items", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice1 = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Test Patient",
      dueAt: null,
      notes: null,
    });

    // Line 1: $50 taxable → subtotal 5000, tax 500, total 5500
    await service.addLineItem(caller, CLINIC_A, invoice1.id, {
      lineItemType: "consultation_fee",
      description: "Consultation",
      catalogueItemId: null,
      catalogueSku: null,
      quantity: 1,
      unitPriceCents: 5_000,
      taxable: true,
    });

    // Line 2: $200 × 2 taxable → subtotal 40000, tax 4000, total 44000
    const { invoice } = await service.addLineItem(
      caller,
      CLINIC_A,
      invoice1.id,
      {
        lineItemType: "procedure_fee",
        description: "Filling",
        catalogueItemId: null,
        catalogueSku: null,
        quantity: 2,
        unitPriceCents: 20_000,
        taxable: true,
      },
    );

    // Total subtotal = 5000 + 40000 = 45000
    // Total tax = 500 + 4000 = 4500
    // Total = 49500
    expect(invoice.subtotalCents).toBe(45_000);
    expect(invoice.taxCents).toBe(4_500);
    expect(invoice.totalCents).toBe(49_500);
    expect(invoice.outstandingCents).toBe(49_500);
  });

  // ── 8. addLineItem — fails on issued invoice ──────────────────────────────
  it("prevents adding line items to an issued invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.addLineItem(caller, CLINIC_A, invoice.id, {
        lineItemType: "other",
        description: "Late fee",
        catalogueItemId: null,
        catalogueSku: null,
        quantity: 1,
        unitPriceCents: 1_000,
        taxable: false,
      }),
    ).rejects.toMatchObject({
      code: "BILLING_LINE_ITEM_LOCKED",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 9. addLineItem — quantity < 1 rejected ────────────────────────────────
  it("rejects a line item with quantity < 1", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.addLineItem(caller, CLINIC_A, invoice.id, {
        lineItemType: "other",
        description: "Bad line",
        catalogueItemId: null,
        catalogueSku: null,
        quantity: 0,
        unitPriceCents: 1_000,
        taxable: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  // ── 10. addLineItem — negative unitPriceCents rejected ────────────────────
  it("rejects a line item with negative unitPriceCents", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.addLineItem(caller, CLINIC_A, invoice.id, {
        lineItemType: "other",
        description: "Bad price",
        catalogueItemId: null,
        catalogueSku: null,
        quantity: 1,
        unitPriceCents: -100,
        taxable: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  // ── 11. removeLineItem — reduces totals ───────────────────────────────────
  it("removes a line item and recalculates invoice totals", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice: invoiceWithLine, lineItem } =
      await createDraftWithOneLine(service, caller, CLINIC_A, 10_000);
    expect(invoiceWithLine.totalCents).toBe(11_000);

    const updatedInvoice = await service.removeLineItem(
      caller,
      CLINIC_A,
      invoiceWithLine.id,
      lineItem.id,
    );

    expect(updatedInvoice.subtotalCents).toBe(0);
    expect(updatedInvoice.taxCents).toBe(0);
    expect(updatedInvoice.totalCents).toBe(0);
    expect(updatedInvoice.outstandingCents).toBe(0);
  });

  // ── 12. removeLineItem — fails on issued invoice ──────────────────────────
  it("prevents removing line items from an issued invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice, lineItem } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.removeLineItem(caller, CLINIC_A, invoice.id, lineItem.id),
    ).rejects.toMatchObject({
      code: "BILLING_LINE_ITEM_LOCKED",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 13. removeLineItem — non-existent item ────────────────────────────────
  it("returns 404 when removing a non-existent line item", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.removeLineItem(
        caller,
        CLINIC_A,
        invoice.id,
        "00000000-0000-0000-0000-000000000099",
      ),
    ).rejects.toMatchObject({
      code: "BILLING_LINE_ITEM_NOT_FOUND",
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  // ── 14. issueInvoice — transitions draft → issued ─────────────────────────
  it("issues a draft invoice and stamps invoiceNumber + issuedAt", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice: draft } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
    );
    const issued = await service.issueInvoice(caller, CLINIC_A, draft.id);

    expect(issued.status).toBe("issued");
    expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(issued.issuedAt).toBeInstanceOf(Date);
  });

  // ── 15. issueInvoice — empty invoice rejected ─────────────────────────────
  it("rejects issuing an invoice with no line items", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.issueInvoice(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "BILLING_EMPTY_INVOICE",
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  // ── 16. issueInvoice — already issued ─────────────────────────────────────
  it("rejects issuing an already-issued invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(service, caller, CLINIC_A);
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.issueInvoice(caller, CLINIC_A, invoice.id),
    ).rejects.toMatchObject({
      code: "BILLING_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 17. recordPayment — partial payment → partially_paid ──────────────────
  it("records a partial payment and transitions invoice to partially_paid", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      10_000,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    // Pay half: $55 of $110 total.
    const { payment, invoice: afterPayment } = await service.recordPayment(
      caller,
      CLINIC_A,
      invoice.id,
      {
        paymentMethod: "eftpos",
        amountCents: 5_500,
        referenceNumber: "TXN-001",
        notes: null,
        transactionAt: new Date(),
      },
    );

    expect(payment.amountCents).toBe(5_500);
    expect(payment.status).toBe("confirmed");
    expect(afterPayment.status).toBe("partially_paid");
    expect(afterPayment.paidCents).toBe(5_500);
    expect(afterPayment.outstandingCents).toBe(5_500);
  });

  // ── 18. recordPayment — full payment → paid ───────────────────────────────
  it("transitions invoice to paid when outstanding reaches 0", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      10_000,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    // Total = 11,000 cents (incl. GST).
    const { invoice: afterPayment } = await service.recordPayment(
      caller,
      CLINIC_A,
      invoice.id,
      {
        paymentMethod: "cash",
        amountCents: 11_000,
        referenceNumber: null,
        notes: null,
        transactionAt: new Date(),
      },
    );

    expect(afterPayment.status).toBe("paid");
    expect(afterPayment.paidCents).toBe(11_000);
    expect(afterPayment.outstandingCents).toBe(0);
  });

  // ── 19. recordPayment — refund raises outstanding ─────────────────────────
  it("records a refund (negative amountCents) and updates outstanding", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      10_000,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    // Full payment first.
    await service.recordPayment(caller, CLINIC_A, invoice.id, {
      paymentMethod: "eftpos",
      amountCents: 11_000,
      referenceNumber: null,
      notes: null,
      transactionAt: new Date(),
    });

    // Now issue a refund of $11.
    const { invoice: afterRefund } = await service.recordPayment(
      caller,
      CLINIC_A,
      invoice.id,
      {
        paymentMethod: "eftpos",
        amountCents: -1_100,
        referenceNumber: "REFUND-001",
        notes: "Partial refund",
        transactionAt: new Date(),
      },
    );

    // paidCents = 11000 - 1100 = 9900; outstanding = 11000 - 9900 = 1100
    expect(afterRefund.paidCents).toBe(9_900);
    expect(afterRefund.outstandingCents).toBe(1_100);
    expect(afterRefund.status).toBe("partially_paid");
  });

  // ── 20. recordPayment — fails on draft invoice ────────────────────────────
  it("rejects payment on a draft invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.recordPayment(caller, CLINIC_A, invoice.id, {
        paymentMethod: "cash",
        amountCents: 1_000,
        referenceNumber: null,
        notes: null,
        transactionAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: "BILLING_INVALID_STATUS",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 21. recordPayment — zero amount rejected ──────────────────────────────
  it("rejects a payment with amountCents = 0", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(service, caller, CLINIC_A);
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    await expect(
      service.recordPayment(caller, CLINIC_A, invoice.id, {
        paymentMethod: "cash",
        amountCents: 0,
        referenceNumber: null,
        notes: null,
        transactionAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: "BILLING_PAYMENT_NEGATIVE",
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  // ── 22. voidInvoice — draft → void ───────────────────────────────────────
  it("voids a draft invoice with a reason", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    const voided = await service.voidInvoice(
      caller,
      CLINIC_A,
      invoice.id,
      "Patient cancelled appointment",
    );

    expect(voided.status).toBe("void");
    expect(voided.voidReason).toBe("Patient cancelled appointment");
    expect(voided.voidedByUserId).toBe(caller.id);
    expect(voided.voidedAt).toBeInstanceOf(Date);
  });

  // ── 23. voidInvoice — issued → void ──────────────────────────────────────
  it("voids an issued invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(service, caller, CLINIC_A);
    await service.issueInvoice(caller, CLINIC_A, invoice.id);

    const voided = await service.voidInvoice(
      caller,
      CLINIC_A,
      invoice.id,
      "Duplicate invoice — refer to INV-2026-000001",
    );

    expect(voided.status).toBe("void");
  });

  // ── 24. voidInvoice — paid invoice rejected ───────────────────────────────
  it("rejects voiding a paid invoice", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
      10_000,
    );
    await service.issueInvoice(caller, CLINIC_A, invoice.id);
    await service.recordPayment(caller, CLINIC_A, invoice.id, {
      paymentMethod: "cash",
      amountCents: 11_000,
      referenceNumber: null,
      notes: null,
      transactionAt: new Date(),
    });

    await expect(
      service.voidInvoice(caller, CLINIC_A, invoice.id, "Mistake"),
    ).rejects.toMatchObject({
      code: "BILLING_VOID_RESTRICTED",
      statusCode: 409,
    } satisfies Partial<AppError>);
  });

  // ── 25. voidInvoice — empty reason rejected ───────────────────────────────
  it("rejects voiding with an empty reason string", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const invoice = await service.createDraftInvoice(caller, CLINIC_A, {
      patientId: null,
      patientName: "Patient",
      dueAt: null,
      notes: null,
    });

    await expect(
      service.voidInvoice(caller, CLINIC_A, invoice.id, "   "),
    ).rejects.toMatchObject({
      code: "BILLING_VOID_RESTRICTED",
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  // ── 26. getInvoice — returns composite detail ─────────────────────────────
  it("getInvoice returns invoice, line items, and payments", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice } = await createDraftWithOneLine(service, caller, CLINIC_A);
    await service.issueInvoice(caller, CLINIC_A, invoice.id);
    await service.recordPayment(caller, CLINIC_A, invoice.id, {
      paymentMethod: "eftpos",
      amountCents: 5_500,
      referenceNumber: null,
      notes: null,
      transactionAt: new Date(),
    });

    const detail = await service.getInvoice(caller, CLINIC_A, invoice.id);

    expect(detail.invoice.status).toBe("partially_paid");
    expect(detail.lineItems).toHaveLength(1);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]?.amountCents).toBe(5_500);
  });

  // ── 27. listInvoices — tenant-scoped ─────────────────────────────────────
  it("listInvoices returns only invoices belonging to the caller's clinic", async () => {
    const { service } = makeService();
    const adminA = makeAdmin(CLINIC_A);
    const adminB = makeAdmin(CLINIC_B);

    // Create 2 invoices in CLINIC_A and 1 in CLINIC_B via owner_admin cross-clinic.
    await service.createDraftInvoice(adminA, CLINIC_A, {
      patientId: null,
      patientName: "A Patient 1",
      dueAt: null,
      notes: null,
    });
    await service.createDraftInvoice(adminA, CLINIC_A, {
      patientId: null,
      patientName: "A Patient 2",
      dueAt: null,
      notes: null,
    });
    await service.createDraftInvoice(adminB, CLINIC_B, {
      patientId: null,
      patientName: "B Patient 1",
      dueAt: null,
      notes: null,
    });

    const clinicAInvoices = await service.listInvoices(adminA, CLINIC_A);
    const clinicBInvoices = await service.listInvoices(adminB, CLINIC_B);

    expect(clinicAInvoices).toHaveLength(2);
    expect(clinicBInvoices).toHaveLength(1);
    expect(clinicAInvoices.every((i) => i.clinicId === CLINIC_A)).toBe(true);
    expect(clinicBInvoices.every((i) => i.clinicId === CLINIC_B)).toBe(true);
  });

  // ── 28. invoice number sequencing ─────────────────────────────────────────
  it("generates sequential invoice numbers per clinic", async () => {
    const { service } = makeService();
    const caller = makeManager();

    const { invoice: inv1 } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
    );
    const { invoice: inv2 } = await createDraftWithOneLine(
      service,
      caller,
      CLINIC_A,
    );

    const issued1 = await service.issueInvoice(caller, CLINIC_A, inv1.id);
    const issued2 = await service.issueInvoice(caller, CLINIC_A, inv2.id);

    const year = new Date().getFullYear();
    expect(issued1.invoiceNumber).toBe(`INV-${String(year)}-000001`);
    expect(issued2.invoiceNumber).toBe(`INV-${String(year)}-000002`);
  });
});
