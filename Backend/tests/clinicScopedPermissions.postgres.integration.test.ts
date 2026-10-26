import { randomUUID } from "node:crypto";

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import pg from "pg";
import request from "supertest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import type { DatabasePool } from "../src/db/pool.js";
import { createLogger } from "../src/utils/logger.js";

const EXPECTED_DATABASE_URL =
  "postgresql://wf_test:local_test_only@127.0.0.1:55432/wf_test_db";
const ACCESS_SECRET = "postgres-permission-test-access-secret-32-chars";
const REFRESH_SECRET = "postgres-permission-test-refresh-secret-32-chars";
const MFA_KEY = "0".repeat(64);
const databaseUrl = process.env["DATABASE_URL"];
const canRun = databaseUrl === EXPECTED_DATABASE_URL;

// createAppDependencies normally performs startup schema checks and demo seeding.
// This suite deliberately replaces only those startup mutators; every repository,
// service, authentication request, and assertion still uses the real PostgreSQL DB.
jest.unstable_mockModule("../src/db/migrate.js", () => ({
  runBootstrapMigrations: jest.fn(() => Promise.resolve(undefined)),
}));
jest.unstable_mockModule("../src/db/seed.js", () => ({
  seedClinics: jest.fn(() => Promise.resolve(undefined)),
  seedDemoSuppliers: jest.fn(() => Promise.resolve(undefined)),
  seedDemoUsers: jest.fn(() => Promise.resolve(undefined)),
  seedInventory: jest.fn(() => Promise.resolve(undefined)),
  seedLegalEntity: jest.fn(() => Promise.resolve(undefined)),
  seedOrganisation: jest.fn(() => Promise.resolve(undefined)),
  seedProcurementPolicies: jest.fn(() => Promise.resolve(undefined)),
  seedSupplierContracts: jest.fn(() => Promise.resolve(undefined)),
  seedSupplierContractPrices: jest.fn(() => Promise.resolve(undefined)),
  seedSupplierRelationships: jest.fn(() => Promise.resolve(undefined)),
}));

