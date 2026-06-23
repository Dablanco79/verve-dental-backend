/**
 * Supplier Invoice API integration tests — Sprint OCR-1.
 *
 * Uses the in-memory test app (no DB, no Anthropic API key).
 * The StubOcrProvider returns predictable synthetic invoice data.
 *
 * Coverage:
 *   1.  POST /upload — unauthenticated returns 401
 *   2.  POST /upload — clinical_staff returns 403
 *   3.  POST /upload — no file returns 400
 *   4.  POST /upload — manager succeeds, returns draft + lines
 *   5.  POST /upload — SHA256 is populated on invoice
 *   6.  GET / — list returns empty initially
 *   7.  GET / — list returns created invoices
 *   8.  GET /:invoiceId — returns invoice + lines
 *   9.  GET /:invoiceId — 404 for unknown id
 *   10. PATCH /:invoiceId — edits header fields
 *   11. PATCH /:invoiceId — 409 when invoice is voided
 *   12. PATCH /:invoiceId/lines/:lineId — recalculates totals
 *   13. POST /:invoiceId/confirm — 422 when supplier_id missing (Amendment 3)
 *   14. POST /:invoiceId/confirm — 422 when invoice_number missing (Amendment 3)
 *   15. POST /:invoiceId/confirm — 422 when invoice_date missing (Amendment 3)
 *   16. POST /:invoiceId/void — voids a pending_review invoice
 *   17. POST /:invoiceId/void — 409 when already confirmed
 *   18. Full happy path: upload → patch → confirm
 */

import request from "supertest";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";

const BASE = `/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-invoices`;

type ApiData<T> = { data: T };

