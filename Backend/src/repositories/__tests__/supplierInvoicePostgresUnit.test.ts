import { describe, expect, it, jest } from "@jest/globals";

import type { DatabasePool } from "../../db/pool.js";
import { createPostgresSupplierInvoiceRepository } from "../supplierInvoiceRepository.postgres.js";

const CLINIC_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createInvoiceRow() {
  const now = new Date("2026-07-02T00:00:00.000Z");
  return {
    id: "99999999-9999-4999-8999-999999999999",
    clinic_id: CLINIC_ID,
    supplier_id: null,
    supplier_name_raw: "Henry Schein",
    invoice_number: "INV-100",
    invoice_date: "2026-07-01",
    due_date: null,
    status: "pending_review",
    subtotal_cents: 1000,
    tax_cents: 100,
    total_cents: 1100,
    currency: "AUD",
    ocr_provider: "test",
    ocr_confidence: "95",
    ocr_raw_response: { provider: "test" },
    original_filename: "invoice.pdf",
    file_mime_type: "application/pdf",
    file_sha256: "sha256",
    storage_key: null,
    imported_by_user_id: USER_ID,
    imported_by_email: "admin@clinic-a.au",
    confirmed_by_user_id: null,
    confirmed_at: null,
    voided_by_user_id: null,
    voided_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
}

function createMockPool() {
  const release = jest.fn();
  const query = jest.fn((sql: string) => {
    if (sql.includes("INSERT INTO supplier_invoices")) {
      return Promise.resolve({ rows: [createInvoiceRow()] });
    }

    return Promise.resolve({ rows: [] });
  });
  const connect = jest.fn(() => Promise.resolve({ query, release }));

  return {
    pool: { connect } as unknown as DatabasePool,
    connect,
    query,
    release,
  };
}

describe("PostgresSupplierInvoiceRepository.createSupplierInvoice", () => {
  it("wraps the insert in tenant context so RLS policies can validate clinic_id", async () => {
    const { pool, connect, query, release } = createMockPool();
    const repo = createPostgresSupplierInvoiceRepository(pool);

    const invoice = await repo.createSupplierInvoice({
      clinicId: CLINIC_ID,
      supplierId: null,
      supplierNameRaw: "Henry Schein",
      invoiceNumber: "INV-100",
      invoiceDate: "2026-07-01",
      dueDate: null,
      subtotalCents: 1000,
      taxCents: 100,
      totalCents: 1100,
      ocrProvider: "test",
      ocrConfidence: 95,
      ocrRawResponse: { provider: "test" },
      originalFilename: "invoice.pdf",
      fileMimeType: "application/pdf",
      fileSha256: "sha256",
      importedByUserId: USER_ID,
      importedByEmail: "admin@clinic-a.au",
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("set_config('app.current_clinic_id'"),
      [CLINIC_ID, "false"],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO supplier_invoices"),
      expect.arrayContaining([CLINIC_ID, "Henry Schein", "INV-100"]),
    );
    expect(query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
    expect(invoice.clinicId).toBe(CLINIC_ID);
  });
});
