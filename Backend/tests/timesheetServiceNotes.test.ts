/**
 * timesheetServiceNotes.test.ts
 *
 * Tests the staff timesheet notes feature (migration 053).
 *
 * Covers the backend enforcement rule:
 *   "If the server-computed geofence state is an exception
 *    (outside / denied / unavailable) AND the relevant note is
 *    missing or blank after trimming → reject with HTTP 422."
 *
 * Scenarios tested
 * ─────────────────
 * Clock In:
 *   1.  Within-range without note → succeeds (note not required)
 *   2.  Outside-range without note → 422 CLOCK_IN_NOTE_REQUIRED
 *   3.  Outside-range with valid note → succeeds + note stored
 *   4.  Denied-location without note → 422 CLOCK_IN_NOTE_REQUIRED
 *   5.  Denied-location with valid note → succeeds + note stored
 *   6.  Unavailable-location without note → 422 CLOCK_IN_NOTE_REQUIRED
 *   7.  Unavailable-location with valid note → succeeds
 *   8.  Whitespace-only note on outside-range → 422 (whitespace trimmed)
 *   9.  No clockInLocation (null) → no note required → succeeds
 *   10. Within-range with optional note → succeeds + note stored
 *   11. Note longer than 500 chars → 400 (Zod validation)
 *
 * Clock Out:
 *   12. Outside-range without note → 422 CLOCK_OUT_NOTE_REQUIRED
 *   13. Outside-range with valid note → 200 + note stored
 *   14. Denied-location without note → 422 CLOCK_OUT_NOTE_REQUIRED
 *   15. Denied-location with valid note → 200
 *   16. No clockOutLocation (null) → no note required → 200
 *
 * Invariant preservation:
 *   17. Note does NOT alter locationState, distanceMetres, or withinRange
 *   18. clockInNote / clockOutNote never appear in approvalNotes or commissionNote
 *
 * All tests use the in-memory test app — no DB, no Redis, fully deterministic.
 */

import { jest } from "@jest/globals";
import request from "supertest";

import {
  SEED_CLINIC_A_ID,
} from "../src/repositories/userRepository.js";
import { createTestApp } from "./helpers/testApp.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
};

type GeofenceLocation = {
  lat: number | null;
  lng: number | null;
  accuracyMetres: number | null;
  targetClinicId: string;
  distanceMetres: number | null;
  withinRange: boolean | null;
  locationState: "within" | "outside" | "denied" | "unavailable";
};

type TimesheetEntry = {
  id: string;
  clinicId: string;
  rosteredClinicId: string;
  staffUserId: string;
  payrollType: string;
  timesheetStatus: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLocation: GeofenceLocation | null;
  clockOutLocation: GeofenceLocation | null;
  clockInNote: string | null;
  clockOutNote: string | null;
  approvalNotes: string | null;
  commissionNote: string | null;
};

type ClockLocationInput = {
  lat: number | null;
  lng: number | null;
  accuracyMetres?: number | null;
  targetClinicId: string;
  locationState?: "denied" | "unavailable";
};

// ── Clinic A seed coordinates ─────────────────────────────────────────────────
// Clinic A: −37.8136, 144.9631 (Melbourne CBD)
// Clinic B: −37.8136, 144.9694 (~500 m east of Clinic A)
const CLINIC_A_LAT = -37.8136;
const CLINIC_A_LNG = 144.9631;
const CLINIC_B_LNG = 144.9694; // ~500 m east — outside 100 m geofence

const SHIFT_START = "2026-09-22T22:00:00.000Z"; // 08:00 AEST
const SHIFT_END   = "2026-09-23T06:00:00.000Z"; // 16:00 AEST

// ── Location helpers ──────────────────────────────────────────────────────────

function withinRangeLocation(): ClockLocationInput {
  return {
    lat: CLINIC_A_LAT + 0.00027, // ~30 m north
    lng: CLINIC_A_LNG,
    accuracyMetres: 12,
    targetClinicId: SEED_CLINIC_A_ID,
  };
}

function outsideRangeLocation(): ClockLocationInput {
  return {
    lat: CLINIC_A_LAT,
    lng: CLINIC_B_LNG,   // ~500 m east
    accuracyMetres: 20,
    targetClinicId: SEED_CLINIC_A_ID,
  };
}

function deniedLocation(): ClockLocationInput {
  return {
    lat: null,
    lng: null,
    targetClinicId: SEED_CLINIC_A_ID,
    locationState: "denied",
  };
}

function unavailableLocation(): ClockLocationInput {
  return {
    lat: null,
    lng: null,
    targetClinicId: SEED_CLINIC_A_ID,
    locationState: "unavailable",
  };
}

