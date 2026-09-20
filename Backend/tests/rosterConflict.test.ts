/**
 * Roster conflict detection tests — unit-level (in-memory repository).
 *
 * Each test creates a fresh app instance to prevent in-memory state
 * from accumulating between tests.
 *
 * Covers:
 *   1. Same staff + same clinic, overlapping → ROSTER_CONFLICT (409)
 *   2. Same staff + different clinics, overlapping → ROSTER_CONFLICT (409)
 *   3. Partial overlap → ROSTER_CONFLICT (409)
 *   4. Touching shifts (existing.end === proposed.start) → allowed (201)
 *   5. Same day, non-overlapping → allowed (201); /conflicts surfaces sameDay
 *   6. Edit a shift: same times + excludeEntryId → no self-conflict (200)
 *   7. /conflicts endpoint separates overlapping vs sameDay correctly
 *   8. clinical_staff cannot call /conflicts (403)
 *   9. GPM home-clinic allowed; different clinic 403
 */
import request from "supertest";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

// ── Time constants ────────────────────────────────────────────────────────────

const BASE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
BASE.setHours(0, 0, 0, 0);

const h = (offset: number) =>
  new Date(BASE.getTime() + offset * 60 * 60 * 1000).toISOString();

const MORN_START = h(7);   // 07:00
const MORN_END   = h(12);  // 12:00
const STD_START  = h(8);   // 08:00
const STD_END    = h(17);  // 17:00
const AFT_START  = h(17);  // 17:00 — touching STD_END
const AFT_END    = h(22);  // 22:00
const NEXT_START = h(32);  // next day 08:00
const NEXT_END   = h(40);  // next day 16:00

// ── Helpers ───────────────────────────────────────────────────────────────────

type ApiData<T> = { data: T };
type ApiError = { error: { code: string; message: string } };

type RosterEntryDto = {
  id: string;
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  shiftStartAt: string;
  shiftEndAt: string;
  shiftType: string;
  status: string;
  notes: string | null;
  createdByUserId: string;
};

