/**
 * laborForecastService.test.ts
 *
 * Comprehensive unit test suite for createLaborForecastService.
 *
 * All tests use in-memory repository implementations only — no database or
 * network access is required.  The suite is safe to run in CI and locally
 * without any external dependencies.
 *
 * Coverage targets:
 *   ✓ Tenant guard: group_practice_manager querying a foreign clinic
 *     → 403 TENANT_ACCESS_DENIED
 *   ✓ Tenant guard: clinical_staff querying a foreign clinic
 *     → 403 TENANT_ACCESS_DENIED
 *   ✓ RBAC gate: clinical_staff querying their own home clinic
 *     → 403 INSUFFICIENT_PERMISSIONS (financial data is always off-limits)
 *   ✓ owner_admin is permitted to query any clinic cross-tenant
 *   ✓ group_practice_manager is permitted to query their own clinic
 *   ✓ Empty clinic (no upcoming shifts) → zero totals, empty breakdownByRole
 *   ✓ Single shift with no history → uses scheduled duration (no calibration)
 *   ✓ Single shift with approved history → per-staff avg hours used
 *   ✓ Multiple historical timesheets for same staff → correct per-staff avg
 *   ✓ Staff with no history → falls back to clinic-wide avg hours
 *   ✓ No clinic-wide history at all → falls back to scheduled shift duration
 *   ✓ Overhead multiplier 1.15: overheadCost = baseCost × 0.15
 *   ✓ Cancelled shifts are excluded from the projection entirely
 *   ✓ Confirmed and completed (non-cancelled) shifts ARE included
 *   ✓ forecastDays option: shifts outside the window are excluded
 *   ✓ Multiple shift types → separate RoleLaborProjection rows
 *   ✓ Multiple shifts of the same type grouped into one row
 *   ✓ breakdownByRole sorted alphabetically by role name
 *   ✓ Grand totals equal the arithmetic sum of per-role breakdown rows
 *   ✓ round2dp eliminates IEEE 754 floating-point drift in hours and currency
 *   ✓ forecastWindowDays reflects the option value applied (default 14)
 *   ✓ CLINIC_WIDE_FALLBACK_RATE applied when no staff have any timesheet history
 *   ✓ DEFAULT_HOURLY_RATE applied for a shift type when its staff have history
 *   ✓ Clinic-wide blended rate applied to a shift type whose staff lack history
 *   ✓ Cross-clinic isolation: only shifts for the queried clinic are counted
 */

import { createLaborForecastService } from "../src/services/laborForecastService.js";
import { createInMemoryRosterRepository } from "../src/repositories/rosterRepository.js";
import { createInMemoryTimesheetRepository } from "../src/repositories/timesheetRepository.js";

import type { RosterRepository } from "../src/repositories/rosterRepository.js";
import type { TimesheetRepository } from "../src/repositories/timesheetRepository.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { CreateTimesheetEntryInput } from "../src/types/payroll.js";
import type { ShiftType } from "../src/types/roster.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_A_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CLINIC_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_USER_ID_A = "cccccccc-0000-0000-0000-000000000003";
const STAFF_USER_ID_B = "dddddddd-0000-0000-0000-000000000004";
const MANAGER_USER_ID = "eeeeeeee-0000-0000-0000-000000000005";

