import { randomUUID } from "node:crypto";

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import pg from "pg";
import request from "supertest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import type { DatabasePool } from "../src/db/pool.js";
import { insertAuditEvent } from "../src/repositories/analyticsRepository.postgres.js";
import type { CorrectTimesheetWithAuditInput } from "../src/repositories/timesheetRepository.js";
import { createLogger } from "../src/utils/logger.js";

const EXPECTED_DATABASE_URL =
  "postgresql://wf_test:local_test_only@127.0.0.1:55432/wf_test_db";
const ACCESS_SECRET = "postgres-correction-test-access-secret-32-chars";
const REFRESH_SECRET = "postgres-correction-test-refresh-secret-32-chars";
const databaseUrl = process.env["DATABASE_URL"];
const canRun = databaseUrl === EXPECTED_DATABASE_URL;

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

describe("timesheet correction atomicity (PostgreSQL integration)", () => {
  if (!canRun) {
    it.skip(`requires DATABASE_URL=${EXPECTED_DATABASE_URL} exactly`, () => undefined);
    return;
  }

  const organisationAId = randomUUID();
  const organisationBId = randomUUID();
  const clinicAId = randomUUID();
  const clinicBId = randomUUID();
  const clinicCId = randomUUID();
  const ownerId = randomUUID();
  const gpmId = randomUUID();
  const staffAId = randomUUID();
  const staffBId = randomUUID();
  const staffCId = randomUUID();
  const fixtureTimesheetIds = new Set<string>();

  let fixturePool: DatabasePool;
  let appPool: DatabasePool;
  let shutdownApp: (() => Promise<void>) | null = null;
  let app: ReturnType<typeof createApp>;

  function tokenFor(id: string, role: "owner_admin" | "group_practice_manager"): string {
    return jwt.sign(
      {
        sub: id,
        email: `${id}@correction.test`,
        role,
        homeClinicId: clinicAId,
        homeClinicName: "Correction Clinic A",
        firstName: "Correction",
        lastName: "Fixture",
        displayName: "Correction Fixture",
        payrollTrack: "hourly",
        permissions: ["module:timesheets"],
        type: "access",
      },
      ACCESS_SECRET,
      { expiresIn: "15m" },
    );
  }

  async function insertUser(
    id: string,
    clinicId: string,
    role: "owner_admin" | "group_practice_manager" | "clinical_staff",
  ): Promise<void> {
    await fixturePool.query(
      `INSERT INTO users (
         id, email, password_hash, role, home_clinic_id, home_clinic_name,
         first_name, last_name, display_name, payroll_track,
         totp_secret, mfa_enabled, is_active
       )
       VALUES ($1, $2, 'not-used', $3, $4, 'Correction Clinic',
               'Correction', 'Fixture', 'Correction Fixture', 'hourly',
               NULL, false, true)`,
      [id, `${id}@correction.test`, role, clinicId],
    );
  }

  async function insertTimesheet(
    clinicId: string,
    staffId: string,
    status: "submitted" | "rejected" | "requires_amendment" | "approved" | "processed",
  ): Promise<string> {
    const id = randomUUID();
    fixtureTimesheetIds.add(id);
    await fixturePool.query(
      `INSERT INTO timesheet_entries (
         id, payroll_type, staff_user_id, staff_email,
         clinic_id, rostered_clinic_id, rostered_clinic_name,
         shift_date, shift_start_at, shift_end_at, attendance_status,
         clock_in_at, clock_out_at, break_duration_minutes,
         total_hours_worked, ordinary_hours, overtime_1_5x_hours,
         overtime_2x_hours, overtime_custom_hours, timesheet_status,
         approved_by_user_id, approved_at, approval_notes, generated_by
       )
       VALUES (
         $1, 'hourly_manual', $2, $3, $4, $4, 'Correction Clinic',
         '2028-06-01', '2028-05-31T22:00:00Z', '2028-06-01T08:00:00Z', 'present',
         '2028-05-31T22:00:00Z', '2028-06-01T06:30:00Z', 30,
         8, 8, 0, 0, 0, $5,
         $6, $7, $8, 'manager_manual'
       )`,
      [
        id,
        staffId,
        `${staffId}@correction.test`,
        clinicId,
        status,
        status === "submitted" ? null : ownerId,
        status === "submitted" ? null : new Date("2028-06-02T00:00:00Z"),
        status === "submitted" ? null : "Original review",
      ],
    );
    return id;
  }

  function correctionInput(id: string, clinicId: string): CorrectTimesheetWithAuditInput {
    return {
      id,
      clinicId,
      ownerAdmin: true,
      clockMutation: {
        clockInAt: new Date("2028-05-31T21:30:00Z"),
        clockOutAt: new Date("2028-06-01T08:00:00Z"),
        breakDurationMinutes: 30,
        totalHoursWorked: 10,
        ordinaryHours: 8,
        overtime15xHours: 2,
        overtime2xHours: 0,
        overtimeCustomHours: 0,
      },
      auditEvent: {
        clinicId,
        entityType: "timesheet_entry",
        entityId: id,
        action: "corrected",
        actorId: ownerId,
        actorEmail: `${ownerId}@correction.test`,
        metadata: {
          reason: "Verified paper record",
          before: { status: "rejected" },
          after: { status: "submitted" },
        },
      },
    };
  }

  async function grantTimesheets(clinicId: string): Promise<void> {
    await fixturePool.query(
      `INSERT INTO user_permission_grants
         (clinic_id, user_id, permission, granted_by)
       VALUES ($1, $2, 'module:timesheets', $3)`,
      [clinicId, gpmId, ownerId],
    );
  }

  beforeAll(async () => {
    fixturePool = new pg.Pool({ connectionString: EXPECTED_DATABASE_URL, max: 4 });
    await fixturePool.query(
      "INSERT INTO organisations (id, name) VALUES ($1, $2), ($3, $4)",
      [
        organisationAId,
        `Correction organisation A ${organisationAId}`,
        organisationBId,
        `Correction organisation B ${organisationBId}`,
      ],
    );
    await fixturePool.query(
      `INSERT INTO clinics (id, name, organisation_id)
       VALUES ($1, 'Correction Clinic A', $4),
              ($2, 'Correction Clinic B', $4),
              ($3, 'Correction Clinic C', $5)`,
      [clinicAId, clinicBId, clinicCId, organisationAId, organisationBId],
    );
    await insertUser(ownerId, clinicAId, "owner_admin");
    await insertUser(gpmId, clinicAId, "group_practice_manager");
    await insertUser(staffAId, clinicAId, "clinical_staff");
    await insertUser(staffBId, clinicBId, "clinical_staff");
    await insertUser(staffCId, clinicCId, "clinical_staff");

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = EXPECTED_DATABASE_URL;
    process.env.DATABASE_SSL = "false";
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    process.env.MFA_ENCRYPTION_KEY = "0".repeat(64);
    process.env.LOG_LEVEL = "silent";
    delete process.env.REDIS_URL;

    const config = loadConfig();
    const logger = createLogger(config);
    const { createAppDependencies } = await import("../src/bootstrap/dependencies.js");
    const deps = await createAppDependencies(config, logger);
    if (!deps.databasePool) throw new Error("Expected PostgreSQL app pool");
    appPool = deps.databasePool;
    shutdownApp = deps.shutdown;
    app = createApp(config, logger, deps);
  }, 30_000);

  beforeEach(async () => {
    await fixturePool.query(
      "DELETE FROM user_permission_grants WHERE user_id = $1 OR granted_by = $1",
      [gpmId],
    );
    await fixturePool.query("DELETE FROM user_clinic_assignments WHERE user_id = $1", [gpmId]);
    await fixturePool.query(
      `INSERT INTO user_clinic_assignments
         (user_id, clinic_id, can_roster, can_operate, assigned_by_user_id)
       VALUES ($1, $2, true, true, $5),
              ($1, $3, false, false, $5),
              ($1, $4, false, true, $5)`,
      [gpmId, clinicAId, clinicBId, clinicCId, ownerId],
    );
  });

  afterEach(async () => {
    await fixturePool.query(
      "DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])",
      [[...fixtureTimesheetIds]],
    );
    await fixturePool.query(
      "DELETE FROM timesheet_entries WHERE id = ANY($1::uuid[])",
      [[...fixtureTimesheetIds]],
    );
    const remaining = await fixturePool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM audit_events WHERE entity_id = ANY($1::uuid[])) +
         (SELECT count(*) FROM timesheet_entries WHERE id = ANY($1::uuid[]))
       )::text AS count`,
      [[...fixtureTimesheetIds]],
    );
    expect(remaining.rows[0]?.count).toBe("0");
    fixtureTimesheetIds.clear();
  });

  afterAll(async () => {
    try {
      await shutdownApp?.();
    } finally {
      await fixturePool.query(
        "DELETE FROM user_permission_grants WHERE user_id = $1 OR granted_by = $1",
        [gpmId],
      );
      await fixturePool.query(
        "DELETE FROM user_clinic_assignments WHERE user_id = ANY($1::uuid[])",
        [[gpmId, ownerId]],
      );
      await fixturePool.query(
        "DELETE FROM users WHERE id = ANY($1::uuid[])",
        [[ownerId, gpmId, staffAId, staffBId, staffCId]],
      );
      await fixturePool.query(
        "DELETE FROM clinics WHERE id = ANY($1::uuid[])",
        [[clinicAId, clinicBId, clinicCId]],
      );
      await fixturePool.query(
        "DELETE FROM organisations WHERE id = ANY($1::uuid[])",
        [[organisationAId, organisationBId]],
      );
      const remaining = await fixturePool.query<{ count: string }>(
        `SELECT (
           (SELECT count(*) FROM organisations WHERE id = ANY($1::uuid[])) +
           (SELECT count(*) FROM clinics WHERE id = ANY($2::uuid[])) +
           (SELECT count(*) FROM users WHERE id = ANY($3::uuid[])) +
           (SELECT count(*) FROM user_clinic_assignments WHERE user_id = $4) +
           (SELECT count(*) FROM user_permission_grants WHERE user_id = $4)
         )::text AS count`,
        [
          [organisationAId, organisationBId],
          [clinicAId, clinicBId, clinicCId],
          [ownerId, gpmId, staffAId, staffBId, staffCId],
          gpmId,
        ],
      );
      expect(remaining.rows[0]?.count).toBe("0");
      await fixturePool.end();
    }
  }, 30_000);

  it("persists one correction and its database-timestamped audit event", async () => {
    await grantTimesheets(clinicAId);
    const id = await insertTimesheet(clinicAId, staffAId, "rejected");
    const beforeRequest = new Date();
    const response = await request(app)
      .patch(`/api/v1/clinics/${clinicAId}/timesheets/${id}/correct`)
      .set("Authorization", `Bearer ${tokenFor(gpmId, "group_practice_manager")}`)
      .send({
        clockInAt: "2028-05-31T21:30:00.000Z",
        clockOutAt: "2028-06-01T08:00:00.000Z",
        correctionReason: "  Verified paper record  ",
      });
    expect(response.status).toBe(200);

    const stored = await fixturePool.query<{
      clock_in_at: Date;
      total_hours_worked: string;
      timesheet_status: string;
      approved_by_user_id: string | null;
    }>("SELECT * FROM timesheet_entries WHERE id = $1", [id]);
    expect(stored.rows[0]).toMatchObject({
      clock_in_at: new Date("2028-05-31T21:30:00Z"),
      total_hours_worked: "10.00",
      timesheet_status: "submitted",
      approved_by_user_id: null,
    });
    const audit = await fixturePool.query<{
      actor_id: string;
      actor_email: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>("SELECT actor_id, actor_email, metadata, created_at FROM audit_events WHERE entity_id = $1", [id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_id: gpmId,
      actor_email: `${gpmId}@correction.test`,
      metadata: {
        reason: "Verified paper record",
        before: { status: "rejected" },
        after: { status: "submitted", totalHoursWorked: 10 },
      },
    });
    expect(audit.rows[0]?.created_at.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
  });

  it("rolls back the actual update when the audit insert fails", async () => {
    const id = await insertTimesheet(clinicAId, staffAId, "rejected");
    const before = await fixturePool.query("SELECT * FROM timesheet_entries WHERE id = $1", [id]);
    const { createPostgresTimesheetRepository } =
      await import("../src/repositories/timesheetRepository.postgres.js");
    const repository = createPostgresTimesheetRepository(appPool, () =>
      Promise.reject(new Error("injected audit failure after update")),
    );

    await expect(repository.correctWithAudit(correctionInput(id, clinicAId))).rejects.toThrow(
      "injected audit failure after update",
    );
    const after = await fixturePool.query("SELECT * FROM timesheet_entries WHERE id = $1", [id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const audit = await fixturePool.query("SELECT id FROM audit_events WHERE entity_id = $1", [id]);
    expect(audit.rows).toHaveLength(0);
  });

  it.each(["approved", "processed"] as const)(
    "rejects a %s write-time race without correction or audit",
    async (status) => {
      const id = await insertTimesheet(clinicAId, staffAId, "submitted");
      const before = await fixturePool.query("SELECT * FROM timesheet_entries WHERE id = $1", [id]);
      const { createPostgresTimesheetRepository } =
        await import("../src/repositories/timesheetRepository.postgres.js");
      const repository = createPostgresTimesheetRepository(appPool);
      // Simulate the service's validation read, followed by a concurrent payroll transition.
      expect((await repository.findById(id))?.timesheetStatus).toBe("submitted");
      await fixturePool.query(
        "UPDATE timesheet_entries SET timesheet_status = $2 WHERE id = $1",
        [id, status],
      );

      await expect(repository.correctWithAudit(correctionInput(id, clinicAId))).rejects.toMatchObject({
        statusCode: 409,
        code: "TIMESHEET_NOT_CORRECTABLE",
      });
      const after = await fixturePool.query("SELECT * FROM timesheet_entries WHERE id = $1", [id]);
      expect(after.rows[0]).toMatchObject({
        ...before.rows[0],
        timesheet_status: status,
      });
      const audit = await fixturePool.query("SELECT id FROM audit_events WHERE entity_id = $1", [id]);
      expect(audit.rows).toHaveLength(0);
    },
  );

  it("serializes concurrent corrections so each audit before-value is authoritative", async () => {
    const id = await insertTimesheet(clinicAId, staffAId, "submitted");
    const firstApplicationName = `correction-first-${randomUUID()}`;
    const secondApplicationName = `correction-second-${randomUUID()}`;
    const firstPool = new pg.Pool({
      connectionString: EXPECTED_DATABASE_URL,
      max: 1,
      application_name: firstApplicationName,
    });
    const secondPool = new pg.Pool({
      connectionString: EXPECTED_DATABASE_URL,
      max: 1,
      application_name: secondApplicationName,
    });
    let releaseFirstAudit = (): void => undefined;
    const firstAuditGate = new Promise<void>((resolve) => {
      releaseFirstAudit = resolve;
    });
    let signalFirstAudit = (): void => undefined;
    const firstAuditReached = new Promise<void>((resolve) => {
      signalFirstAudit = resolve;
    });
    const { createPostgresTimesheetRepository } =
      await import("../src/repositories/timesheetRepository.postgres.js");
    const firstRepository = createPostgresTimesheetRepository(
      firstPool,
      async (client, input) => {
        signalFirstAudit();
        await firstAuditGate;
        return insertAuditEvent(client, input);
      },
    );
    const secondRepository = createPostgresTimesheetRepository(secondPool);
    const firstInput = correctionInput(id, clinicAId);
    firstInput.auditEvent.metadata = { reason: "First concurrent correction" };
    const secondInput = correctionInput(id, clinicAId);
    secondInput.clockMutation = {
      ...secondInput.clockMutation,
      clockInAt: new Date("2028-05-31T21:00:00Z"),
      totalHoursWorked: 10.5,
      ordinaryHours: 8,
      overtime15xHours: 2.5,
    };
    secondInput.auditEvent.metadata = { reason: "Second concurrent correction" };

    let firstCorrection: Promise<unknown> | undefined;
    let secondCorrection: Promise<unknown> | undefined;
    try {
      firstCorrection = firstRepository.correctWithAudit(firstInput);
      await firstAuditReached;
      secondCorrection = secondRepository.correctWithAudit(secondInput);

      let secondIsWaitingForRowLock = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const waiting = await fixturePool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_stat_activity
              WHERE application_name = $1
                AND wait_event_type = 'Lock'
           ) AS waiting`,
          [secondApplicationName],
        );
        if (waiting.rows[0]?.waiting) {
          secondIsWaitingForRowLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(secondIsWaitingForRowLock).toBe(true);

      releaseFirstAudit();
      await Promise.all([firstCorrection, secondCorrection]);

      const audits = await fixturePool.query<{
        metadata: {
          reason: string;
          before: Record<string, unknown>;
          after: Record<string, unknown>;
        };
      }>("SELECT metadata FROM audit_events WHERE entity_id = $1", [id]);
      expect(audits.rows).toHaveLength(2);
      const firstAudit = audits.rows.find(
        (row) => row.metadata.reason === "First concurrent correction",
      );
      const secondAudit = audits.rows.find(
        (row) => row.metadata.reason === "Second concurrent correction",
      );
      expect(firstAudit?.metadata.before).toMatchObject({
        clockInAt: "2028-05-31T22:00:00.000Z",
        totalHoursWorked: 8,
        status: "submitted",
      });
      expect(firstAudit?.metadata.after).toMatchObject({
        clockInAt: "2028-05-31T21:30:00.000Z",
        totalHoursWorked: 10,
        status: "submitted",
      });
      expect(secondAudit?.metadata.before).toEqual(firstAudit?.metadata.after);
      expect(secondAudit?.metadata.after).toMatchObject({
        clockInAt: "2028-05-31T21:00:00.000Z",
        totalHoursWorked: 10.5,
        status: "submitted",
      });
    } finally {
      releaseFirstAudit();
      await Promise.allSettled(
        [firstCorrection, secondCorrection].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  });

  it("enforces live GPM assignment, permission, and organisation scope with one token", async () => {
    const token = tokenFor(gpmId, "group_practice_manager");
    const clinicBEntry = await insertTimesheet(clinicBId, staffBId, "submitted");
    await grantTimesheets(clinicBId);

    expect(
      (await request(app)
        .patch(`/api/v1/clinics/${clinicBId}/timesheets/${clinicBEntry}/correct`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clockInAt: "2028-05-31T21:30:00Z",
          clockOutAt: "2028-06-01T08:00:00Z",
          correctionReason: "Cross-clinic correction",
        })).status,
    ).toBe(403);

    await fixturePool.query(
      "UPDATE user_clinic_assignments SET can_operate = true WHERE user_id = $1 AND clinic_id = $2",
      [gpmId, clinicBId],
    );
    expect(
      (await request(app)
        .patch(`/api/v1/clinics/${clinicBId}/timesheets/${clinicBEntry}/correct`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clockInAt: "2028-05-31T21:30:00Z",
          clockOutAt: "2028-06-01T08:00:00Z",
          correctionReason: "Cross-clinic correction",
        })).status,
    ).toBe(200);

    await fixturePool.query(
      `UPDATE user_permission_grants
          SET revoked_at = now()
        WHERE user_id = $1 AND clinic_id = $2 AND permission = 'module:timesheets'`,
      [gpmId, clinicBId],
    );
    expect(
      (await request(app)
        .patch(`/api/v1/clinics/${clinicBId}/timesheets/${clinicBEntry}/correct`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clockInAt: "2028-05-31T21:00:00Z",
          clockOutAt: "2028-06-01T08:00:00Z",
          correctionReason: "Must now fail",
        })).status,
    ).toBe(403);

    const clinicCEntry = await insertTimesheet(clinicCId, staffCId, "submitted");
    await grantTimesheets(clinicCId);
    expect(
      (await request(app)
        .patch(`/api/v1/clinics/${clinicCId}/timesheets/${clinicCEntry}/correct`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clockInAt: "2028-05-31T21:30:00Z",
          clockOutAt: "2028-06-01T08:00:00Z",
          correctionReason: "Unrelated organisation",
        })).status,
    ).toBe(403);
  });

  it("allows atomic correction and audit under verve_app RLS only in the selected clinic", async () => {
    const allowedId = await insertTimesheet(clinicAId, staffAId, "submitted");
    const blockedId = await insertTimesheet(clinicAId, staffAId, "submitted");
    const rlsPool = new pg.Pool({
      connectionString: EXPECTED_DATABASE_URL,
      max: 1,
      options: "-c role=verve_app",
    });
    try {
      const { createPostgresTimesheetRepository } =
        await import("../src/repositories/timesheetRepository.postgres.js");
      const repository = createPostgresTimesheetRepository(rlsPool);
      const allowedInput = correctionInput(allowedId, clinicAId);
      allowedInput.ownerAdmin = false;

      await expect(repository.correctWithAudit(allowedInput)).resolves.toMatchObject({
        id: allowedId,
        clinicId: clinicAId,
        timesheetStatus: "submitted",
      });
      const allowedAudit = await fixturePool.query(
        "SELECT id FROM audit_events WHERE entity_id = $1",
        [allowedId],
      );
      expect(allowedAudit.rows).toHaveLength(1);

      const blockedBefore = await fixturePool.query(
        "SELECT * FROM timesheet_entries WHERE id = $1",
        [blockedId],
      );
      const blockedInput = correctionInput(blockedId, clinicBId);
      blockedInput.ownerAdmin = false;
      blockedInput.auditEvent.clinicId = clinicBId;
      await expect(repository.correctWithAudit(blockedInput)).rejects.toMatchObject({
        statusCode: 409,
        code: "TIMESHEET_NOT_CORRECTABLE",
      });
      const blockedAfter = await fixturePool.query(
        "SELECT * FROM timesheet_entries WHERE id = $1",
        [blockedId],
      );
      expect(blockedAfter.rows[0]).toEqual(blockedBefore.rows[0]);
      const blockedAudit = await fixturePool.query(
        "SELECT id FROM audit_events WHERE entity_id = $1",
        [blockedId],
      );
      expect(blockedAudit.rows).toHaveLength(0);
    } finally {
      await rlsPool.end();
    }
  });
});