async function mkShiftAt(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string,
  staffUserId: string,
  startAt: string,
  endAt: string,
  expectStatus = 201,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/clinics/${clinicId}/roster`)
    .set("Authorization", `Bearer ${token}`)
    .send({ staffUserId, shiftStartAt: startAt, shiftEndAt: endAt, shiftType: "standard", notes: null })
    .expect(expectStatus);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Cross-clinic roster conflict detection", () => {
  // ─── Test 1: same clinic, overlapping → rejected ──────────────────────────

  it("rejects overlapping shift at the same clinic (same staff)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, STD_START, STD_END);

    // Inner overlap 09:00–16:00
    const res = await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, h(9), h(16), 409);
    expect((res.body as ApiError).error.code).toBe("ROSTER_CONFLICT");
  });

  // ─── Test 2: different clinics, overlapping → rejected ────────────────────

  it("rejects overlapping shift at a different clinic (same staff)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicBAdmin; // owner_admin → eligible everywhere

    // Seed at clinic A
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, STD_START, STD_END);

    // Attempt overlapping shift at clinic B
    const res = await mkShiftAt(app, token, SEED_CLINIC_B_ID, staffId, h(10), h(14), 409);
    expect((res.body as ApiError).error.code).toBe("ROSTER_CONFLICT");
  });

  // ─── Test 3: partial overlap → rejected ───────────────────────────────────

  it("rejects a partially overlapping shift", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, STD_START, STD_END);

    // Starts during STD shift (14:00), ends after (20:00)
    const res = await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, h(14), h(20), 409);
    expect((res.body as ApiError).error.code).toBe("ROSTER_CONFLICT");
  });

  // ─── Test 4: touching → allowed ───────────────────────────────────────────

  it("allows a shift that starts exactly when the previous ends (touching)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, STD_START, STD_END);

    // AFT_START === STD_END → touching, not overlapping
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, AFT_START, AFT_END, 201);
  });

  // ─── Test 5: same day, non-overlapping → allowed; sameDay surfaced ────────

  it("allows same-day non-overlapping shifts; /conflicts returns them as sameDay", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    // Morning shift 07:00–12:00 UTC at clinic A.
    // h(7)/h(12) = UTC 07:00–12:00. In AEST (UTC+10) = Melbourne 17:00–22:00 Day N;
    // in AEDT (UTC+11) = Melbourne 18:00–23:00 Day N.  Both are on Melbourne Day N.
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, MORN_START, MORN_END);

    // Proposed afternoon slot — must be on the same Melbourne Day N as MORN.
    //
    // WHY NOT h(13): BASE = Date.now() + 14 days anchored to UTC midnight.
    // When the test runs on Sep 20 CI, BASE = Oct 4 2026 UTC midnight.
    // Australia's DST transition (AEST → AEDT) is Oct 4 at 02:00 AEST = UTC 16:00 Oct 3,
    // meaning all h() offsets on Oct 4 UTC are already in AEDT (UTC+11).
    // h(13) = UTC 13:00 Oct 4 = AEDT 00:00 Oct 5 = Melbourne midnight = Day N+1.
    // melbourneDayWindow(h(13)) returns Day N+1; MORN is on Day N → sameDay empty → fail.
    //
    // SAFE WINDOW: UTC 12:30–12:55.
    //   AEST (UTC+10): Melbourne 22:30–22:55 Oct 4 = Day N ✓
    //   AEDT (UTC+11): Melbourne 23:30–23:55 Oct 4 = Day N ✓
    // Both representations are on Melbourne Day N regardless of which DST leg is active.
    const SAFE_AFT_START = new Date(BASE.getTime() + (12 * 60 + 30) * 60 * 1000).toISOString();
    const SAFE_AFT_END   = new Date(BASE.getTime() + (12 * 60 + 55) * 60 * 1000).toISOString();

    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(SAFE_AFT_START)}` +
          `&end=${encodeURIComponent(SAFE_AFT_END)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    expect(data.overlapping).toHaveLength(0);
    expect(data.sameDay.length).toBeGreaterThanOrEqual(1);

    // Actual creation at clinic B (different clinic, non-overlapping) should succeed.
    await mkShiftAt(app, token, SEED_CLINIC_B_ID, staffId, SAFE_AFT_START, SAFE_AFT_END, 201);
  });

  // ─── Test 6: edit does not conflict with itself ────────────────────────────

  it("does not conflict with itself during an edit (excludeEntryId)", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    const seedRes = await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, STD_START, STD_END);
    const created = (seedRes.body as ApiData<RosterEntryDto>).data;

    // PATCH same times — must not 409 (self-conflict)
    const patchRes = await request(app)
      .patch(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ shiftStartAt: STD_START, shiftEndAt: STD_END, shiftType: "overtime" })
      .expect(200);

    expect((patchRes.body as ApiData<RosterEntryDto>).data.shiftType).toBe("overtime");

    // /conflicts with excludeEntryId must not include the entry itself
    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(STD_START)}` +
          `&end=${encodeURIComponent(STD_END)}` +
          `&excludeEntryId=${created.id}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    expect(data.overlapping.some((e) => e.id === created.id)).toBe(false);
  });

  // ─── Test 7: /conflicts buckets overlapping vs sameDay ────────────────────

  it("/conflicts separates strict overlaps from same-day-only shifts", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicBAdmin;

    // In Melbourne (AEST = UTC+10), BASE is UTC midnight = Melbourne 10:00 AEST.
    // Melbourne Day N window = UTC [Day N-1 14:00, Day N 13:59:59].
    //
    // Proposed (STD): h(8)–h(17) = 08:00–17:00 UTC = 18:00 AEST Day N → 03:00 AEST Day N+1
    //
    // Overlapping fixture: MORN h(7)–h(12) = 07:00–12:00 UTC = 17:00–22:00 AEST Day N
    //   overlaps (morn_start 07 < proposed_end 17, morn_end 12 > proposed_start 08)
    //
    // Same-day-only fixture: h(0)–h(6) = 00:00–06:00 UTC = 10:00–16:00 AEST Day N
    //   within Melbourne Day N window ✓, shift_end 06:00 UTC < proposed_start 08:00 UTC → no overlap ✓
    //
    // AFT_START (h(17) = 17:00 UTC = 03:00 AEST Day N+1) was the original fixture but falls on
    // the *next* Melbourne calendar day, so it was correctly excluded by melbourneDayWindow.
    // The fixture was stale (authored with UTC-day assumptions, not Melbourne-day awareness).
    const SAME_DAY_START = h(0);  // 00:00 UTC = 10:00 AEST Day N — same Melbourne day, no overlap
    const SAME_DAY_END   = h(6);  // 06:00 UTC = 16:00 AEST Day N — ends 2 h before proposed

    // Overlapping shift (MORN)
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, MORN_START, MORN_END);
    // Same-day non-overlapping shift
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, SAME_DAY_START, SAME_DAY_END);

    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(STD_START)}` +
          `&end=${encodeURIComponent(STD_END)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;

    expect(data.overlapping.length).toBeGreaterThanOrEqual(1);  // MORN overlaps
    expect(data.sameDay.length).toBeGreaterThanOrEqual(1);      // same-day-only appears
    // Same-day shift must be present and must not appear in overlapping
    const sameDayEntry = data.sameDay.find(
      (e) => new Date(e.shiftStartAt).getTime() === new Date(SAME_DAY_START).getTime(),
    );
    expect(sameDayEntry).toBeDefined();
  });

  // ─── Test 8: clinical_staff cannot call /conflicts ─────────────────────────

  it("returns 403 when clinical_staff calls /conflicts", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");

    await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${SEED_USER_IDS.clinicAStaff}` +
          `&start=${encodeURIComponent(STD_START)}` +
          `&end=${encodeURIComponent(STD_END)}`,
      )
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(403);
  });

  // ─── Test 9: GPM home-clinic OK; different clinic 403 ─────────────────────

  it("GPM can call /conflicts for their home clinic only", async () => {
    const app = await createTestApp();
    const gpmToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Home clinic A — should succeed
    await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${SEED_USER_IDS.clinicAStaff}` +
          `&start=${encodeURIComponent(NEXT_START)}` +
          `&end=${encodeURIComponent(NEXT_END)}`,
      )
      .set("Authorization", `Bearer ${gpmToken}`)
      .expect(200);

    // Clinic B (not home, no can_operate assignment) — should 403
    await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_B_ID}/roster/conflicts` +
          `?staffUserId=${SEED_USER_IDS.clinicBAdmin}` +
          `&start=${encodeURIComponent(NEXT_START)}` +
          `&end=${encodeURIComponent(NEXT_END)}`,
      )
      .set("Authorization", `Bearer ${gpmToken}`)
      .expect(403);
  });
});