const FAKE_PDF = Buffer.from("%PDF-1.4 test invoice content");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadInvoice(app: Awaited<ReturnType<typeof createTestApp>>, token: string) {
  return request(app)
    .post(`${BASE}/upload`)
    .set("Authorization", `Bearer ${token}`)
    .attach("file", FAKE_PDF, { filename: "invoice.pdf", contentType: "application/pdf" });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Supplier Invoice API", () => {
  // ── 1. Unauthenticated upload → 401 ────────────────────────────────────────
  it("returns 401 when not authenticated", async () => {
    const app = await createTestApp();
    const res = await request(app)
      .post(`${BASE}/upload`)
      .attach("file", FAKE_PDF, { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(401);
  });

  // ── 2. Clinical staff upload → 403 ─────────────────────────────────────────
  it("returns 403 when clinical_staff tries to upload", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await uploadInvoice(app, token);
    expect(res.status).toBe(403);
  });

  // ── 3. Upload without file → 400 ───────────────────────────────────────────
  it("returns 400 when no file is sent", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .post(`${BASE}/upload`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  // ── 4. Manager upload succeeds → 201 ───────────────────────────────────────
  it("returns 201 with extracted invoice and lines for manager upload", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await uploadInvoice(app, token);

    expect(res.status).toBe(201);
    const body = res.body as ApiData<{
      invoice: { id: string; status: string; ocrConfidence: number };
      lines: { id: string; ocrDescription: string }[];
    }>;
    expect(body.data.invoice.status).toBe("pending_review");
    expect(body.data.invoice.ocrConfidence).toBe(99);
    expect(body.data.lines).toHaveLength(1);
    expect(body.data.lines[0]?.ocrDescription).toContain("Stub item");
  });

  // ── 5. SHA256 populated on upload (Amendment 1B) ───────────────────────────
  it("populates fileSha256 on uploaded invoice", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await uploadInvoice(app, token);

    expect(res.status).toBe(201);
    const body = res.body as ApiData<{ invoice: { fileSha256: string } }>;
    expect(body.data.invoice.fileSha256).toHaveLength(64);
  });

  // ── 6. List — empty initially ──────────────────────────────────────────────
  it("returns empty list initially", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(BASE)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<unknown[]>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  // ── 7. List — returns invoices ─────────────────────────────────────────────
  it("returns uploaded invoices in the list", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await uploadInvoice(app, token);
    await uploadInvoice(app, token);

    const res = await request(app)
      .get(BASE)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<unknown[]>;
    expect(body.data).toHaveLength(2);
  });

  // ── 8. GET /:invoiceId — returns invoice + lines ───────────────────────────
  it("GET /:invoiceId returns invoice and lines", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    const res = await request(app)
      .get(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      invoice: { id: string };
      lines: unknown[];
    }>;
    expect(body.data.invoice.id).toBe(invoiceId);
    expect(body.data.lines).toHaveLength(1);
  });

  // ── 9. GET /:invoiceId — 404 unknown ──────────────────────────────────────
  it("returns 404 for unknown invoiceId", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`${BASE}/00000000-0000-0000-0000-000000000099`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  // ── 10. PATCH /:invoiceId — edits header ──────────────────────────────────
  it("PATCH updates supplier_id, invoice_number, and invoice_date", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    // First create a supplier to reference
    const supplierRes = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Acme Dental Supplies" });
    const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

    const patchRes = await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId,
        invoiceNumber: "ACME-2026-001",
        invoiceDate: "2026-06-01",
        notes: "Reviewed",
      });

    expect(patchRes.status).toBe(200);
    const body = patchRes.body as ApiData<{
      invoice: { supplierId: string; invoiceNumber: string; notes: string };
    }>;
    expect(body.data.invoice.supplierId).toBe(supplierId);
    expect(body.data.invoice.invoiceNumber).toBe("ACME-2026-001");
    expect(body.data.invoice.notes).toBe("Reviewed");
  });

  // ── 11. PATCH — 409 on voided invoice ─────────────────────────────────────
  it("PATCH returns 409 when invoice is voided", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    await request(app)
      .post(`${BASE}/${invoiceId}/void`)
      .set("Authorization", `Bearer ${token}`);

    const patchRes = await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "too late" });

    expect(patchRes.status).toBe(409);
  });

  // ── 12. PATCH /:invoiceId/lines/:lineId — recalculates totals ─────────────
  it("PATCH line recalculates subtotal, tax, and total", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const { invoice, lines } = (uploadRes.body as ApiData<{
      invoice: { id: string };
      lines: { id: string }[];
    }>).data;

    const lineRes = await request(app)
      .patch(`${BASE}/${invoice.id}/lines/${lines[0]?.id ?? ""}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 4, unitPriceCents: 3_000, taxRateBasisPoints: 1_000 });

    expect(lineRes.status).toBe(200);
    const lineBody = lineRes.body as ApiData<{
      subtotalCents: number;
      taxCents: number;
      totalCents: number;
    }>;
    // subtotal = 4 × 3000 = 12000; tax = 1200; total = 13200
    expect(lineBody.data.subtotalCents).toBe(12_000);
    expect(lineBody.data.taxCents).toBe(1_200);
    expect(lineBody.data.totalCents).toBe(13_200);
  });

  // ── 13. POST /confirm — 422 missing supplier_id (Amendment 3) ─────────────
  it("confirm returns 422 when supplier_id is missing", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    const res = await request(app)
      .post(`${BASE}/${invoiceId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // ── 14. POST /confirm — 422 missing invoice_number (Amendment 3) ──────────
  it("confirm returns 422 when invoice_number is null after PATCH", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    const supplierRes = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Test Supplier" });
    const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

    // Set supplier_id but explicitly null out invoice_number
    await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierId, invoiceNumber: null, invoiceDate: "2026-06-01" });

    const res = await request(app)
      .post(`${BASE}/${invoiceId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  // ── 15. POST /confirm — 422 missing invoice_date (Amendment 3) ────────────
  it("confirm returns 422 when invoice_date is null", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    const supplierRes = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Test Supplier" });
    const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

    await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierId, invoiceNumber: "INV-001", invoiceDate: null });

    const res = await request(app)
      .post(`${BASE}/${invoiceId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  // ── 16. POST /void — voids a pending_review invoice ───────────────────────
  it("void transitions invoice to voided status", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    const res = await request(app)
      .post(`${BASE}/${invoiceId}/void`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<{ status: string }>;
    expect(body.data.status).toBe("voided");
  });

  // ── 17. POST /void — 409 when confirmed ───────────────────────────────────
  it("void returns 409 when invoice is already confirmed", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const uploadRes = await uploadInvoice(app, token);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    // Create supplier and set required fields
    const supplierRes = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Confirm Test Supplier" });
    const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

    await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierId, invoiceNumber: "INV-CONFIRM", invoiceDate: "2026-06-01" });

    await request(app)
      .post(`${BASE}/${invoiceId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    const voidRes = await request(app)
      .post(`${BASE}/${invoiceId}/void`)
      .set("Authorization", `Bearer ${token}`);

    expect(voidRes.status).toBe(409);
  });

  // ── 18. Full happy path: upload → patch → confirm ─────────────────────────
  it("completes the full upload → review → confirm workflow", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Step 1: Upload
    const uploadRes = await uploadInvoice(app, token);
    expect(uploadRes.status).toBe(201);
    const invoiceId = (uploadRes.body as ApiData<{ invoice: { id: string } }>).data.invoice.id;

    // Step 2: Create supplier and patch header
    const supplierRes = await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierName: "Happy Path Supplier" });
    expect(supplierRes.status).toBe(201);
    const supplierId = (supplierRes.body as ApiData<{ id: string }>).data.id;

    const patchRes = await request(app)
      .patch(`${BASE}/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId,
        invoiceNumber: "HP-2026-001",
        invoiceDate: "2026-06-15",
        notes: "Reviewed and verified",
      });
    expect(patchRes.status).toBe(200);

    // Step 3: Confirm
    const confirmRes = await request(app)
      .post(`${BASE}/${invoiceId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(confirmRes.status).toBe(200);
    const confirmBody = confirmRes.body as ApiData<{
      invoice: { status: string; confirmedAt: string };
      priceUpdates: number;
    }>;
    expect(confirmBody.data.invoice.status).toBe("confirmed");
    expect(confirmBody.data.invoice.confirmedAt).toBeTruthy();
    expect(typeof confirmBody.data.priceUpdates).toBe("number");
  });
});
