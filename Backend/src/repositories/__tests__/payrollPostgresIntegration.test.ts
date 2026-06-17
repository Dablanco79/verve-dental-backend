/**
 * payrollPostgresIntegration.test.ts
 *
 * Mocked-pool integration tests for the PostgreSQL leave and timesheet
 * repositories.  No real database connection is required — a jest.fn() pool
 * stub intercepts every pool.query() call so the tests run fully in-process.
 *
 * Coverage goals
 * ──────────────
 * 1. Mapper fidelity
 *      - numeric(6,2) DB strings → JS numbers (parseFloat)
 *      - date DB strings → preserved as 'YYYY-MM-DD' TypeScript strings
 *      - timestamptz DB values → Date objects pass-through
 *      - overtime_1_5x_hours  → overtime15xHours  (critical column rename)
 *      - overtime_2x_hours    → overtime2xHours   (critical column rename)
 *      - snake_case → camelCase for every field in both row types
 *
 * 2. Leave query builder
 *      - listByClinic / listByStaff date overlap semantics:
 *          from  →  end_date >= $n::date   (not start_date!)
 *          to    →  start_date <= $n::date (not end_date!)
 *      - findApprovedOverlap predicate uses a single $2 param for both sides
 *
 * 3. Timesheet create — initialTimesheetStatus routing
 *      - commission_log  → param $20 === null
 *      - hourly_auto     → param $20 === 'draft'
 *      - hourly_manual   → param $20 === 'draft'
 *      - overtime15xHours lands at INSERT param index 16  ($17)
 *      - overtime2xHours  lands at INSERT param index 17  ($18)
 *
 * 4. Timesheet dynamic SET builder (update)
 *      - undefined field → column absent from SET clause + params
 *      - null field      → column present in SET, null in params
 *      - value field     → column present in SET, value in params
 *      - overtime15xHours → overtime_1_5x_hours  in SET
 *      - overtime2xHours  → overtime_2x_hours    in SET
 *      - updated_at = now() is always the first SET term
 *      - id is always the last element of the params array
 *
 * 5. getForecastLogs SQL contract
 *      - param[0] = rosteredClinicId (not clinicId)
 *      - param[1] = date
 *      - SQL hardcodes payroll_type = 'commission_log'
 *      - SQL uses IN ('present', 'absent', 'sick')
 *      - SQL never mentions 'pending_verification' or 'cancelled'
 *
 * 6. listByClinic (timesheets) option handling
 *      - pendingApprovalOnly: true  → hardcoded "timesheet_status = 'submitted'"
 *      - pendingApprovalOnly overrides any timesheetStatus filter
 *      - shiftDate is mutually exclusive with from/to range
 */

// In Jest's ESM mode the `jest` namespace object (jest.fn, jest.Mock, etc.)
// must be imported explicitly — it is not auto-injected as a global the way
// describe / it / expect are.
import { jest } from "@jest/globals";
import { createPostgresLeaveRepository } from "../leaveRepository.postgres.js";
import { createPostgresTimesheetRepository } from "../timesheetRepository.postgres.js";
import type { DatabasePool } from "../../db/pool.js";
import type { CreateTimesheetEntryInput } from "../../types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock pool factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a stub DatabasePool whose query() method resolves with `rows`.
 * Exposes the raw jest.Mock as `query` so tests can inspect call arguments.
 *
 * Jest 29 (@jest/globals) tightens mockResolvedValue's generic inference and
 * rejects the plain object literal unless the return type is pinned.  Casting
 * to `never` is the standard test-code escape hatch — runtime behaviour is
 * unchanged because the cast exists only at compile time.
 */
function makeMockPool(rows: unknown[] = []) {
  const query = jest.fn().mockResolvedValue(
    { rows, rowCount: rows.length } as never,
  );
  const pool = { query } as unknown as DatabasePool;
  return { pool, query };
}

/**
 * Retrieves the SQL string and params array from the most recent pool.query call.
 * Typed as [string, unknown[]] since that is the only overload used by these repos.
 */
