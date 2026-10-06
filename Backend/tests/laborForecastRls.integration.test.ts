/**
 * Real PostgreSQL regression coverage for the All Clinics labour forecast.
 *
 * DATABASE_URL must reference the disposable integration database prepared by
 * test:db:setup. Connections used by the forecast repositories assume the
 * verve_app role at startup so FORCE RLS is exercised without superuser bypass.
 */

import pg from "pg";

import { installRlsPoolHook, runWithTenantContext } from "../src/db/tenantContext.js";
import type { DatabasePool } from "../src/db/pool.js";
import { createPostgresClinicRepository } from "../src/repositories/clinicRepository.postgres.js";
import type { ClinicRepository } from "../src/repositories/clinicRepository.js";
import { createPostgresRosterRepository } from "../src/repositories/rosterRepository.postgres.js";
import { createPostgresStaffPayRateRepository } from "../src/repositories/staffPayRateRepository.postgres.js";
import { createPostgresTimesheetRepository } from "../src/repositories/timesheetRepository.postgres.js";
import { createPostgresUserRepository } from "../src/repositories/userRepository.postgres.js";
import {
  createLaborForecastService,
  type LaborCostAnalysis,
} from "../src/services/laborForecastService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { Clinic } from "../src/types/clinic.js";

const DB_URL = process.env["DATABASE_URL"];
const suite = DB_URL ? describe : describe.skip;

const CLINICS = {
  bentleigh: "1ab00000-0000-4000-8000-000000000001",
  cheltenham: "1ab00000-0000-4000-8000-000000000002",
  heathmont: "1ab00000-0000-4000-8000-000000000003",
} as const;

const USERS = {
  owner: "1ab00000-0000-4000-8000-100000000001",
  staff38: "1ab00000-0000-4000-8000-100000000002",
  staff32: "1ab00000-0000-4000-8000-100000000003",
} as const;

const ROSTER_IDS = [
  "1ab00000-0000-4000-8000-200000000001",
  "1ab00000-0000-4000-8000-200000000002",
  "1ab00000-0000-4000-8000-200000000003",
  "1ab00000-0000-4000-8000-200000000004",
] as const;

const RATE_IDS = [
  "1ab00000-0000-4000-8000-300000000001",
  "1ab00000-0000-4000-8000-300000000002",
] as const;

function melbourneToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftWindow(date: string, hours: number): [Date, Date] {
  const start = new Date(`${date}T00:00:00.000Z`);
  return [start, new Date(start.getTime() + hours * 60 * 60 * 1000)];
}

