import { randomUUID } from "node:crypto";
import pg from "pg";

import { createPostgresLeaveRepository } from "../src/repositories/leaveRepository.postgres.js";
import { createPostgresRosterRepository } from "../src/repositories/rosterRepository.postgres.js";
import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import type { DatabasePool } from "../src/db/pool.js";
import { AppError } from "../src/types/errors.js";

const DB_URL = process.env["TEST_DATABASE_URL"];

describe("Leave/roster person-lock concurrency (Postgres)", () => {
  if (!DB_URL) {
    it.skip("TEST_DATABASE_URL not configured", () => undefined);
    return;
  }

  let pool: DatabasePool;
  const leaveIds: string[] = [];
  const rosterIds: string[] = [];

  beforeAll(() => {
    const parsed = new URL(DB_URL);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("Concurrency integration tests require an isolated local test database");
    }
    pool = new pg.Pool({ connectionString: DB_URL, max: 8 });
  });

  afterEach(async () => {
    await pool.query("DELETE FROM roster_entry_audit WHERE roster_entry_id = ANY($1::uuid[])", [rosterIds]);
    await pool.query("DELETE FROM roster_entries WHERE id = ANY($1::uuid[])", [rosterIds]);
    await pool.query("DELETE FROM leave_requests WHERE id = ANY($1::uuid[])", [leaveIds]);
    rosterIds.length = 0;
    leaveIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("serializes simultaneous approval/create without an unreported conflicting shift", async () => {
    const leaveId = randomUUID();
    leaveIds.push(leaveId);
    const date = "2035-01-15";
    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, reason, status)
       VALUES ($1, $2, 'staff@clinic-a.au', $3, 'annual', $4, $4, 1, 'Concurrency', 'pending')`,
      [leaveId, SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID, date],
    );

    const leaveRepo = createPostgresLeaveRepository(pool);
    const rosterRepo = createPostgresRosterRepository(pool);
    const shiftIdPromise = rosterRepo.createEntry(
      {
        staffUserId: SEED_USER_IDS.clinicAStaff,
        staffEmail: "staff@clinic-a.au",
        rosteredClinicId: SEED_CLINIC_A_ID,
        rosteredClinicName: "Clinic A",
        shiftStartAt: new Date("2035-01-14T21:00:00.000Z"),
        shiftEndAt: new Date("2035-01-15T06:00:00.000Z"),
        shiftType: "standard",
        notes: null,
        createdByUserId: SEED_USER_IDS.clinicAAdmin,
        createdByEmail: "admin@clinic-a.au",
      },
      {
        windowStart: new Date("2035-01-14T21:00:00.000Z"),
        windowEnd: new Date("2035-01-15T06:00:00.000Z"),
        approvedLeaveWindow: { firstDate: date, lastDate: date },
      },
    );
    const approvalPromise = leaveRepo.approveWithRosterConflicts({
      leaveId,
      clinicId: SEED_CLINIC_A_ID,
      expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
      reviewedByUserId: SEED_USER_IDS.clinicAManager,
      reviewNotes: null,
      timeZone: "Australia/Melbourne",
    });

    const [shiftResult, approvalResult] = await Promise.allSettled([
      shiftIdPromise,
      approvalPromise,
    ]);
    expect(approvalResult.status).toBe("fulfilled");
    if (approvalResult.status !== "fulfilled") return;

    if (shiftResult.status === "fulfilled") {
      rosterIds.push(shiftResult.value.id);
      expect(approvalResult.value.conflicts.map((conflict) => conflict.rosterEntryId))
        .toContain(shiftResult.value.id);
      expect(shiftResult.value.status).toBe("scheduled");
    } else {
      expect(shiftResult.reason).toBeInstanceOf(AppError);
      expect((shiftResult.reason as AppError).code).toBe("APPROVED_LEAVE_CONFLICT");
      expect(approvalResult.value.conflicts).toHaveLength(0);
    }

    const persisted = await pool.query<{ status: string }>(
      "SELECT status FROM leave_requests WHERE id = $1",
      [leaveId],
    );
    expect(persisted.rows[0]?.status).toBe("approved");
  });

  it("privileged approval lookup returns only the authorized leave owner's shifts", async () => {
    const leaveId = randomUUID();
    const targetShiftId = randomUUID();
    const unrelatedShiftId = randomUUID();
    leaveIds.push(leaveId);
    rosterIds.push(targetShiftId, unrelatedShiftId);

    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, status)
       VALUES ($1, $2, 'staff@clinic-a.au', $3, 'annual', '2035-02-01', '2035-02-01', 1, 'pending')`,
      [leaveId, SEED_USER_IDS.clinicAStaff, SEED_CLINIC_A_ID],
    );
    await pool.query(
      `INSERT INTO roster_entries
         (id, staff_user_id, staff_email, rostered_clinic_id, rostered_clinic_name,
          shift_start_at, shift_end_at, shift_type, status, created_by_user_id)
       VALUES
         ($1, $2, 'staff@clinic-a.au', $4, 'Clinic A',
          '2035-01-31T21:00:00Z', '2035-02-01T06:00:00Z', 'standard', 'scheduled', $5),
         ($3, $5, 'manager@clinic-a.au', $4, 'Clinic A',
          '2035-01-31T21:00:00Z', '2035-02-01T06:00:00Z', 'standard', 'scheduled', $5)`,
      [
        targetShiftId,
        SEED_USER_IDS.clinicAStaff,
        unrelatedShiftId,
        SEED_CLINIC_A_ID,
        SEED_USER_IDS.clinicAManager,
      ],
    );

    const result = await createPostgresLeaveRepository(pool).approveWithRosterConflicts({
      leaveId,
      clinicId: SEED_CLINIC_A_ID,
      expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
      reviewedByUserId: SEED_USER_IDS.clinicAManager,
      reviewNotes: null,
      timeZone: "Australia/Melbourne",
    });

    expect(result.conflicts.map((conflict) => conflict.rosterEntryId)).toEqual([targetShiftId]);
  });
});