// ── Request helpers ───────────────────────────────────────────────────────────

async function doClockIn(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/clock-in`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      rosterEntryId: null,
      shiftStartAt: SHIFT_START,
      shiftEndAt: SHIFT_END,
      ...body,
    });
}

async function doClockOut(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  timesheetId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${timesheetId}/clock-out`)
    .set("Authorization", `Bearer ${token}`)
    .send({ breakDurationMinutes: 0, ...body });
}

// ── Clock-in tests ────────────────────────────────────────────────────────────

describe("Staff Timesheet Notes — clock-in enforcement", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
  });

  // ── 1. Within-range: note not required ──────────────────────────────────

  it("1. within-range clock-in without a note succeeds (201)", async () => {
    const res = await doClockIn(app, token, { clockInLocation: withinRangeLocation() });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBeNull();
  });

  // ── 2. Outside-range: note REQUIRED ─────────────────────────────────────

  it("2. outside-range clock-in without a note is rejected with 422", async () => {
    const res = await doClockIn(app, token, { clockInLocation: outsideRangeLocation() });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_IN_NOTE_REQUIRED");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "clockInNote" }),
      ]),
    );
  });

  // ── 3. Outside-range with note → succeeds + note persisted ──────────────

  it("3. outside-range clock-in with a valid note succeeds (201) and stores the note", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: outsideRangeLocation(),
      clockInNote: "Covering at Heathmont today",
    });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBe("Covering at Heathmont today");
    // Note never alters geofence metadata
    expect(body.data.clockInLocation?.locationState).toBe("outside");
    expect(body.data.clockInLocation?.withinRange).toBe(false);
  });

  // ── 4. Permission denied: note REQUIRED ─────────────────────────────────

  it("4. permission-denied clock-in without a note is rejected with 422", async () => {
    const res = await doClockIn(app, token, { clockInLocation: deniedLocation() });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_IN_NOTE_REQUIRED");
  });

  // ── 5. Permission denied with note → succeeds ────────────────────────────

  it("5. permission-denied clock-in with a valid note succeeds (201)", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: deniedLocation(),
      clockInNote: "Location permission unavailable on phone",
    });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBe("Location permission unavailable on phone");
    expect(body.data.clockInLocation?.locationState).toBe("denied");
  });

  // ── 6. Location unavailable: note REQUIRED ───────────────────────────────

  it("6. unavailable-location clock-in without a note is rejected with 422", async () => {
    const res = await doClockIn(app, token, { clockInLocation: unavailableLocation() });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_IN_NOTE_REQUIRED");
  });

  // ── 7. Location unavailable with note → succeeds ─────────────────────────

  it("7. unavailable-location clock-in with a valid note succeeds (201)", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: unavailableLocation(),
      clockInNote: "Train delay — clocking in from platform",
    });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBe("Train delay — clocking in from platform");
    expect(body.data.clockInLocation?.locationState).toBe("unavailable");
  });

  // ── 8. Whitespace-only note treated as empty → 422 ──────────────────────

  it("8. whitespace-only note on outside-range clock-in is rejected (422)", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: outsideRangeLocation(),
      clockInNote: "   ",
    });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_IN_NOTE_REQUIRED");
  });

  // ── 9. Null clockInLocation: no note required ────────────────────────────

  it("9. no clockInLocation (null/omitted) does not require a note — succeeds (201)", async () => {
    const res = await doClockIn(app, token, {});
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBeNull();
    expect(body.data.clockInLocation).toBeNull();
  });

  // ── 10. Within-range with optional note stored ───────────────────────────

  it("10. within-range clock-in with an optional note stores the note (201)", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: withinRangeLocation(),
      clockInNote: "Working from main clinic reception today",
    });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    expect(body.data.clockInNote).toBe("Working from main clinic reception today");
    expect(body.data.clockInLocation?.locationState).toBe("within");
  });

  // ── 11. Note >500 chars rejected by Zod ─────────────────────────────────

  it("11. note longer than 500 characters is rejected by Zod validation (400)", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: outsideRangeLocation(),
      clockInNote: "A".repeat(501),
    });
    expect(res.status).toBe(400);
  });
});

// ── Clock-out tests ───────────────────────────────────────────────────────────

