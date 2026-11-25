import { randomUUID } from "node:crypto";

import pg from "pg";

import {
  installRlsPoolHook,
  runWithTenantContext,
} from "../src/db/tenantContext.js";
import type { DatabasePool } from "../src/db/pool.js";
import { createPostgresClinicRepository } from "../src/repositories/clinicRepository.postgres.js";
import { createPostgresLeaveRepository } from "../src/repositories/leaveRepository.postgres.js";
import { createPostgresRosterRepository } from "../src/repositories/rosterRepository.postgres.js";
import { createPostgresUserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.postgres.js";
import { createPostgresUserRepository } from "../src/repositories/userRepository.postgres.js";
import { createRosterService } from "../src/services/rosterService.js";
import type { AuthenticatedUser, UserRole } from "../src/types/auth.js";
import { AppError } from "../src/types/errors.js";

const DB_URL = process.env["DATABASE_URL"];
const suite = DB_URL ? describe : describe.skip;

const ids = {
  organisationA: randomUUID(),
  organisationB: randomUUID(),
  clinicA: randomUUID(),
  clinicB: randomUUID(),
  clinicC: randomUUID(),
  owner: randomUUID(),
  manager: randomUUID(),
  unauthorisedManager: randomUUID(),
  crossHomeStaff: randomUUID(),
  clinicBStaff: randomUUID(),
  inactiveStaff: randomUUID(),
  notRosterEligibleStaff: randomUUID(),
  unassignedStaff: randomUUID(),
  otherOrganisationStaff: randomUUID(),
  approvedLeave: randomUUID(),
} as const;

const LEAVE_DATE = "2035-02-14";
const SHIFT_START = new Date("2035-02-13T21:00:00.000Z");
const SHIFT_END = new Date("2035-02-14T06:00:00.000Z");

function caller(
  id: string,
  role: "owner_admin" | "group_practice_manager",
): AuthenticatedUser {
  return {
    id,
    email: `${id}@roster-rls.test`,
    role,
    homeClinicId: ids.clinicA,
    homeClinicName: "Roster RLS Clinic A",
    firstName: "Roster",
    lastName: "Manager",
    displayName: "Roster Manager",
    payrollTrack: "hourly",
    permissions: ["module:roster"],
  };
}

suite("Roster eligible staff — real PostgreSQL FORCE RLS", () => {
  let fixturePool: pg.Pool;
  let appPool: DatabasePool;
  let service: ReturnType<typeof createRosterService>;

  async function cleanupFixtures(): Promise<void> {
    await fixturePool.query(
      `DELETE FROM roster_entry_audit
       WHERE roster_entry_id IN (
         SELECT id FROM roster_entries WHERE staff_user_id = $1
       )`,
      [ids.crossHomeStaff],
    );
    await fixturePool.query(
      "DELETE FROM roster_entries WHERE staff_user_id = $1",
      [ids.crossHomeStaff],
    );
    await fixturePool.query(
      "DELETE FROM leave_requests WHERE staff_user_id = $1",
      [ids.crossHomeStaff],
    );
    await fixturePool.query(
      "DELETE FROM user_clinic_assignments WHERE user_id = ANY($1::uuid[])",
      [[
        ids.owner,
        ids.manager,
        ids.unauthorisedManager,
        ids.crossHomeStaff,
        ids.clinicBStaff,
        ids.inactiveStaff,
        ids.notRosterEligibleStaff,
        ids.unassignedStaff,
        ids.otherOrganisationStaff,
      ]],
    );
    await fixturePool.query(
      "DELETE FROM users WHERE id = ANY($1::uuid[])",
      [[
        ids.owner,
        ids.manager,
        ids.unauthorisedManager,
        ids.crossHomeStaff,
        ids.clinicBStaff,
        ids.inactiveStaff,
        ids.notRosterEligibleStaff,
        ids.unassignedStaff,
        ids.otherOrganisationStaff,
      ]],
    );
    await fixturePool.query(
      "DELETE FROM clinics WHERE id = ANY($1::uuid[])",
      [[ids.clinicA, ids.clinicB, ids.clinicC]],
    );
    await fixturePool.query(
      "DELETE FROM organisations WHERE id = ANY($1::uuid[])",
      [[ids.organisationA, ids.organisationB]],
    );
  }

  async function insertUser(
    id: string,
    homeClinicId: string,
    role: UserRole,
    isActive = true,
  ): Promise<void> {
    await fixturePool.query(
      `INSERT INTO users (
         id, email, password_hash, role, home_clinic_id, home_clinic_name,
         first_name, last_name, display_name, payroll_track,
         totp_secret, mfa_enabled, is_active
       )
       VALUES (
         $1, $2, 'not-used', $3, $4, 'Roster RLS Clinic',
         'Roster', 'Fixture', 'Roster Fixture', 'hourly',
         NULL, false, $5
       )`,
      [id, `${id}@roster-rls.test`, role, homeClinicId, isActive],
    );
  }

  beforeAll(async () => {
    fixturePool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    await cleanupFixtures();

    await fixturePool.query(
      "INSERT INTO organisations (id, name) VALUES ($1, $2), ($3, $4)",
      [
        ids.organisationA,
        `Roster RLS Organisation A ${ids.organisationA}`,
        ids.organisationB,
        `Roster RLS Organisation B ${ids.organisationB}`,
      ],
    );
    await fixturePool.query(
      `INSERT INTO clinics (id, name, organisation_id)
       VALUES
         ($1, 'Roster RLS Clinic A', $4),
         ($2, 'Roster RLS Clinic B', $4),
         ($3, 'Roster RLS Clinic C', $5)`,
      [
        ids.clinicA,
        ids.clinicB,
        ids.clinicC,
        ids.organisationA,
        ids.organisationB,
      ],
    );

    await insertUser(ids.owner, ids.clinicA, "owner_admin");
    await insertUser(ids.manager, ids.clinicA, "group_practice_manager");
    await insertUser(
      ids.unauthorisedManager,
      ids.clinicA,
      "group_practice_manager",
    );
    await insertUser(ids.crossHomeStaff, ids.clinicA, "clinical_staff");
    await insertUser(ids.clinicBStaff, ids.clinicB, "clinical_staff");
    await insertUser(ids.inactiveStaff, ids.clinicA, "clinical_staff", false);
    await insertUser(
      ids.notRosterEligibleStaff,
      ids.clinicA,
      "clinical_staff",
    );
    await insertUser(ids.unassignedStaff, ids.clinicA, "clinical_staff");
    await insertUser(
      ids.otherOrganisationStaff,
      ids.clinicC,
      "clinical_staff",
    );

    await fixturePool.query(
      `INSERT INTO user_clinic_assignments
         (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id)
       VALUES
         ($1, $4, true, true, $3),
         ($1, $5, false, true, $3),
         ($2, $4, true, true, $3),
         ($6, $5, true, false, $3),
         ($7, $5, true, false, $3),
         ($8, $5, true, false, $3),
         ($9, $5, false, false, $3)`,
      [
        ids.manager,
        ids.unauthorisedManager,
        ids.owner,
        ids.clinicA,
        ids.clinicB,
        ids.crossHomeStaff,
        ids.clinicBStaff,
        ids.inactiveStaff,
        ids.notRosterEligibleStaff,
      ],
    );

    await fixturePool.query(
      `INSERT INTO leave_requests (
         id, staff_user_id, staff_email, clinic_id, leave_type,
         start_date, end_date, total_days, reason, status,
         reviewed_by_user_id, reviewed_at, review_notes
       )
       VALUES (
         $1, $2, $3, $4, 'annual',
         $5::date, $5::date, 1, 'Confidential medical context', 'approved',
         $6, now(), 'Confidential approval notes'
       )`,
      [
        ids.approvedLeave,
        ids.crossHomeStaff,
        `${ids.crossHomeStaff}@roster-rls.test`,
        ids.clinicA,
        LEAVE_DATE,
        ids.manager,
      ],
    );

    appPool = new pg.Pool({
      connectionString: DB_URL,
      options: "-c role=verve_app",
      max: 8,
    });
    const identity = await appPool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user, rolsuper, rolbypassrls
       FROM pg_roles
       WHERE rolname = current_user`,
    );
    expect(identity.rows[0]).toEqual({
      current_user: "verve_app",
      rolsuper: false,
      rolbypassrls: false,
    });

    installRlsPoolHook(appPool);
    service = createRosterService(
      createPostgresRosterRepository(appPool),
      createPostgresLeaveRepository(appPool),
      createPostgresUserRepository(appPool),
      createPostgresClinicRepository(appPool),
      createPostgresUserClinicAssignmentsRepository(appPool),
    );
  }, 30_000);

  afterAll(async () => {
    await appPool.end();
    await cleanupFixtures().catch(() => undefined);
    await fixturePool.end();
  }, 20_000);

  it("returns active target-clinic assignments, including cross-home staff", async () => {
    const result = await runWithTenantContext(
      ids.clinicB,
      false,
      () => service.getRosterEligibleStaff(
        caller(ids.manager, "group_practice_manager"),
        ids.clinicB,
      ),
    );

    expect(result.map((staff) => staff.id).sort()).toEqual(
      [ids.crossHomeStaff, ids.clinicBStaff].sort(),
    );
    expect(result.map((staff) => staff.id)).not.toContain(ids.inactiveStaff);
    expect(result.map((staff) => staff.id)).not.toContain(
      ids.notRosterEligibleStaff,
    );
    expect(result.map((staff) => staff.id)).not.toContain(ids.unassignedStaff);
  });

  it("returns identical eligible staff IDs for Owner/Admin and authorised GPM", async () => {
    const [ownerResult, managerResult] = await Promise.all([
      runWithTenantContext(
        ids.clinicB,
        true,
        () => service.getRosterEligibleStaff(
          caller(ids.owner, "owner_admin"),
          ids.clinicB,
        ),
      ),
      runWithTenantContext(
        ids.clinicB,
        false,
        () => service.getRosterEligibleStaff(
          caller(ids.manager, "group_practice_manager"),
          ids.clinicB,
        ),
      ),
    ]);

    expect(managerResult.map((staff) => staff.id).sort()).toEqual(
      ownerResult.map((staff) => staff.id).sort(),
    );
  });

  it("rejects a Practice Manager without target-clinic operational access", async () => {
    await expect(
      runWithTenantContext(
        ids.clinicB,
        false,
        () => service.getRosterEligibleStaff(
          caller(ids.unauthorisedManager, "group_practice_manager"),
          ids.clinicB,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
  });

  it("fails closed when an inconsistent cross-organisation assignment exists", async () => {
    await fixturePool.query(
      `INSERT INTO user_clinic_assignments
         (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id)
       VALUES ($1, $2, true, false, $3)`,
      [ids.otherOrganisationStaff, ids.clinicB, ids.owner],
    );

    try {
      await expect(
        runWithTenantContext(
          ids.clinicB,
          false,
          () => service.getRosterEligibleStaff(
            caller(ids.manager, "group_practice_manager"),
            ids.clinicB,
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "INTERNAL_ERROR",
      } satisfies Partial<AppError>);
    } finally {
      await fixturePool.query(
        `DELETE FROM user_clinic_assignments
         WHERE user_id = $1 AND clinic_id = $2`,
        [ids.otherOrganisationStaff, ids.clinicB],
      );
    }
  });

  it("keeps direct users reads restricted by the existing home-clinic RLS policy", async () => {
    const policy = await fixturePool.query<{ qual: string | null }>(
      `SELECT qual
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'users'
         AND policyname = 'rls_users_select'`,
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]?.qual).toContain("home_clinic_id");
    expect(policy.rows[0]?.qual).not.toContain("user_clinic_assignments");

    const directRows = await runWithTenantContext(
      ids.clinicB,
      false,
      async () => appPool.query<{ id: string }>(
        "SELECT id FROM users WHERE id = $1",
        [ids.crossHomeStaff],
      ),
    );
    expect(directRows.rows).toHaveLength(0);
  });

  it("returns only the roster selector's limited public staff projection", async () => {
    const result = await runWithTenantContext(
      ids.clinicB,
      false,
      () => service.getRosterEligibleStaff(
        caller(ids.manager, "group_practice_manager"),
        ids.clinicB,
      ),
    );

    expect(result).not.toHaveLength(0);
    for (const staff of result) {
      expect(Object.keys(staff).sort()).toEqual(
        ["displayName", "email", "firstName", "id", "lastName"].sort(),
      );
      expect(staff).not.toHaveProperty("passwordHash");
      expect(staff).not.toHaveProperty("totpSecret");
      expect(staff).not.toHaveProperty("payrollTrack");
    }
  });

  it("detects cross-home approved leave in the restricted GPM conflict preview", async () => {
    const result = await runWithTenantContext(
      ids.clinicB,
      false,
      () => service.checkConflictsForShift(
        caller(ids.manager, "group_practice_manager"),
        ids.clinicB,
        {
          staffUserId: ids.crossHomeStaff,
          proposedStart: SHIFT_START,
          proposedEnd: SHIFT_END,
        },
      ),
    );

    expect(result.approvedLeave).toStrictEqual([{
      leaveId: ids.approvedLeave,
      startDate: LEAVE_DATE,
      endDate: LEAVE_DATE,
    }]);
  });

  it("rejects final shift save for cross-home approved leave", async () => {
    await expect(
      runWithTenantContext(
        ids.clinicB,
        false,
        () => service.createEntry(
          caller(ids.manager, "group_practice_manager"),
          ids.clinicB,
          {
            staffUserId: ids.crossHomeStaff,
            shiftStartAt: SHIFT_START,
            shiftEndAt: SHIFT_END,
            shiftType: "standard",
            notes: null,
          },
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "APPROVED_LEAVE_CONFLICT",
    } satisfies Partial<AppError>);
  });

  it("forbids an unauthorised GPM from previewing cross-home leave", async () => {
    await expect(
      runWithTenantContext(
        ids.clinicB,
        false,
        () => service.checkConflictsForShift(
          caller(ids.unauthorisedManager, "group_practice_manager"),
          ids.clinicB,
          {
            staffUserId: ids.crossHomeStaff,
            proposedStart: SHIFT_START,
            proposedEnd: SHIFT_END,
          },
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
  });

  it("exposes no confidential leave fields in the preview projection", async () => {
    const result = await runWithTenantContext(
      ids.clinicB,
      false,
      () => service.checkConflictsForShift(
        caller(ids.manager, "group_practice_manager"),
        ids.clinicB,
        {
          staffUserId: ids.crossHomeStaff,
          proposedStart: SHIFT_START,
          proposedEnd: SHIFT_END,
        },
      ),
    );
    const leave = result.approvedLeave[0];

    expect(Object.keys(leave ?? {}).sort()).toEqual(
      ["endDate", "leaveId", "startDate"].sort(),
    );
    expect(leave).not.toHaveProperty("reason");
    expect(leave).not.toHaveProperty("reviewNotes");
    expect(leave).not.toHaveProperty("leaveType");
    expect(leave).not.toHaveProperty("staffEmail");
  });
});