function lastCall(query: jest.Mock): [string, unknown[]] {
  const call = query.mock.calls[query.mock.calls.length - 1] as [
    string,
    unknown[],
  ];
  return call;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture rows — shaped exactly as node-postgres returns them
// (date → string, numeric → string, timestamptz → Date)
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ROSTERED_CLINIC_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_USER_ID = "cccccccc-0000-0000-0000-000000000003";
const MANAGER_USER_ID = "dddddddd-0000-0000-0000-000000000004";
const ROSTER_ENTRY_ID = "eeeeeeee-0000-0000-0000-000000000005";
const TIMESHEET_ID = "ffffffff-0000-0000-0000-000000000006";
const LEAVE_ID = "11111111-0000-0000-0000-000000000007";

const SHIFT_DATE = "2026-07-15";
const START_DATE = "2026-07-01";
const END_DATE = "2026-07-05";

const CREATED_AT = new Date("2026-06-01T00:00:00.000Z");
const UPDATED_AT = new Date("2026-06-01T01:00:00.000Z");
const SHIFT_START = new Date(`${SHIFT_DATE}T08:00:00.000Z`);
const SHIFT_END = new Date(`${SHIFT_DATE}T17:00:00.000Z`);
const CLOCK_IN = new Date(`${SHIFT_DATE}T08:02:00.000Z`);
const CLOCK_OUT = new Date(`${SHIFT_DATE}T17:05:00.000Z`);

/** A complete leave_requests row as returned by node-postgres. */
const LEAVE_ROW = {
  id: LEAVE_ID,
  staff_user_id: STAFF_USER_ID,
  staff_email: "staff@clinic-a.au",
  clinic_id: CLINIC_ID,
  leave_type: "annual",
  start_date: START_DATE,    // DB 'date' → 'YYYY-MM-DD' string
  end_date: END_DATE,        // DB 'date' → 'YYYY-MM-DD' string
  total_days: "5.00",        // DB numeric(6,2) → string
  reason: "Family holiday",
  status: "pending",
  reviewed_by_user_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
};

/** A commission_log timesheet row as returned by node-postgres. */
const COMMISSION_ROW = {
  id: TIMESHEET_ID,
  payroll_type: "commission_log",
  staff_user_id: STAFF_USER_ID,
  staff_email: "provider@clinic-a.au",
  clinic_id: CLINIC_ID,
  rostered_clinic_id: ROSTERED_CLINIC_ID,
  rostered_clinic_name: "Verve Dental Clinic B",
  roster_entry_id: ROSTER_ENTRY_ID,
  shift_date: SHIFT_DATE,     // DB 'date' → 'YYYY-MM-DD' string
  shift_start_at: SHIFT_START,
  shift_end_at: SHIFT_END,
  attendance_status: "pending_verification",
  clock_in_at: null,
  clock_out_at: null,
  break_duration_minutes: null,
  total_hours_worked: null,    // null for commission_log
  ordinary_hours: null,
  overtime_1_5x_hours: null,
  overtime_2x_hours: null,
  overtime_custom_hours: null,
  timesheet_status: null,      // null for commission_log
  approved_by_user_id: null,
  approved_at: null,
  approval_notes: null,
  commission_note: null,
  generated_by: "system_auto",
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
};

/** An hourly_auto timesheet row — all five numeric columns populated. */
const HOURLY_ROW = {
  ...COMMISSION_ROW,
  id: "hourly-000-0000-0000-000000000001",
  payroll_type: "hourly_auto",
  attendance_status: "present",
  clock_in_at: CLOCK_IN,
  clock_out_at: CLOCK_OUT,
  break_duration_minutes: 30,             // integer → JS number
  total_hours_worked: "8.55",             // numeric(6,2) → string
  ordinary_hours: "8.00",                 // numeric(6,2) → string
  overtime_1_5x_hours: "0.55",           // numeric(6,2) → string  (column name uses _1_5x_)
  overtime_2x_hours: "0.00",             // numeric(6,2) → string  (column name uses _2x_)
  overtime_custom_hours: "0.00",         // numeric(6,2) → string
  timesheet_status: "draft",
};

// ─────────────────────────────────────────────────────────────────────────────
// PostgresLeaveRepository
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresLeaveRepository — mapper fidelity", () => {
  it("parses numeric(6,2) total_days string to a JS number", async () => {
    const { pool } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.totalDays).toBe(5);
    expect(typeof result?.totalDays).toBe("number");
  });

  it("parses a half-day total_days string '0.50' to 0.5", async () => {
    const row = { ...LEAVE_ROW, total_days: "0.50" };
    const { pool } = makeMockPool([row]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.totalDays).toBe(0.5);
  });

  it("preserves start_date and end_date as YYYY-MM-DD strings without conversion", async () => {
    const { pool } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.startDate).toBe(START_DATE);
    expect(result?.endDate).toBe(END_DATE);
    expect(result?.startDate).not.toBeInstanceOf(Date);
    expect(result?.endDate).not.toBeInstanceOf(Date);
  });

  it("maps all snake_case DB columns to camelCase TypeScript fields", async () => {
    const { pool } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.id).toBe(LEAVE_ID);
    expect(result?.staffUserId).toBe(STAFF_USER_ID);
    expect(result?.staffEmail).toBe("staff@clinic-a.au");
    expect(result?.clinicId).toBe(CLINIC_ID);
    expect(result?.leaveType).toBe("annual");
    expect(result?.reason).toBe("Family holiday");
    expect(result?.status).toBe("pending");
    expect(result?.createdAt).toBe(CREATED_AT);
    expect(result?.updatedAt).toBe(UPDATED_AT);
  });

  it("maps null review fields directly (pending request has no reviewer)", async () => {
    const { pool } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.reviewedByUserId).toBeNull();
    expect(result?.reviewedAt).toBeNull();
    expect(result?.reviewNotes).toBeNull();
  });

  it("maps populated review fields for an approved request", async () => {
    const approvedAt = new Date("2026-06-10T09:00:00.000Z");
    const row = {
      ...LEAVE_ROW,
      status: "approved",
      reviewed_by_user_id: MANAGER_USER_ID,
      reviewed_at: approvedAt,
      review_notes: "Approved — enjoy your holiday",
    };
    const { pool } = makeMockPool([row]);
    const repo = createPostgresLeaveRepository(pool);

    const result = await repo.findById(LEAVE_ID);

    expect(result?.status).toBe("approved");
    expect(result?.reviewedByUserId).toBe(MANAGER_USER_ID);
    expect(result?.reviewedAt).toBe(approvedAt);
    expect(result?.reviewNotes).toBe("Approved — enjoy your holiday");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresLeaveRepository — listByClinic date overlap semantics", () => {
  /**
   * The critical overlap rule:
   *   A leave request overlaps a window [from, to] when:
   *     end_date   >= from  (leave has not ended before the window starts)
   *     start_date <= to    (leave has not started after the window ends)
   *
   * Using start_date >= from would INCORRECTLY exclude leave that started
   * before 'from' but extends into the window.
   */

  it("with no options: only clinic_id = $1 in WHERE", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID);

    const [sql, params] = lastCall(query);
    expect(sql).toContain("clinic_id = $1");
    expect(sql).not.toContain("end_date");
    expect(sql).not.toContain("start_date <=");
    expect(params).toEqual([CLINIC_ID]);
  });

  it("from option: uses end_date >= $n::date (not start_date)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID, { from: "2026-07-01" });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("end_date >= $2::date");
    expect(sql).not.toContain("start_date >=");
    expect(params[1]).toBe("2026-07-01");
  });

  it("to option: uses start_date <= $n::date (not end_date)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID, { to: "2026-07-31" });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("start_date <= $2::date");
    expect(sql).not.toContain("end_date <=");
    expect(params[1]).toBe("2026-07-31");
  });

  it("from + to: generates both overlap conditions in order", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("end_date >= $2::date");
    expect(sql).toContain("start_date <= $3::date");
    expect(params).toEqual([CLINIC_ID, "2026-07-01", "2026-07-31"]);
  });

  it("all four filters combined: five conditions, five params", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID, {
      status: "approved",
      leaveType: "annual",
      from: "2026-07-01",
      to: "2026-07-31",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("clinic_id = $1");
    expect(sql).toContain("status = $2");
    expect(sql).toContain("leave_type = $3");
    expect(sql).toContain("end_date >= $4::date");
    expect(sql).toContain("start_date <= $5::date");
    expect(params).toEqual([
      CLINIC_ID,
      "approved",
      "annual",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("listByStaff from/to uses the same overlap semantics as listByClinic", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByStaff(STAFF_USER_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("end_date >= $2::date");
    expect(sql).toContain("start_date <= $3::date");
    expect(params[0]).toBe(STAFF_USER_ID);
  });

  it("results are ordered by start_date DESC", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.listByClinic(CLINIC_ID);

    const [sql] = lastCall(query);
    expect(sql.toLowerCase()).toContain("order by start_date desc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresLeaveRepository — findApprovedOverlap", () => {
  it("passes staffUserId as $1 and date as $2 (used twice in SQL)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-04");

    const [, params] = lastCall(query);
    expect(params).toEqual([STAFF_USER_ID, "2026-07-04"]);
    expect(params).toHaveLength(2);
  });

  it("SQL hardcodes status = 'approved' (not a parameterised placeholder)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-04");

    const [sql] = lastCall(query);
    expect(sql).toContain("status = 'approved'");
  });

  it("SQL uses start_date <= $2::date AND end_date >= $2::date for the overlap", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-04");

    const [sql] = lastCall(query);
    expect(sql).toContain("start_date <= $2::date");
    expect(sql).toContain("end_date   >= $2::date");
  });

  it("returns mapped domain objects from the DB rows", async () => {
    const { pool } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    const results = await repo.findApprovedOverlap(STAFF_USER_ID, START_DATE);

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(LEAVE_ID);
    expect(results[0]?.totalDays).toBe(5); // numeric string parsed
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresLeaveRepository — updateStatus", () => {
  it("passes status, reviewedByUserId, reviewNotes, id in correct param order", async () => {
    const { pool, query } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.updateStatus(LEAVE_ID, {
      status: "approved",
      reviewedByUserId: MANAGER_USER_ID,
      reviewNotes: "Looks good",
    });

    const [, params] = lastCall(query);
    expect(params[0]).toBe("approved");
    expect(params[1]).toBe(MANAGER_USER_ID);
    expect(params[2]).toBe("Looks good");
    expect(params[3]).toBe(LEAVE_ID);
  });

  it("passes null for reviewNotes when undefined is provided", async () => {
    const { pool, query } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.updateStatus(LEAVE_ID, {
      status: "approved",
      reviewedByUserId: MANAGER_USER_ID,
      reviewNotes: null,
    });

    const [, params] = lastCall(query);
    expect(params[2]).toBeNull();
  });

  it("SQL sets reviewed_at = now() server-side (not a JS param)", async () => {
    const { pool, query } = makeMockPool([LEAVE_ROW]);
    const repo = createPostgresLeaveRepository(pool);

    await repo.updateStatus(LEAVE_ID, {
      status: "rejected",
      reviewedByUserId: MANAGER_USER_ID,
      reviewNotes: "Not enough cover",
    });

    const [sql] = lastCall(query);
    expect(sql).toContain("reviewed_at         = now()");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — mapper fidelity
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — mapper fidelity (hourly_auto row)", () => {
  it("parses all five numeric(6,2) string columns to JS numbers", async () => {
    const { pool } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.totalHoursWorked).toBe(8.55);
    expect(result?.ordinaryHours).toBe(8);
    expect(result?.overtime15xHours).toBe(0.55);
    expect(result?.overtime2xHours).toBe(0);
    expect(result?.overtimeCustomHours).toBe(0);
    expect(typeof result?.totalHoursWorked).toBe("number");
  });

  it("maps overtime_1_5x_hours (DB) → overtime15xHours (TS) correctly", async () => {
    const row = { ...HOURLY_ROW, overtime_1_5x_hours: "1.50" };
    const { pool } = makeMockPool([row]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.overtime15xHours).toBe(1.5);
    // Ensure the raw DB column name did not leak into the domain object
    expect((result as Record<string, unknown>).overtime_1_5x_hours).toBeUndefined();
  });

  it("maps overtime_2x_hours (DB) → overtime2xHours (TS) correctly", async () => {
    const row = { ...HOURLY_ROW, overtime_2x_hours: "2.00" };
    const { pool } = makeMockPool([row]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.overtime2xHours).toBe(2);
    expect((result as Record<string, unknown>).overtime_2x_hours).toBeUndefined();
  });

  it("preserves shift_date as 'YYYY-MM-DD' string (DB date type)", async () => {
    const { pool } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.shiftDate).toBe(SHIFT_DATE);
    expect(result?.shiftDate).not.toBeInstanceOf(Date);
  });

  it("passes timestamptz fields through as Date objects", async () => {
    const { pool } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.shiftStartAt).toBe(SHIFT_START);
    expect(result?.shiftEndAt).toBe(SHIFT_END);
    expect(result?.clockInAt).toBe(CLOCK_IN);
    expect(result?.clockOutAt).toBe(CLOCK_OUT);
    expect(result?.createdAt).toBe(CREATED_AT);
  });

  it("integer break_duration_minutes comes through as a JS number", async () => {
    const { pool } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.breakDurationMinutes).toBe(30);
    expect(typeof result?.breakDurationMinutes).toBe("number");
  });

  it("maps all snake_case columns to camelCase for the hourly row", async () => {
    const { pool } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.payrollType).toBe("hourly_auto");
    expect(result?.staffUserId).toBe(STAFF_USER_ID);
    expect(result?.staffEmail).toBe("provider@clinic-a.au");
    expect(result?.clinicId).toBe(CLINIC_ID);
    expect(result?.rosteredClinicId).toBe(ROSTERED_CLINIC_ID);
    expect(result?.rosteredClinicName).toBe("Verve Dental Clinic B");
    expect(result?.rosterEntryId).toBe(ROSTER_ENTRY_ID);
    expect(result?.timesheetStatus).toBe("draft");
    expect(result?.generatedBy).toBe("system_auto");
  });
});

