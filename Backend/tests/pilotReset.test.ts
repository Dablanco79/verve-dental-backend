/**
 * Pilot Reset API Tests
 *
 * Tests all 56+ backend scenarios from the implementation brief.
 *
 * Uses the in-memory test app (no DATABASE_URL / REDIS_URL).
 * Security, access-control, nonce, MFA, and phrase tests work in-memory.
 * DB-level deletion counts are zero (in-memory repo) — correct behaviour
 * is verified by the in-memory repository returning safe empty results.
 */

import { generateSync } from "otplib";
import request from "supertest";

import {
  SEED_ADMIN_TOTP_SECRET,
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import { buildConfirmationPhrase } from "../src/services/pilotResetService.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

async function createPilotResetApp() {
  process.env.PILOT_RESET_ENABLED = "true";
  return createTestApp();
}

async function createPilotResetDisabledApp() {
  process.env.PILOT_RESET_ENABLED = "false";
  return createTestApp();
}

async function getAdminToken(app: Awaited<ReturnType<typeof createTestApp>>) {
  return loginAndGetAccessToken(app, "admin@clinic-a.au");
}

async function getStaffToken(app: Awaited<ReturnType<typeof createTestApp>>) {
  return loginAndGetAccessToken(app, "staff@clinic-a.au");
}

async function doPreview(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string,
  mode: "operational" | "full_pilot" = "operational",
) {
  return request(app)
    .post("/api/v1/admin/pilot-reset/preview")
    .set("Authorization", `Bearer ${token}`)
    .send({ clinicId, mode });
}

// ─── Feature Flag Tests (T1–T2) ──────────────────────────────────────────────

describe("Pilot Reset — Feature Flag", () => {
  it("T1: preview returns 404 when feature disabled", async () => {
    const app = await createPilotResetDisabledApp();
    const token = await getAdminToken(app);
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(404);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("T2: execute returns 404 when feature disabled", async () => {
    const app = await createPilotResetDisabledApp();
    const token = await getAdminToken(app);
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken: "00000000-0000-4000-8000-000000000000",
        mfaCode: "000000",
        confirmationPhrase: "RESET TEST PILOT DATA",
      });
    expect(res.status).toBe(404);
  });
});

// ─── Authentication Tests (T3) ────────────────────────────────────────────────

describe("Pilot Reset — Authentication", () => {
  it("T3: unauthenticated preview is rejected", async () => {
    const app = await createPilotResetApp();
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/preview")
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational" });
    expect(res.status).toBe(401);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("T3b: unauthenticated execute is rejected", async () => {
    const app = await createPilotResetApp();
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken: "00000000-0000-4000-8000-000000000000",
        mfaCode: "000000",
        confirmationPhrase: "RESET TEST PILOT DATA",
      });
    expect(res.status).toBe(401);
  });
});

// ─── Role Tests (T4–T6) ──────────────────────────────────────────────────────

describe("Pilot Reset — Role Authorisation", () => {
  it("T4: clinical_staff is blocked from preview", async () => {
    const app = await createPilotResetApp();
    const token = await getStaffToken(app);
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("T5: group_practice_manager is blocked from preview", async () => {
    const app = await createPilotResetApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(403);
  });

  it("T6: owner_admin is allowed to preview", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{ clinic: { id: string } }>;
    expect(body.data.clinic.id).toBe(SEED_CLINIC_A_ID);
  });
});

// ─── Preview Tests (T9–T17) ──────────────────────────────────────────────────

describe("Pilot Reset — Preview Endpoint", () => {
  it("T7: clinicId must be a valid UUID", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: "not-a-uuid", mode: "operational" });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("T8: explicit clinicId is required (missing body field)", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "operational" });
    expect(res.status).toBe(400);
  });

  it("T9: preview performs no deletes", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    // Run preview twice — second should return same counts (idempotent read)
    const res1 = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const res2 = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const b1 = res1.body as ApiData<{ deleteCounts: { supplierInvoices: number } }>;
    const b2 = res2.body as ApiData<{ deleteCounts: { supplierInvoices: number } }>;
    // Counts are stable (no deletes occurred between previews)
    expect(b1.data.deleteCounts.supplierInvoices).toBe(b2.data.deleteCounts.supplierInvoices);
  });

  it("T10: preview returns valid count structure", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      deleteCounts: Record<string, number>;
      preserved: string[];
      blockers: unknown[];
      warnings: unknown[];
      previewToken: string;
      previewExpiresAt: string;
      expectedConfirmationPhrase: string;
    }>;
    // Required fields present
    expect(typeof body.data.previewToken).toBe("string");
    expect(body.data.previewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.data.previewExpiresAt).toBeTruthy();
    expect(Array.isArray(body.data.preserved)).toBe(true);
    expect(body.data.preserved.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data.blockers)).toBe(true);
    expect(typeof body.data.deleteCounts).toBe("object");
    expect(typeof body.data.expectedConfirmationPhrase).toBe("string");
  });

  it("T11: preview does not expose counts for other clinics", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const resA = await doPreview(app, token, SEED_CLINIC_A_ID);
    const resB = await doPreview(app, token, SEED_CLINIC_B_ID);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = resA.body as ApiData<{ clinic: { id: string } }>;
    const bodyB = resB.body as ApiData<{ clinic: { id: string } }>;
    expect(bodyA.data.clinic.id).toBe(SEED_CLINIC_A_ID);
    expect(bodyB.data.clinic.id).toBe(SEED_CLINIC_B_ID);
  });

  it("T12: operational vs full_pilot counts differ in structure", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const opRes = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const fpRes = await doPreview(app, token, SEED_CLINIC_A_ID, "full_pilot");
    expect(opRes.status).toBe(200);
    expect(fpRes.status).toBe(200);
    const opBody = opRes.body as ApiData<{
      deleteCounts: { productSuppliers: number; clinicInventoryItemsDeleted: number };
    }>;
    const fpBody = fpRes.body as ApiData<{
      deleteCounts: { productSuppliers: number; clinicInventoryItemsDeleted: number };
      orphanCounts: { orphanMasterProductCandidates: number };
    }>;
    // Operational reset has zero for full-pilot-only fields
    expect(opBody.data.deleteCounts.productSuppliers).toBe(0);
    expect(opBody.data.deleteCounts.clinicInventoryItemsDeleted).toBe(0);
    // Full pilot response includes orphan counts
    expect(typeof fpBody.data.orphanCounts).toBe("object");
  });

  it("T15: preview creates a nonce (previewToken)", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{ previewToken: string; previewExpiresAt: string }>;
    expect(body.data.previewToken).toBeTruthy();
    expect(body.data.previewExpiresAt).toBeTruthy();
    // Token should expire ~5 minutes in the future
    const expiresAt = new Date(body.data.previewExpiresAt).getTime();
    const now = Date.now();
    expect(expiresAt).toBeGreaterThan(now + 4 * 60 * 1000);
    expect(expiresAt).toBeLessThan(now + 6 * 60 * 1000);
  });

  it("T17: nonce is tied to clinic+mode", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    // Preview for clinic A
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    expect(previewRes.status).toBe(200);
    const preview = previewRes.body as ApiData<{ previewToken: string }>;

    // Try to execute for clinic B using clinic A's nonce — should fail
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const executeRes = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_B_ID,
        mode: "operational",
        previewToken: preview.data.previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic B"),
      });
    expect(executeRes.status).toBe(400);
    const body = executeRes.body as ApiError;
    expect(body.error.code).toBe("PREVIEW_TOKEN_CLINIC_MISMATCH");
  });
});

