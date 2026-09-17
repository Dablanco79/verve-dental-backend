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

    // Morning shift 07:00–12:00 at clinic A
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, MORN_START, MORN_END);

    // Pre-flight check BEFORE creating the afternoon shift:
    // The morning shift (07:00–12:00) should appear in sameDay when
    // checking for an afternoon slot (13:00–18:00) on the same calendar day.
    const conflictRes = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/conflicts` +
          `?staffUserId=${staffId}` +
          `&start=${encodeURIComponent(h(13))}` +
          `&end=${encodeURIComponent(h(18))}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { data } = conflictRes.body as ApiData<{ overlapping: RosterEntryDto[]; sameDay: RosterEntryDto[] }>;
    expect(data.overlapping).toHaveLength(0);
    expect(data.sameDay.length).toBeGreaterThanOrEqual(1);

    // Actual creation at clinic B (different clinic, non-overlapping) should succeed
    await mkShiftAt(app, token, SEED_CLINIC_B_ID, staffId, h(13), h(18), 201);
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

    // Morning 07:00–12:00 (will overlap with proposed 08:00–17:00)
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, MORN_START, MORN_END);
    // Afternoon 17:00–22:00 (touches proposed end — same day but not overlapping)
    await mkShiftAt(app, token, SEED_CLINIC_A_ID, staffId, AFT_START, AFT_END);

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

    expect(data.overlapping.length).toBeGreaterThanOrEqual(1);  // morning overlaps
    expect(data.sameDay.length).toBeGreaterThanOrEqual(1);      // afternoon is sameDay
    // Afternoon shift must not appear in overlapping
    const aftEntry = data.sameDay.find((e) => new Date(e.shiftStartAt).getTime() === new Date(AFT_START).getTime());
    expect(aftEntry).toBeDefined();
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

    // Clinic B (not home) — should 403
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
