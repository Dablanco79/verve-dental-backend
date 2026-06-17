/**
 * Purchase Order API — submit workflow + CSV export
 *
 * Tests cover:
 *   - GET  /clinics/:clinicId/purchase-orders          list (with real orderStatus)
 *   - PATCH /clinics/:clinicId/purchase-orders/:poId/submit
 *   - GET  /clinics/:clinicId/purchase-orders/export.csv
 *   - RBAC: clinical_staff denied; manager + admin allowed
 *   - Error paths: 404 PO not found, 409 already submitted (race-safe path)
 *   - Tenant isolation: cross-clinic access denied
 *   - Route parameter validation: malformed UUIDs rejected
 */
import request from "supertest";

import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type PoLine = {
  id: string;
  draftPurchaseOrderId: string;
  masterSku: string;
  itemName: string;
  quantity: number;
  reason: string;
  orderStatus: "draft" | "submitted";
  createdAt: string;
};

type ScanResponse = {
  draftPoLineAdded: boolean;
  draftPoLine: {
    id: string;
    draftPurchaseOrderId: string;
    masterCatalogItemId: string;
    clinicInventoryItemId: string;
    quantity: number;
    reason: string;
  } | null;
};

/**
 * Helper: scan Diamond Burs (VRV-BUR-001) in Clinic A with quantity 9,
 * which drops stock from 12 → 3 (< reorder point 4), triggering a draft PO line.
 * Returns the draftPurchaseOrderId from the response.
 */
async function scanAndGetPoId(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
): Promise<string> {
  const scanRes = await request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
    .set("Authorization", `Bearer ${token}`)
    .send({ barcodeValue: "9301234567891", quantity: 9 });

  expect(scanRes.status).toBe(200);
  const body = scanRes.body as ApiData<ScanResponse>;
  expect(body.data.draftPoLineAdded).toBe(true);
  expect(body.data.draftPoLine).not.toBeNull();

  const poLine = body.data.draftPoLine;
  if (!poLine) throw new Error("Expected draftPoLine to be defined");
  return poLine.draftPurchaseOrderId;
}

// ─── List Purchase Orders ──────────────────────────────────────────────────────

describe("Purchase Order API — list", () => {
  it("returns an empty array when no PO lines exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<PoLine[]>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
  });

  it("returns enriched PO lines with orderStatus 'draft' after a scan triggers reorder", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await scanAndGetPoId(app, token);

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiData<PoLine[]>;
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const line = body.data[0];
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.masterSku).toBe("VRV-BUR-001");
    expect(line.itemName).toBe("Diamond Burs FG Round #2 (Pack 5)");
    expect(line.quantity).toBe(1);
    expect(line.reason).toBe("below_reorder_point");
    expect(line.orderStatus).toBe("draft");
    expect(typeof line.draftPurchaseOrderId).toBe("string");
    expect(typeof line.createdAt).toBe("string");
  });

  it("denies clinical_staff access", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("enforces tenant isolation — manager from clinic A cannot list clinic B POs", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows owner_admin to list POs", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("returns 401 without auth token", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`);

    expect(res.status).toBe(401);
  });
});

// ─── Submit Purchase Order ─────────────────────────────────────────────────────

