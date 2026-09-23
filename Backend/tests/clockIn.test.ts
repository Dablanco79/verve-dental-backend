/**
 * clockIn.test.ts — Pilot Blocker Fix (Clock In / Clock Out correctness)
 *
 * Verifies Clock In and Clock Out end-to-end, with explicit coverage of:
 *
 *   Request shape
 *   ─────────────
 *   - valid clinical_staff clock-in succeeds (201)
 *   - malformed / missing shiftStartAt or shiftEndAt is rejected (400)
 *   - sending shiftDate in the body is rejected (strict schema)
 *   - sending rosteredClinicId in the body is rejected (strict schema / location spoofing)
 *
 *   Shift-window validation
 *   ───────────────────────
 *   - shiftEndAt AFTER shiftStartAt succeeds (201)
 *   - shiftEndAt EQUAL TO shiftStartAt is rejected (400, INVALID_SHIFT_WINDOW)
 *   - shiftEndAt BEFORE shiftStartAt is rejected (400, INVALID_SHIFT_WINDOW)
 *
 *   Server-authoritative timestamps
 *   ────────────────────────────────
 *   - clockInAt in the response is the server's timestamp, NOT a client-supplied value
 *     (the clock-in body contains no clockInAt field at all; the schema would reject it)
 *   - clockOutAt in the response is the server's timestamp, NOT a client-supplied value
 *     (sending clockOutAt in the clock-out body is rejected by the strict schema)
 *
 *   RBAC
 *   ────
 *   - group_practice_manager cannot use clock-in (403)
 *   - owner_admin cannot use clock-in (403)
 *   - unauthenticated request is rejected (401)
 *
 *   Payroll home-clinic invariant
 *   ──────────────────────────────
 *   - entry.clinicId equals caller.homeClinicId (payroll/RLS anchor)
 *   - entry.rosteredClinicId equals the route clinicId (physical work location)
 *   - entry.staffUserId equals the authenticated caller's id
 *
 *   shiftDate derivation
 *   ─────────────────────
 *   - shiftDate is the Melbourne-local calendar date of shiftStartAt
 *   - shiftDate can differ from the UTC date when the shift starts near UTC midnight
 *
 *   Clock Out
 *   ─────────
 *   - valid clock-out with breakDurationMinutes succeeds (200)
 *   - sending clockOutAt in the clock-out body is rejected (strict schema)
 *   - staff cannot clock out another user's entry (403)
 *
 * All tests use the in-memory test app — no DB, no Redis, fully deterministic.
 */

import { jest } from "@jest/globals";
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import {
  SEED_CLINIC_A_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";

// ── Shared type helpers ───────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
};

type TimesheetEntry = {
  id: string;
  clinicId: string;
  rosteredClinicId: string;
  shiftDate: string;
  shiftStartAt: string;
  shiftEndAt: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  staffUserId: string;
  payrollType: string;
  timesheetStatus: string | null;
  totalHoursWorked: number | null;
};

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Clock in as the standard Clinic A staff member.
 * Uses a shift window that is always valid (end 8 h after start).
 * Returns the created TimesheetEntry.
 */
async function clockInAsStaff(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  overrides: { shiftStartAt?: string; shiftEndAt?: string } = {},
) {
  const shiftStartAt = overrides.shiftStartAt ?? "2026-09-21T22:00:00.000Z";
  const shiftEndAt = overrides.shiftEndAt ?? "2026-09-22T06:00:00.000Z";

  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
    .set("Authorization", `Bearer ${token}`)
    .send({ rosterEntryId: null, shiftStartAt, shiftEndAt });
}

// ── SHIFT WINDOW VALIDATION ───────────────────────────────────────────────────

describe("POST /clock-in — shift-window validation", () => {
  it("201: shiftEndAt after shiftStartAt succeeds", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token, {
      shiftStartAt: "2026-09-21T22:00:00.000Z",
      shiftEndAt: "2026-09-22T06:00:00.000Z",  // +8 h
    });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.payrollType).toBe("hourly_auto");
    expect(entry.timesheetStatus).toBe("draft");
  });

  it("400: shiftEndAt equal to shiftStartAt is rejected (INVALID_SHIFT_WINDOW)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token, {
      shiftStartAt: "2026-09-21T08:00:00.000Z",
      shiftEndAt: "2026-09-21T08:00:00.000Z",  // equal — zero duration
    });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("INVALID_SHIFT_WINDOW");
  });

  it("400: shiftEndAt before shiftStartAt is rejected (INVALID_SHIFT_WINDOW)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token, {
      shiftStartAt: "2026-09-21T17:00:00.000Z",
      shiftEndAt: "2026-09-21T09:00:00.000Z",  // 8 h before start
    });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("INVALID_SHIFT_WINDOW");
    // The error details must point at shiftEndAt so the client can highlight it.
    const details = body.error.details ?? [];
    expect(details.some((d) => d.field === "shiftEndAt")).toBe(true);
  });
});

