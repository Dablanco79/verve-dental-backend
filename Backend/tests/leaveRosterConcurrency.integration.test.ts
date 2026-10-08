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
  const cancellationIds: string[] = [];
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
    await pool.query("DELETE FROM leave_cancellation_requests WHERE id = ANY($1::uuid[])", [cancellationIds]);
    await pool.query("DELETE FROM leave_requests WHERE id = ANY($1::uuid[])", [leaveIds]);
    rosterIds.length = 0;
    cancellationIds.length = 0;
    leaveIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertApprovedLeave(date: string): Promise<string> {
    const leaveId = randomUUID();
    leaveIds.push(leaveId);
    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, 'staff@clinic-a.au', $3, 'annual', $4, $4, 1,
               'approved', $5, now())`,
      [
        leaveId,
        SEED_USER_IDS.clinicAStaff,
        SEED_CLINIC_A_ID,
        date,
        SEED_USER_IDS.clinicAManager,
      ],
    );
    return leaveId;
  }

  async function insertPendingCancellation(leaveId: string): Promise<string> {
    const requestId = randomUUID();
    cancellationIds.push(requestId);
    await pool.query(
      `INSERT INTO leave_cancellation_requests
         (id, leave_request_id, clinic_id, staff_user_id, requested_by_user_id, request_reason)
       VALUES ($1, $2, $3, $4, $4, 'Concurrent plans changed')`,
      [requestId, leaveId, SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff],
    );
    return requestId;
  }

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

  it("serializes approved-leave cancellation with concurrent roster creation", async () => {
    const leaveId = randomUUID();
    leaveIds.push(leaveId);
    const date = "2035-03-15";
    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_user_id, staff_email, clinic_id, leave_type,
          start_date, end_date, total_days, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, 'staff@clinic-a.au', $3, 'annual', $4, $4, 1,
               'approved', $5, now())`,
      [
        leaveId,
        SEED_USER_IDS.clinicAStaff,
        SEED_CLINIC_A_ID,
        date,
        SEED_USER_IDS.clinicAManager,
      ],
    );

    const leaveRepo = createPostgresLeaveRepository(pool);
    const rosterRepo = createPostgresRosterRepository(pool);
    const shiftPromise = rosterRepo.createEntry(
      {
        staffUserId: SEED_USER_IDS.clinicAStaff,
        staffEmail: "staff@clinic-a.au",
        rosteredClinicId: SEED_CLINIC_A_ID,
        rosteredClinicName: "Clinic A",
        shiftStartAt: new Date("2035-03-14T21:00:00.000Z"),
        shiftEndAt: new Date("2035-03-15T06:00:00.000Z"),
        shiftType: "standard",
        notes: null,
        createdByUserId: SEED_USER_IDS.clinicAAdmin,
        createdByEmail: "admin@clinic-a.au",
      },
      {
        windowStart: new Date("2035-03-14T21:00:00.000Z"),
        windowEnd: new Date("2035-03-15T06:00:00.000Z"),
        approvedLeaveWindow: { firstDate: date, lastDate: date },
      },
    );
    const cancellationPromise = leaveRepo.cancelApprovedLeave({
      leaveId,
      clinicId: SEED_CLINIC_A_ID,
      expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
      cancelledByUserId: SEED_USER_IDS.clinicAManager,
      cancellationReason: "Concurrent safety test",
    });

    const [shiftResult, cancellationResult] = await Promise.allSettled([
      shiftPromise,
      cancellationPromise,
    ]);
    expect(cancellationResult.status).toBe("fulfilled");
    if (cancellationResult.status !== "fulfilled") return;
    expect(cancellationResult.value.status).toBe("cancelled");

    if (shiftResult.status === "fulfilled") {
      rosterIds.push(shiftResult.value.id);
      expect(shiftResult.value.status).toBe("scheduled");
    } else {
      expect(shiftResult.reason).toBeInstanceOf(AppError);
      expect((shiftResult.reason as AppError).code).toBe("APPROVED_LEAVE_CONFLICT");
    }

    const persisted = await pool.query<{
      status: string;
      reviewed_by_user_id: string;
      reviewed_at: Date | null;
      cancelled_by_user_id: string;
      cancellation_reason: string;
    }>(
      `SELECT status, reviewed_by_user_id, reviewed_at,
              cancelled_by_user_id, cancellation_reason
         FROM leave_requests
        WHERE id = $1`,
      [leaveId],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: "cancelled",
      reviewed_by_user_id: SEED_USER_IDS.clinicAManager,
      cancelled_by_user_id: SEED_USER_IDS.clinicAManager,
      cancellation_reason: "Concurrent safety test",
    });
    expect(persisted.rows[0]?.reviewed_at).not.toBeNull();
  });

  it("serializes cancellation-request creation against direct cancellation", async () => {
    const leaveId = await insertApprovedLeave("2035-04-15");
    const leaveRepo = createPostgresLeaveRepository(pool);
    const [createResult, directResult] = await Promise.allSettled([
      leaveRepo.createCancellationRequest({
        leaveRequestId: leaveId,
        clinicId: SEED_CLINIC_A_ID,
        staffUserId: SEED_USER_IDS.clinicAStaff,
        requestedByUserId: SEED_USER_IDS.clinicAStaff,
        requestReason: "Concurrent request",
      }),
      leaveRepo.cancelApprovedLeave({
        leaveId,
        clinicId: SEED_CLINIC_A_ID,
        expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
        cancelledByUserId: SEED_USER_IDS.clinicAManager,
        cancellationReason: "Concurrent direct cancellation",
      }),
    ]);

    expect([createResult, directResult].filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    if (createResult.status === "fulfilled") {
      cancellationIds.push(createResult.value.id);
      expect(directResult.status).toBe("rejected");
      expect((directResult as PromiseRejectedResult).reason).toMatchObject({
        code: "PENDING_CANCELLATION_REQUEST",
      });
    } else {
      expect(directResult.status).toBe("fulfilled");
      expect(createResult.reason).toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    }
  });

  it("allows exactly one concurrent approve-or-decline decision", async () => {
    const leaveId = await insertApprovedLeave("2035-05-15");
    const requestId = await insertPendingCancellation(leaveId);
    const leaveRepo = createPostgresLeaveRepository(pool);
    const review = {
      requestId,
      leaveId,
      clinicId: SEED_CLINIC_A_ID,
      expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
      reviewedByUserId: SEED_USER_IDS.clinicAManager,
      reviewNotes: "Concurrent decision",
      selfReviewExceptionUsed: false,
    };
    const [approveResult, declineResult] = await Promise.allSettled([
      leaveRepo.approveCancellationRequest(review),
      leaveRepo.declineCancellationRequest(review),
    ]);

    expect([approveResult, declineResult].filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    const persisted = await pool.query<{ child_status: string; parent_status: string }>(
      `SELECT c.status::text AS child_status, l.status::text AS parent_status
         FROM leave_cancellation_requests c
         JOIN leave_requests l ON l.id = c.leave_request_id
        WHERE c.id = $1`,
      [requestId],
    );
    if (approveResult.status === "fulfilled") {
      expect(persisted.rows[0]).toEqual({
        child_status: "approved",
        parent_status: "cancelled",
      });
    } else {
      expect(persisted.rows[0]).toEqual({
        child_status: "declined",
        parent_status: "approved",
      });
    }
  });

  it("serializes cancellation approval against roster creation", async () => {
    const date = "2035-06-15";
    const leaveId = await insertApprovedLeave(date);
    const requestId = await insertPendingCancellation(leaveId);
    const leaveRepo = createPostgresLeaveRepository(pool);
    const rosterRepo = createPostgresRosterRepository(pool);
    const [approvalResult, rosterResult] = await Promise.allSettled([
      leaveRepo.approveCancellationRequest({
        requestId,
        leaveId,
        clinicId: SEED_CLINIC_A_ID,
        expectedStaffUserId: SEED_USER_IDS.clinicAStaff,
        reviewedByUserId: SEED_USER_IDS.clinicAManager,
        reviewNotes: null,
        selfReviewExceptionUsed: false,
      }),
      rosterRepo.createEntry(
        {
          staffUserId: SEED_USER_IDS.clinicAStaff,
          staffEmail: "staff@clinic-a.au",
          rosteredClinicId: SEED_CLINIC_A_ID,
          rosteredClinicName: "Clinic A",
          shiftStartAt: new Date("2035-06-14T21:00:00.000Z"),
          shiftEndAt: new Date("2035-06-15T06:00:00.000Z"),
          shiftType: "standard",
          notes: null,
          createdByUserId: SEED_USER_IDS.clinicAAdmin,
          createdByEmail: "admin@clinic-a.au",
        },
        {
          windowStart: new Date("2035-06-14T21:00:00.000Z"),
          windowEnd: new Date("2035-06-15T06:00:00.000Z"),
          approvedLeaveWindow: { firstDate: date, lastDate: date },
        },
      ),
    ]);

    expect(approvalResult.status).toBe("fulfilled");
    if (rosterResult.status === "fulfilled") {
      rosterIds.push(rosterResult.value.id);
      expect(rosterResult.value.status).toBe("scheduled");
    } else {
      expect(rosterResult.reason).toMatchObject({ code: "APPROVED_LEAVE_CONFLICT" });
    }
    const parent = await pool.query<{ status: string }>(
      "SELECT status::text FROM leave_requests WHERE id = $1",
      [leaveId],
    );
    expect(parent.rows[0]?.status).toBe("cancelled");
  });

  it("enforces child-row RLS isolation for staff identity and clinic", async () => {
    const leaveId = await insertApprovedLeave("2035-07-15");
    const requestId = await insertPendingCancellation(leaveId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE verve_app");
      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.owner_admin_mode', 'false', true),
                set_config('app.current_user_id', $2, true)`,
        [SEED_CLINIC_A_ID, SEED_USER_IDS.clinicAStaff],
      );
      const own = await client.query(
        "SELECT id FROM leave_cancellation_requests WHERE id = $1",
        [requestId],
      );
      expect(own.rowCount).toBe(1);

      await client.query(
        "SELECT set_config('app.current_user_id', $1, true)",
        [SEED_USER_IDS.clinicAManager],
      );
      const otherUser = await client.query(
        "SELECT id FROM leave_cancellation_requests WHERE id = $1",
        [requestId],
      );
      expect(otherUser.rowCount).toBe(0);

      await client.query(
        `SELECT set_config('app.current_clinic_id', $1, true),
                set_config('app.current_user_id', $2, true)`,
        ["22222222-2222-4222-8222-222222222222", SEED_USER_IDS.clinicAStaff],
      );
      const otherClinic = await client.query(
        "SELECT id FROM leave_cancellation_requests WHERE id = $1",
        [requestId],
      );
      expect(otherClinic.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