describe("Staff Timesheet Notes — clock-out enforcement", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
  });

  async function clockInWithinRange(): Promise<string> {
    const res = await doClockIn(app, token, { clockInLocation: withinRangeLocation() });
    expect(res.status).toBe(201);
    return (res.body as ApiData<TimesheetEntry>).data.id;
  }

  // ── 12. Outside-range clock-out: note REQUIRED ───────────────────────────

  it("12. outside-range clock-out without a note is rejected with 422", async () => {
    const id = await clockInWithinRange();
    const res = await doClockOut(app, token, id, { clockOutLocation: outsideRangeLocation() });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_OUT_NOTE_REQUIRED");
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "clockOutNote" })]),
    );
  });

  // ── 13. Outside-range with note → succeeds + note stored ────────────────

  it("13. outside-range clock-out with a valid note succeeds (200) and stores the note", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-22T22:00:00.000Z")); // T0 — clock-in
    try {
      const id = await clockInWithinRange();
      jest.setSystemTime(new Date("2026-09-22T22:05:00.000Z")); // T1 — 5 min later
      const res = await doClockOut(app, token, id, {
        clockOutLocation: outsideRangeLocation(),
        clockOutNote: "Emergency patient — stayed back",
      });
      expect(res.status).toBe(200);
      const body = res.body as ApiData<TimesheetEntry>;
      expect(body.data.clockOutNote).toBe("Emergency patient — stayed back");
      // Geofence result is unchanged — note never alters it
      expect(body.data.clockOutLocation?.locationState).toBe("outside");
      expect(body.data.clockOutLocation?.withinRange).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── 14. Permission denied: note REQUIRED ─────────────────────────────────

  it("14. permission-denied clock-out without a note is rejected with 422", async () => {
    const id = await clockInWithinRange();
    const res = await doClockOut(app, token, id, { clockOutLocation: deniedLocation() });
    expect(res.status).toBe(422);
    const body = res.body as ApiError;
    expect(body.error.code).toBe("CLOCK_OUT_NOTE_REQUIRED");
  });

  // ── 15. Permission denied with note → succeeds ───────────────────────────

  it("15. permission-denied clock-out with a valid note succeeds (200)", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-22T22:00:00.000Z")); // T0 — clock-in
    try {
      const id = await clockInWithinRange();
      jest.setSystemTime(new Date("2026-09-22T22:05:00.000Z")); // T1 — 5 min later
      const res = await doClockOut(app, token, id, {
        clockOutLocation: deniedLocation(),
        clockOutNote: "Location permission unavailable on phone",
      });
      expect(res.status).toBe(200);
      const body = res.body as ApiData<TimesheetEntry>;
      expect(body.data.clockOutNote).toBe("Location permission unavailable on phone");
      expect(body.data.clockOutLocation?.locationState).toBe("denied");
    } finally {
      jest.useRealTimers();
    }
  });

  // ── 16. No clock-out location: no note required ──────────────────────────

  it("16. no clockOutLocation (null/omitted) does not require a note — succeeds (200)", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-22T22:00:00.000Z")); // T0 — clock-in
    try {
      const id = await clockInWithinRange();
      jest.setSystemTime(new Date("2026-09-22T22:05:00.000Z")); // T1 — 5 min later
      const res = await doClockOut(app, token, id, {});
      expect(res.status).toBe(200);
      const body = res.body as ApiData<TimesheetEntry>;
      expect(body.data.clockOutNote).toBeNull();
      expect(body.data.clockOutLocation).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Invariant preservation ────────────────────────────────────────────────────

describe("Staff Timesheet Notes — invariant preservation", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
  });

  // ── 17. Note does NOT alter geofence metadata ────────────────────────────

  it("17. providing a clock-in note does not alter distanceMetres, locationState, or withinRange", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: outsideRangeLocation(),
      clockInNote: "Covering at Heathmont today",
    });
    expect(res.status).toBe(201);
    const body = res.body as ApiData<TimesheetEntry>;
    // Geofence state must be server-computed — the note has no effect on it
    expect(body.data.clockInLocation?.locationState).toBe("outside");
    expect(body.data.clockInLocation?.withinRange).toBe(false);
    expect(typeof body.data.clockInLocation?.distanceMetres).toBe("number");
    expect(body.data.clockInLocation?.distanceMetres).toBeGreaterThan(100);
  });

  // ── 18. Staff notes stay separate from manager-only fields ───────────────

  it("18. clockInNote never appears in approvalNotes or commissionNote", async () => {
    const res = await doClockIn(app, token, {
      clockInLocation: outsideRangeLocation(),
      clockInNote: "Covering at Heathmont today",
    });
    expect(res.status).toBe(201);
    const entry = (res.body as ApiData<TimesheetEntry>).data;
    expect(entry.clockInNote).toBe("Covering at Heathmont today");
    // Manager-authored fields must remain null — note never leaks into them
    expect(entry.approvalNotes).toBeNull();
    expect(entry.commissionNote).toBeNull();
  });
});