// ── SCHEMA / REQUEST-SHAPE VALIDATION ─────────────────────────────────────────

describe("POST /clock-in — request-shape validation", () => {
  it("400: malformed shiftStartAt is rejected", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftStartAt: "not-a-timestamp",
        shiftEndAt: "2026-09-22T06:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("400: missing shiftStartAt is rejected", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftEndAt: "2026-09-22T06:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("400: sending shiftDate in the body is rejected (server derives it — strict schema)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftDate: "2026-09-21",            // must be rejected
        shiftStartAt: "2026-09-21T22:00:00.000Z",
        shiftEndAt: "2026-09-22T06:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("400: sending rosteredClinicId in the body is rejected (prevents location spoofing)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        rosteredClinicId: SEED_CLINIC_A_ID,  // must be rejected
        shiftStartAt: "2026-09-21T22:00:00.000Z",
        shiftEndAt: "2026-09-22T06:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });
});

// ── SERVER-AUTHORITATIVE TIMESTAMPS ──────────────────────────────────────────

describe("Clock In / Clock Out — server-authoritative timestamps", () => {
  it("clockInAt is set by the server, not provided by the client", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const before = new Date();
    const res = await clockInAsStaff(app, token);
    const after = new Date();

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;

    // clockInAt must be within the server's response window.
    // The schema rejects any clockInAt supplied in the body (strict schema),
    // so only the server can set this value.
    expect(entry.clockInAt).not.toBeNull();
    if (entry.clockInAt === null) {
      throw new Error("Expected entry.clockInAt to be set by the server");
    }
    const recordedAt = new Date(entry.clockInAt);
    expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("400: sending clockInAt in the clock-in body is rejected (strict schema)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftStartAt: "2026-09-21T22:00:00.000Z",
        shiftEndAt: "2026-09-22T06:00:00.000Z",
        clockInAt: "2026-09-21T00:00:00.000Z",  // attempt to backdate
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("clockOutAt is set by the server, not provided by the client", async () => {
    // calculateHourBuckets uses Math.floor(elapsedMs / 60_000) — intentional
    // production logic that rejects a zero-minute shift.  Even with
    // breakDurationMinutes: 0 a sub-minute in-process test run yields
    // grossMinutes = 0 → workedMinutes = 0 → INVALID_CLOCK_TIMES (400).
    //
    // Fix: use Jest fake system time so clock-in and clock-out are a
    // deterministic 5 minutes apart from the service's perspective.
    // jest.setSystemTime() only updates what new Date() returns; it does NOT
    // trigger timer callbacks, so supertest HTTP calls and Promise resolution
    // are completely unaffected.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-21T04:00:00.000Z")); // T0

    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      // Clock in — service records clockInAt = T0 (04:00 UTC).
      const clockInRes = await clockInAsStaff(app, token);
      expect(clockInRes.status).toBe(201);
      const entry = (clockInRes.body as ApiData<TimesheetEntry>).data;

      // Advance faked system clock to T1 = 04:05 UTC.
      // calculateHourBuckets: grossMinutes = Math.floor(5) = 5;
      //                        workedMinutes = 5 − 0 = 5 > 0 ✓
      jest.setSystemTime(new Date("2026-09-21T04:05:00.000Z")); // T1

      // Clock out — NO clockOutAt in the request body (strict schema rejects it —
      // see the next test).  Service sets clockOutAt = new Date() = T1.
      const before = new Date(); // T1 (04:05 UTC faked)
      const clockOutRes = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
        .set("Authorization", `Bearer ${token}`)
        .send({ breakDurationMinutes: 0 });
      const after = new Date();  // T1 (04:05 UTC faked)

      expect(clockOutRes.status).toBe(200);
      const updated = (clockOutRes.body as ApiData<TimesheetEntry>).data;

      expect(updated.clockOutAt).not.toBeNull();
      if (updated.clockOutAt === null) {
        throw new Error("Expected updated.clockOutAt to be set by the server");
      }
      const recordedAt = new Date(updated.clockOutAt);
      // Server-recorded clockOutAt must equal T1 — the faked system time at the
      // moment the clock-out request was processed, NOT any value from the client.
      expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    } finally {
      jest.useRealTimers();
    }
  });

  it("400: sending clockOutAt in the clock-out body is rejected (strict schema)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const clockInRes = await clockInAsStaff(app, token);
    expect(clockInRes.status).toBe(201);
    const entry = (clockInRes.body as ApiData<TimesheetEntry>).data;

    // Attempt to supply a client-chosen clock-out timestamp.
    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clockOutAt: "2026-09-21T06:00:00.000Z",  // must be rejected
        breakDurationMinutes: 0,
      });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });
});