describe("PostgresTimesheetRepository — mapper fidelity (commission_log row)", () => {
  it("maps all five numeric columns to null for commission_log", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.totalHoursWorked).toBeNull();
    expect(result?.ordinaryHours).toBeNull();
    expect(result?.overtime15xHours).toBeNull();
    expect(result?.overtime2xHours).toBeNull();
    expect(result?.overtimeCustomHours).toBeNull();
  });

  it("timesheetStatus is null for commission_log entries", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.timesheetStatus).toBeNull();
  });

  it("clock fields are null for commission_log entries", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.clockInAt).toBeNull();
    expect(result?.clockOutAt).toBeNull();
    expect(result?.breakDurationMinutes).toBeNull();
  });

  it("attendanceStatus is 'pending_verification' for a fresh commission_log", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findById(TIMESHEET_ID);

    expect(result?.attendanceStatus).toBe("pending_verification");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — create: initialTimesheetStatus and param order
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — create: initialTimesheetStatus routing", () => {
  /** Builds a minimal CreateTimesheetEntryInput for the given payrollType. */
  function makeInput(
    payrollType: "commission_log" | "hourly_auto" | "hourly_manual",
  ): CreateTimesheetEntryInput {
    const base = {
      staffUserId: STAFF_USER_ID,
      staffEmail: "staff@clinic.au",
      clinicId: CLINIC_ID,
      rosteredClinicId: ROSTERED_CLINIC_ID,
      rosteredClinicName: "Verve Dental Clinic B",
      rosterEntryId: null,
      shiftDate: SHIFT_DATE,
      shiftStartAt: SHIFT_START,
      shiftEndAt: SHIFT_END,
      attendanceStatus: "present" as const,
      generatedBy: "system_auto",
      clockInAt: null,
      clockOutAt: null,
      breakDurationMinutes: null,
      totalHoursWorked: null,
      ordinaryHours: null,
      overtime15xHours: null,
      overtime2xHours: null,
      overtimeCustomHours: null,
      commissionNote: null,
    };

    if (payrollType === "commission_log") {
      return { ...base, payrollType: "commission_log", attendanceStatus: "pending_verification" };
    }
    return { ...base, payrollType };
  }

  // In the INSERT, $20 (index 19) is the initialTimesheetStatus.
  // $17 (index 16) = overtime_1_5x_hours   (overtime15xHours)
  // $18 (index 17) = overtime_2x_hours     (overtime2xHours)

  it("commission_log: INSERT param at index 19 ($20) is null", async () => {
    const { pool, query } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(makeInput("commission_log"));

    const [, params] = lastCall(query);
    expect(params[19]).toBeNull();
  });

  it("hourly_auto: INSERT param at index 19 ($20) is 'draft'", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(makeInput("hourly_auto"));

    const [, params] = lastCall(query);
    expect(params[19]).toBe("draft");
  });

  it("hourly_manual: INSERT param at index 19 ($20) is 'draft'", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(makeInput("hourly_manual"));

    const [, params] = lastCall(query);
    expect(params[19]).toBe("draft");
  });

  it("overtime15xHours lands at INSERT param index 16 ($17 = overtime_1_5x_hours)", async () => {
    const input = { ...makeInput("hourly_auto"), overtime15xHours: 0.75 };
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(input);

    const [, params] = lastCall(query);
    expect(params[16]).toBe(0.75);
  });

  it("overtime2xHours lands at INSERT param index 17 ($18 = overtime_2x_hours)", async () => {
    const input = { ...makeInput("hourly_auto"), overtime2xHours: 1.5 };
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(input);

    const [, params] = lastCall(query);
    expect(params[17]).toBe(1.5);
  });

  it("null rosterEntryId is passed as null (not undefined)", async () => {
    const { pool, query } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(makeInput("commission_log"));

    const [, params] = lastCall(query);
    expect(params[6]).toBeNull(); // index 6 = roster_entry_id ($7)
  });

  it("INSERT has exactly 22 params matching the 22-column INSERT statement", async () => {
    const { pool, query } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.create(makeInput("commission_log"));

    const [, params] = lastCall(query);
    expect(params).toHaveLength(22);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — dynamic SET builder (update)
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — update: dynamic SET builder", () => {
  it("always includes 'updated_at = now()' as the first SET term", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, { attendanceStatus: "present" });

    const [sql] = lastCall(query);
    expect(sql).toContain("updated_at = now()");
    // Must appear before any other SET assignment
    expect(sql.indexOf("updated_at = now()")).toBeLessThan(
      sql.indexOf("attendance_status"),
    );
  });

  it("id is always the last element of the params array", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, { attendanceStatus: "present", commissionNote: "note" });

    const [, params] = lastCall(query);
    expect(params[params.length - 1]).toBe(TIMESHEET_ID);
  });

  it("undefined field is absent from both the SET clause and params", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    // approvalNotes is NOT provided → should be absent
    await repo.update(TIMESHEET_ID, { attendanceStatus: "present" });

    const [sql, params] = lastCall(query);
    expect(sql).not.toContain("approval_notes");
    // params: one for attendanceStatus + one for id = 2 total
    expect(params).toHaveLength(2);
  });

  it("null field IS included in SET clause and params (explicit null write)", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    // Explicitly setting approvedByUserId to null (e.g. un-assigning)
    await repo.update(TIMESHEET_ID, { approvedByUserId: null });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("approved_by_user_id");
    // params: null value + id = 2 total; null is at index 0
    expect(params[0]).toBeNull();
    expect(params).toHaveLength(2);
  });

  it("maps overtime15xHours → overtime_1_5x_hours in the SET clause", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, { overtime15xHours: 1.5 });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("overtime_1_5x_hours");
    expect(sql).not.toContain("overtime15xHours"); // raw TS name must not leak into SQL
    expect(params[0]).toBe(1.5);
  });

  it("maps overtime2xHours → overtime_2x_hours in the SET clause", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, { overtime2xHours: 2.0 });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("overtime_2x_hours");
    expect(sql).not.toContain("overtime2xHours"); // raw TS name must not leak
    expect(params[0]).toBe(2.0);
  });

  it("all optional fields via clockMutation: SET has 15 terms, params has 14 entries", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const approvedAt = new Date();
    await repo.update(TIMESHEET_ID, {
      attendanceStatus: "present",
      timesheetStatus: "approved",
      clockMutation: {
        clockOutAt: CLOCK_OUT,
        breakDurationMinutes: 30,
        totalHoursWorked: 8.55,
        ordinaryHours: 8,
        overtime15xHours: 0.55,
        overtime2xHours: 0,
        overtimeCustomHours: 0,
      },
      commissionNote: null,
      approvedByUserId: MANAGER_USER_ID,
      approvedAt,
      approvalNotes: "Looks good",
    });

    const [sql, params] = lastCall(query);

    // clockMutation (7) + attendanceStatus (1) + timesheetStatus (1) +
    // commissionNote (1) + approvedByUserId (1) + approvedAt (1) +
    // approvalNotes (1) = 13 data params + 1 id = 14 total
    expect(params).toHaveLength(14);

    // All expected columns must appear in SET
    expect(sql).toContain("attendance_status");
    expect(sql).toContain("timesheet_status");
    expect(sql).toContain("clock_out_at");
    expect(sql).toContain("break_duration_minutes");
    expect(sql).toContain("total_hours_worked");
    expect(sql).toContain("ordinary_hours");
    expect(sql).toContain("overtime_1_5x_hours");
    expect(sql).toContain("overtime_2x_hours");
    expect(sql).toContain("overtime_custom_hours");
    expect(sql).toContain("commission_note");
    expect(sql).toContain("approved_by_user_id");
    expect(sql).toContain("approved_at");
    expect(sql).toContain("approval_notes");

    // clock_in_at must NEVER appear — it is not updatable via this method.
    expect(sql).not.toContain("clock_in_at");
  });

  it("zero optional fields: SET has only 'updated_at = now()', params has only [id]", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, {});

    const [sql, params] = lastCall(query);
    // Only updated_at = now() in SET, no field-level assignments
    expect(sql).toContain("updated_at = now()");
    expect(sql).not.toContain("attendance_status");
    expect(sql).not.toContain("timesheet_status");
    // Only the id param
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(TIMESHEET_ID);
  });

  it("commission verification fields only: SET includes attendance + commissionNote", async () => {
    const { pool, query } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.update(TIMESHEET_ID, {
      attendanceStatus: "present",
      commissionNote: "Confirmed in clinic",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("attendance_status");
    expect(sql).toContain("commission_note");
    expect(sql).not.toContain("timesheet_status");
    expect(sql).not.toContain("overtime_1_5x_hours");
    // params[0]=present, params[1]='Confirmed in clinic', params[2]=id
    expect(params).toHaveLength(3);
    expect(params[0]).toBe("present");
    expect(params[1]).toBe("Confirmed in clinic");
    expect(params[2]).toBe(TIMESHEET_ID);
  });

  it("approval fields only: SET includes timesheet_status, approvedBy, approvedAt, notes", async () => {
    const { pool, query } = makeMockPool([HOURLY_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const approvedAt = new Date("2026-07-16T10:00:00.000Z");
    await repo.update(TIMESHEET_ID, {
      timesheetStatus: "approved",
      approvedByUserId: MANAGER_USER_ID,
      approvedAt,
      approvalNotes: "All clear",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("timesheet_status");
    expect(sql).toContain("approved_by_user_id");
    expect(sql).toContain("approved_at");
    expect(sql).toContain("approval_notes");
    // Must NOT include unrelated columns
    expect(sql).not.toContain("clock_in_at");
    expect(sql).not.toContain("ordinary_hours");
    expect(params).toHaveLength(5); // 4 fields + id
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — getForecastLogs SQL contract
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — getForecastLogs forecasting contract", () => {
  it("param[0] is rosteredClinicId — NOT clinicId", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [, params] = lastCall(query);
    expect(params[0]).toBe(ROSTERED_CLINIC_ID);
    expect(params[0]).not.toBe(CLINIC_ID); // explicitly different IDs in fixtures
  });

  it("param[1] is the shift date string", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [, params] = lastCall(query);
    expect(params[1]).toBe(SHIFT_DATE);
    expect(params).toHaveLength(2);
  });

  it("SQL hardcodes payroll_type = 'commission_log'", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("payroll_type        = 'commission_log'");
  });

  it("SQL filters rostered_clinic_id (not clinic_id)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("rostered_clinic_id  = $1");
    expect(sql).not.toMatch(/\bclinic_id\s*=\s*\$1/);
  });

  it("SQL uses shift_date = $2::date", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("shift_date          = $2::date");
  });

  it("SQL includes IN ('present', 'absent', 'sick')", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("'present'");
    expect(sql).toContain("'absent'");
    expect(sql).toContain("'sick'");
  });

  it("SQL NEVER mentions 'pending_verification' (forecasting safeguard)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).not.toContain("pending_verification");
  });

  it("SQL NEVER mentions 'cancelled' (forecasting safeguard)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).not.toContain("cancelled");
  });

  it("SQL requires approved_by_user_id IS NOT NULL (structural verification)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("approved_by_user_id IS NOT NULL");
  });

  it("SQL requires approved_at IS NOT NULL (structural verification)", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [sql] = lastCall(query);
    expect(sql).toContain("approved_at         IS NOT NULL");
  });

  it("params array still has exactly 2 elements after adding IS NOT NULL guards", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    const [, params] = lastCall(query);
    expect(params).toHaveLength(2);
  });

  it("returns mapped domain objects with correct field names", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const results = await repo.getForecastLogs(ROSTERED_CLINIC_ID, SHIFT_DATE);

    expect(results).toHaveLength(1);
    const entry = results[0];
    expect(entry?.payrollType).toBe("commission_log");
    expect(entry?.rosteredClinicId).toBe(ROSTERED_CLINIC_ID);
    expect(entry?.shiftDate).toBe(SHIFT_DATE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — listByClinic option handling
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — listByClinic option handling", () => {
  it("pendingApprovalOnly: true adds hardcoded \"timesheet_status = 'submitted'\"", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID, { pendingApprovalOnly: true });

    const [sql] = lastCall(query);
    expect(sql).toContain("timesheet_status = 'submitted'");
  });

  it("pendingApprovalOnly overrides a concurrent timesheetStatus filter", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID, {
      pendingApprovalOnly: true,
      timesheetStatus: "approved", // should be ignored
    });

    const [sql, params] = lastCall(query);
    // The hardcoded literal must appear, not a $n placeholder for 'approved'
    expect(sql).toContain("timesheet_status = 'submitted'");
    // 'approved' must not be in the params array
    expect(params).not.toContain("approved");
  });

  it("timesheetStatus filter (without pendingApprovalOnly) uses a parameterised placeholder", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID, { timesheetStatus: "approved" });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("timesheet_status = $2");
    expect(params).toContain("approved");
    // The hardcoded literal must NOT appear when using a param
    expect(sql).not.toContain("timesheet_status = 'submitted'");
  });

  it("shiftDate option adds shift_date = $n::date and suppresses from/to", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID, {
      shiftDate: SHIFT_DATE,
      from: "2026-07-01", // should be ignored when shiftDate is provided
      to: "2026-07-31",   // should be ignored when shiftDate is provided
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain(`shift_date = $2::date`);
    expect(sql).not.toContain("shift_date >=");
    expect(sql).not.toContain("shift_date <=");
    // Only clinicId and shiftDate in params (from/to ignored)
    expect(params).toEqual([CLINIC_ID, SHIFT_DATE]);
  });

  it("from + to range adds shift_date >= and shift_date <=", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    const [sql, params] = lastCall(query);
    expect(sql).toContain("shift_date >= $2::date");
    expect(sql).toContain("shift_date <= $3::date");
    expect(params).toEqual([CLINIC_ID, "2026-07-01", "2026-07-31"]);
  });

  it("results are ordered by shift_date DESC", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.listByClinic(CLINIC_ID);

    const [sql] = lastCall(query);
    expect(sql.toLowerCase()).toContain("order by shift_date desc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgresTimesheetRepository — findByRosterEntry
// ─────────────────────────────────────────────────────────────────────────────

describe("PostgresTimesheetRepository — findByRosterEntry", () => {
  it("passes rosterEntryId as the sole param", async () => {
    const { pool, query } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    await repo.findByRosterEntry(ROSTER_ENTRY_ID);

    const [, params] = lastCall(query);
    expect(params).toEqual([ROSTER_ENTRY_ID]);
  });

  it("returns null when DB returns no rows", async () => {
    const { pool } = makeMockPool([]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findByRosterEntry(ROSTER_ENTRY_ID);

    expect(result).toBeNull();
  });

  it("returns a mapped domain object when DB returns a row", async () => {
    const { pool } = makeMockPool([COMMISSION_ROW]);
    const repo = createPostgresTimesheetRepository(pool);

    const result = await repo.findByRosterEntry(ROSTER_ENTRY_ID);

    expect(result?.rosterEntryId).toBe(ROSTER_ENTRY_ID);
    expect(result?.payrollType).toBe("commission_log");
  });
});