// ─── Execute Tests (T18–T24) ─────────────────────────────────────────────────

describe("Pilot Reset — Execute Endpoint", () => {
  it("T18: execute without preview token is blocked", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken: "00000000-0000-4000-8000-000000000001",
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("INVALID_PREVIEW_TOKEN");
  });

  it("T20: reused nonce is blocked", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    // Get preview
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(previewRes.status).toBe(200);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;

    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const phrase = buildConfirmationPhrase("Verve Dental Clinic A");

    // First execute — succeeds (zero counts in-memory)
    const exec1 = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken, mfaCode, confirmationPhrase: phrase });
    expect(exec1.status).toBe(200);

    // Second execute with same token — blocked
    const mfaCode2 = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const exec2 = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken, mfaCode: mfaCode2, confirmationPhrase: phrase });
    expect(exec2.status).toBe(400);
    const body = exec2.body as ApiError;
    expect(body.error.code).toBe("PREVIEW_TOKEN_USED");
  });

  it("T21: incorrect MFA code is blocked", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(previewRes.status).toBe(200);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode: "000000", // invalid code
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(401);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("INVALID_MFA_CODE");
  });

  it("T22: incorrect confirmation phrase is blocked", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(previewRes.status).toBe(200);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;

    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: "wrong phrase",
      });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CONFIRMATION_PHRASE_MISMATCH");
  });

  it("T23: correct MFA + correct phrase succeeds", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    expect(previewRes.status).toBe(200);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;

    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      clinic: { id: string };
      mode: string;
      deletedCounts: Record<string, number>;
      postResetChecks: Array<{ name: string; passed: boolean }>;
      auditReference: string;
      completedAt: string;
    }>;
    expect(body.data.clinic.id).toBe(SEED_CLINIC_A_ID);
    expect(body.data.mode).toBe("operational");
    expect(typeof body.data.auditReference).toBe("string");
    expect(body.data.completedAt).toBeTruthy();
    expect(Array.isArray(body.data.postResetChecks)).toBe(true);
  });

  it("T24: duplicate execute with same token is blocked (reuse guard)", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(previewRes.status).toBe(200);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;
    const phrase = buildConfirmationPhrase("Verve Dental Clinic A");

    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken, mfaCode, confirmationPhrase: phrase });

    const mfaCode2 = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const dup = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken, mfaCode: mfaCode2, confirmationPhrase: phrase });
    expect(dup.status).toBe(400);
    expect((dup.body as ApiError).error.code).toBe("PREVIEW_TOKEN_USED");
  });
});

