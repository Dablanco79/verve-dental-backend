/**
 * Permission API — RBAC v2 foundation
 *
 * Covers:
 *   POST   /api/v1/clinics/:clinicId/users/:userId/permissions
 *     - owner_admin can grant a permission (201 + grant object)
 *     - granting the same permission twice is idempotent (200/201)
 *     - invalid permission string returns 400 INVALID_PERMISSION
 *     - missing permission field returns 400 VALIDATION_ERROR
 *     - group_practice_manager is rejected (403)
 *     - clinical_staff is rejected (403)
 *     - unauthenticated request is rejected (401)
 *
 *   GET    /api/v1/clinics/:clinicId/users/:userId/permissions
 *     - owner_admin can list grants for a user
 *     - returns empty array when no explicit grants exist
 *     - group_practice_manager is rejected (403)
 *     - unauthenticated request is rejected (401)
 *
 *   DELETE /api/v1/clinics/:clinicId/users/:userId/permissions/:permission
 *     - owner_admin can revoke an active grant (204)
 *     - revoking a non-existent grant returns 404
 *     - invalid permission in URL returns 400
 *     - group_practice_manager is rejected (403)
 *     - unauthenticated request is rejected (401)
 *
 *   Token permissions payload
 *     - access token includes role-based default permissions
 *     - access token includes explicitly granted permissions unioned with defaults
 *
 * All tests run against the in-memory repository — no database required.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { PERMISSIONS } from "../src/types/permissions.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string; message: string } };
type GrantData = {
  id: string;
  clinicId: string;
  userId: string;
  permission: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
};
type ApiData<T> = { data: T };

const TARGET_USER_ID = SEED_USER_IDS.clinicAStaff;
const PERM_URL = (clinicId: string, userId: string) =>
  `/api/v1/clinics/${clinicId}/users/${userId}/permissions`;
const PERM_ITEM_URL = (clinicId: string, userId: string, perm: string) =>
  `/api/v1/clinics/${clinicId}/users/${userId}/permissions/${encodeURIComponent(perm)}`;

// ─── POST /permissions — grant ────────────────────────────────────────────────

describe("POST /api/v1/clinics/:clinicId/users/:userId/permissions", () => {
  describe("RBAC — role access", () => {
    it("returns 201 when owner_admin grants a permission", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: PERMISSIONS.BILLING_READ });

      expect(res.status).toBe(201);
      const body = res.body as ApiData<GrantData>;
      expect(body.data.permission).toBe(PERMISSIONS.BILLING_READ);
      expect(body.data.userId).toBe(TARGET_USER_ID);
      expect(body.data.clinicId).toBe(SEED_CLINIC_A_ID);
      expect(body.data.revokedAt).toBeNull();
    });

    it("returns 403 when group_practice_manager attempts to grant", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: PERMISSIONS.BILLING_READ });

      expect(res.status).toBe(403);
      expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when clinical_staff attempts to grant", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: PERMISSIONS.BILLING_READ });

      expect(res.status).toBe(403);
      expect((res.body as ApiError).error.code).toBe("FORBIDDEN");
    });

    it("returns 401 for unauthenticated request", async () => {
      const app = await createTestApp();

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .send({ permission: PERMISSIONS.BILLING_READ });

      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns 400 INVALID_PERMISSION for an unknown permission string", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: "made_up:permission" });

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("INVALID_PERMISSION");
    });

    it("returns 400 VALIDATION_ERROR when permission field is missing", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      const res = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 201 idempotently on duplicate grant (same permission granted twice)", async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

      await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: PERMISSIONS.ANALYTICS_READ });

      const second = await request(app)
        .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
        .set("Authorization", `Bearer ${token}`)
        .send({ permission: PERMISSIONS.ANALYTICS_READ });

      // Idempotent — returns the existing grant, still 2xx
      expect(second.status).toBe(201);
      const body = second.body as ApiData<GrantData>;
      expect(body.data.revokedAt).toBeNull();
    });
  });
});

// ─── GET /permissions — list ──────────────────────────────────────────────────

describe("GET /api/v1/clinics/:clinicId/users/:userId/permissions", () => {
  it("returns empty array when user has no explicit grants", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .get(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ApiData<GrantData[]>).data).toEqual([]);
  });

  it("returns active grants after granting permissions", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app)
      .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ permission: PERMISSIONS.USERS_READ });

    const res = await request(app)
      .get(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const grants = (res.body as ApiData<GrantData[]>).data;
    expect(grants.length).toBe(1);
    expect(grants[0]?.permission).toBe(PERMISSIONS.USERS_READ);
    expect(grants[0]?.revokedAt).toBeNull();
  });

  it("includes revoked grants in the list (full history)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Grant then revoke
    await request(app)
      .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ permission: PERMISSIONS.ROSTER_WRITE });

    await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, PERMISSIONS.ROSTER_WRITE))
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .get(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const grants = (res.body as ApiData<GrantData[]>).data;
    expect(grants.length).toBe(1);
    expect(grants[0]?.revokedAt).not.toBeNull();
  });

  it("returns 403 when group_practice_manager tries to list permissions", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 401 for unauthenticated request", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .get(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID));

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /permissions/:permission — revoke ─────────────────────────────────

describe("DELETE /api/v1/clinics/:clinicId/users/:userId/permissions/:permission", () => {
  it("returns 204 when owner_admin revokes an existing grant", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await request(app)
      .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ permission: PERMISSIONS.INVENTORY_WRITE });

    const res = await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, PERMISSIONS.INVENTORY_WRITE))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it("returns 404 when attempting to revoke a non-existent grant", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, PERMISSIONS.CLINIC_WRITE))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ApiError).error.code).toBe("PERMISSION_GRANT_NOT_FOUND");
  });

  it("returns 400 INVALID_PERMISSION for an unknown permission in URL", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, "bad:permission"))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("INVALID_PERMISSION");
  });

  it("returns 403 when group_practice_manager tries to revoke", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, PERMISSIONS.BILLING_READ))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 401 for unauthenticated request", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .delete(PERM_ITEM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID, PERMISSIONS.BILLING_READ));

    expect(res.status).toBe(401);
  });
});

// ─── Token permissions payload ────────────────────────────────────────────────

describe("Access token — permissions payload", () => {
  it("clinical_staff token includes default role permissions", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Decode the JWT (no verify — we just need the payload)
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64 ?? "", "base64url").toString(),
    ) as { permissions: string[] };

    expect(Array.isArray(payload.permissions)).toBe(true);
    // clinical_staff defaults: inventory:read, roster:read, timesheets:read
    expect(payload.permissions).toContain("inventory:read");
    expect(payload.permissions).toContain("roster:read");
    expect(payload.permissions).toContain("timesheets:read");
    // Should NOT contain owner-only permissions
    expect(payload.permissions).not.toContain("permissions:manage");
  });

  it("owner_admin token includes all permissions", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64 ?? "", "base64url").toString(),
    ) as { permissions: string[] };

    expect(payload.permissions).toContain("permissions:manage");
    expect(payload.permissions).toContain("billing:read");
    expect(payload.permissions).toContain("clinic:write");
  });

  it("newly granted permission appears in next access token", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Grant billing:read to clinical_staff (who doesn't have it by default)
    await request(app)
      .post(PERM_URL(SEED_CLINIC_A_ID, TARGET_USER_ID))
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permission: PERMISSIONS.BILLING_READ });

    // staff logs out and back in to get fresh token
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const [, payloadB64] = staffToken.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64 ?? "", "base64url").toString(),
    ) as { permissions: string[] };

    expect(payload.permissions).toContain(PERMISSIONS.BILLING_READ);
  });
});
