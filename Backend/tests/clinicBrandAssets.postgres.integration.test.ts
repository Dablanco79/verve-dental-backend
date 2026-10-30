import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../src/repositories/userRepository.js";

const LOCAL_DEVELOPMENT_DATABASE_URL =
  "postgresql://wf_test:local_test_only@127.0.0.1:55432/wf_test_db";
const designatedDatabaseUrl =
  process.env["CLINIC_BRAND_ASSETS_DATABASE_URL"];
const databaseUrl =
  designatedDatabaseUrl ??
  (process.env["DATABASE_URL"] === LOCAL_DEVELOPMENT_DATABASE_URL
    ? LOCAL_DEVELOPMENT_DATABASE_URL
    : undefined);

function assertDisposableDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = url.pathname.slice(1);
  const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const isAuthorisedLocalDatabase =
    url.hostname === "127.0.0.1" &&
    url.port === "55432" &&
    databaseName === "wf_test_db";
  const isAuthorisedCiDatabase =
    url.hostname === "localhost" &&
    url.port === "5432" &&
    databaseName === "verve_test_clinic_brand_assets";
  if (
    !isLocalHost ||
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    (!isAuthorisedLocalDatabase && !isAuthorisedCiDatabase)
  ) {
    throw new Error(
      "Clinic brand asset PostgreSQL tests require an explicitly authorised disposable local database",
    );
  }
}

if (designatedDatabaseUrl) {
  assertDisposableDatabaseUrl(designatedDatabaseUrl);
}

const canRun = databaseUrl !== undefined;

