/**
 * Module Permissions — full security verification matrix
 *
 * Coverage (all scenarios from the Sep 2026 signoff checklist):
 *
 *   BILLING SECURITY GAP
 *     1. clinical_staff → 403 on GET /billing/invoices
 *     2. owner_admin → 200 on GET /billing/invoices
 *     3. group_practice_manager → 200 on GET /billing/invoices (managerOrAdmin)
 *
 *   PROCUREMENT GATE
 *     4. seed clinical_staff (no module:procurement) → 403 on POST /purchase-orders
 *     5. clinical_staff WITH module:procurement → passes procurement gate (not 403)
 *     6. clinical_staff WITH module:procurement → 403 on POST /:poId/cancel (role guard)
 *     7. clinical_staff WITH module:procurement → 403 on GET /export.csv (role guard)
 *
 *   RECEIVING GATE
 *     8. seed clinical_staff (no module:receiving) → 403 on POST /inventory/receive
 *     9. clinical_staff WITH module:receiving → passes receiving gate (not 403)
 *
 *   TIMESHEETS GATE
 *    10. clinical_staff with module:timesheets → 200 on GET /timesheets/me
 *    11. clinical_staff with module:timesheets → 403 on GET /timesheets (manager-only list)
 *
 *   ROSTER GATE
 *    12. clinical_staff with module:roster → 200 on GET /roster/me
 *    13. clinical_staff with module:roster → 403 on POST /roster (write roles only)
 *
 *   LEAVE GATE
 *    14. clinical_staff with module:leave → passes leave submission gate (not 403)
 *    15. clinical_staff with module:leave → 403 on POST /leave/:id/approve (manager only)
 *
 *   ANALYTICS GATE
 *    16. clinical_staff (no module:reports) → 403 on GET /analytics/dashboard
 *    17. group_practice_manager (has module:reports) → 200 on GET /analytics/dashboard
 *
 *   NEW USER INITIAL GRANTS
 *    18. newly created GPM → 8 module grants
 *    19. newly created clinical_staff → exactly 3 module grants
 *    20. new clinical_staff → 403 on GET /inventory (no module:inventory)
 *    21. after granting module:inventory to new staff → 200 on GET /inventory
 *
 *   GRANT REVOCATION
 *    22. revoking module:inventory + re-login → 403 on GET /inventory
 *
 *   OWNER/ADMIN FULL ACCESS
 *    23. owner_admin → 200 on every module-gated route family
 *
 * MFA notes:
 *   Tests that login as admin@clinic-b.au, admin@clinic-a.au, or
 *   manager@clinic-a.au go through the TOTP flow which can hold up to 2.2 s
 *   waiting for a safe TOTP window.  All such tests carry an explicit 30-second
 *   timeout.  Tests using only staff@clinic-a.au (no MFA) use the default.
 */

import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const UNIQUE_SUFFIX = Date.now().toString(36);
const FAKE_UUID = "00000000-0000-4000-8000-000000000001";