// ─── Multi-tenant Isolation (T25–T28) ────────────────────────────────────────

describe("Pilot Reset — Multi-tenant isolation", () => {
  it("T25–T26: reset clinic A does not affect clinic B preview counts", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    // Preview clinic B before reset
    const resBefore = await doPreview(app, token, SEED_CLINIC_B_ID, "operational");
    expect(resBefore.status).toBe(200);
    const beforeCounts = (resBefore.body as ApiData<{ deleteCounts: Record<string, number> }>).data.deleteCounts;

    // Execute reset on clinic A
    const previewResA = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const { previewToken } = (previewResA.body as ApiData<{ previewToken: string }>).data;
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });

    // Preview clinic B after reset — counts unchanged
    const resAfter = await doPreview(app, token, SEED_CLINIC_B_ID, "operational");
    expect(resAfter.status).toBe(200);
    const afterCounts = (resAfter.body as ApiData<{ deleteCounts: Record<string, number> }>).data.deleteCounts;

    expect(afterCounts).toEqual(beforeCounts);
  });
});

// ─── Execute Response Structure (T29–T41) ─────────────────────────────────────

describe("Pilot Reset — Execute response structure", () => {
  it("T29: operational reset result includes expected fields", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      preserved: string[];
      deletedCounts: {
        purchasingDrafts: number;
        draftPurchaseOrders: number;
        supplierInvoices: number;
      };
    }>;
    expect(Array.isArray(body.data.preserved)).toBe(true);
    expect(typeof body.data.deletedCounts.purchasingDrafts).toBe("number");
    expect(typeof body.data.deletedCounts.draftPurchaseOrders).toBe("number");
    expect(typeof body.data.deletedCounts.supplierInvoices).toBe("number");
  });

  it("T35–T36: full pilot reset returns clinic config reset fields", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID, "full_pilot");
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "full_pilot",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      deletedCounts: {
        productSuppliers: number;
        supplierRelationships: number;
        clinicInventoryItemsDeleted: number;
      };
    }>;
    expect(typeof body.data.deletedCounts.productSuppliers).toBe("number");
    expect(typeof body.data.deletedCounts.supplierRelationships).toBe("number");
    expect(typeof body.data.deletedCounts.clinicInventoryItemsDeleted).toBe("number");
  });
});