// ── RBAC ─────────────────────────────────────────────────────────────────────

describe("POST /clock-in — RBAC", () => {
  it("401: unauthenticated request is rejected", async () => {
    const app = await createTestApp();

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .send({
        rosterEntryId: null,
        shiftStartAt: "2026-09-21T22:00:00.000Z",
        shiftEndAt: "2026-09-22T06:00:00.000Z",
      });

    expect(res.status).toBe(401);
  });

  it("403: group_practice_manager cannot clock in (use createManualEntry instead)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await clockInAsStaff(app, token);

    expect(res.status).toBe(403);
  });

  it("403: owner_admin cannot clock in (use createManualEntry instead)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await clockInAsStaff(app, token);

    expect(res.status).toBe(403);
  });
});

// ── PAYROLL HOME-CLINIC INVARIANT ─────────────────────────────────────────────

describe("POST /clock-in — payroll home-clinic invariant", () => {
  it("entry.clinicId = caller.homeClinicId (payroll/RLS anchor, never URL clinicId)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token);

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;

    // clinic_id must equal the staff member's home clinic — this is the
    // invariant that Postgres RLS, all payroll grouping, and export filtering
    // all depend on.  It must not be derived from the URL.
    expect(entry.clinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("entry.rosteredClinicId = URL clinicId (physical work location)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token);

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    // For an ad-hoc clock-in, the route clinicId is the physical work location.
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("entry.staffUserId = authenticated caller's id (cannot clock in as another user)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockInAsStaff(app, token);

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.staffUserId).toBe(SEED_USER_IDS.clinicAStaff);
  });
});

// ── SHIFTDATE DERIVATION ──────────────────────────────────────────────────────

describe("POST /clock-in — shiftDate derivation (Melbourne local time)", () => {
  it("shiftDate is the Melbourne-local calendar date of shiftStartAt", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // 2026-09-22T01:00:00Z = 2026-09-22T11:00:00+10 AEST → Melbourne date "2026-09-22"
    const res = await clockInAsStaff(app, token, {
      shiftStartAt: "2026-09-22T01:00:00.000Z",
      shiftEndAt: "2026-09-22T09:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect((res.body as ApiData<TimesheetEntry>).data.shiftDate).toBe("2026-09-22");
  });

  it("shiftDate uses Melbourne date even when it differs from the UTC date", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // 2026-09-21T14:30:00Z = 2026-09-22T00:30:00+10 AEST
    // UTC date = "2026-09-21" but Melbourne local date = "2026-09-22"
    const res = await clockInAsStaff(app, token, {
      shiftStartAt: "2026-09-21T14:30:00.000Z",
      shiftEndAt: "2026-09-21T22:30:00.000Z",
    });

    expect(res.status).toBe(201);
    // Must be "2026-09-22", not the UTC date "2026-09-21".
    expect((res.body as ApiData<TimesheetEntry>).data.shiftDate).toBe("2026-09-22");
  });
});

// ── CLOCK OUT ─────────────────────────────────────────────────────────────────

describe("POST /clock-out — clock-out behaviour", () => {
  async function doClockIn(app: Awaited<ReturnType<typeof createTestApp>>, token: string) {
    const res = await clockInAsStaff(app, token);
    expect(res.status).toBe(201);
    return (res.body as ApiData<TimesheetEntry>).data;
  }

  it("200: valid clock-out advances status to submitted", async () => {
    // Same fake-timer technique as the server-authoritative test above:
    // ensure a 5-minute gap so Math.floor yields grossMinutes = 5 > 0.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-21T04:00:00.000Z")); // T0

    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      const entry = await doClockIn(app, token); // clockInAt = T0

      // Advance 5 minutes: grossMinutes = Math.floor(5) = 5 → workedMinutes = 5 > 0 ✓
      jest.setSystemTime(new Date("2026-09-21T04:05:00.000Z")); // T1

      const res = await request(app)
        .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
        .set("Authorization", `Bearer ${token}`)
        .send({ breakDurationMinutes: 0 });

      expect(res.status).toBe(200);
      const updated = (res.body as ApiData<TimesheetEntry>).data;
      expect(updated.clockOutAt).not.toBeNull();
      expect(updated.timesheetStatus).toBe("submitted");
      expect(updated.totalHoursWorked).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("403: staff cannot clock out another user's entry", async () => {
    const app = await createTestApp();
    // Staff A clocks in.
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const entry = await doClockIn(app, staffToken);

    // A different user (admin) tries to clock out Staff A's entry.
    // The service's staffUserId check fires before clockUpdatePayload is reached,
    // so the breakDurationMinutes value is irrelevant to the 403 assertion.
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ breakDurationMinutes: 0 });

    // service enforces entry.staffUserId === caller.id → 403
    expect(res.status).toBe(403);
  });
});

// ── ROSTER PRE-FILL ACTIVATION (PRODUCTION BLOCKER FIX) ──────────────────────
//
// generateFromCompletedRoster() creates an hourly_auto 'draft' entry when a
// roster shift transitions to 'completed'.  Before this fix, a subsequent
// clockIn() call against the same roster entry unconditionally tried to INSERT
// a new row, violating the unique constraint timesheet_entries_roster_unique
// and returning HTTP 500.
//
// Regression coverage:
//   1. Clock-in against a roster shift with a pre-filled entry activates the
//      existing row (201) — server time stamps clockInAt, clockOutAt is null
//   2. Second clock-in against the same activated entry returns 409
//      ALREADY_CLOCKED_IN — never HTTP 500

describe("POST /clock-in — roster pre-fill activation (production blocker fix)", () => {
  type RosterEntryResponse = {
    id: string;
    status: string;
    shiftStartAt: string;
    shiftEndAt: string;
  };

  // A roster shift well in the future so it cannot conflict with any other test.
  const ROSTER_SHIFT_START = "2026-10-01T22:00:00.000Z";
  const ROSTER_SHIFT_END   = "2026-10-02T06:00:00.000Z"; // +8 h

  /**
   * Creates a roster entry for the seed staff member and then marks it
   * 'completed', which fires generateFromCompletedRoster() and creates
   * an hourly_auto 'draft' pre-fill row.  Returns the roster entry id.
   */
  async function seedCompletedRosterEntry(
    app: Awaited<ReturnType<typeof createTestApp>>,
    managerToken: string,
  ): Promise<string> {
    // Step 1 — create the roster entry.
    const createRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        shiftStartAt: ROSTER_SHIFT_START,
        shiftEndAt: ROSTER_SHIFT_END,
        shiftType: "standard",
      });
    expect(createRes.status).toBe(201);
    const entry = (createRes.body as ApiData<RosterEntryResponse>).data;

    // Step 2 — mark completed → triggers generateFromCompletedRoster() hook.
    const completeRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${entry.id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ status: "completed" });
    expect(completeRes.status).toBe(200);

    return entry.id;
  }

  it("201: clock-in against a pre-filled roster entry activates the existing row, not a duplicate", async () => {
    const app          = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken   = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const rosterEntryId = await seedCompletedRosterEntry(app, managerToken);

    const before = new Date();
    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        rosterEntryId,
        // shiftStartAt / shiftEndAt are required by schema but are ignored for
        // roster-linked entries — the service derives them from the DB record.
        shiftStartAt: ROSTER_SHIFT_START,
        shiftEndAt: ROSTER_SHIFT_END,
      });
    const after = new Date();

    // Must succeed — no HTTP 500 from the unique constraint.
    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;

    expect(entry.timesheetStatus).toBe("draft");
    expect(entry.payrollType).toBe("hourly_auto");

    // clockInAt must be the actual server activation time, NOT the scheduled
    // shiftStartAt from the pre-fill ("2026-10-01T22:00:00.000Z").
    expect(entry.clockInAt).not.toBeNull();
    if (entry.clockInAt === null) throw new Error("Expected clockInAt to be set after activation");
    const clockedInAt = new Date(entry.clockInAt).getTime();
    expect(clockedInAt).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(clockedInAt).toBeLessThanOrEqual(after.getTime() + 1000);

    // clockOutAt must be null — the staff member has not yet clocked out.
    expect(entry.clockOutAt).toBeNull();
  });

  it("409 ALREADY_CLOCKED_IN: second clock-in against the same activated entry is rejected, not HTTP 500", async () => {
    const app          = await createTestApp();
    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const staffToken   = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const rosterEntryId = await seedCompletedRosterEntry(app, managerToken);

    // First clock-in: activates the pre-fill row (201).
    const firstRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ rosterEntryId, shiftStartAt: ROSTER_SHIFT_START, shiftEndAt: ROSTER_SHIFT_END });
    expect(firstRes.status).toBe(201);

    // Second clock-in: must return 409, never 500.
    const secondRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ rosterEntryId, shiftStartAt: ROSTER_SHIFT_START, shiftEndAt: ROSTER_SHIFT_END });

    expect(secondRes.status).toBe(409);
    expect((secondRes.body as ApiError).error.code).toBe("ALREADY_CLOCKED_IN");
  });
});
