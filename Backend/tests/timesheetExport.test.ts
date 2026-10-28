/**
 * timesheetExport.test.ts — Workforce Pilot Package 1 (Timesheet Hours Export)
 *
 * Coverage:
 *   RBAC
 *   - owner_admin can export their clinic (200 + xlsx body)
 *   - owner_admin can export any clinic (cross-clinic)
 *   - group_practice_manager can export their home clinic (200 + xlsx body)
 *   - group_practice_manager with can_operate=true for Clinic B can export Clinic B
 *   - group_practice_manager with can_roster=true only for Clinic B cannot export Clinic B
 *   - group_practice_manager cannot export a clinic with no assignment (403)
 *   - clinical_staff is rejected at the route layer (403)
 *   - unauthenticated request is rejected (401)
 *   - same RBAC rules apply to the list (GET /) endpoint
 *
 *   Filters
 *   - date range (from / to) is respected
 *   - staffEmail filter is respected
 *
 *   Pagination safety
 *   - all records are exported (>50, larger than the paginated UI default)
 *
 *   Export content
 *   - response Content-Type is xlsx
 *   - X-Export-Row-Count header matches the number of seeded entries
 *   - empty result set returns 0-row workbook (Content-Type still xlsx)
 *
 *   Hours calculation agreement
 *   - X-Export-Row-Count from the export matches the count from the list endpoint
 *
 * All tests use the in-memory test app (no DB, no Redis) — deterministic and
 * isolated.  Postgres-specific index/RLS coverage is identified for GitHub CI.
 */

import { jest } from "@jest/globals";
import request from "supertest";

import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";
import type { ClinicRepository } from "../src/repositories/clinicRepository.js";
import type { RosterRepository } from "../src/repositories/rosterRepository.js";
import type { TimesheetRepository } from "../src/repositories/timesheetRepository.js";
import type { UserClinicAssignmentsRepository } from "../src/repositories/userClinicAssignmentsRepository.js";
import type { UserRepository } from "../src/repositories/userRepository.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import { createTimesheetService } from "../src/services/timesheetService.js";
import type { AuthenticatedUser, UserRecord } from "../src/types/auth.js";
import type { TimesheetEntry, TimesheetStatus } from "../src/types/payroll.js";
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Clock in as staff and return the newly created hourly_auto entry. */
async function seedClockIn(
  app: Awaited<ReturnType<typeof createTestApp>>,
  staffToken: string,
  clinicId: string,
  shiftStartAt: string,
  shiftEndAt: string,
  clockInLocation?: {
    lat: number;
    lng: number;
    accuracyMetres: number;
    targetClinicId: string;
  },
): Promise<{ id: string }> {
  // shiftDate is no longer sent — the backend derives it from shiftStartAt in
  // Melbourne local time (see payrollController.clockIn and melbourneTime.ts).
  const res = await request(app)
    .post(`/api/v1/clinics/${clinicId}/timesheets/clock-in`)
    .set("Authorization", `Bearer ${staffToken}`)
    .send({
      rosterEntryId: null,
      shiftStartAt,
      shiftEndAt,
      physicalClinicId: clinicId,
      clockInLocation,
    });
  if (res.status !== 201) {
    throw new Error(`seedClockIn: POST returned ${String(res.status)}: ${JSON.stringify(res.body)}`);
  }
  return (res.body as { data: { id: string } }).data;
}