const callerAdmin: AuthenticatedUser = {
  id: MANAGER_USER_ID,
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: CLINIC_A_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

const callerManagerA: AuthenticatedUser = {
  id: MANAGER_USER_ID,
  email: "manager@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: CLINIC_A_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

const callerStaffA: AuthenticatedUser = {
  id: STAFF_USER_ID_A,
  email: "staff@clinic-a.au",
  role: "clinical_staff",
  homeClinicId: CLINIC_A_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a date N days ago as a YYYY-MM-DD string. */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Seeds a roster shift in the future window.
 *
 * The shift starts at 08:00 UTC on the given day offset.  Duration defaults
 * to 9 hours (08:00–17:00) to match the forecastService.test.ts convention.
 *
 * Returns the staffUserId used so callers can cross-reference it with
 * timesheet helpers.
 */
async function seedShift(
  rosterRepo: RosterRepository,
  opts: {
    clinicId: string;
    staffUserId?: string;
    staffEmail?: string;
    shiftType?: ShiftType;
    daysFromNow?: number;
    durationHours?: number;
    status?: "scheduled" | "confirmed" | "completed" | "cancelled";
  },
): Promise<string> {
  const staffUserId = opts.staffUserId ?? STAFF_USER_ID_A;
  const daysFromNow = opts.daysFromNow ?? 1;
  const durationHours = opts.durationHours ?? 9;
  const shiftType = opts.shiftType ?? "standard";
  const status = opts.status ?? "scheduled";

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysFromNow);
  start.setUTCHours(8, 0, 0, 0);

  const end = new Date(start.getTime() + durationHours * 3_600_000);

  const entry = await rosterRepo.createEntry({
    staffUserId,
    staffEmail: opts.staffEmail ?? "staff@clinic-a.au",
    rosteredClinicId: opts.clinicId,
    rosteredClinicName: "Clinic A",
    shiftStartAt: start,
    shiftEndAt: end,
    shiftType,
    notes: null,
    createdByUserId: MANAGER_USER_ID,
    createdByEmail: "manager@clinic-a.au",
  });

  if (status !== "scheduled") {
    await rosterRepo.updateEntry(
      entry.id,
      { status },
      { userId: MANAGER_USER_ID, email: "manager@clinic-a.au" },
    );
  }

  return staffUserId;
}

/**
 * Seeds an approved hourly_auto timesheet entry within the 30-day historical
 * lookback window (default: 7 days ago).
 *
 * Approved hourly timesheets are the data source the service uses to build
 * per-staff average hours-per-shift calibration maps.  Commission_log entries
 * are intentionally excluded by the service's `timesheetStatus: "approved"`
 * filter (commission entries have null timesheetStatus).
 */
async function seedApprovedTimesheet(
  timesheetRepo: TimesheetRepository,
  opts: {
    clinicId: string;
    staffUserId?: string;
    totalHoursWorked: number;
    shiftDateDaysAgo?: number;
  },
): Promise<void> {
  const staffUserId = opts.staffUserId ?? STAFF_USER_ID_A;
  const shiftDate = daysAgoStr(opts.shiftDateDaysAgo ?? 7);

  const input: CreateTimesheetEntryInput = {
    payrollType: "hourly_auto",
    staffUserId,
    staffEmail: "staff@clinic-a.au",
    clinicId: opts.clinicId,
    rosteredClinicId: opts.clinicId,
    rosteredClinicName: "Clinic A",
    rosterEntryId: null,
    shiftDate,
    shiftStartAt: new Date(`${shiftDate}T08:00:00.000Z`),
    shiftEndAt: new Date(`${shiftDate}T17:00:00.000Z`),
    attendanceStatus: "present",
    clockInAt: new Date(`${shiftDate}T08:00:00.000Z`),
    clockOutAt: new Date(`${shiftDate}T17:00:00.000Z`),
    breakDurationMinutes: 0,
    totalHoursWorked: opts.totalHoursWorked,
    ordinaryHours: opts.totalHoursWorked,
    overtime15xHours: null,
    overtime2xHours: null,
    overtimeCustomHours: null,
    commissionNote: null,
    generatedBy: "system_auto",
  };

  const entry = await timesheetRepo.create(input);

  await timesheetRepo.update(entry.id, {
    timesheetStatus: "approved",
    approvedByUserId: MANAGER_USER_ID,
    approvedAt: new Date(),
    approvalNotes: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Access control (tenant guard + RBAC gate)
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — access control", () => {
  it("throws 403 TENANT_ACCESS_DENIED when group_practice_manager queries a foreign clinic", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    // callerManagerA.homeClinicId = CLINIC_A_ID; querying CLINIC_B_ID is forbidden.
    await expect(
      svc.getLaborForecast(callerManagerA, CLINIC_B_ID),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED", statusCode: 403 });
  });

  it("throws 403 TENANT_ACCESS_DENIED when clinical_staff queries a foreign clinic", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    // callerStaffA.homeClinicId = CLINIC_A_ID; querying CLINIC_B_ID is forbidden.
    await expect(
      svc.getLaborForecast(callerStaffA, CLINIC_B_ID),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED", statusCode: 403 });
  });

  it("throws 403 INSUFFICIENT_PERMISSIONS when clinical_staff queries their own home clinic", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    // Financial cost data must never be visible to clinical_staff — even for
    // their own clinic.  The RBAC gate fires AFTER the tenant guard passes.
    await expect(
      svc.getLaborForecast(callerStaffA, CLINIC_A_ID),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_PERMISSIONS", statusCode: 403 });
  });

  it("permits owner_admin to query a clinic other than their own homeClinicId", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    // callerAdmin.homeClinicId = CLINIC_A_ID; cross-clinic query of CLINIC_B_ID must succeed.
    await expect(
      svc.getLaborForecast(callerAdmin, CLINIC_B_ID),
    ).resolves.toMatchObject({ clinicId: CLINIC_B_ID });
  });

  it("permits group_practice_manager to query their own clinic", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    await expect(
      svc.getLaborForecast(callerManagerA, CLINIC_A_ID),
    ).resolves.toMatchObject({ clinicId: CLINIC_A_ID });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Empty-clinic baseline
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — empty clinic", () => {
  it("returns zero totals and an empty breakdownByRole when there are no upcoming shifts", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.clinicId).toBe(CLINIC_A_ID);
    expect(result.forecastWindowDays).toBe(14);
    expect(result.totalProjectedHours).toBe(0);
    expect(result.totalProjectedBaseCost).toBe(0);
    expect(result.totalProjectedOverheadCost).toBe(0);
    expect(result.grandTotalProjectedCost).toBe(0);
    expect(result.breakdownByRole).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Hours projection and calibration
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — hours projection", () => {
  it("uses the scheduled shift duration when no approved timesheet history exists", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Single 9-hour standard shift; no historical timesheets at this clinic.
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, durationHours: 9 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    expect(row?.role).toBe("standard");
    expect(row?.totalScheduledHours).toBe(9);
  });

  it("calibrates projected hours from the per-staff historical average", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A's approved history shows they typically clock 7.5 hours.
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 7.5,
    });

    // Upcoming shift for Staff A is scheduled for 9 hours (08:00–17:00).
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    // Historical avg (7.5h) should override the 9h scheduled duration.
    expect(row?.totalScheduledHours).toBe(7.5);
  });

  it("averages multiple historical timesheets into a single per-staff projection", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Three historical entries: (6 + 8 + 7) / 3 = 7.0 hours average.
    await seedApprovedTimesheet(timesheetRepo, { clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, totalHoursWorked: 6, shiftDateDaysAgo: 5 });
    await seedApprovedTimesheet(timesheetRepo, { clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, totalHoursWorked: 8, shiftDateDaysAgo: 10 });
    await seedApprovedTimesheet(timesheetRepo, { clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, totalHoursWorked: 7, shiftDateDaysAgo: 15 });

    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.breakdownByRole[0]?.totalScheduledHours).toBeCloseTo(7.0, 5);
  });

  it("uses the clinic-wide average hours for staff who have no personal history", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A has one approved timesheet → clinic-wide avg = 8h.
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 8,
    });

    // Staff B has NO history; their 9-hour scheduled shift should project at 8h (clinic avg).
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    expect(row?.totalScheduledHours).toBe(8);
  });

  it("falls back to scheduled shift duration when no clinic-wide history exists at all", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // No approved timesheets at this clinic — the scheduled duration must be used directly.
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      durationHours: 8,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.breakdownByRole[0]?.totalScheduledHours).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Cost calculations and multipliers
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — cost calculations", () => {
  it("applies the DEFAULT_HOURLY_RATE for standard when the shift type has historical coverage", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A has history → hasHistoryCoverage = true → DEFAULT rate $50/hr applies.
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 9,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftType: "standard",
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole.find((r) => r.role === "standard");

    // 5000 c/hr × 9h = 45000 c (AUD 450.00)
    expect(row?.projectedBaseCost).toBe(45000);
  });

  it("applies the 1.15 overhead multiplier: overheadCost = baseCost × 0.15", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 9,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftType: "standard",
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    // baseCostCents = 45000; overheadCents = round(45000 × 0.15) = 6750; total = 51750
    expect(row?.projectedBaseCost).toBe(45000);
    expect(row?.projectedOverheadCost).toBe(6750);
    expect(row?.totalProjectedCost).toBe(51750);
  });

  it("computes correct costs for an overtime shift (7500 c/hr rate)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Overtime coverage to trigger DEFAULT rate (7500 c/hr = AUD 75.00/hr).
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 9,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftType: "overtime",
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole.find((r) => r.role === "overtime");

    // 7500 c/hr × 9h = 67500 c; overhead = round(67500 × 0.15) = 10125 c; total = 77625 c
    expect(row?.projectedBaseCost).toBe(67500);
    expect(row?.projectedOverheadCost).toBe(10125);
    expect(row?.totalProjectedCost).toBe(77625);
  });

  it("round2dp eliminates IEEE 754 floating-point drift in projected hours; cents eliminate cost drift", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A's average is 1.1h. Three upcoming shifts → accumulated sum =
    // 1.1 + 1.1 + 1.1 = 3.3000000000000003 in IEEE 754 arithmetic.
    // round2dp must normalise this to exactly 3.30 before cost multiplication.
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 1.1,
    });
    for (let day = 1; day <= 3; day++) {
      await seedShift(rosterRepo, {
        clinicId: CLINIC_A_ID,
        staffUserId: STAFF_USER_ID_A,
        durationHours: 1.1,
        daysFromNow: day,
      });
    }

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    // Accumulated 1.1 × 3 = 3.3000000000000003 → round2dp → 3.3
    expect(row?.totalScheduledHours).toBe(3.3);
    // baseCostCents = Math.round(3.3 × 5000) = 16500 c (AUD 165.00)
    expect(row?.projectedBaseCost).toBe(16500);
    // overheadCents = Math.round(16500 × 0.15) = 2475 c (AUD 24.75)
    expect(row?.projectedOverheadCost).toBe(2475);
    // totalCents = 16500 + 2475 = 18975 c (AUD 189.75)
    expect(row?.totalProjectedCost).toBe(18975);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Shift filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — shift filtering", () => {
  it("excludes cancelled shifts from the projection entirely", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, status: "cancelled" });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.breakdownByRole).toHaveLength(0);
    expect(result.grandTotalProjectedCost).toBe(0);
  });

  it("includes confirmed shifts (only cancelled is excluded)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, status: "confirmed", daysFromNow: 1 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    // One confirmed 9-hour shift must appear in the projection.
    expect(result.totalProjectedHours).toBe(9);
  });

  it("includes completed shifts in the forward projection window", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, status: "completed", daysFromNow: 1 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.totalProjectedHours).toBe(9);
  });

  it("excludes shifts outside the forecastDays window", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    // Day 3 is inside a 5-day window; day 8 falls outside it.
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, daysFromNow: 3 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, daysFromNow: 8 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID, { forecastDays: 5 });

    // Only the day-3 shift (9 hours) should be projected.
    expect(result.totalProjectedHours).toBe(9);
    expect(result.forecastWindowDays).toBe(5);
  });

  it("isolates projection to the queried clinic — cross-clinic shifts do not leak", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    // One shift for Clinic A and one for Clinic B.
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, daysFromNow: 1 });
    await seedShift(rosterRepo, { clinicId: CLINIC_B_ID, daysFromNow: 2 });

    // Query Clinic A only — must not include the Clinic B shift.
    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.totalProjectedHours).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Multi-role aggregation and sorting
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — multi-role aggregation", () => {
  it("produces a separate RoleLaborProjection row for each distinct shift type", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 1 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "overtime", daysFromNow: 2 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "on_call", daysFromNow: 3 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const roles = result.breakdownByRole.map((r) => r.role);

    expect(result.breakdownByRole).toHaveLength(3);
    expect(roles).toContain("standard");
    expect(roles).toContain("overtime");
    expect(roles).toContain("on_call");
  });

  it("groups multiple shifts of the same type into one aggregated row", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    // Three standard shifts of 9h each → should produce a single row with 27h.
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 1 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 2 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 3 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.breakdownByRole).toHaveLength(1);
    expect(result.breakdownByRole[0]?.totalScheduledHours).toBe(27);
  });

  it("sorts breakdownByRole alphabetically by role name for stable output", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 1 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "on_call", daysFromNow: 2 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "overtime", daysFromNow: 3 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const roles = result.breakdownByRole.map((r) => r.role);

    // Alphabetical: "on_call" < "overtime" < "standard"
    expect(roles).toEqual(["on_call", "overtime", "standard"]);
  });

  it("grand totals equal the arithmetic sum of all per-role breakdown rows", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "standard", daysFromNow: 1 });
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, shiftType: "overtime", daysFromNow: 2 });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    const sumHours = result.breakdownByRole.reduce((s, r) => s + r.totalScheduledHours, 0);
    const sumBase = result.breakdownByRole.reduce((s, r) => s + r.projectedBaseCost, 0);
    const sumOverhead = result.breakdownByRole.reduce((s, r) => s + r.projectedOverheadCost, 0);
    const sumTotal = result.breakdownByRole.reduce((s, r) => s + r.totalProjectedCost, 0);

    expect(result.totalProjectedHours).toBeCloseTo(sumHours, 5);
    expect(result.totalProjectedBaseCost).toBeCloseTo(sumBase, 5);
    expect(result.totalProjectedOverheadCost).toBeCloseTo(sumOverhead, 5);
    expect(result.grandTotalProjectedCost).toBeCloseTo(sumTotal, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Hourly rate fallback behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — rate fallback behaviour", () => {
  it("uses CLINIC_WIDE_FALLBACK_RATE (5500 c/hr = AUD 55.00) when no staff have any timesheet history", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const svc = createLaborForecastService(rosterRepo, createInMemoryTimesheetRepository());

    // 10-hour on_call shift; no history → 5500 c/hr × 10h = 55000 c (AUD 550.00)
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      shiftType: "on_call",
      durationHours: 10,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole[0];

    expect(row?.projectedBaseCost).toBe(55000);
  });

  it("uses DEFAULT_HOURLY_RATE for a shift type when its scheduled staff have approved history", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A has approved history → hasHistoryCoverage = true → DEFAULT standard rate $50/hr.
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 9,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftType: "standard",
      durationHours: 9,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const row = result.breakdownByRole.find((r) => r.role === "standard");

    // 5000 c/hr (DEFAULT standard rate) × 9h = 45000 c (AUD 450.00)
    expect(row?.projectedBaseCost).toBe(45000);
  });

  it("uses the clinic-wide blended rate for a shift type whose scheduled staff have no history", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Staff A (STAFF_USER_ID_A) has approved history and a standard shift.
    // Staff B (STAFF_USER_ID_B) has NO history and an on_call shift.
    //
    // clinicWideAverageRate is computed from covered shift types only:
    //   Only Staff A's standard shift is covered → rate pool = [50.0]
    //   → clinicWideAverageRate = 50.0 / 1 = $50.00/hr
    //
    // on_call (Staff B, uncovered) uses clinicWideAverageRate = $50.00/hr.
    // on_call hours: Staff B has no history, but clinic avg = 9h (from Staff A).
    // → baseCost = 9h × $50.00 = $450.00
    await seedApprovedTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      totalHoursWorked: 9,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftType: "standard",
      durationHours: 9,
      daysFromNow: 1,
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      shiftType: "on_call",
      durationHours: 9,
      daysFromNow: 2,
    });

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const onCallRow = result.breakdownByRole.find((r) => r.role === "on_call");

    // Clinic-wide blended rate = 5000 c/hr (only standard covered); 9h × 5000 = 45000 c
    expect(onCallRow?.projectedBaseCost).toBe(45000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — Summary metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("LaborForecastService — summary metadata", () => {
  it("reflects the default forecastWindowDays of 14 when no option is supplied", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);

    expect(result.forecastWindowDays).toBe(14);
  });

  it("reflects a custom forecastDays option in the returned summary", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const result = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID, { forecastDays: 30 });

    expect(result.forecastWindowDays).toBe(30);
  });

  it("includes the queried clinicId in the returned summary", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const resultA = await svc.getLaborForecast(callerAdmin, CLINIC_A_ID);
    const resultB = await svc.getLaborForecast(callerAdmin, CLINIC_B_ID);

    expect(resultA.clinicId).toBe(CLINIC_A_ID);
    expect(resultB.clinicId).toBe(CLINIC_B_ID);
  });
});