// ─── Melbourne timezone conflict tests ─────────────────────────────────────────

describe("Melbourne timezone same-day comparison", () => {
  // UTC timestamps for 21 Sep 2026 and 22 Sep 2026 in Melbourne (AEST = UTC+10)
  // 21 Sep AEST 08:00 = 2026-09-20T22:00:00Z
  // 21 Sep AEST 17:00 = 2026-09-21T07:00:00Z
  // 22 Sep AEST 08:00 = 2026-09-21T22:00:00Z
  // 22 Sep AEST 17:00 = 2026-09-22T07:00:00Z
  const EXISTING_START = "2026-09-20T22:00:00.000Z"; // 21 Sep 08:00 AEST
  const EXISTING_END   = "2026-09-21T07:00:00.000Z"; // 21 Sep 17:00 AEST
  const PROPOSED_START = "2026-09-21T22:00:00.000Z"; // 22 Sep 08:00 AEST
  const PROPOSED_END   = "2026-09-22T07:00:00.000Z"; // 22 Sep 17:00 AEST

  it("proposed shift on 22 Sep AEST does NOT trigger same-day warning for existing shift on 21 Sep AEST", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    // Create existing shift on 21 Sep AEST
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, EXISTING_START, EXISTING_END, 201);

    // Check conflicts for proposed shift on 22 Sep AEST
    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(PROPOSED_START)}` +
          `&end=${encodeURIComponent(PROPOSED_END)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    // Different Melbourne calendar days → sameDay must be empty
    expect(data.overlapping).toHaveLength(0);
    expect(data.sameDay).toHaveLength(0);
  });

  it("adjacent Melbourne local dates do not trigger same-day warning", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    // Shift ending at 23:00 AEST on 21 Sep = 2026-09-21T13:00:00Z
    const lateShiftStart = "2026-09-21T07:00:00.000Z";  // 17:00 AEST 21 Sep
    const lateShiftEnd   = "2026-09-21T13:00:00.000Z";  // 23:00 AEST 21 Sep

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, lateShiftStart, lateShiftEnd, 201);

    // Proposed shift starting at 00:30 AEST on 22 Sep = 2026-09-21T14:30:00Z
    const nextDayStart = "2026-09-21T14:30:00.000Z"; // 00:30 AEST 22 Sep
    const nextDayEnd   = "2026-09-21T23:00:00.000Z"; // 09:00 AEST 22 Sep

    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(nextDayStart)}` +
          `&end=${encodeURIComponent(nextDayEnd)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    // Different Melbourne calendar days → no sameDay warning
    expect(data.overlapping).toHaveLength(0);
    expect(data.sameDay).toHaveLength(0);
  });

  it("genuine same-day non-overlapping shifts in Melbourne produce amber sameDay result", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    // Morning on 22 Sep AEST: 08:00–12:00 = 22:00–02:00 UTC
    const mornStart = "2026-09-21T22:00:00.000Z"; // 08:00 AEST 22 Sep
    const mornEnd   = "2026-09-22T02:00:00.000Z"; // 12:00 AEST 22 Sep

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, mornStart, mornEnd, 201);

    // Afternoon on 22 Sep AEST: 14:00–18:00 = 04:00–08:00 UTC
    const aftStart = "2026-09-22T04:00:00.000Z"; // 14:00 AEST 22 Sep
    const aftEnd   = "2026-09-22T08:00:00.000Z"; // 18:00 AEST 22 Sep

    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(aftStart)}` +
          `&end=${encodeURIComponent(aftEnd)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    // Same Melbourne calendar day, no time overlap → sameDay warning
    expect(data.overlapping).toHaveLength(0);
    expect(data.sameDay).toHaveLength(1);
  });

  it("genuine overlap on the same Melbourne day remains blocked", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const staffId = SEED_USER_IDS.clinicAStaff;

    // Shift 08:00–17:00 AEST on 22 Sep
    const existStart = "2026-09-21T22:00:00.000Z"; // 08:00 AEST 22 Sep
    const existEnd   = "2026-09-22T07:00:00.000Z"; // 17:00 AEST 22 Sep

    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, existStart, existEnd, 201);

    // Attempt overlapping 10:00–14:00 AEST on 22 Sep → conflict
    const overlapStart = "2026-09-22T00:00:00.000Z"; // 10:00 AEST 22 Sep
    const overlapEnd   = "2026-09-22T04:00:00.000Z"; // 14:00 AEST 22 Sep

    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(overlapStart)}` +
          `&end=${encodeURIComponent(overlapEnd)}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    expect(data.overlapping).toHaveLength(1);
    expect(data.sameDay).toHaveLength(0);
  });
});