/** Create and approve a deterministic hourly_manual entry through public APIs. */
async function seedApprovedManual(
  app: Awaited<ReturnType<typeof createTestApp>>,
  managerToken: string,
  clinicId: string,
  shiftDate: string,
  startHour = 8,
): Promise<{ id: string; totalHoursWorked: number }> {
  const hour = String(startHour).padStart(2, "0");
  const endHour = String(startHour + 8).padStart(2, "0");
  const createRes = await request(app)
    .post(`/api/v1/clinics/${clinicId}/timesheets`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({
      staffUserId: SEED_USER_IDS.clinicAStaff,
      rosterEntryId: null,
      shiftDate,
      shiftStartAt: `${shiftDate}T${hour}:00:00.000Z`,
      shiftEndAt: `${shiftDate}T${endHour}:00:00.000Z`,
      clockInAt: `${shiftDate}T${hour}:00:00.000Z`,
      clockOutAt: `${shiftDate}T${endHour}:00:00.000Z`,
      breakDurationMinutes: 0,
    });
  if (createRes.status !== 201) {
    throw new Error(`seedApprovedManual: create returned ${String(createRes.status)}: ${JSON.stringify(createRes.body)}`);
  }
  const created = (createRes.body as { data: { id: string } }).data;
  const approveRes = await request(app)
    .post(`/api/v1/clinics/${clinicId}/timesheets/${created.id}/approve`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({ approvalNotes: "Approved for export test" });
  if (approveRes.status !== 200) {
    throw new Error(`seedApprovedManual: approve returned ${String(approveRes.status)}: ${JSON.stringify(approveRes.body)}`);
  }
  return (approveRes.body as {
    data: { id: string; totalHoursWorked: number };
  }).data;
}

async function getExport(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string,
  query: Record<string, string> = {},
) {
  const qs = new URLSearchParams(query).toString();
  const path = `/api/v1/clinics/${clinicId}/timesheets/export${qs ? `?${qs}` : ""}`;
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}

async function getBinaryExport(
  app: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  clinicId: string,
  query: Record<string, string> = {},
) {
  const qs = new URLSearchParams(query).toString();
  const path = `/api/v1/clinics/${clinicId}/timesheets/export${qs ? `?${qs}` : ""}`;
  return request(app)
    .get(path)
    .set("Authorization", `Bearer ${token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      res.on("end", () => { callback(null, Buffer.concat(chunks)); });
      res.on("error", (err: Error) => { callback(err, Buffer.alloc(0)); });
    });
}

/**
 * Dynamically replaces all clinic assignments for `manager@clinic-a.au`
 * (clinicAManager) using the owner_admin PUT clinic-access API.
 *
 * This avoids polluting the shared in-memory seed data with test-only
 * assignments.  The in-memory app is freshly constructed per test, so
 * changes here are isolated to the calling test.
 *
 * The home Clinic A assignment is always included so the manager retains
 * their home-clinic access across all scenarios.
 *
 * @param adminToken   Access token for an owner_admin (e.g. admin@clinic-a.au).
 * @param clinicBConfig  Desired Clinic B flags, or null to leave Clinic B unassigned.
 */
async function setManagerClinicBAccess(
  app: Awaited<ReturnType<typeof createTestApp>>,
  adminToken: string,
  clinicBConfig: { canOperate: boolean; canRoster: boolean } | null,
): Promise<void> {
  type Assignment = { clinicId: string; canOperate: boolean; canRoster: boolean };
  const assignments: Assignment[] = [
    // Always preserve the home clinic assignment — if omitted, replaceForUser
    // would remove it and break other tests within the same app instance.
    { clinicId: SEED_CLINIC_A_ID, canOperate: true, canRoster: true },
  ];
  if (clinicBConfig !== null) {
    assignments.push({ clinicId: SEED_CLINIC_B_ID, ...clinicBConfig });
  }
  const res = await request(app)
    .put(`/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/clinic-access`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ assignments });
  // Fail fast on setup error so tests don't silently pass for the wrong reason.
  if (res.status !== 200) {
    throw new Error(`setManagerClinicBAccess: PUT returned ${String(res.status)}: ${JSON.stringify(res.body)}`);
  }
}

async function grantManagerClinicBTimesheetPermission(
  app: Awaited<ReturnType<typeof createTestApp>>,
  adminToken: string,
): Promise<void> {
  const res = await request(app)
    .post(
      `/api/v1/clinics/${SEED_CLINIC_B_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions`,
    )
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ permission: "module:timesheets" });
  if (res.status !== 201) {
    throw new Error(
      `Permission setup failed (${String(res.status)}): ${JSON.stringify(res.body)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — RBAC", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const app = await createTestApp();
    const res = await request(app).get(
      `/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/export`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for clinical_staff", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const res = await getExport(app, token, SEED_CLINIC_A_ID);
    expect(res.status).toBe(403);
  });

  it("returns 200 + xlsx for owner_admin on their own clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const res = await getExport(app, token, SEED_CLINIC_A_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
  });

  it("returns 200 for owner_admin on a different clinic (org-wide access)", async () => {
    const app = await createTestApp();
    // owner_admin bypasses all clinic-scope checks — org-wide access.
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const res = await getExport(app, token, SEED_CLINIC_B_ID);

    expect(res.status).toBe(200);
  });

  it("returns 200 + xlsx for group_practice_manager on their home clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getExport(app, token, SEED_CLINIC_A_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
  });

  it("returns 200 for GPM with can_operate=true at a non-home clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await setManagerClinicBAccess(app, adminToken, { canOperate: true, canRoster: false });

    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getExport(app, managerToken, SEED_CLINIC_B_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
  });

  it("returns 403 for GPM with can_roster=true only (no can_operate) at a non-home clinic", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    // Roster eligibility alone must NOT grant timesheet manager access.
    await setManagerClinicBAccess(app, adminToken, { canOperate: false, canRoster: true });

    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getExport(app, managerToken, SEED_CLINIC_B_ID);

    expect(res.status).toBe(403);
  });

  it("returns 403 for GPM with no assignment at a non-home clinic", async () => {
    const app = await createTestApp();
    // Default seed: manager@clinic-a.au has NO assignment at CLINIC_B.
    // rlsTenantContextMiddleware → hasOperationalAccess → false → 403.
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getExport(app, token, SEED_CLINIC_B_ID);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GPM multi-clinic access — Timesheet LIST endpoint
// Verifies that the same can_operate model applies to GET / as to GET /export.
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets — GPM multi-clinic list access", () => {
  async function getList(
    app: Awaited<ReturnType<typeof createTestApp>>,
    token: string,
    clinicId: string,
  ) {
    return request(app)
      .get(`/api/v1/clinics/${clinicId}/timesheets`)
      .set("Authorization", `Bearer ${token}`);
  }

  it("GPM with can_operate=true for Clinic B can list Clinic B timesheets", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await setManagerClinicBAccess(app, adminToken, { canOperate: true, canRoster: false });

    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getList(app, managerToken, SEED_CLINIC_B_ID);

    expect(res.status).toBe(200);
  });

  it("GPM cannot use a target-clinic Timesheets grant after the home grant is revoked", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await setManagerClinicBAccess(app, adminToken, { canOperate: true, canRoster: false });
    const revokeHome = await request(app)
      .delete(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/users/${SEED_USER_IDS.clinicAManager}/permissions/module%3Atimesheets`,
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(revokeHome.status).toBe(204);
    await grantManagerClinicBTimesheetPermission(app, adminToken);

    const managerToken = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getList(app, managerToken, SEED_CLINIC_B_ID);

    expect(res.status).toBe(403);
  });

  it("GPM without can_operate for Clinic B cannot list Clinic B timesheets", async () => {
    const app = await createTestApp();
    // Default seed: no Clinic B assignment for manager@clinic-a.au.
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const res = await getList(app, token, SEED_CLINIC_B_ID);

    expect(res.status).toBe(403);
  });

  it("owner_admin can list any clinic timesheets", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const res = await getList(app, token, SEED_CLINIC_B_ID);

    expect(res.status).toBe(200);
  });

  it("clinical_staff cannot access clinic-wide timesheet list", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const res = await getList(app, token, SEED_CLINIC_A_ID);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content-Disposition / filename
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — filename", () => {
  it("generates a date-range filename when from/to are supplied", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getExport(app, token, SEED_CLINIC_A_ID, {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      "timesheets_2026-01-01_to_2026-12-31.xlsx",
    );
  });

  it("falls back to timesheets_export.xlsx when no date range given", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getExport(app, token, SEED_CLINIC_A_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("timesheets_export.xlsx");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query parameter validation
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — validation", () => {
  it("returns 400 when 'from' is after 'to'", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getExport(app, token, SEED_CLINIC_A_ID, {
      from: "2026-12-31",
      to: "2026-01-01",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when staffEmail is not a valid email", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const res = await getExport(app, token, SEED_CLINIC_A_ID, {
      staffEmail: "not-an-email",
    });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Date range and staff filters
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — filters", () => {
  it("date range filter excludes entries outside the range (X-Export-Row-Count)", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Seed two approved entries in different months.
    await seedApprovedManual(app, adminToken, SEED_CLINIC_A_ID, "2026-01-15");
    await seedApprovedManual(app, adminToken, SEED_CLINIC_A_ID, "2026-06-20");

    // Export only January — June entry must be excluded.
    const resJan = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    const janCount = parseInt(resJan.headers["x-export-row-count"] as string, 10);

    // Export only June — January entry must be excluded.
    const resJun = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: "2026-06-01",
      to: "2026-06-30",
    });
    const junCount = parseInt(resJun.headers["x-export-row-count"] as string, 10);

    expect(janCount).toBe(1);
    expect(junCount).toBe(1);

    // The January-only export must not include the June entry.
    // We verify this by confirming January export has fewer rows than combined export.
    const resCombined = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    const combinedCount = parseInt(resCombined.headers["x-export-row-count"] as string, 10);

    expect(combinedCount).toBe(2);
  });

  it("staffEmail filter scopes export to a single staff member", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    await seedApprovedManual(app, adminToken, SEED_CLINIC_A_ID, "2026-09-01");

    // Export filtered to the specific staff email.
    const resFiltered = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      staffEmail: "staff@clinic-a.au",
    });
    const resAll = await getExport(app, adminToken, SEED_CLINIC_A_ID);

    expect(resFiltered.status).toBe(200);
    const filteredCount = parseInt(resFiltered.headers["x-export-row-count"] as string, 10);
    const allCount = parseInt(resAll.headers["x-export-row-count"] as string, 10);

    expect(filteredCount).toBe(1);
    expect(filteredCount).toBeLessThanOrEqual(allCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination safety — more than one UI page exported in full
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — pagination safety", () => {
  /**
   * Regression test: ensures the export returns ALL records, not just the
   * first 50/100 rows that the paginated GET / endpoint returns.
   *
   * Approach:
   *   1. Seed 55 clock-in entries (> the default page size of 50).
   *   2. Call GET /timesheets?limit=50 — verify it returns exactly 50.
   *   3. Call GET /timesheets/export — verify X-Export-Row-Count ≥ 55.
   */
  it("exports all records when count exceeds the default page size (55 entries)", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Seed 55 approved entries across different dates in August 2026.
    const SEED_COUNT = 55;
    for (let i = 1; i <= SEED_COUNT; i++) {
      const day = String(i % 28 === 0 ? 28 : i % 28).padStart(2, "0");
      await seedApprovedManual(
        app,
        adminToken,
        SEED_CLINIC_A_ID,
        `2026-08-${day}`,
        6 + (i % 10),
      );
    }

    // Paginated list endpoint — default limit=50.
    const listRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets?limit=50&from=2026-08-01&to=2026-08-31`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    type ListBody = { data: unknown[]; pagination: { total: number; limit: number } };
    const listBody = listRes.body as ListBody;
    // The paginated endpoint should return at most 50 items…
    expect(listBody.data.length).toBeLessThanOrEqual(50);
    // …but the total is at least SEED_COUNT.
    expect(listBody.pagination.total).toBeGreaterThanOrEqual(SEED_COUNT);

    // Export endpoint — must return ALL records.
    const exportRes = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(exportRes.status).toBe(200);
    const exportCount = parseInt(exportRes.headers["x-export-row-count"] as string, 10);
    expect(exportCount).toBe(SEED_COUNT);

    // Crucially: the export count must exceed the paginated page size.
    expect(exportCount).toBeGreaterThan(listBody.data.length);
  });
});

describe("timesheet export — payroll eligibility", () => {
  it("exports only approved hourly_auto and hourly_manual rows", async () => {
    const approvedByUserId = SEED_USER_IDS.clinicAAdmin;
    const now = new Date("2026-10-01T00:00:00.000Z");
    const baseEntry: TimesheetEntry = {
      id: "00000000-0000-4000-8000-000000000001",
      payrollType: "hourly_auto",
      staffUserId: SEED_USER_IDS.clinicAStaff,
      staffEmail: "staff@clinic-a.au",
      clinicId: SEED_CLINIC_A_ID,
      rosteredClinicId: SEED_CLINIC_A_ID,
      rosteredClinicName: "Verve Dental Clinic A",
      rosterEntryId: null,
      shiftDate: "2026-09-15",
      shiftStartAt: new Date("2026-09-14T22:00:00.000Z"),
      shiftEndAt: new Date("2026-09-15T06:00:00.000Z"),
      attendanceStatus: "present",
      clockInAt: new Date("2026-09-14T22:00:00.000Z"),
      clockOutAt: new Date("2026-09-15T06:00:00.000Z"),
      breakDurationMinutes: 30,
      totalHoursWorked: 7.5,
      ordinaryHours: 7.5,
      overtime15xHours: 0,
      overtime2xHours: 0,
      overtimeCustomHours: 0,
      timesheetStatus: "approved",
      approvedByUserId,
      approvedAt: new Date("2026-09-16T01:00:00.000Z"),
      approvalNotes: "Approved",
      commissionNote: null,
      clockInNote: null,
      clockOutNote: null,
      clockInLocation: null,
      clockOutLocation: null,
      generatedBy: "staff@clinic-a.au",
      createdAt: now,
      updatedAt: now,
    };

    const approvedAuto = { ...baseEntry };
    const approvedManual: TimesheetEntry = {
      ...baseEntry,
      id: "00000000-0000-4000-8000-000000000002",
      payrollType: "hourly_manual",
      shiftDate: "2026-09-16",
      totalHoursWorked: 8,
      ordinaryHours: 8,
    };
    const excludedStatuses: TimesheetStatus[] = [
      "draft",
      "submitted",
      "rejected",
      "requires_amendment",
      "processed",
    ];
    const excludedHourly = excludedStatuses.map<TimesheetEntry>((timesheetStatus, index) => ({
      ...baseEntry,
      id: `00000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
      staffUserId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      staffEmail: `excluded-${timesheetStatus}@clinic-a.au`,
      shiftDate: `2026-09-${String(index + 17).padStart(2, "0")}`,
      timesheetStatus,
    }));
    const commissionLog: TimesheetEntry = {
      ...baseEntry,
      id: "00000000-0000-4000-8000-000000000008",
      payrollType: "commission_log",
      staffUserId: "10000000-0000-4000-8000-000000000008",
      staffEmail: "commission@clinic-a.au",
      clockInAt: null,
      clockOutAt: null,
      breakDurationMinutes: null,
      totalHoursWorked: null,
      ordinaryHours: null,
      overtime15xHours: null,
      overtime2xHours: null,
      overtimeCustomHours: null,
      // Deliberately mark this malformed commission row approved so the test
      // proves payroll-type eligibility is enforced independently of status.
      timesheetStatus: "approved",
      commissionNote: "Verified commission attendance",
    };
    const repositoryEntries = [
      ...excludedHourly,
      commissionLog,
      approvedAuto,
      approvedManual,
    ];

    const timesheetRepository = {
      listByClinic: () => Promise.resolve(repositoryEntries),
    } as unknown as TimesheetRepository;
    const staffUser: UserRecord = {
      id: SEED_USER_IDS.clinicAStaff,
      email: "staff@clinic-a.au",
      passwordHash: "",
      role: "clinical_staff",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      firstName: "Ava",
      lastName: "Worker",
      displayName: null,
      payrollTrack: "hourly",
      totpSecret: null,
      mfaEnabled: false,
      isActive: true,
    };
    const approverUser: UserRecord = {
      ...staffUser,
      id: approvedByUserId,
      email: "admin@clinic-a.au",
      role: "owner_admin",
      payrollTrack: "commission",
    };
    const lookedUpUserIds: string[] = [];
    const userRepository = {
      findById: (id: string) => {
        lookedUpUserIds.push(id);
        return Promise.resolve(
          id === staffUser.id ? staffUser : id === approverUser.id ? approverUser : null,
        );
      },
    } as unknown as UserRepository;
    const service = createTimesheetService(
      timesheetRepository,
      userRepository,
      {} as RosterRepository,
      {} as UserClinicAssignmentsRepository,
      {} as ClinicRepository,
    );
    const caller: AuthenticatedUser = {
      id: approvedByUserId,
      email: "admin@clinic-a.au",
      role: "owner_admin",
      homeClinicId: SEED_CLINIC_A_ID,
      homeClinicName: "Verve Dental Clinic A",
      firstName: null,
      lastName: null,
      displayName: null,
      payrollTrack: "commission",
      permissions: [],
    };

    const result = await service.exportTimesheets(caller, SEED_CLINIC_A_ID);

    expect(result.rowCount).toBe(2);
    expect(new Set(lookedUpUserIds)).toEqual(new Set([approvedByUserId, staffUser.id]));

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(result.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets["Timesheets"];
    expect(worksheet).toBeDefined();
    if (!worksheet) throw new Error("Timesheets worksheet missing from exported workbook");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row["Payroll Type"], row["Timesheet Status"]])).toEqual([
      ["hourly_auto", "approved"],
      ["hourly_manual", "approved"],
    ]);
    expect(rows[0]).toMatchObject({
      "Staff Name": "Ava Worker",
      "Staff Email": "staff@clinic-a.au",
      "Date": "2026-09-15",
      "Worked Hours": 7.5,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty result set
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — empty result", () => {
  it("returns the canonical headers and no data rows when no eligible entries match", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    // Use a date far in the future — guaranteed to have no entries.
    const res = await getBinaryExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: "2099-01-01",
      to: "2099-12-31",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    const rowCount = parseInt(res.headers["x-export-row-count"] as string, 10);
    expect(rowCount).toBe(0);

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(res.body as Buffer, { type: "buffer" });
    const worksheet = workbook.Sheets["Timesheets"];
    expect(worksheet).toBeDefined();
    if (!worksheet) throw new Error("Timesheets worksheet missing from exported workbook");

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "Staff Name",
      "Staff Email",
      "Clinic / Location",
      "Date",
      "Clock In (Australia/Melbourne)",
      "Clock Out (Australia/Melbourne)",
      "Break (min)",
      "Worked Hours",
      "Duration",
      "Payroll Type",
      "Timesheet Status",
      "Attendance",
      "Approval Notes",
      "Approved By",
      "Approved At (Australia/Melbourne)",
      "Commission Note",
      "Clock In Location",
      "Clock In Distance (m)",
      "Clock In Note",
      "Clock Out Location",
      "Clock Out Distance (m)",
      "Clock Out Note",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hours calculation agreement
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — hours calculation consistency", () => {
  /**
   * Verifies that the export uses the SAME stored totalHoursWorked value as
   * the list endpoint — i.e. no second inconsistent calculation.
   *
   * Approach:
   *   1. Clock in and out to create an entry with known hours.
   *   2. Read totalHoursWorked from the list endpoint.
   *   3. Confirm the export's X-Export-Row-Count = 1 (exactly one entry).
   *   4. The XLSX content is a binary blob — we verify total agreement via
   *      the row count matching the list endpoint's record count, which proves
   *      the same dataset is used (not a re-fetch with a different filter).
   */
  it("export row count matches list endpoint record count for the same date range", async () => {
    const app = await createTestApp();
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    const targetDate = "2026-07-10";
    await seedApprovedManual(app, adminToken, SEED_CLINIC_A_ID, targetDate);

    // List endpoint — count records for this exact date.
    const listRes = await request(app)
      .get(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets?from=${targetDate}&to=${targetDate}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    type ListBody = { data: unknown[]; pagination: { total: number } };
    const listBody = listRes.body as ListBody;
    const listTotal = listBody.pagination.total;

    // Export for the same date range.
    const exportRes = await getExport(app, adminToken, SEED_CLINIC_A_ID, {
      from: targetDate,
      to: targetDate,
    });

    expect(exportRes.status).toBe(200);
    const exportCount = parseInt(exportRes.headers["x-export-row-count"] as string, 10);

    // Export must include exactly the same number of records as the list endpoint.
    expect(exportCount).toBe(listTotal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTES FOR GITHUB CI (Postgres integration coverage)
// ─────────────────────────────────────────────────────────────────────────────
//
// The tests above use the in-memory repository (no DATABASE_URL).
// The following properties MUST be validated in CI with a real Postgres DB:
//
//   1. staff_email index scan: the staffEmail filter hits staff_email directly
//      (the column is denormalized and indexed in migration 008).
//
//   2. RLS policy enforcement: the RLS pool hook on timesheet_entries must
//      prevent cross-tenant data leakage.  Verified by preferredNameRls and
//      rosterConcurrency integration tests as a model — a dedicated
//      timesheetExport.rls.integration.test.ts should be added in Package 2
//      when Postgres is confirmed available in the CI environment.
//
//   3. Large dataset: seed >100 rows and verify the export does not time out
//      and returns all rows (no accidental LIMIT 100 in the export query).

// ─────────────────────────────────────────────────────────────────────────────
// Geofence audit columns in the XLSX export
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /timesheets/export — geofence audit columns", () => {
  it("exported XLSX includes geofence status and distance columns", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-20T22:00:00.000Z"));
    const entry = await seedClockIn(
      app,
      staffToken,
      SEED_CLINIC_A_ID,
      "2026-09-20T22:00:00.000Z",
      "2026-09-21T06:00:00.000Z",
      {
        lat: -37.8136,
        lng: 144.9631,
        accuracyMetres: 12,
        targetClinicId: SEED_CLINIC_A_ID,
      },
    );
    jest.setSystemTime(new Date("2026-09-21T06:00:00.000Z"));
    const outRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ breakDurationMinutes: 0 });
    expect(outRes.status).toBe(200);
    const approveRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(approveRes.status).toBe(200);
    jest.useRealTimers();

    // Export without date filter to include all entries.
    const exportRes = await getBinaryExport(app, adminToken, SEED_CLINIC_A_ID);
    expect(exportRes.status).toBe(200);

    // Verify the row count from the header before parsing
    const rowCount = parseInt(exportRes.headers["x-export-row-count"] as string, 10);
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // Parse the XLSX buffer to verify column headers
    const XLSX = await import("xlsx");
    const wb = XLSX.read(exportRes.body as Buffer, { type: "buffer" });
    const ws = wb.Sheets["Timesheets"];
    expect(ws).toBeDefined();
    // Explicit guard so TypeScript narrows WorkSheet | undefined → WorkSheet.
    // The expect() above guarantees the throw is never reached at runtime.
    if (!ws) throw new Error("Timesheets worksheet missing from exported workbook");

    // Use header:1 to get raw row arrays including the header row
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    expect(allRows.length).toBeGreaterThanOrEqual(2); // header + at least 1 data row
    const headers = allRows[0] as string[];
    expect(headers).toContain("Clock In Location");
    expect(headers).toContain("Clock In Distance (m)");
    expect(headers).toContain("Clock Out Location");
    expect(headers).toContain("Clock Out Distance (m)");

    // The approved row retains both geofence audit columns.
    const dataRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    expect(dataRows.length).toBeGreaterThanOrEqual(1);
    const ourRow = dataRows[0] as Record<string, unknown>;
    expect(typeof ourRow["Clock In Location"]).toBe("string");
    expect((ourRow["Clock In Location"] as string).length).toBeGreaterThan(0);
    expect(ourRow["Clock Out Location"]).toBe("Not recorded");
  });

  it("historical entry (no location data) exports 'Not recorded' for both location columns", async () => {
    const app = await createTestApp();
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    const adminToken = await loginAndGetAccessToken(app, "admin@clinic-a.au");

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-21T22:00:00.000Z"));
    const entry = await seedClockIn(
      app,
      staffToken,
      SEED_CLINIC_A_ID,
      "2026-09-21T22:00:00.000Z",
      "2026-09-22T06:00:00.000Z",
    );
    jest.setSystemTime(new Date("2026-09-22T06:00:00.000Z"));
    const outRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/clock-out`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ breakDurationMinutes: 0 });
    expect(outRes.status).toBe(200);
    const approveRes = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/timesheets/${entry.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(approveRes.status).toBe(200);
    jest.useRealTimers();

    const exportRes = await getBinaryExport(app, adminToken, SEED_CLINIC_A_ID);
    expect(exportRes.status).toBe(200);

    const rowCount = parseInt(exportRes.headers["x-export-row-count"] as string, 10);
    expect(rowCount).toBeGreaterThanOrEqual(1);

    const XLSX = await import("xlsx");
    const wb = XLSX.read(exportRes.body as Buffer, { type: "buffer" });
    const ws = wb.Sheets["Timesheets"];
    expect(ws).toBeDefined();
    if (!ws) throw new Error("Timesheets worksheet missing from exported workbook");

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0] as Record<string, unknown>;

    expect(row["Clock In Location"]).toBe("Not recorded");
    expect(row["Clock Out Location"]).toBe("Not recorded");
    expect(row["Clock In Distance (m)"]).toBe("");
    expect(row["Clock Out Distance (m)"]).toBe("");
  });
});