// Grant response shape returned by GET /:userId/permissions
type GrantRow = { permission: string; revokedAt: string | null };
type GrantsBody = { data: GrantRow[] };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function grantPermission(
  app: Awaited<ReturnType<typeof createTestApp>>,
  adminToken: string,
  userId: string,
  permission: string,
): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${userId}/permissions`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ permission });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`grant failed (${String(res.status)}): ${JSON.stringify(res.body)}`);
  }
}

async function revokePermission(
  app: Awaited<ReturnType<typeof createTestApp>>,
  adminToken: string,
  userId: string,
  permission: string,
): Promise<void> {
  const res = await request(app)
    .delete(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${userId}/permissions/${encodeURIComponent(permission)}`,
    )
    .set("Authorization", `Bearer ${adminToken}`);
  if (res.status !== 204) {
    throw new Error(`revoke failed (${String(res.status)}): ${JSON.stringify(res.body)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1-3 · Billing security gap
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — billing security gap fix", () => {
  it(
    "1. blocks clinical_staff from GET /billing/invoices (403)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    },
    30_000,
  );

  it(
    "2. allows owner_admin to access GET /billing/invoices (200)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-b.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    },
    30_000,
  );

  it(
    "3. GPM (managerOrAdmin) can access GET /billing/invoices (200)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/billing/invoices`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-7 · Procurement gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — procurement gate", () => {
  it(
    "4. seed clinical_staff (no module:procurement) → 403 on POST /purchase-orders",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
        .set("Authorization", `Bearer ${token}`)
        .send({ poReference: null, notes: null, supplierId: null });
      expect(res.status).toBe(403);
    },
    15_000,
  );

  it(
    "5. clinical_staff WITH module:procurement passes the procurement gate (not 403)",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      // Grant module:procurement to the seed staff user
      await grantPermission(app, adminToken, SEED_USER_IDS.clinicAStaff, "module:procurement");
      // Fresh login to get a token that includes the new grant
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ poReference: null, notes: null, supplierId: null });
      // The module gate passed — a 201 (created draft PO) proves access was granted.
      // A 4xx validation or business-logic error is also acceptable; anything
      // except 403 proves the permission gate was satisfied.
      expect(res.status).not.toBe(403);
    },
    30_000,
  );

  it(
    "6. clinical_staff WITH module:procurement → 403 on POST /:poId/cancel (role guard still applies)",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      await grantPermission(app, adminToken, SEED_USER_IDS.clinicAStaff, "module:procurement");
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${FAKE_UUID}/cancel`)
        .set("Authorization", `Bearer ${staffToken}`);
      // Cancel requires requireRoles("owner_admin","group_practice_manager")
      expect(res.status).toBe(403);
    },
    30_000,
  );

  it(
    "7. clinical_staff WITH module:procurement → 403 on GET /export.csv (role guard still applies)",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      await grantPermission(app, adminToken, SEED_USER_IDS.clinicAStaff, "module:procurement");
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/export.csv`)
        .set("Authorization", `Bearer ${staffToken}`);
      // Export requires requireRoles("owner_admin","group_practice_manager")
      expect(res.status).toBe(403);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8-9 · Receiving gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — receiving gate", () => {
  it(
    "8. seed clinical_staff (no module:receiving) → 403 on POST /inventory/receive",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/receive`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    },
    15_000,
  );

  it(
    "9. clinical_staff WITH module:receiving passes the receiving gate (not 403)",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      await grantPermission(app, adminToken, SEED_USER_IDS.clinicAStaff, "module:receiving");
      const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory/receive`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({});
      // module:receiving is the sole gate — any non-403 response proves access.
      expect(res.status).not.toBe(403);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 10-11 · Timesheets gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — timesheets gate", () => {
  // Seed staff has module:timesheets (from seedInMemoryModuleGrants).  These
  // tests do not need MFA so use the default timeout.
  it(
    "10. clinical_staff with module:timesheets → 200 on GET /timesheets/me",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/me`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    },
    15_000,
  );

  it(
    "11. clinical_staff with module:timesheets → 403 on GET /timesheets (manager-only list)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets`)
        .set("Authorization", `Bearer ${token}`);
      // Clinic-wide timesheet list requires PAYROLL_MANAGER_ROLES
      expect(res.status).toBe(403);
    },
    15_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 12-13 · Roster gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — roster gate", () => {
  it(
    "12. clinical_staff with module:roster → 200 on GET /roster/me (My Shifts)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/me`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    },
    15_000,
  );

  it(
    "13. clinical_staff with module:roster → 403 on POST /roster (write-role action)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      // POST /roster requires ROSTER_WRITE_ROLES (owner_admin, group_practice_manager)
      expect(res.status).toBe(403);
    },
    15_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 14-15 · Leave gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — leave gate", () => {
  it(
    "14. clinical_staff with module:leave → passes leave submission gate (not 403)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "annual",
          startDate: "2026-10-01",
          endDate: "2026-10-05",
          notes: "Test leave",
        });
      // POST /leave allows all roles (PAYROLL_ALL_ROLES) — staff with
      // module:leave passes both the module gate and the role gate.
      // A 4xx from body validation is fine; only 403 would indicate a gate failure.
      expect(res.status).not.toBe(403);
    },
    15_000,
  );

  it(
    "15. clinical_staff with module:leave → 403 on POST /leave/:id/approve (manager only)",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/leave/${FAKE_UUID}/approve`)
        .set("Authorization", `Bearer ${token}`);
      // Approve requires PAYROLL_MANAGER_ROLES
      expect(res.status).toBe(403);
    },
    15_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 16-17 · Analytics gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — analytics gate", () => {
  it(
    "16. clinical_staff (no module:reports) → 403 on GET /analytics/dashboard",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/analytics/dashboard`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    },
    15_000,
  );

  it(
    "17. GPM with module:reports → 200 on GET /analytics/dashboard",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/analytics/dashboard`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 18-21 · New user initial grants
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — new user initial grants", () => {
  it(
    "18. newly created GPM has 8 module grants",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

      const createRes = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: `new-gpm-${UNIQUE_SUFFIX}@test-mp.au`,
          password: "password123",
          role: "group_practice_manager",
          clinicName: "Verve Dental Clinic A",
          firstName: "Test",
          lastName: "Manager",
        });
      expect(createRes.status).toBe(201);
      const newUser = (createRes.body as { data: { id: string } }).data;

      const permsRes = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${newUser.id}/permissions`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(permsRes.status).toBe(200);

      const grants = (permsRes.body as GrantsBody).data;
      const activeGrants = grants.filter((g) => g.revokedAt === null).map((g) => g.permission);

      const expectedModules = [
        "module:timesheets",
        "module:roster",
        "module:leave",
        "module:inventory",
        "module:stocktakes",
        "module:procurement",
        "module:receiving",
        "module:reports",
      ];
      for (const mod of expectedModules) {
        expect(activeGrants).toContain(mod);
      }
    },
    30_000,
  );

  it(
    "19. newly created clinical_staff has exactly 3 module grants",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

      const createRes = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: `new-staff-${UNIQUE_SUFFIX}@test-mp.au`,
          password: "password123",
          role: "clinical_staff",
          clinicName: "Verve Dental Clinic A",
          firstName: "Test",
          lastName: "Staff",
        });
      expect(createRes.status).toBe(201);
      const newUser = (createRes.body as { data: { id: string } }).data;

      const permsRes = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${newUser.id}/permissions`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(permsRes.status).toBe(200);

      const grants = (permsRes.body as GrantsBody).data;
      const activeModuleGrants = grants
        .filter((g) => g.revokedAt === null && g.permission.startsWith("module:"))
        .map((g) => g.permission);

      expect(activeModuleGrants).toHaveLength(3);
      expect(activeModuleGrants).toContain("module:timesheets");
      expect(activeModuleGrants).toContain("module:roster");
      expect(activeModuleGrants).toContain("module:leave");
      expect(activeModuleGrants).not.toContain("module:inventory");
    },
    30_000,
  );

  it(
    "20. new clinical_staff cannot access inventory (no module:inventory grant)",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

      const createRes = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: `inv-test-${UNIQUE_SUFFIX}@test-mp.au`,
          password: "password123",
          role: "clinical_staff",
          clinicName: "Verve Dental Clinic A",
          firstName: "Inv",
          lastName: "Test",
        });
      expect(createRes.status).toBe(201);

      const staffToken = await loginAndGetAccessToken(
        app,
        `inv-test-${UNIQUE_SUFFIX}@test-mp.au`,
        "password123",
      );
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    },
    30_000,
  );

  it(
    "21. after granting module:inventory to new clinical_staff, they can access inventory",
    async () => {
      const app = await createTestApp();
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");

      const createRes = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: `inv-grant-${UNIQUE_SUFFIX}@test-mp.au`,
          password: "password123",
          role: "clinical_staff",
          clinicName: "Verve Dental Clinic A",
          firstName: "GrantInv",
          lastName: "Test",
        });
      expect(createRes.status).toBe(201);
      const newUser = (createRes.body as { data: { id: string } }).data;

      await grantPermission(app, adminToken, newUser.id, "module:inventory");

      const staffToken = await loginAndGetAccessToken(
        app,
        `inv-grant-${UNIQUE_SUFFIX}@test-mp.au`,
        "password123",
      );
      const res = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 22 · Grant revocation
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — grant revocation", () => {
  it(
    "22. revoking module:inventory and re-logging in → 403 on GET /inventory",
    async () => {
      const app = await createTestApp();
      // Seed staff already has module:inventory from seedInMemoryModuleGrants.
      // Confirm access first.
      const staffTokenBefore = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const before = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${staffTokenBefore}`);
      expect(before.status).toBe(200);

      // Admin revokes module:inventory
      const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      await revokePermission(app, adminToken, SEED_USER_IDS.clinicAStaff, "module:inventory");

      // Fresh login — JWT now excludes module:inventory
      const staffTokenAfter = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const after = await request(app)
        .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/inventory`)
        .set("Authorization", `Bearer ${staffTokenAfter}`);
      expect(after.status).toBe(403);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 23 · Owner/Admin full access
// ─────────────────────────────────────────────────────────────────────────────

describe("Module permissions — owner_admin full access", () => {
  it(
    "23. owner_admin can access all module-gated route families",
    async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
      const clinicId = SEED_CLINIC_A_ID;

      const checks = await Promise.all([
        request(app).get(`/api/v1/clinics/${clinicId}/inventory`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/timesheets/me`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/timesheets`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/roster/me`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/purchase-orders`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/analytics/dashboard`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/v1/clinics/${clinicId}/billing/invoices`).set("Authorization", `Bearer ${token}`),
      ]);

      for (const res of checks) {
        // Every module-gated endpoint must return 200 for owner_admin.
        // (The admin has ALL_PERMISSIONS which includes every module:*.)
        expect(res.status).toBe(200);
      }
    },
    30_000,
  );
});
