/**
 * Soft Geofence — Clock In / Clock Out Tests
 *
 * Verifies all 10 required scenarios for the pilot soft-geofence feature:
 *
 *   1.  Within-range Clock In succeeds
 *   2.  Outside-range Clock In warns but succeeds (soft gate — never hard-blocks)
 *   3.  Denied-location Clock In still allows Clock In with warning
 *   4.  Within-range Clock Out succeeds
 *   5.  Outside-range Clock Out warns but succeeds
 *   6.  Roster-linked cross-clinic shift checks physical rostered clinic, not home clinic
 *   7.  Ad-hoc shift uses explicitly selected physical clinic
 *   8.  payroll clinic_id remains home clinic (invariant preserved)
 *   9.  Geofence metadata is recorded correctly in clock_in_location / clock_out_location
 *   10. Existing Timesheet workflows remain unchanged (legacy requests without location succeed)
 *
 * Implementation notes:
 *   • The backend AUTHORITATIVELY computes distanceMetres, withinRange, locationState.
 *   • Clients send only lat/lng/accuracyMetres/targetClinicId (+ locationState for denied/unavailable).
 *   • distanceMetres, withinRange, locationState ("within"/"outside") are NEVER accepted from client.
 *   • Denied/unavailable locations use lat: null, lng: null (never 0, 0).
 *   • The backend NEVER hard-blocks based on locationState or withinRange.
 *   • Existing requests that omit clockInLocation / clockOutLocation continue to work.
 *
 * Seed clinic coordinates (set in createInMemoryClinicRepository):
 *   Clinic A: −37.8136, 144.9631  (Melbourne CBD)
 *   Clinic B: −37.8136, 144.9694  (~500 m east of Clinic A)
 */

import { jest } from "@jest/globals";
import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { haversineDistance, GEOFENCE_RADIUS_METRES } from "../src/utils/haversine.js";
import { createTestApp } from "./helpers/testApp.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";

// ── Shared type helpers ────────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

/** Shape of geofence location as returned by the API (backend-computed fields included). */
type GeofenceLocation = {
  lat: number | null;
  lng: number | null;
  accuracyMetres: number | null;
  targetClinicId: string;
  distanceMetres: number | null;
  withinRange: boolean | null;
  locationState: "within" | "outside" | "denied" | "unavailable";
};

/** Shape of what the CLIENT SENDS — no backend-computed fields. */
type ClockLocationInput = {
  lat: number | null;
  lng: number | null;
  accuracyMetres?: number | null;
  targetClinicId: string;
  locationState?: "denied" | "unavailable";
};

type TimesheetEntry = {
  id: string;
  clinicId: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  rosterEntryId: string | null;
  staffUserId: string;
  payrollType: string;
  timesheetStatus: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalHoursWorked: number | null;
  clockInLocation: GeofenceLocation | null;
  clockOutLocation: GeofenceLocation | null;
};

// ── Seed coordinates (mirrors createInMemoryClinicRepository seed data) ────────
const CLINIC_A_LAT = -37.8136;
const CLINIC_A_LNG = 144.9631;
const CLINIC_B_LAT = -37.8136;
const CLINIC_B_LNG = 144.9694;

// Shift window shared by most tests — always valid (end 8 h after start)
const SHIFT_START = "2026-09-22T22:00:00.000Z"; // 08:00 AEST
const SHIFT_END   = "2026-09-23T06:00:00.000Z"; // 16:00 AEST

// ── Location fixture builders (client-send shape only — no computed fields) ───

/** Device is ~30 m from Clinic A — within the 100 m geofence. */
function withinRangeLocation(targetClinicId = SEED_CLINIC_A_ID): ClockLocationInput {
  // ~30 m north of Clinic A lat
  const deviceLat = CLINIC_A_LAT + 0.00027;
  const deviceLng = CLINIC_A_LNG;
  return {
    lat: deviceLat,
    lng: deviceLng,
    accuracyMetres: 12,
    targetClinicId,
    // No distanceMetres, withinRange, or locationState — backend computes these
  };
}

/** Device is ~500 m from Clinic A — outside the 100 m geofence. */
function outsideRangeLocation(targetClinicId = SEED_CLINIC_A_ID): ClockLocationInput {
  // Place the device at Clinic B's coordinates (~500 m east of Clinic A)
  return {
    lat: CLINIC_B_LAT,
    lng: CLINIC_B_LNG,
    accuracyMetres: 20,
    targetClinicId,
    // No distanceMetres, withinRange, or locationState — backend computes these
  };
}