function clinic(id: string, name: string): Clinic {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    name,
    abn: null,
    addressLine1: null,
    suburb: null,
    state: null,
    postcode: null,
    timezone: "Australia/Melbourne",
    subscriptionTier: "standard",
    isActive: true,
    preferredName: null,
    organisationId: null,
    latitude: null,
    longitude: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const TEST_CLINICS = [
  clinic(CLINICS.bentleigh, "Verve Dental - Bentleigh East"),
  clinic(CLINICS.cheltenham, "Verve Dental - Cheltenham"),
  clinic(CLINICS.heathmont, "Verve Dental - Heathmont"),
];

const caller: AuthenticatedUser = {
  id: USERS.owner,
  email: "rls-labour-owner@example.test",
  role: "owner_admin",
  homeClinicId: CLINICS.bentleigh,
  homeClinicName: "Verve Dental - Bentleigh East",
  firstName: "RLS",
  lastName: "Owner",
  displayName: "RLS Owner",
  permissions: ["payroll:rates:read"],
};

const managerCaller: AuthenticatedUser = {
  ...caller,
  role: "group_practice_manager",
};

suite("All Clinics labour forecast — real PostgreSQL FORCE RLS", () => {
  let adminPool: pg.Pool;
  let appPool: DatabasePool;
  let service: ReturnType<typeof createLaborForecastService>;
  let from: string;
  let to: string;

  async function cleanupFixtures(): Promise<void> {
    await adminPool.query(
      `DELETE FROM timesheet_entries WHERE staff_user_id = ANY($1::uuid[])`,
      [[USERS.staff38, USERS.staff32]],
    );
    await adminPool.query(
      `DELETE FROM roster_entry_audit WHERE roster_entry_id = ANY($1::uuid[])`,
      [[...ROSTER_IDS]],
    );
    await adminPool.query(
      `DELETE FROM roster_entries WHERE id = ANY($1::uuid[])`,
      [[...ROSTER_IDS]],
    );
    await adminPool.query(
      `DELETE FROM staff_pay_rates WHERE id = ANY($1::uuid[])`,
      [[...RATE_IDS]],
    );
    await adminPool.query(
      `DELETE FROM user_clinic_assignments WHERE user_id = ANY($1::uuid[])`,
      [[USERS.owner, USERS.staff38, USERS.staff32]],
    );
    await adminPool.query(
      `DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [[USERS.owner, USERS.staff38, USERS.staff32]],
    );
    await adminPool.query(
      `DELETE FROM clinics WHERE id = ANY($1::uuid[])`,
      [[CLINICS.bentleigh, CLINICS.cheltenham, CLINICS.heathmont]],
    );
  }

  async function individual(clinicEntry: Clinic): Promise<LaborCostAnalysis> {
    return runWithTenantContext(clinicEntry.id, true, () =>
      service.getLaborCostAnalysis(caller, clinicEntry.id, {
        from,
        to,
        timezone: clinicEntry.timezone,
      }),
    );
  }

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: DB_URL });
    await cleanupFixtures();

    from = melbourneToday();
    to = addDays(from, 13);

    await adminPool.query(
      `INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
       VALUES
         ($1, $2, 'Australia/Melbourne', 'standard', true),
         ($3, $4, 'Australia/Melbourne', 'standard', true),
         ($5, $6, 'Australia/Melbourne', 'standard', true)`,
      [
        CLINICS.bentleigh, TEST_CLINICS[0]?.name,
        CLINICS.cheltenham, TEST_CLINICS[1]?.name,
        CLINICS.heathmont, TEST_CLINICS[2]?.name,
      ],
    );

    await adminPool.query(
      `INSERT INTO users
         (id, email, password_hash, role, home_clinic_id, home_clinic_name,
          first_name, last_name, display_name, payroll_track, mfa_enabled, is_active)
       VALUES
         ($1, 'rls-labour-owner@example.test', 'test', 'owner_admin',
          $4, 'Verve Dental - Bentleigh East', 'RLS', 'Owner', 'RLS Owner',
          'commission', false, true),
         ($2, 'rls-labour-38@example.test', 'test', 'clinical_staff',
          $4, 'Verve Dental - Bentleigh East', 'Rate', 'Thirty Eight', 'Rate 38',
          'hourly', false, true),
         ($3, 'rls-labour-32@example.test', 'test', 'clinical_staff',
          $5, 'Verve Dental - Cheltenham', 'Rate', 'Thirty Two', 'Rate 32',
          'hourly', false, true)`,
      [USERS.owner, USERS.staff38, USERS.staff32, CLINICS.bentleigh, CLINICS.cheltenham],
    );

    await adminPool.query(
      `INSERT INTO staff_pay_rates
         (id, staff_user_id, base_hourly_rate_cents, employment_type,
          super_rate_percent, effective_from, created_by_user_id)
       VALUES
         ($1, $3, 3800, 'full_time', 12, '2020-01-01', $5),
         ($2, $4, 3200, 'full_time', 12, '2020-01-01', $5)`,
      [RATE_IDS[0], RATE_IDS[1], USERS.staff38, USERS.staff32, USERS.owner],
    );

    const shifts = [
      [ROSTER_IDS[0], USERS.staff38, "rls-labour-38@example.test", CLINICS.bentleigh, TEST_CLINICS[0]?.name, addDays(from, 1), 5],
      [ROSTER_IDS[1], USERS.staff32, "rls-labour-32@example.test", CLINICS.bentleigh, TEST_CLINICS[0]?.name, addDays(from, 2), 4],
      [ROSTER_IDS[2], USERS.staff38, "rls-labour-38@example.test", CLINICS.cheltenham, TEST_CLINICS[1]?.name, addDays(from, 3), 3],
      [ROSTER_IDS[3], USERS.staff32, "rls-labour-32@example.test", CLINICS.heathmont, TEST_CLINICS[2]?.name, addDays(from, 4), 2],
    ] as const;

    for (const [id, staffId, email, clinicId, clinicName, date, hours] of shifts) {
      const [start, end] = shiftWindow(date, hours);
      await adminPool.query(
        `INSERT INTO roster_entries
           (id, staff_user_id, staff_email, rostered_clinic_id, rostered_clinic_name,
            shift_start_at, shift_end_at, shift_type, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'standard', 'scheduled', $8)`,
        [id, staffId, email, clinicId, clinicName, start, end, USERS.owner],
      );
    }

    // Startup role assumption makes every repository checkout production-like:
    // current_user=verve_app, NOSUPERUSER, NOBYPASSRLS.
    appPool = new pg.Pool({
      connectionString: DB_URL,
      options: "-c role=verve_app",
      max: 3,
    });
    const identity = await appPool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user,
              rolsuper,
              rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    const role = identity.rows[0];
    if (!role || role.current_user !== "verve_app" || role.rolsuper || role.rolbypassrls) {
      throw new Error(`RLS integration role is not production-equivalent: ${JSON.stringify(role)}`);
    }

    installRlsPoolHook(appPool);

    const postgresClinics = createPostgresClinicRepository(appPool);
    const clinicRepository: ClinicRepository = {
      ...postgresClinics,
      findAll: () => Promise.resolve(TEST_CLINICS.map((entry) => ({ ...entry }))),
    };
    service = createLaborForecastService(
      createPostgresRosterRepository(appPool),
      createPostgresTimesheetRepository(appPool),
      createPostgresStaffPayRateRepository(appPool),
      createPostgresUserRepository(appPool),
      clinicRepository,
    );
  }, 30_000);

  afterAll(async () => {
    await appPool.end();
    await cleanupFixtures().catch(() => undefined);
    await adminPool.end();
  }, 20_000);

  it("proves the app role is non-superuser/NOBYPASSRLS and no-context roster reads fail closed", async () => {
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

    const noContext = await appPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM roster_entries
        WHERE id = ANY($1::uuid[])`,
      [[...ROSTER_IDS]],
    );
    expect(noContext.rows[0]?.count).toBe("0");
  });

  it("clean pool: all three clinics contribute exact hours and cents", async () => {
    const group = await service.getGroupLaborCostAnalysis(caller, { from, to });
    const byId = new Map(group.clinics.map((entry) => [entry.clinicId, entry.analysis]));

    expect(byId.get(CLINICS.bentleigh)?.futureForecast?.totalHours).toBe(9);
    expect(byId.get(CLINICS.bentleigh)?.planningEstimate.totalCostCents).toBe(35_616);
    expect(byId.get(CLINICS.cheltenham)?.futureForecast?.totalHours).toBe(3);
    expect(byId.get(CLINICS.cheltenham)?.planningEstimate.totalCostCents).toBe(12_768);
    expect(byId.get(CLINICS.heathmont)?.futureForecast?.totalHours).toBe(2);
    expect(byId.get(CLINICS.heathmont)?.planningEstimate.totalCostCents).toBe(7_168);

    expect(group.totals.totalHours).toBe(14);
    expect(group.totals.futureCostCents).toBe(55_552);
    expect(group.totals.totalCostCents).toBe(55_552);
  });

  it("clinic requests followed by group produce identical authoritative analyses", async () => {
    const individuals = await Promise.all(TEST_CLINICS.map(individual));
    const group = await service.getGroupLaborCostAnalysis(caller, { from, to });

    for (const analysis of individuals) {
      const grouped = group.clinics.find((entry) => entry.clinicId === analysis.clinicId);
      expect(grouped?.analysis).toEqual(analysis);
    }
  });

  it("group → clinic → group remains identical", async () => {
    const first = await service.getGroupLaborCostAnalysis(caller, { from, to });
    await individual(TEST_CLINICS[0] as Clinic);
    await individual(TEST_CLINICS[1] as Clinic);
    await individual(TEST_CLINICS[2] as Clinic);
    const second = await service.getGroupLaborCostAnalysis(caller, { from, to });

    expect(second).toEqual(first);
  });

  it("concurrent per-clinic calculations remain isolated and reconcile exactly", async () => {
    const individuals = await Promise.all(TEST_CLINICS.map(individual));
    expect(individuals.map((analysis) => analysis.clinicId).sort()).toEqual(
      Object.values(CLINICS).sort(),
    );
    expect(individuals.reduce(
      (sum, analysis) => sum + (analysis.futureForecast?.totalHours ?? 0),
      0,
    )).toBe(14);
    expect(individuals.reduce(
      (sum, analysis) => sum + (analysis.planningEstimate.totalCostCents ?? 0),
      0,
    )).toBe(55_552);
  });

  it("owner_admin-only group enforcement remains intact", async () => {
    await expect(
      service.getGroupLaborCostAnalysis(managerCaller, { from, to }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "INSUFFICIENT_PERMISSIONS",
    });
  });
});
