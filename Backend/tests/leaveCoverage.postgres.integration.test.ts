import { randomUUID } from "node:crypto";
import pg from "pg";

import type { DatabasePool } from "../src/db/pool.js";
import { createPostgresLeaveCoverageRepository } from "../src/repositories/leaveCoverageRepository.postgres.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";

const DB_URL = process.env["DATABASE_URL"];

describe("migration 060 leave coverage — PostgreSQL", () => {
  if (!DB_URL) {
    it.skip("Skipped: DATABASE_URL not set — runs in PostgreSQL CI", () => {});
    return;
  }

  let pool: DatabasePool | undefined;
  const getPool = (): DatabasePool => {
    if (!pool) throw new Error("[leaveCoveragePostgres] pool not initialized");
    return pool;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    const schema = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('coverage_groups', 'coverage_group_members')`,
    );
    if (schema.rows.length !== 2) {
      throw new Error("[leaveCoveragePostgres] Migration 060 is not applied");
    }
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verve_app') THEN
          CREATE ROLE verve_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
        END IF;
      END
      $$;
      GRANT USAGE ON SCHEMA public TO verve_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON coverage_groups, coverage_group_members TO verve_app;
      GRANT EXECUTE ON FUNCTION app_is_owner_admin(), app_current_clinic_id() TO verve_app;
    `);
    await pool.query("GRANT verve_app TO CURRENT_USER").catch(() => undefined);
  }, 20_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("FORCE RLS hides cross-clinic and cross-tenant groups from a non-superuser context", async () => {
    const db = getPool();
    const groupA = randomUUID();
    const groupB = randomUUID();
    const otherOrganisationId = randomUUID();
    const otherClinicId = randomUUID();
    const otherTenantGroupId = randomUUID();
    await db.query(
      "INSERT INTO organisations (id, name, status) VALUES ($1, $2, 'active')",
      [otherOrganisationId, `Other tenant ${otherOrganisationId}`],
    );
    await db.query(
      `INSERT INTO clinics
         (id, name, timezone, subscription_tier, is_active, organisation_id)
       VALUES ($1, $2, 'Australia/Melbourne', 'standard', true, $3)`,
      [otherClinicId, `Other tenant clinic ${otherClinicId}`, otherOrganisationId],
    );
    await db.query(
      `INSERT INTO coverage_groups (id, clinic_id, name)
       VALUES ($1, $4, $7), ($2, $5, $8), ($3, $6, $9)`,
      [
        groupA,
        groupB,
        otherTenantGroupId,
        SEED_CLINIC_A_ID,
        SEED_CLINIC_B_ID,
        otherClinicId,
        `RLS A ${groupA}`,
        `RLS B ${groupB}`,
        `RLS other tenant ${otherTenantGroupId}`,
      ],
    );
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'false', true),
                set_config('app.current_user_id', $2, true)`,
        [SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAManager],
      );
      const visible = await client.query<{ id: string }>(
        "SELECT id FROM coverage_groups WHERE id = ANY($1::uuid[])",
        [[groupA, groupB, otherTenantGroupId]],
      );
      expect(visible.rows.map((row) => row.id)).toEqual([groupA]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await db.query(
        "DELETE FROM coverage_groups WHERE id = ANY($1::uuid[])",
        [[groupA, groupB, otherTenantGroupId]],
      );
      await db.query("DELETE FROM clinics WHERE id = $1", [otherClinicId]);
      await db.query("DELETE FROM organisations WHERE id = $1", [otherOrganisationId]);
    }
  });

  it("enforces same-clinic FKs and can_roster eligibility", async () => {
    const db = getPool();
    const groupId = randomUUID();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO coverage_groups (id, clinic_id, name) VALUES ($1, $2, $3)",
        [groupId, SEED_CLINIC_A_ID, `Integrity ${groupId}`],
      );

      await client.query("SAVEPOINT cross_clinic");
      await expect(client.query(
        `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
         VALUES ($1, $2, $3)`,
        [groupId, SEED_CLINIC_B_ID, SEED_USER_IDS.clinicBAdmin],
      )).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK TO SAVEPOINT cross_clinic");

      await client.query(
        `UPDATE user_clinic_assignments SET can_roster = false
          WHERE user_id = $1 AND clinic_id = $2`,
        [SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID],
      );
      await client.query("SAVEPOINT ineligible");
      await expect(client.query(
        `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
         VALUES ($1, $2, $3)`,
        [groupId, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff],
      )).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT ineligible");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("removes membership when can_roster is disabled or the assignment is deleted", async () => {
    const db = getPool();
    const groupId = randomUUID();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO coverage_groups (id, clinic_id, name) VALUES ($1, $2, $3)",
        [groupId, SEED_CLINIC_A_ID, `Cleanup ${groupId}`],
      );
      await client.query(
        `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
         VALUES ($1, $2, $3)`,
        [groupId, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff],
      );
      await client.query(
        `UPDATE user_clinic_assignments SET can_roster = false
          WHERE user_id = $1 AND clinic_id = $2`,
        [SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID],
      );
      let count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM coverage_group_members WHERE group_id = $1",
        [groupId],
      );
      expect(count.rows[0]?.count).toBe("0");

      await client.query(
        `UPDATE user_clinic_assignments SET can_roster = true
          WHERE user_id = $1 AND clinic_id = $2`,
        [SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID],
      );
      await client.query(
        `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
         VALUES ($1, $2, $3)`,
        [groupId, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff],
      );
      await client.query(
        "DELETE FROM user_clinic_assignments WHERE user_id = $1 AND clinic_id = $2",
        [SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID],
      );
      count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM coverage_group_members WHERE group_id = $1",
        [groupId],
      );
      expect(count.rows[0]?.count).toBe("0");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("finds an approved cross-home peer once across multiple groups", async () => {
    const db = getPool();
    const repository = createPostgresLeaveCoverageRepository(db);
    const firstGroupId = randomUUID();
    const secondGroupId = randomUUID();
    const groupIds = [firstGroupId, secondGroupId];
    const leaveId = randomUUID();
    const crossHomePeer = SEED_USER_IDS.clinicBAdmin;
    try {
      await db.query(
        "UPDATE clinics SET leave_overlap_warnings_enabled = true WHERE id = $1",
        [SEED_CLINIC_A_ID],
      );
      await db.query(
        `INSERT INTO user_clinic_assignments
           (user_id, clinic_id, can_roster, can_operate)
         VALUES ($1, $2, true, false)
         ON CONFLICT (user_id, clinic_id)
         DO UPDATE SET can_roster = true`,
        [crossHomePeer, SEED_CLINIC_A_ID],
      );
      await db.query(
        `INSERT INTO coverage_groups (id, clinic_id, name)
         VALUES ($1, $3, $4), ($2, $3, $5)`,
        [firstGroupId, secondGroupId, SEED_CLINIC_A_ID, `Duplicate A ${firstGroupId}`, `Duplicate B ${secondGroupId}`],
      );
      await db.query(
        `INSERT INTO coverage_group_members (group_id, clinic_id, user_id)
         SELECT group_id, $3, user_id
           FROM unnest($1::uuid[]) group_id
           CROSS JOIN unnest($2::uuid[]) user_id`,
        [groupIds, [SEED_USER_IDS.clinicAManager, crossHomePeer], SEED_CLINIC_A_ID],
      );
      await db.query(
        `INSERT INTO leave_requests
           (id, staff_user_id, staff_email, clinic_id, leave_type,
            start_date, end_date, total_days, status, reviewed_by_user_id, reviewed_at)
         VALUES ($1, $2, 'cross-home-private@example.test', $3, 'annual',
                 '2040-06-10', '2040-06-12', 3, 'approved', $4, now())`,
        [leaveId, crossHomePeer, SEED_CLINIC_B_ID, SEED_USER_IDS.clinicBAdmin],
      );

      const warning = await repository.getWarning(
        SEED_CLINIC_A_ID,
        SEED_USER_IDS.clinicAManager,
        "2040-06-12",
        "2040-06-12",
      );
      expect(warning.overlappingColleagueCount).toBe(1);
      expect(warning.affectedGroups).toHaveLength(2);
      expect(JSON.stringify(warning)).not.toContain("cross-home-private");
    } finally {
      await db.query("DELETE FROM leave_requests WHERE id = $1", [leaveId]);
      await db.query("DELETE FROM coverage_groups WHERE id = ANY($1::uuid[])", [groupIds]);
      await db.query(
        "DELETE FROM user_clinic_assignments WHERE user_id = $1 AND clinic_id = $2",
        [crossHomePeer, SEED_CLINIC_A_ID],
      );
      await db.query(
        "UPDATE clinics SET leave_overlap_warnings_enabled = false WHERE id = $1",
        [SEED_CLINIC_A_ID],
      );
    }
  });
});