describe("clinic-scoped permissions (PostgreSQL integration)", () => {
  if (!canRun) {
    it.skip(
      `requires DATABASE_URL=${EXPECTED_DATABASE_URL} exactly`,
      () => undefined,
    );
    return;
  }

  const organisationAId = randomUUID();
  const organisationBId = randomUUID();
  const clinicAId = randomUUID();
  const clinicBId = randomUUID();
  const clinicCId = randomUUID();
  const ownerAId = randomUUID();
  const gpmId = randomUUID();
  const catalogItemId = randomUUID();
  const inventoryAId = randomUUID();
  const inventoryBId = randomUUID();
  const createdClinicIds = new Set<string>();

  let fixturePool: DatabasePool;
  let appPool: DatabasePool | null = null;
  let shutdownApp: (() => Promise<void>) | null = null;
  let app: ReturnType<typeof createApp>;

  function tokenFor(
    id: string,
    role: "owner_admin" | "group_practice_manager",
    homeClinicId = clinicAId,
  ): string {
    return jwt.sign(
      {
        sub: id,
        email: `${id}@permission.test`,
        role,
        homeClinicId,
        homeClinicName: "Stale token clinic",
        firstName: "Stale",
        lastName: "Claims",
        displayName: "Stale Claims",
        payrollTrack: "hourly",
        permissions: ["module:inventory", "users:manage"],
        type: "access",
      },
      ACCESS_SECRET,
      { expiresIn: "15m" },
    );
  }

  async function insertUser(
    id: string,
    role: "owner_admin" | "group_practice_manager",
  ): Promise<void> {
    await fixturePool.query(
      `INSERT INTO users (
         id, email, password_hash, role, home_clinic_id, home_clinic_name,
         first_name, last_name, display_name, payroll_track,
         totp_secret, mfa_enabled, is_active
       )
       VALUES ($1, $2, 'not-used-by-token-tests', $3, $4, 'Clinic A',
               'Postgres', 'Fixture', 'Postgres Fixture', 'hourly',
               NULL, false, true)`,
      [id, `${id}@permission.test`, role, clinicAId],
    );
  }

  async function grant(clinicId: string): Promise<void> {
    await fixturePool.query(
      `INSERT INTO user_permission_grants
         (clinic_id, user_id, permission, granted_by)
       VALUES ($1, $2, 'module:inventory', $3)`,
      [clinicId, gpmId, ownerAId],
    );
  }

  beforeAll(async () => {
    fixturePool = new pg.Pool({
      connectionString: EXPECTED_DATABASE_URL,
      max: 3,
    });

    await fixturePool.query(
      `INSERT INTO organisations (id, name)
       VALUES ($1, $2), ($3, $4)`,
      [
        organisationAId,
        `Permission test organisation A ${organisationAId}`,
        organisationBId,
        `Permission test organisation B ${organisationBId}`,
      ],
    );
    await fixturePool.query(
      `INSERT INTO clinics (id, name, organisation_id)
       VALUES ($1, 'Permission Clinic A', $4),
              ($2, 'Permission Clinic B', $4),
              ($3, 'Permission Clinic C', $5)`,
      [clinicAId, clinicBId, clinicCId, organisationAId, organisationBId],
    );
    await insertUser(ownerAId, "owner_admin");
    await insertUser(gpmId, "group_practice_manager");
    await fixturePool.query(
      `INSERT INTO master_catalog_items
         (id, sku, name, category, unit_of_measure, default_unit_cost_cents)
       VALUES ($1, $2, 'Permission RLS item', 'Test', 'Unit', 100)`,
      [catalogItemId, `permission-rls-${catalogItemId}`],
    );
    await fixturePool.query(
      `INSERT INTO clinic_inventory_items
         (id, clinic_id, master_catalog_item_id, quantity_on_hand)
       VALUES ($1, $3, $5, 1), ($2, $4, $5, 2)`,
      [inventoryAId, inventoryBId, clinicAId, clinicBId, catalogItemId],
    );

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = EXPECTED_DATABASE_URL;
    process.env.DATABASE_SSL = "false";
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    process.env.MFA_ENCRYPTION_KEY = MFA_KEY;
    process.env.LOG_LEVEL = "silent";
    delete process.env.REDIS_URL;

    const config = loadConfig();
    const logger = createLogger(config);
    const { createAppDependencies } = await import("../src/bootstrap/dependencies.js");
    const deps = await createAppDependencies(config, logger);
    appPool = deps.databasePool;
    shutdownApp = deps.shutdown;
    app = createApp(config, logger, deps);
  }, 30_000);

  beforeEach(async () => {
    await fixturePool.query(
      "DELETE FROM user_permission_grants WHERE user_id = $1 OR granted_by = $1",
      [gpmId],
    );
    await fixturePool.query(
      `UPDATE users
          SET role = 'group_practice_manager',
              home_clinic_id = $2,
              home_clinic_name = 'Permission Clinic A'
        WHERE id = $1`,
      [gpmId, clinicAId],
    );
    await fixturePool.query(
      "DELETE FROM user_clinic_assignments WHERE user_id = $1",
      [gpmId],
    );
    await fixturePool.query(
      `INSERT INTO user_clinic_assignments
         (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id)
       VALUES ($1, $2, true, true, $4),
              ($1, $3, true, false, $4)`,
      [gpmId, clinicAId, clinicBId, ownerAId],
    );
  });

  afterAll(async () => {
    try {
      await shutdownApp?.();
    } finally {
      try {
        await fixturePool.query(
          "DELETE FROM user_permission_grants WHERE user_id = ANY($1::uuid[]) OR granted_by = ANY($1::uuid[])",
          [[gpmId, ownerAId]],
        );
        await fixturePool.query(
          "DELETE FROM user_clinic_assignments WHERE user_id = ANY($1::uuid[])",
          [[gpmId, ownerAId]],
        );
        await fixturePool.query(
          "DELETE FROM clinic_inventory_items WHERE id = ANY($1::uuid[])",
          [[inventoryAId, inventoryBId]],
        );
        await fixturePool.query(
          "DELETE FROM master_catalog_items WHERE id = $1",
          [catalogItemId],
        );
        await fixturePool.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[])",
          [[gpmId, ownerAId]],
        );
        await fixturePool.query(
          "DELETE FROM clinics WHERE id = ANY($1::uuid[])",
          [[...createdClinicIds, clinicAId, clinicBId, clinicCId]],
        );
        await fixturePool.query(
          "DELETE FROM organisations WHERE id = ANY($1::uuid[])",
          [[organisationAId, organisationBId]],
        );
      } finally {
        await fixturePool.end();
      }
    }
  }, 30_000);

  it("isolates GPM grants by clinic A and B using real authenticated requests", async () => {
    await grant(clinicAId);
    await fixturePool.query(
      "UPDATE user_clinic_assignments SET can_operate = true WHERE user_id = $1 AND clinic_id = $2",
      [gpmId, clinicBId],
    );
    const token = tokenFor(gpmId, "group_practice_manager");

    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicAId}/inventory`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/inventory`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(403);

    const { createPostgresPermissionRepository } =
      await import("../src/repositories/permissionRepository.postgres.js");
    await createPostgresPermissionRepository(appPool as DatabasePool).grant(
      clinicBId,
      gpmId,
      "module:inventory",
      ownerAId,
    );

    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/inventory`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);
  });

  it("applies persisted revoked_at immediately to the same issued JWT", async () => {
    await grant(clinicAId);
    const gpmToken = tokenFor(gpmId, "group_practice_manager");
    const ownerToken = tokenFor(ownerAId, "owner_admin");

    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicAId}/inventory`)
        .set("Authorization", `Bearer ${gpmToken}`)).status,
    ).toBe(200);
    expect(
      (await request(app)
        .delete(
          `/api/v1/clinics/${clinicAId}/users/${gpmId}/permissions/module%3Ainventory`,
        )
        .set("Authorization", `Bearer ${ownerToken}`)).status,
    ).toBe(204);

    const persisted = await fixturePool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at
         FROM user_permission_grants
        WHERE clinic_id = $1 AND user_id = $2 AND permission = 'module:inventory'`,
      [clinicAId, gpmId],
    );
    expect(persisted.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicAId}/inventory`)
        .set("Authorization", `Bearer ${gpmToken}`)).status,
    ).toBe(403);
  });

  it("rehydrates persisted home-clinic reassignment and role demotion from the same token", async () => {
    await grant(clinicBId);
    const staleToken = tokenFor(gpmId, "group_practice_manager", clinicAId);

    await fixturePool.query(
      `UPDATE users
          SET home_clinic_id = $2, home_clinic_name = 'Permission Clinic B'
        WHERE id = $1`,
      [gpmId, clinicBId],
    );
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/inventory`)
        .set("Authorization", `Bearer ${staleToken}`)).status,
    ).toBe(200);

    await fixturePool.query(
      "UPDATE users SET role = 'clinical_staff' WHERE id = $1",
      [gpmId],
    );
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/users`)
        .set("Authorization", `Bearer ${staleToken}`)).status,
    ).toBe(403);
  });

  it("keeps owners inside their organisation and inherits it for API-created clinics", async () => {
    const ownerToken = tokenFor(ownerAId, "owner_admin");
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicCId}/inventory`)
        .set("Authorization", `Bearer ${ownerToken}`)).status,
    ).toBe(403);

    const created = await request(app)
      .post("/api/v1/clinics")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Inherited organisation ${randomUUID()}` });
    expect(created.status).toBe(201);
    const createdBody = created.body as { data: { id: string } };
    const createdId = createdBody.data.id;
    createdClinicIds.add(createdId);

    const persisted = await fixturePool.query<{ organisation_id: string }>(
      "SELECT organisation_id FROM clinics WHERE id = $1",
      [createdId],
    );
    expect(persisted.rows[0]?.organisation_id).toBe(organisationAId);
  });

  it("requires an assignment with can_operate=true even when a grant exists", async () => {
    await grant(clinicBId);
    const token = tokenFor(gpmId, "group_practice_manager");

    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/inventory`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(403);

    await fixturePool.query(
      "UPDATE user_clinic_assignments SET can_operate = true WHERE user_id = $1 AND clinic_id = $2",
      [gpmId, clinicBId],
    );
    expect(
      (await request(app)
        .get(`/api/v1/clinics/${clinicBId}/inventory`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);
  });

  it("enforces clinic row isolation as non-superuser verve_app under RLS", async () => {
    const client = await fixturePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT
           set_config('app.current_clinic_id', $1, true),
           set_config('app.owner_admin_mode', 'false', true),
           set_config('app.current_user_id', $2, true)`,
        [clinicAId, gpmId],
      );
      const visible = await client.query<{ id: string }>(
        "SELECT id FROM clinic_inventory_items WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[inventoryAId, inventoryBId]],
      );
      expect(visible.rows.map((row) => row.id)).toEqual([inventoryAId]);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
});
