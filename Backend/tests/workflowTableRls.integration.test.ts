/**
 * Behavioural regression tests for migration 059.
 *
 * The tests deliberately transfer the protected tables to a temporary
 * NOSUPERUSER, NOBYPASSRLS role and execute every assertion as that table
 * owner. All roles, ownership changes and fixtures are transaction-scoped.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

const DATABASE_URL =
  process.env["WORKFLOW_RLS_DATABASE_URL"] ?? process.env["DATABASE_URL"];
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const pool = DATABASE_URL
  ? new pg.Pool({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 15_000,
      max: 3,
    })
  : undefined;

type ProtectedTable =
  | "stocktake_sessions"
  | "stocktake_lines"
  | "purchasing_drafts";

type FixtureContext = {
  clinicA: string;
  clinicB: string;
  userId: string;
  inventoryA: string;
  inventoryB: string;
  masterItemId: string;
  sessionA: string;
  sessionB: string;
};

const protectedTables: ProtectedTable[] = [
  "stocktake_sessions",
  "stocktake_lines",
  "purchasing_drafts",
];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function expectRlsRejection(
  client: pg.PoolClient,
  sql: string,
  values: unknown[],
): Promise<void> {
  const savepoint = `expected_rls_${randomUUID().replaceAll("-", "")}`;
  await client.query(`SAVEPOINT ${savepoint}`);

  let caught: unknown;
  try {
    await client.query(sql, values);
  } catch (error) {
    caught = error;
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);

  expect(caught).toBeDefined();
  expect(caught).toMatchObject({ code: "42501" });
  expect((caught as Error).message).toMatch(/row-level security/i);
}

function insertSql(table: ProtectedTable): string {
  switch (table) {
    case "stocktake_sessions":
      return `INSERT INTO stocktake_sessions
                (id, clinic_id, name, status, created_by_user_id, created_by_email)
              VALUES ($1, $2, $3, 'draft', $4, 'workflow-rls@test.invalid')`;
    case "stocktake_lines":
      return `INSERT INTO stocktake_lines
                (id, session_id, clinic_id, clinic_inventory_item_id,
                 master_catalog_item_id, expected_quantity, unit_cost_cents,
                 product_name, category, stock_unit)
              VALUES ($1, $2, $3, $4, $5, 0, 0, $6, 'RLS test', 'item')`;
    case "purchasing_drafts":
      return `INSERT INTO purchasing_drafts
                (id, clinic_id, draft_reference, created_by_user_id)
              VALUES ($1, $2, $3, $4)`;
  }
}

function insertValues(
  table: ProtectedTable,
  id: string,
  clinicId: string,
  context: FixtureContext,
): unknown[] {
  const clinicA = clinicId === context.clinicA;
  switch (table) {
    case "stocktake_sessions":
      return [id, clinicId, `Workflow RLS ${id}`, context.userId];
    case "stocktake_lines":
      return [
        id,
        clinicA ? context.sessionA : context.sessionB,
        clinicId,
        clinicA ? context.inventoryA : context.inventoryB,
        context.masterItemId,
        `Workflow RLS ${id}`,
      ];
    case "purchasing_drafts":
      return [id, clinicId, `RLS-${id}`, context.userId];
  }
}

async function createValidFixtures(
  client: pg.PoolClient,
): Promise<FixtureContext & { fixtureA: Record<ProtectedTable, string>; fixtureB: Record<ProtectedTable, string> }> {
  await client.query(
    `SELECT
       set_config('app.owner_admin_mode', 'true', true),
       set_config('app.current_clinic_id', '', true)`,
  );

  const clinics = await client.query<{ id: string }>(
    "SELECT id FROM clinics WHERE is_active = true ORDER BY id LIMIT 2",
  );
  if (clinics.rows.length !== 2) {
    throw new Error("Workflow RLS integration tests require two active clinics");
  }
  const [clinicARow, clinicBRow] = clinics.rows;
  if (!clinicARow || !clinicBRow) {
    throw new Error("Workflow RLS integration tests require two active clinics");
  }
  const clinicA = clinicARow.id;
  const clinicB = clinicBRow.id;

  const users = await client.query<{ id: string }>(
    "SELECT id FROM users ORDER BY id LIMIT 1",
  );
  if (!users.rows[0]) {
    throw new Error("Workflow RLS integration tests require one seeded user");
  }
  const userId = users.rows[0].id;

  const masterItemId = randomUUID();
  const inventoryA = randomUUID();
  const inventoryB = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const lineA = randomUUID();
  const lineB = randomUUID();
  const draftA = randomUUID();
  const draftB = randomUUID();

  await client.query(
    `INSERT INTO master_catalog_items
       (id, sku, name, category, stock_unit, receiving_unit,
        units_per_receiving_unit, unit_of_measure, default_unit_cost_cents)
     VALUES ($1, $2, 'Workflow RLS item', 'test', 'Item', 'Item', 1, 'Item', 0)`,
    [masterItemId, `RLS-${masterItemId}`],
  );
  await client.query(
    `INSERT INTO clinic_inventory_items
       (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point)
     VALUES ($1, $2, $3, 0, 0), ($4, $5, $3, 0, 0)`,
    [inventoryA, clinicA, masterItemId, inventoryB, clinicB],
  );
  await client.query(
    `INSERT INTO stocktake_sessions
       (id, clinic_id, name, status, created_by_user_id, created_by_email)
     VALUES
       ($1, $2, 'Workflow RLS A', 'draft', $3, 'workflow-rls@test.invalid'),
       ($4, $5, 'Workflow RLS B', 'draft', $3, 'workflow-rls@test.invalid')`,
    [sessionA, clinicA, userId, sessionB, clinicB],
  );
  await client.query(
    `INSERT INTO stocktake_lines
       (id, session_id, clinic_id, clinic_inventory_item_id,
        master_catalog_item_id, expected_quantity, unit_cost_cents,
        product_name, category, stock_unit)
     VALUES
       ($1, $2, $3, $4, $5, 0, 0, 'Workflow RLS A', 'test', 'item'),
       ($6, $7, $8, $9, $5, 0, 0, 'Workflow RLS B', 'test', 'item')`,
    [
      lineA,
      sessionA,
      clinicA,
      inventoryA,
      masterItemId,
      lineB,
      sessionB,
      clinicB,
      inventoryB,
    ],
  );
  await client.query(
    `INSERT INTO purchasing_drafts
       (id, clinic_id, draft_reference, created_by_user_id)
     VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)`,
    [draftA, clinicA, `RLS-${draftA}`, userId, draftB, clinicB, `RLS-${draftB}`],
  );

  return {
    clinicA,
    clinicB,
    userId,
    inventoryA,
    inventoryB,
    masterItemId,
    sessionA,
    sessionB,
    fixtureA: {
      stocktake_sessions: sessionA,
      stocktake_lines: lineA,
      purchasing_drafts: draftA,
    },
    fixtureB: {
      stocktake_sessions: sessionB,
      stocktake_lines: lineB,
      purchasing_drafts: draftB,
    },
  };
}

afterAll(async () => {
  await pool?.end();
});

describeWithDatabase("Migration 059 — behavioural table-owner RLS", () => {
  it.each(protectedTables)(
    "%s enforces clinic isolation for its actual NOBYPASSRLS table owner",
    async (table) => {
      if (!pool) {
        throw new Error("Workflow RLS integration database is not configured");
      }
      const client = await pool.connect();
      const ownerRole = `workflow_rls_owner_${randomUUID().replaceAll("-", "")}`;

      try {
        await client.query("BEGIN");

        const executor = await client.query<{
          rolsuper: boolean;
          rolcreaterole: boolean;
        }>(
          `SELECT rolsuper, rolcreaterole
             FROM pg_roles
            WHERE rolname = current_user`,
        );
        if (!executor.rows[0]?.rolsuper && !executor.rows[0]?.rolcreaterole) {
          throw new Error(
            "Workflow RLS integration database must permit creation of the disposable owner role",
          );
        }

        const context = await createValidFixtures(client);
        await client.query(
          `CREATE ROLE ${quoteIdentifier(ownerRole)}
             NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS`,
        );
        for (const protectedTable of protectedTables) {
          await client.query(
            `ALTER TABLE ${quoteIdentifier(protectedTable)}
               OWNER TO ${quoteIdentifier(ownerRole)}`,
          );
        }

        const roleEvidence = await client.query<{
          relname: string;
          owner_name: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
        }>(
          `SELECT c.relname,
                  owner.rolname AS owner_name,
                  owner.rolsuper,
                  owner.rolbypassrls,
                  has_table_privilege(owner.rolname, c.oid, 'SELECT') AS can_select,
                  has_table_privilege(owner.rolname, c.oid, 'INSERT') AS can_insert,
                  has_table_privilege(owner.rolname, c.oid, 'UPDATE') AS can_update,
                  has_table_privilege(owner.rolname, c.oid, 'DELETE') AS can_delete
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_roles owner ON owner.oid = c.relowner
            WHERE n.nspname = 'public'
              AND c.relname = $1`,
          [table],
        );
        expect(roleEvidence.rows).toEqual([
          {
            relname: table,
            owner_name: ownerRole,
            rolsuper: false,
            rolbypassrls: false,
            can_select: true,
            can_insert: true,
            can_update: true,
            can_delete: true,
          },
        ]);

        await client.query(`SET LOCAL ROLE ${quoteIdentifier(ownerRole)}`);
        await client.query(
          `SELECT
             set_config('app.owner_admin_mode', 'false', true),
             set_config('app.current_clinic_id', '', true)`,
        );

        const forceState = await client.query<{ forced: boolean }>(
          `SELECT relforcerowsecurity AS forced
             FROM pg_class
            WHERE oid = $1::regclass`,
          [`public.${table}`],
        );
        expect(forceState.rows[0]?.forced).toBe(true);

        // With migration 059 applied, no-context reads are hidden and writes fail at
        // the RLS boundary even though the role owns the table and has DML rights.
        const noContextRead = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(table)}
            WHERE id = ANY($1::uuid[])`,
          [[context.fixtureA[table], context.fixtureB[table]]],
        );
        expect(noContextRead.rows[0]?.count).toBe("0");
        const noContextInsertId = randomUUID();
        await expectRlsRejection(
          client,
          insertSql(table),
          insertValues(table, noContextInsertId, context.clinicA, context),
        );

        await client.query(
          `SELECT
             set_config('app.current_clinic_id', $1, true),
             set_config('app.owner_admin_mode', 'false', true)`,
          [context.clinicA],
        );

        const clinicRead = await client.query<{ id: string }>(
          `SELECT id
             FROM ${quoteIdentifier(table)}
            WHERE id = ANY($1::uuid[])
            ORDER BY id`,
          [[context.fixtureA[table], context.fixtureB[table]]],
        );
        expect(clinicRead.rows.map((row) => row.id)).toEqual([
          context.fixtureA[table],
        ]);

        const ownInsertId = randomUUID();
        const ownInsert = await client.query(
          insertSql(table),
          insertValues(table, ownInsertId, context.clinicA, context),
        );
        expect(ownInsert.rowCount).toBe(1);
        const ownUpdate = await client.query(
          `UPDATE ${quoteIdentifier(table)}
              SET updated_at = clock_timestamp()
            WHERE id = $1`,
          [ownInsertId],
        );
        expect(ownUpdate.rowCount).toBe(1);
        const ownDelete = await client.query(
          `DELETE FROM ${quoteIdentifier(table)} WHERE id = $1`,
          [ownInsertId],
        );
        expect(ownDelete.rowCount).toBe(1);

        const hiddenUpdate = await client.query(
          `UPDATE ${quoteIdentifier(table)}
              SET updated_at = clock_timestamp()
            WHERE id = $1`,
          [context.fixtureB[table]],
        );
        expect(hiddenUpdate.rowCount).toBe(0);
        const hiddenDelete = await client.query(
          `DELETE FROM ${quoteIdentifier(table)} WHERE id = $1`,
          [context.fixtureB[table]],
        );
        expect(hiddenDelete.rowCount).toBe(0);

        const crossClinicInsertId = randomUUID();
        const crossClinicValues = insertValues(
          table,
          crossClinicInsertId,
          context.clinicB,
          context,
        );
        await expectRlsRejection(
          client,
          insertSql(table),
          crossClinicValues,
        );
        await expectRlsRejection(
          client,
          `UPDATE ${quoteIdentifier(table)} SET clinic_id = $1 WHERE id = $2`,
          [context.clinicB, context.fixtureA[table]],
        );

        await client.query(
          "SELECT set_config('app.owner_admin_mode', 'true', true)",
        );
        const ownerAdminRead = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(table)}
            WHERE id = $1`,
          [context.fixtureB[table]],
        );
        expect(ownerAdminRead.rows[0]?.count).toBe("1");

        // The exact statements rejected above now succeed. This proves their
        // fixtures, constraints and table privileges were valid and RLS alone
        // caused the 42501 failures.
        const ownerAdminInsert = await client.query(
          insertSql(table),
          crossClinicValues,
        );
        expect(ownerAdminInsert.rowCount).toBe(1);
        const ownerAdminDelete = await client.query(
          `DELETE FROM ${quoteIdentifier(table)} WHERE id = $1`,
          [crossClinicInsertId],
        );
        expect(ownerAdminDelete.rowCount).toBe(1);
        const ownerAdminReassign = await client.query(
          `UPDATE ${quoteIdentifier(table)} SET clinic_id = $1 WHERE id = $2`,
          [context.clinicB, context.fixtureA[table]],
        );
        expect(ownerAdminReassign.rowCount).toBe(1);
        const ownerAdminUpdate = await client.query(
          `UPDATE ${quoteIdentifier(table)}
              SET updated_at = clock_timestamp()
            WHERE id = $1`,
          [context.fixtureB[table]],
        );
        expect(ownerAdminUpdate.rowCount).toBe(1);

        // Mutation check: remove only migration 059's FORCE property after all
        // corrected-behaviour assertions. The same NOBYPASSRLS table owner now
        // bypasses every policy and sees both clinics with no context. A pre-059
        // schema therefore fails the forceState/noContextRead assertions above.
        await client.query(
          `SELECT
             set_config('app.owner_admin_mode', 'false', true),
             set_config('app.current_clinic_id', '', true)`,
        );
        await client.query(
          `ALTER TABLE ${quoteIdentifier(table)} NO FORCE ROW LEVEL SECURITY`,
        );
        const pre059Visible = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(table)}
            WHERE id = ANY($1::uuid[])`,
          [[context.fixtureA[table], context.fixtureB[table]]],
        );
        expect(pre059Visible.rows[0]?.count).toBe("2");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    },
    45_000,
  );
});