describe("migration 061 clinic brand assets FORCE RLS", () => {
  if (!canRun) {
    it.skip(
      "Skipped locally: set CLINIC_BRAND_ASSETS_DATABASE_URL to an authorised disposable database",
      () => undefined,
    );
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const otherOrganisationId = randomUUID();
  const otherOrganisationClinicId = randomUUID();

  async function withClinicContext(
    clinicId: string,
    work: (client: pg.PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'false', true),
                set_config('app.current_user_id', '', true)`,
        [clinicId],
      );
      await work(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    const migration = await pool.query<{ present: string | null }>(
      "SELECT to_regclass('public.clinic_brand_assets')::text AS present",
    );
    if (!migration.rows[0]?.present) {
      throw new Error("[clinicBrandAssetsPostgres] Migration 061 is not applied");
    }
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verve_app') THEN
          CREATE ROLE verve_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS;
        END IF;
      END
      $$;
      GRANT USAGE ON SCHEMA public TO verve_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_brand_assets TO verve_app;
      GRANT EXECUTE ON FUNCTION app_current_clinic_id() TO verve_app;
    `);
    await pool.query("GRANT verve_app TO CURRENT_USER").catch(() => undefined);
    await pool.query(
      "INSERT INTO organisations (id, name) VALUES ($1, $2)",
      [otherOrganisationId, `Clinic Brand RLS ${otherOrganisationId}`],
    );
    await pool.query(
      `INSERT INTO clinics
         (id, name, timezone, subscription_tier, is_active, organisation_id)
       VALUES ($1, $2, 'Australia/Melbourne', 'standard', true, $3)`,
      [
        otherOrganisationClinicId,
        `Other Organisation Clinic ${otherOrganisationClinicId}`,
        otherOrganisationId,
      ],
    );

    for (const [clinicId, checksum] of [
      [SEED_CLINIC_A_ID, "a".repeat(64)],
      [SEED_CLINIC_B_ID, "b".repeat(64)],
      [otherOrganisationClinicId, "d".repeat(64)],
    ] as const) {
      await withClinicContext(clinicId, async (client) => {
        await client.query(
          `INSERT INTO clinic_brand_assets
             (clinic_id, image_data, mime_type, sha256_checksum, width, height)
           VALUES ($1, $2, 'image/png', $3, 1, 1)
           ON CONFLICT (clinic_id) DO UPDATE
             SET image_data = EXCLUDED.image_data,
                 sha256_checksum = EXCLUDED.sha256_checksum,
                 updated_at = now()`,
          [clinicId, Buffer.from([1]), checksum],
        );
      });
    }
  }, 20_000);

  afterAll(async () => {
    for (const clinicId of [
      SEED_CLINIC_A_ID,
      SEED_CLINIC_B_ID,
      otherOrganisationClinicId,
    ]) {
      await withClinicContext(clinicId, async (client) => {
        await client.query(
          "DELETE FROM clinic_brand_assets WHERE clinic_id = $1",
          [clinicId],
        );
      }).catch(() => undefined);
    }
    await pool.query("DELETE FROM clinics WHERE id = $1", [otherOrganisationClinicId])
      .catch(() => undefined);
    await pool.query("DELETE FROM organisations WHERE id = $1", [otherOrganisationId])
      .catch(() => undefined);
    await pool.end();
  });

  it("has FORCE RLS and an exact-clinic policy without owner-admin bypass", async () => {
    const ledger = await pool.query<{ id: string; applied_at: Date }>(
      `SELECT id, applied_at
         FROM schema_migrations
        WHERE id = '061_clinic_brand_assets'`,
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.id).toBe("061_clinic_brand_assets");
    expect(ledger.rows[0]?.applied_at).toBeInstanceOf(Date);

    const table = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.clinic_brand_assets'::regclass`,
    );
    expect(table.rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    });

    const policy = await pool.query<{ qual: string; with_check: string }>(
      `SELECT qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'clinic_brand_assets'
          AND policyname = 'rls_clinic_brand_assets_tenant'`,
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]?.qual).toContain("app_current_clinic_id()");
    expect(policy.rows[0]?.with_check).toContain("app_current_clinic_id()");
    expect(policy.rows[0]?.qual).not.toContain("app_is_owner_admin()");
    expect(policy.rows[0]?.with_check).not.toContain("app_is_owner_admin()");
  });

  it("restricts SELECT to the exact clinic even with owner_admin_mode=true", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'true', true),
                set_config('app.current_user_id', '', true)`,
        [SEED_CLINIC_A_ID],
      );

      const visible = await client.query<{ clinic_id: string }>(
        `SELECT clinic_id
           FROM clinic_brand_assets
          WHERE clinic_id = ANY($1::uuid[])
          ORDER BY clinic_id`,
        [[
          SEED_CLINIC_A_ID,
          SEED_CLINIC_B_ID,
          otherOrganisationClinicId,
        ]],
      );
      expect(visible.rows.map((row) => row.clinic_id)).toEqual([SEED_CLINIC_A_ID]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("blocks cross-clinic UPDATE and DELETE transactionally", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'true', true)`,
        [SEED_CLINIC_A_ID],
      );
      await expect(
        client.query(
          "UPDATE clinic_brand_assets SET sha256_checksum = $1 WHERE clinic_id = $2",
          ["c".repeat(64), SEED_CLINIC_B_ID],
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      await expect(
        client.query(
          "DELETE FROM clinic_brand_assets WHERE clinic_id = $1",
          [SEED_CLINIC_B_ID],
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("rejects an INSERT or upsert targeting another clinic", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'true', true)`,
        [SEED_CLINIC_A_ID],
      );
      await client.query("SAVEPOINT cross_clinic_insert");
      await expect(
        client.query(
          `INSERT INTO clinic_brand_assets
             (clinic_id, image_data, mime_type, sha256_checksum, width, height)
           VALUES ($1, $2, 'image/png', $3, 1, 1)
           ON CONFLICT (clinic_id) DO UPDATE
             SET image_data = EXCLUDED.image_data,
                 sha256_checksum = EXCLUDED.sha256_checksum`,
          [SEED_CLINIC_B_ID, Buffer.from([9]), "e".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT cross_clinic_insert");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("keeps each switched clinic context exact, including another organisation", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      for (const clinicId of [
        SEED_CLINIC_A_ID,
        SEED_CLINIC_B_ID,
        otherOrganisationClinicId,
      ]) {
        await client.query(
          `SELECT set_config('app.current_clinic_id', $1, true),
                  set_config('app.owner_admin_mode', 'true', true)`,
          [clinicId],
        );
        const visible = await client.query<{ clinic_id: string }>(
          `SELECT clinic_id
             FROM clinic_brand_assets
            WHERE clinic_id = ANY($1::uuid[])`,
          [[
            SEED_CLINIC_A_ID,
            SEED_CLINIC_B_ID,
            otherOrganisationClinicId,
          ]],
        );
        expect(visible.rows.map((row) => row.clinic_id)).toEqual([clinicId]);
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