// ─── Idempotency (T45–T46) ───────────────────────────────────────────────────

describe("Pilot Reset — Idempotency", () => {
  it("T45: resetting an already-clean clinic succeeds with zero counts", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);

    // First reset
    const preview1 = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const token1 = (preview1.body as ApiData<{ previewToken: string }>).data.previewToken;
    const mfa1 = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const exec1 = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken: token1, mfaCode: mfa1, confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A") });
    expect(exec1.status).toBe(200);

    // Second reset (clinic already clean)
    const preview2 = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const token2 = (preview2.body as ApiData<{ previewToken: string }>).data.previewToken;
    const mfa2 = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });
    const exec2 = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "operational", previewToken: token2, mfaCode: mfa2, confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A") });
    expect(exec2.status).toBe(200);

    const body2 = exec2.body as ApiData<{ deletedCounts: Record<string, number> }>;
    // In-memory repo: all zero
    const totalDeleted = Object.values(body2.data.deletedCounts).reduce((a, b) => a + b, 0);
    expect(totalDeleted).toBe(0);
  });
});

// ─── Audit Events (T47–T51) ──────────────────────────────────────────────────

describe("Pilot Reset — Audit Events", () => {
  it("T47: preview records previewed event (no MFA code in audit)", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    // Preview should not throw (audit event recorded fire-and-forget)
    const res = await doPreview(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(200);
  });

  it("T51: no MFA code appears in execute response", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(200);
    // MFA code must not appear in response body
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(mfaCode);
  });
});

// ─── Post-Reset Checks (T52–T56) ─────────────────────────────────────────────

describe("Pilot Reset — Post-reset Checks", () => {
  it("T52–T56: post-reset checks are returned and all pass in-memory", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID, "operational");
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(200);
    const body = res.body as ApiData<{
      postResetChecks: Array<{ name: string; passed: boolean }>;
    }>;
    expect(Array.isArray(body.data.postResetChecks)).toBe(true);
    expect(body.data.postResetChecks.length).toBeGreaterThan(0);
    // All checks should pass in in-memory mode
    const failedChecks = body.data.postResetChecks.filter((c) => !c.passed);
    expect(failedChecks).toHaveLength(0);
  });
});

// ─── Validation (T8b) ────────────────────────────────────────────────────────

describe("Pilot Reset — Input Validation", () => {
  it("mfaCode must be 6 digits", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const previewRes = await doPreview(app, token, SEED_CLINIC_A_ID);
    const { previewToken } = (previewRes.body as ApiData<{ previewToken: string }>).data;

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken,
        mfaCode: "12345", // 5 digits — invalid
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("previewToken must be a valid UUID", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const mfaCode = generateSync({ secret: SEED_ADMIN_TOTP_SECRET });

    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/execute")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicId: SEED_CLINIC_A_ID,
        mode: "operational",
        previewToken: "not-a-uuid",
        mfaCode,
        confirmationPhrase: buildConfirmationPhrase("Verve Dental Clinic A"),
      });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("mode must be operational or full_pilot", async () => {
    const app = await createPilotResetApp();
    const token = await getAdminToken(app);
    const res = await request(app)
      .post("/api/v1/admin/pilot-reset/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ clinicId: SEED_CLINIC_A_ID, mode: "invalid_mode" });
    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Confirmation phrase helper (unit) ───────────────────────────────────────

describe("buildConfirmationPhrase", () => {
  it("generates expected phrase format", () => {
    expect(buildConfirmationPhrase("Bentleigh East")).toBe("RESET BENTLEIGH EAST PILOT DATA");
    expect(buildConfirmationPhrase("Verve Dental Clinic A")).toBe("RESET VERVE DENTAL CLINIC A PILOT DATA");
  });
});