/** Location permission was denied — no coordinates captured. */
function deniedLocation(targetClinicId = SEED_CLINIC_A_ID): ClockLocationInput {
  return {
    lat: null,   // null — NOT 0,0
    lng: null,   // null — NOT 0,0
    accuracyMetres: null,
    targetClinicId,
    locationState: "denied",
  };
}

/** Location service unavailable. */
function unavailableLocation(targetClinicId = SEED_CLINIC_A_ID): ClockLocationInput {
  return {
    lat: null,   // null — NOT 0,0
    lng: null,   // null — NOT 0,0
    accuracyMetres: null,
    targetClinicId,
    locationState: "unavailable",
  };
}

// ── Helper: clock in as Clinic A staff ───────────────────────────────────────

async function clockIn(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  extra: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
    .set("Authorization", `Bearer ${token}`)
    .send({ rosterEntryId: null, shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END, ...extra });
}

async function clockOut(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  timesheetId: string,
  extra: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${timesheetId}/clock-out`)
    .set("Authorization", `Bearer ${token}`)
    // 0 break minutes — tests clock in and out within milliseconds, so
    // grossMinutes ≈ 0; any non-zero break would give workedMinutes ≤ 0
    // and trigger INVALID_CLOCK_TIMES.
    .send({ breakDurationMinutes: 0, ...extra });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Within-range Clock In succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 1: within-range Clock In succeeds", () => {
  it("returns 201 and backend computes clockInLocation.locationState = within", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const loc = withinRangeLocation();
    const res = await clockIn(app, token, { clockInLocation: loc });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInAt).toBeTruthy();
    expect(entry.clockInLocation).not.toBeNull();
    // Backend authoritatively computes "within" from the submitted coordinates
    expect(entry.clockInLocation?.locationState).toBe("within");
    expect(entry.clockInLocation?.withinRange).toBe(true);
    expect(entry.clockInLocation?.distanceMetres).toBeGreaterThanOrEqual(0);
    expect(entry.clockInLocation?.distanceMetres).toBeLessThanOrEqual(GEOFENCE_RADIUS_METRES);
    expect(entry.clockInLocation?.targetClinicId).toBe(SEED_CLINIC_A_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Outside-range Clock In warns but succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 2: outside-range Clock In warns but succeeds (soft gate)", () => {
  it("returns 201 regardless and backend computes clockInLocation.locationState = outside", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const loc = outsideRangeLocation();
    const res = await clockIn(app, token, { clockInLocation: loc });

    // NEVER hard-blocked — status 201 always
    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInAt).toBeTruthy();
    // Backend authoritatively computes "outside" from the submitted coordinates
    expect(entry.clockInLocation?.locationState).toBe("outside");
    expect(entry.clockInLocation?.withinRange).toBe(false);
    expect(entry.clockInLocation?.distanceMetres).toBeGreaterThan(GEOFENCE_RADIUS_METRES);
    // Confirms the timesheet was actually created despite outside range
    expect(entry.timesheetStatus).toBe("draft");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Denied-location Clock In still allows Clock In
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 3: denied-location Clock In still succeeds", () => {
  it("returns 201 and records clockInLocation.locationState = denied with null coordinates", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const loc = deniedLocation();
    const res = await clockIn(app, token, { clockInLocation: loc });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation?.locationState).toBe("denied");
    expect(entry.clockInLocation?.distanceMetres).toBeNull();
    expect(entry.clockInLocation?.withinRange).toBeNull();
    // SECURITY: denied stores null coordinates, not 0,0
    expect(entry.clockInLocation?.lat).toBeNull();
    expect(entry.clockInLocation?.lng).toBeNull();
  });

  it("returns 201 when no clockInLocation is sent at all (legacy / permission not requested)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token); // no clockInLocation field

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    // Historical-style entry — location not recorded
    expect(entry.clockInLocation).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Within-range Clock Out succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 4: within-range Clock Out succeeds", () => {
  it("returns 200 and backend computes clockOutLocation.locationState = within", async () => {
    // Use fake timers so clock-in and clock-out are 5 minutes apart from the
    // service's perspective. calculateHourBuckets requires workedMinutes > 0;
    // without fake timers both calls happen within milliseconds → 0 minutes → 400.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-25T04:00:00.000Z")); // T0 — clock-in
    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const inRes = await clockIn(app, token);
      expect(inRes.status).toBe(201);
      const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

      jest.setSystemTime(new Date("2026-09-25T04:05:00.000Z")); // T1 — clock-out (+5 min)

      const outLoc = withinRangeLocation();
      const outRes = await clockOut(app, token, timesheetId, { clockOutLocation: outLoc });

      expect(outRes.status).toBe(200);
      const entry = (outRes.body as ApiData<TimesheetEntry>).data;
      expect(entry.clockOutAt).toBeTruthy();
      expect(entry.clockOutLocation?.locationState).toBe("within");
      expect(entry.clockOutLocation?.withinRange).toBe(true);
      expect(entry.timesheetStatus).toBe("submitted");
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Outside-range Clock Out warns but succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 5: outside-range Clock Out warns but succeeds (soft gate)", () => {
  it("returns 200 regardless and backend computes clockOutLocation.locationState = outside", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-25T05:00:00.000Z")); // T0 — clock-in
    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const inRes = await clockIn(app, token);
      expect(inRes.status).toBe(201);
      const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

      jest.setSystemTime(new Date("2026-09-25T05:05:00.000Z")); // T1 — clock-out (+5 min)

      const outLoc = outsideRangeLocation();
      const outRes = await clockOut(app, token, timesheetId, { clockOutLocation: outLoc });

      // Never hard-blocked
      expect(outRes.status).toBe(200);
      const entry = (outRes.body as ApiData<TimesheetEntry>).data;
      expect(entry.clockOutLocation?.locationState).toBe("outside");
      expect(entry.clockOutLocation?.withinRange).toBe(false);
      expect(entry.timesheetStatus).toBe("submitted");
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Roster-linked cross-clinic uses physical rostered clinic
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 6: roster-linked cross-clinic uses rosteredClinicId, not homeClinicId", () => {
  it("timesheet.rosteredClinicId differs from homeClinicId when shift is at Clinic B", async () => {
    const app = await createTestApp();
    const adminBToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");
    const staffToken  = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // POST to Clinic B's roster endpoint — rosteredClinicId = SEED_CLINIC_B_ID
    const rosterRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${adminBToken}`)
      .send({
        staffUserId:  SEED_USER_IDS.clinicAStaff,
        shiftStartAt: SHIFT_START,
        shiftEndAt:   SHIFT_END,
      });

    expect(rosterRes.status).toBe(201);
    const rosterEntryId = (rosterRes.body as ApiData<{ id: string }>).data.id;

    // Clock in at Clinic B with geofence targeting Clinic B.
    // Client sends only raw coordinates — no distanceMetres/withinRange/locationState.
    const locAtClinicB: ClockLocationInput = {
      lat: CLINIC_B_LAT,
      lng: CLINIC_B_LNG,  // at Clinic B
      accuracyMetres: 15,
      targetClinicId: SEED_CLINIC_B_ID,
    };

    const clockInRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        rosterEntryId,
        shiftStartAt: SHIFT_START,
        shiftEndAt:   SHIFT_END,
        clockInLocation: locAtClinicB,
      });

    expect(clockInRes.status).toBe(201);
    const entry = (clockInRes.body as ApiData<TimesheetEntry>).data;

    // Physical work location is Clinic B (from the roster entry)
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_B_ID);
    // Geofence target confirms Clinic B was used for the proximity check
    expect(entry.clockInLocation?.targetClinicId).toBe(SEED_CLINIC_B_ID);
    // Backend computes "within" because device is at Clinic B's coordinates
    expect(entry.clockInLocation?.locationState).toBe("within");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Ad-hoc shift uses explicitly selected physical clinic
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 7: ad-hoc shift uses explicitly selected physical clinic", () => {
  it("targetClinicId in location matches physicalClinicId for ad-hoc clock-in", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Ad-hoc: no rosterEntryId; explicit physicalClinicId = home clinic
    const loc: ClockLocationInput = {
      lat: CLINIC_A_LAT + 0.00027,
      lng: CLINIC_A_LNG,
      accuracyMetres: 10,
      targetClinicId: SEED_CLINIC_A_ID,
    };

    const res = await clockIn(app, token, {
      clockInLocation: loc,
      physicalClinicId: SEED_CLINIC_A_ID,  // explicit selection
    });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    // Ad-hoc: both clinicId and rosteredClinicId are home clinic (explicitly selected)
    expect(entry.clinicId).toBe(SEED_CLINIC_A_ID);
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_A_ID);
    expect(entry.clockInLocation?.targetClinicId).toBe(SEED_CLINIC_A_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: payroll clinic_id remains home clinic (invariant preserved)
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 8: payroll clinic_id invariant is never overwritten", () => {
  it("entry.clinicId is homeClinicId even when geofence check targets a different clinic", async () => {
    const app = await createTestApp();
    const adminBToken = await loginAndGetAccessToken(app, "admin@clinic-b.au");
    const staffToken  = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const rosterRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/roster`)
      .set("Authorization", `Bearer ${adminBToken}`)
      .send({
        staffUserId:  SEED_USER_IDS.clinicAStaff,
        shiftStartAt: SHIFT_START,
        shiftEndAt:   SHIFT_END,
      });
    expect(rosterRes.status).toBe(201);
    const rosterEntryId = (rosterRes.body as ApiData<{ id: string }>).data.id;

    // Clock in at Clinic B with geofence targeting Clinic B
    const loc: ClockLocationInput = {
      lat: CLINIC_B_LAT,
      lng: CLINIC_B_LNG,
      accuracyMetres: 15,
      targetClinicId: SEED_CLINIC_B_ID,
    };

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_B_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ rosterEntryId, shiftStartAt: SHIFT_START, shiftEndAt: SHIFT_END, clockInLocation: loc });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;

    // Payroll anchor MUST remain home clinic (Clinic A) — invariant preserved
    expect(entry.clinicId).toBe(SEED_CLINIC_A_ID);
    // Physical work location is Clinic B (from the roster entry) — never confused
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_B_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: Geofence metadata is recorded correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 9: metadata recorded accurately in response", () => {
  it("backend computes accurate clockInLocation fields for within-range event", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const loc = withinRangeLocation();
    const res = await clockIn(app, token, { clockInLocation: loc });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation).not.toBeNull();
    const recorded = entry.clockInLocation as NonNullable<TimesheetEntry["clockInLocation"]>;

    // Coordinates round-trip from client
    expect(recorded.lat).toBe(loc.lat);
    expect(recorded.lng).toBe(loc.lng);
    expect(recorded.accuracyMetres).toBe(loc.accuracyMetres);
    expect(recorded.targetClinicId).toBe(SEED_CLINIC_A_ID);
    // Backend-computed fields
    expect(typeof recorded.distanceMetres).toBe("number");
    expect(recorded.distanceMetres).toBeGreaterThanOrEqual(0);
    expect(recorded.distanceMetres).toBeLessThanOrEqual(GEOFENCE_RADIUS_METRES);
    expect(recorded.withinRange).toBe(true);
    expect(recorded.locationState).toBe("within");
  });

  it("backend computes accurate clockOutLocation fields for outside-range event", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-25T06:00:00.000Z")); // T0 — clock-in
    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const inRes = await clockIn(app, token);
      expect(inRes.status).toBe(201);
      const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

      jest.setSystemTime(new Date("2026-09-25T06:05:00.000Z")); // T1 — clock-out (+5 min)

      const outLoc = outsideRangeLocation();
      const outRes = await clockOut(app, token, timesheetId, { clockOutLocation: outLoc });

      expect(outRes.status).toBe(200);
      const entry = (outRes.body as ApiData<TimesheetEntry>).data;
      expect(entry.clockOutLocation).not.toBeNull();
      const recorded = entry.clockOutLocation as NonNullable<TimesheetEntry["clockOutLocation"]>;

      expect(recorded.lat).toBe(outLoc.lat);
      expect(recorded.lng).toBe(outLoc.lng);
      // Backend-computed
      expect(recorded.locationState).toBe("outside");
      expect(recorded.withinRange).toBe(false);
      expect(recorded.distanceMetres).toBeGreaterThan(GEOFENCE_RADIUS_METRES);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clockInLocation and clockOutLocation are stored independently", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-25T07:00:00.000Z")); // T0 — clock-in
    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      // Clock in within range
      const inRes = await clockIn(app, token, { clockInLocation: withinRangeLocation() });
      expect(inRes.status).toBe(201);
      const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

      jest.setSystemTime(new Date("2026-09-25T07:05:00.000Z")); // T1 — clock-out (+5 min)

      // Clock out outside range
      const outRes = await clockOut(app, token, timesheetId, { clockOutLocation: outsideRangeLocation() });
      expect(outRes.status).toBe(200);

      const entry = (outRes.body as ApiData<TimesheetEntry>).data;
      expect(entry.clockInLocation?.locationState).toBe("within");
      expect(entry.clockOutLocation?.locationState).toBe("outside");
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: Existing Timesheet workflows remain unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — Test 10: existing timesheet workflows are unaffected", () => {
  it("clock-in without any location field succeeds and returns clockInLocation = null", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token);  // no clockInLocation

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation).toBeNull();
    expect(entry.clockOutLocation).toBeNull();
  });

  it("clock-out without any location field succeeds", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-25T08:00:00.000Z")); // T0 — clock-in
    try {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

      const inRes = await clockIn(app, token);
      expect(inRes.status).toBe(201);
      const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

      jest.setSystemTime(new Date("2026-09-25T08:05:00.000Z")); // T1 — clock-out (+5 min)

      const outRes = await clockOut(app, token, timesheetId);  // no clockOutLocation

      expect(outRes.status).toBe(200);
      const entry = (outRes.body as ApiData<TimesheetEntry>).data;
      expect(entry.clockOutAt).toBeTruthy();
      expect(entry.clockOutLocation).toBeNull();
      expect(entry.timesheetStatus).toBe("submitted");
    } finally {
      jest.useRealTimers();
    }
  });

  it("clockOutAt in the clock-out body is still rejected (schema strict mode)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const inRes = await clockIn(app, token);
    expect(inRes.status).toBe(201);
    const timesheetId = (inRes.body as ApiData<TimesheetEntry>).data.id;

    // Sending a clockOutAt field should be rejected by the strict schema
    const outRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${timesheetId}/clock-out`)
      .set("Authorization", `Bearer ${token}`)
      .send({ breakDurationMinutes: 30, clockOutAt: "2026-09-22T14:30:00.000Z" });

    expect(outRes.status).toBe(400);
    expect((outRes.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("invalid locationState value is rejected by Zod schema", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token, {
      clockInLocation: {
        lat: null,
        lng: null,
        accuracyMetres: null,
        targetClinicId: SEED_CLINIC_A_ID,
        locationState: "invalid_state",  // not in enum (only "denied"/"unavailable" allowed)
      },
    });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("unavailable locationState succeeds — device location service was off", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token, { clockInLocation: unavailableLocation() });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation?.locationState).toBe("unavailable");
    expect(entry.clockInLocation?.lat).toBeNull();
    expect(entry.clockInLocation?.lng).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: Denied/unavailable must store null coordinates (not 0,0)
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — denied/unavailable store null coordinates (not 0,0)", () => {
  it("denied clockInLocation stores null lat and lng", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token, { clockInLocation: deniedLocation() });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation).not.toBeNull();
    const loc = entry.clockInLocation as NonNullable<TimesheetEntry["clockInLocation"]>;
    expect(loc.locationState).toBe("denied");
    expect(loc.lat).toBeNull();
    expect(loc.lng).toBeNull();
    expect(loc.distanceMetres).toBeNull();
    expect(loc.withinRange).toBeNull();
  });

  it("unavailable clockInLocation stores null lat and lng", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token, { clockInLocation: unavailableLocation() });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInLocation).not.toBeNull();
    const loc = entry.clockInLocation as NonNullable<TimesheetEntry["clockInLocation"]>;
    expect(loc.locationState).toBe("unavailable");
    expect(loc.lat).toBeNull();
    expect(loc.lng).toBeNull();
    expect(loc.distanceMetres).toBeNull();
    expect(loc.withinRange).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: Backend authoritatively recomputes distance/withinRange
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — backend authoritatively recomputes distance and withinRange", () => {
  it("forged withinRange=true field in request body is rejected by schema (400)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // withinRange is not in the clockLocationInputSchema — strict mode rejects it
    const res = await clockIn(app, token, {
      clockInLocation: {
        lat: -37.9,
        lng: 144.9,
        targetClinicId: SEED_CLINIC_A_ID,
        withinRange: true,  // not allowed — backend computes this
      },
    });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("forged distanceMetres field is rejected by schema (400)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await clockIn(app, token, {
      clockInLocation: {
        lat: -37.9,
        lng: 144.9,
        targetClinicId: SEED_CLINIC_A_ID,
        distanceMetres: 5,  // not allowed — backend computes this
      },
    });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("client cannot forge locationState=within for a far-away location", async () => {
    // The schema only accepts locationState "denied"/"unavailable" — not "within".
    // A client trying to send locationState: "within" with coordinates is rejected.
    const res = await (async () => {
      const app = await createTestApp();
      const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
      return clockIn(app, token, {
        clockInLocation: {
          lat: -37.9,
          lng: 144.9,
          targetClinicId: SEED_CLINIC_A_ID,
          locationState: "within",  // not allowed from client
        },
      });
    })();

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe("VALIDATION_ERROR");
  });

  it("outside-range coords get locationState=outside from backend regardless of client intent", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    // Send outside-range coords — backend computes "outside", not "within"
    const outsideLoc = outsideRangeLocation();
    const res = await clockIn(app, token, { clockInLocation: outsideLoc });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    // Backend computed, not forged
    expect(entry.clockInLocation?.locationState).toBe("outside");
    expect(entry.clockInLocation?.withinRange).toBe(false);
    expect(entry.clockInLocation?.distanceMetres).toBeGreaterThan(GEOFENCE_RADIUS_METRES);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 1: Ad-hoc requires explicit physical clinic selection
// ─────────────────────────────────────────────────────────────────────────────

describe("Geofence — ad-hoc requires explicit physical clinic selection", () => {
  it("ad-hoc clock-in with physicalClinicId = home clinic sets rosteredClinicId correctly", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftStartAt: SHIFT_START,
        shiftEndAt: SHIFT_END,
        physicalClinicId: SEED_CLINIC_A_ID,  // explicit selection
        clockInLocation: { lat: CLINIC_A_LAT + 0.00027, lng: CLINIC_A_LNG, accuracyMetres: 12, targetClinicId: SEED_CLINIC_A_ID },
      });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clinicId).toBe(SEED_CLINIC_A_ID);          // payroll anchor unchanged
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_A_ID);  // physical = selected clinic
    expect(entry.clockInLocation?.targetClinicId).toBe(SEED_CLINIC_A_ID);
  });

  it("ad-hoc with physicalClinicId = Clinic B sets rosteredClinicId to Clinic B while payroll stays Clinic A", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    const res = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        rosterEntryId: null,
        shiftStartAt: SHIFT_START,
        shiftEndAt: SHIFT_END,
        physicalClinicId: SEED_CLINIC_B_ID,  // working at Clinic B
        clockInLocation: { lat: CLINIC_B_LAT, lng: CLINIC_B_LNG, accuracyMetres: 10, targetClinicId: SEED_CLINIC_B_ID },
      });

    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clinicId).toBe(SEED_CLINIC_A_ID);          // payroll: home clinic A
    expect(entry.rosteredClinicId).toBe(SEED_CLINIC_B_ID);  // physical: explicit B
    expect(entry.clockInLocation?.targetClinicId).toBe(SEED_CLINIC_B_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Haversine unit tests (pure function — no HTTP)
// ─────────────────────────────────────────────────────────────────────────────

describe("haversineDistance — pure unit tests", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });

  it("returns ~30 m for seed within-range offset", () => {
    const deviceLat = CLINIC_A_LAT + 0.00027;
    const dist = haversineDistance(deviceLat, CLINIC_A_LNG, CLINIC_A_LAT, CLINIC_A_LNG);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(GEOFENCE_RADIUS_METRES);
  });

  it("returns ~500 m for Clinic A → Clinic B", () => {
    const dist = haversineDistance(CLINIC_B_LAT, CLINIC_B_LNG, CLINIC_A_LAT, CLINIC_A_LNG);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeGreaterThan(400); // ~500 m
    expect(dist).toBeLessThan(600);
  });

  it("is symmetric (distance A→B equals distance B→A)", () => {
    const d1 = haversineDistance(-37.8136, 144.9631, -37.8200, 144.9700);
    const d2 = haversineDistance(-37.8200, 144.9700, -37.8136, 144.9631);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});