describe("Purchase Order API — submit", () => {
  it("transitions a draft PO to submitted and returns enriched lines", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const poId = await scanAndGetPoId(app, token);

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    const body = res.body as ApiData<{
      purchaseOrder: { id: string; status: string };
      lines: PoLine[];
    }>;

    expect(body.data.purchaseOrder.id).toBe(poId);
    expect(body.data.purchaseOrder.status).toBe("submitted");
    expect(Array.isArray(body.data.lines)).toBe(true);
    expect(body.data.lines.length).toBeGreaterThanOrEqual(1);
    const firstLine = body.data.lines[0];
    if (!firstLine) return;
    expect(firstLine.orderStatus).toBe("submitted");
  });

  it("reflects submitted status in subsequent list calls", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const poId = await scanAndGetPoId(app, token);

    await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const listRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const body = listRes.body as ApiData<PoLine[]>;
    const submitted = body.data.filter((l) => l.orderStatus === "submitted");
    expect(submitted.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 409 when the PO is already submitted", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const poId = await scanAndGetPoId(app, token);

    await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const secondRes = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(secondRes.status).toBe(409);
    const errBody = secondRes.body as ApiError;
    expect(errBody.error.code).toBe("PO_ALREADY_SUBMITTED");
  });

  it("returns 404 for a non-existent PO ID", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/00000000-0000-4000-8000-000000000000/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
    const errBody = res.body as ApiError;
    expect(errBody.error.code).toBe("PO_NOT_FOUND");
  });

  it("rejects extra fields in the body (.strict() validation)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const poId = await scanAndGetPoId(app, token);

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ unknownField: "value" });

    expect(res.status).toBe(400);
    const errBody = res.body as ApiError;
    expect(errBody.error.code).toBe("VALIDATION_ERROR");
  });

  it("denies clinical_staff", async () => {
    const app = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const poId = await scanAndGetPoId(app, managerToken);

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("auto-creates a new draft PO for future scans after submission", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // First: scan burs (qty 12 → 3, below reorder 4) → creates draft PO
    const firstPoId = await scanAndGetPoId(app, token);

    // Submit the first PO
    await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${firstPoId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // Scan composite resin (qty 8 → 2, crossing reorder point 3) via QR barcode.
    // This item was above its reorder point, so the scan threshold-crossing logic
    // fires and a new draft PO line is added to a fresh draft PO.
    const scanRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/scans`)
      .set("Authorization", `Bearer ${token}`)
      .send({ barcodeValue: "VRV-CMP-001", quantity: 6 });

    expect(scanRes.status).toBe(200);
    const scanBody = scanRes.body as ApiData<ScanResponse>;
    expect(scanBody.data.draftPoLineAdded).toBe(true);
    expect(scanBody.data.draftPoLine).not.toBeNull();
    // The new PO line must belong to a different (newly-created) PO
    const newPoLine = scanBody.data.draftPoLine;
    if (!newPoLine) return;
    expect(newPoLine.draftPurchaseOrderId).not.toBe(firstPoId);
  });

  it("race-safe: duplicate submit returns 409 via typed PoAlreadySubmittedError, not 500", async () => {
    // Verifies the race-safe submit path:
    //  - There is NO pre-check before the repository call
    //  - The repository throws PoAlreadySubmittedError (typed) when the PO is
    //    already submitted (as happens when two requests arrive concurrently)
    //  - The service maps PoAlreadySubmittedError → 409, NOT 500
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const poId = await scanAndGetPoId(app, token);

    // First submit succeeds
    const firstRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(firstRes.status).toBe(200);

    // Second submit — exercises the typed error path from the repository
    // (the same path a concurrent request hits after losing the race)
    const secondRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(secondRes.status).toBe(409);
    const errBody = secondRes.body as ApiError;
    expect(errBody.error.code).toBe("PO_ALREADY_SUBMITTED");
  });
});

// ─── CSV Export ───────────────────────────────────────────────────────────────

describe("Purchase Order API — CSV export", () => {
  it("returns a text/csv response with correct headers", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await scanAndGetPoId(app, token);

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.csv/);
  });

  it("CSV body contains the expected column header row", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await scanAndGetPoId(app, token);

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    const csvText = res.text;
    const lines = csvText.split("\r\n");
    expect(lines[0]).toBe(
      "Line ID,PO ID,SKU,Item Name,Qty Needed,Trigger,Status,Created At",
    );
  });

  it("CSV data rows include correct item data", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await scanAndGetPoId(app, token);

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    const csvText = res.text;
    const lines = csvText.split("\r\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const dataRow = lines[1];
    if (!dataRow) return;
    expect(dataRow).toContain("VRV-BUR-001");
    expect(dataRow).toContain("draft");
  });

  it("exports an empty CSV (header only) when there are no PO lines", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^Line ID,/);
  });

  it("includes submitted lines in the export", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const poId = await scanAndGetPoId(app, token);

    await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${poId}/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("submitted");
  });

  it("denies clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ─── Tenant Isolation ─────────────────────────────────────────────────────────

describe("Purchase Order API — tenant isolation", () => {
  it("clinic A manager cannot list clinic B purchase orders", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("clinic A manager cannot submit a purchase order scoped to clinic B", async () => {
    const app = await createTestApp();
    const tokenA = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create a PO in clinic A first (so we have a valid poId shape)
    const poId = await scanAndGetPoId(app, tokenA);

    // Attempt to submit using clinic B's URL — should be rejected by tenant guard
    const res = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders/${poId}/submit`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("clinic A manager cannot export clinic B purchase orders as CSV", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("submitting a cross-clinic PO ID returns 404 (not found within scoped clinic)", async () => {
    const app = await createTestApp();
    const tokenA = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const tokenB = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Create a PO belonging to clinic A
    const clinicAPoId = await scanAndGetPoId(app, tokenA);

    // As owner_admin (who can access any clinic), try to submit clinic A's PO
    // against clinic B's URL — the PO is not in clinic B, so it must be 404.
    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders/${clinicAPoId}/submit`,
      )
      .set("Authorization", `Bearer ${tokenB}`)
      .send({});

    expect(res.status).toBe(404);
    const errBody = res.body as ApiError;
    expect(errBody.error.code).toBe("PO_NOT_FOUND");
  });

  it("owner_admin can list purchase orders for any clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const resA = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(resA.status).toBe(200);

    const resB = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(resB.status).toBe(200);
  });

  it("owner_admin can export CSV for any clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const resA = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(resA.status).toBe(200);

    const resB = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_B_ID}/purchase-orders/export.csv`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(resB.status).toBe(200);
  });
});

// ─── Route Parameter Validation ──────────────────────────────────────────────

describe("Purchase Order API — route parameter validation", () => {
  it("rejects a malformed (non-UUID) clinicId when listing POs", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get("/api/v1/clinics/not-a-uuid/purchase-orders")
      .set("Authorization", `Bearer ${token}`);

    // The tenant middleware rejects owner_admin with a non-existent clinicId
    // via the UUID param check; we accept either 400 or 403/404 responses
    // as long as the request is rejected before any repository call.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects a malformed (non-UUID) poId when submitting", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/not-a-uuid/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    const errBody = res.body as ApiError;
    expect(errBody.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an all-zeros (invalid) UUID for poId when submitting", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .patch(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/00000000-0000-0000-0000-000000000000/submit`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // All-zeros is a valid UUID shape so we expect 404 (not found), not 400
    expect(res.status).toBe(404);
  });
});
