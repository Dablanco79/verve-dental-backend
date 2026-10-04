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
import type { UserRepository } from "../src/repositories/userRepository.js";
import type { UserRecord } from "../src/types/auth.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { CreateTimesheetEntryInput, StaffPayrollTrack } from "../src/types/payroll.js";
import type { ShiftType } from "../src/types/roster.js";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal UserRepository factory for unit tests
// (Only listByClinic is used by the labor-forecast service; all other methods
//  throw "not implemented" to detect accidental calls.)
// ─────────────────────────────────────────────────────────────────────────────

function createMinimalUserRepo(
  staffPayrollTracks: Record<string, StaffPayrollTrack>,
): UserRepository {
  const makeRecord = (id: string, payrollTrack: StaffPayrollTrack): UserRecord => ({
    id,
    email: `${id}@test.au`,
    passwordHash: "",
    role: "clinical_staff",
    homeClinicId: CLINIC_A_ID,
    homeClinicName: "Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    payrollTrack,
    totpSecret: null,
    mfaEnabled: false,
    isActive: true,
  });

  return {
    findByEmail(): never { throw new Error("not implemented in test stub"); },
    findById(id: string): Promise<ReturnType<typeof makeRecord> | null> {
      const track = staffPayrollTracks[id];
      return Promise.resolve(track ? makeRecord(id, track) : null);
    },
    createUser(): never { throw new Error("not implemented in test stub"); },
    listByClinic(): Promise<ReturnType<typeof makeRecord>[]> {
      return Promise.resolve(Object.entries(staffPayrollTracks).map(([id, track]) => makeRecord(id, track)));
    },
    getClinicName(): Promise<string> { return Promise.resolve("Clinic A"); },
    async updatePassword() { /* no-op */ },
    updateUser(): never { throw new Error("not implemented in test stub"); },
    async setUserMfaEnrollment() { /* no-op */ },
  };
}

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
  permissions: [],
};

/** Admin caller WITH payroll:rates:read — use this for tests that assert cost values. */
const callerAdminWithRates: AuthenticatedUser = {
  ...callerAdmin,
  permissions: ["payroll:rates:read"],
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
  permissions: [],
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
  permissions: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns today as YYYY-MM-DD in the clinic's authoritative IANA timezone
 * (Australia/Sydney — matches the service default used in all tests that do
 * not explicitly pass a timezone option).
 *
 * CRITICAL: Do NOT use the system/process timezone here.  GitHub CI runners
 * use UTC, which produces a date one calendar day behind AEDT (UTC+11).  Any
 * test that compares against the service's localTodayStr must use the same
 * IANA zone the service uses; otherwise the today-hybrid boundary logic fails
 * deterministically on CI even though it passes locally (developer machines
 * are typically already set to Australia/Sydney).
 */
function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

/**
 * Returns a date N days ago as a YYYY-MM-DD string.
 * Uses local system timezone for "today", then pure UTC calendar arithmetic
 * so the returned date is always N calendar days before local today regardless
 * of the UTC offset.
 */
function daysAgoStr(n: number): string {
  const [y, m, d] = localToday().split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
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

  // Use the local-date string (system timezone) so that shifts land on the
  // correct clinic-local calendar day regardless of the UTC offset.
  // The service defaults to Australia/Sydney (AEDT = UTC+11), so placing
  // the shift at 08:00 UTC on the local date ensures the clinic-local date
  // matches the intended daysFromNow offset.
  const localDate = dateOffset(daysFromNow);
  const start = new Date(`${localDate}T08:00:00.000Z`);

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
    clockInLocation: null,
    clockOutLocation: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// getLaborCostAnalysis — new method tests
// ─────────────────────────────────────────────────────────────────────────────

import { createInMemoryStaffPayRateRepository } from "../src/repositories/staffPayRateRepository.js";
import type { StaffPayRateRepository } from "../src/repositories/staffPayRateRepository.js";

// Extra fixture IDs for analysis tests
const RATE_MANAGER_ID = "11111111-0000-0000-0000-000000000001";

/**
 * Returns a YYYY-MM-DD date offset from local today by N days
 * (positive = future, negative = past).
 * Uses local system timezone for "today" so the result matches the service's
 * clinic-local today (Australia/Sydney) without any UTC midnight boundary issues.
 */
function dateOffset(n: number): string {
  const [y, m, d] = localToday().split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Seeds a rate in the pay-rate repo. */
async function seedRate(
  rateRepo: StaffPayRateRepository,
  staffUserId: string,
  opts: {
    baseHourlyRateCents: number;
    superRatePercent: number;
    effectiveFrom: string;
  },
): Promise<void> {
  await rateRepo.createRate({
    staffUserId,
    baseHourlyRateCents: opts.baseHourlyRateCents,
    superRatePercent: opts.superRatePercent,
    effectiveFrom: opts.effectiveFrom,
    employmentType: "full_time",
    contractedWeeklyHours: null,
    createdByUserId: RATE_MANAGER_ID,
  });
}

/**
 * Seeds a historical hourly timesheet with a given timesheetStatus.
 */
async function seedHistoricalTimesheet(
  timesheetRepo: TimesheetRepository,
  opts: {
    clinicId: string;
    staffUserId: string;
    staffEmail?: string;
    shiftDate: string;
    totalHoursWorked: number;
    rosterEntryId?: string | null;
    payrollType?: "hourly_auto" | "hourly_manual" | "commission_log";
    timesheetStatus?: "approved" | "submitted" | "rejected" | "requires_amendment" | "draft" | null;
  },
): Promise<void> {
  const shiftDate = opts.shiftDate;
  const input: CreateTimesheetEntryInput = {
    payrollType: opts.payrollType ?? "hourly_auto",
    staffUserId: opts.staffUserId,
    staffEmail: opts.staffEmail ?? "staff@clinic-a.au",
    clinicId: opts.clinicId,
    rosteredClinicId: opts.clinicId,
    rosteredClinicName: "Clinic A",
    rosterEntryId: opts.rosterEntryId ?? null,
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
    clockInLocation: null,
    clockOutLocation: null,
  };
  const entry = await timesheetRepo.create(input);
  const status = opts.timesheetStatus !== undefined ? opts.timesheetStatus : "approved";
  if (status !== null && status !== "draft") {
    await timesheetRepo.update(entry.id, {
      timesheetStatus: status,
      approvedByUserId: MANAGER_USER_ID,
      approvedAt: new Date(),
      approvalNotes: status === "rejected" || status === "requires_amendment" ? "Test note" : null,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — effective-dated rate lookup fix
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — effective-dated rate lookup", () => {
  it("future shift BEFORE rate change date uses the OLD rate", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    // Old rate: $38/hr from well in the past (no end date yet)
    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_800,
      superRatePercent: 12,
      effectiveFrom: "2026-01-01",
    });
    // New rate: $40/hr effective in 5 days — closes the old rate
    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 4_000,
      superRatePercent: 12,
      effectiveFrom: dateOffset(5),
    });

    // Shift in 2 days (before the new rate kicks in)
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, daysFromNow: 2, durationHours: 10 });

    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(1),
      to: dateOffset(3),
    });

    const shiftType = result.futureForecast?.breakdownByShiftType[0];
    // 10h × 3800 c/hr = 38000 c
    expect(shiftType?.baseCostCents).toBe(38_000);
  });

  it("future shift ON/AFTER rate change date uses the NEW rate", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_800,
      superRatePercent: 12,
      effectiveFrom: "2026-01-01",
    });
    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 4_000,
      superRatePercent: 12,
      effectiveFrom: dateOffset(5),
    });

    // Shift in 7 days (after the new rate kicks in)
    await seedShift(rosterRepo, { clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, daysFromNow: 7, durationHours: 10 });

    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(6),
      to: dateOffset(8),
    });

    const shiftType = result.futureForecast?.breakdownByShiftType[0];
    // 10h × 4000 c/hr = 40000 c
    expect(shiftType?.baseCostCents).toBe(40_000);
  });

  it("historical approved cost uses the rate effective on the timesheet shiftDate", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    // Rate was $35/hr historically, now $38/hr
    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_500,
      superRatePercent: 11,
      effectiveFrom: "2026-01-01",
    });
    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_800,
      superRatePercent: 12,
      effectiveFrom: dateOffset(-10), // new rate from 10 days ago
    });

    // Historical timesheet from 20 days ago (when $35/hr applied)
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-20),
      totalHoursWorked: 8,
      timesheetStatus: "approved",
    });

    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-25),
      to: dateOffset(-1),
    });

    // 8h × 3500 c/hr = 28000 c base; super = 28000 × 11% = 3080 c
    expect(result.historical?.approved.baseCostCents).toBe(28_000);
    expect(result.historical?.approved.superCostCents).toBe(3_080);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — Historical status classification
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — historical status classification", () => {
  it("classifies submitted timesheets as Pending Approval (not Approved)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "submitted",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.pending.hours).toBe(8);
    expect(result.historical?.approved.hours).toBe(0);
  });

  it("classifies rejected timesheets separately — excluded from planning estimate", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "rejected",
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.rejected.hours).toBe(8);
    expect(result.historical?.approved.hours).toBe(0);
    expect(result.historical?.pending.hours).toBe(0);
    // Rejected must NOT contribute to planning estimate
    expect(result.planningEstimate.totalCostCents).toBe(0);
  });

  it("classifies requires_amendment separately from rejected", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 6,
      timesheetStatus: "requires_amendment",
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.requiresAmendment.hours).toBe(6);
    expect(result.historical?.rejected.hours).toBe(0);
    // requires_amendment must NOT contribute to planning estimate
    expect(result.planningEstimate.totalCostCents).toBe(0);
  });

  it("classifies draft hourly timesheets as Incomplete (no cost)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-3),
      totalHoursWorked: 7,
      timesheetStatus: "draft",
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.incomplete.count).toBe(1);
    expect(result.planningEstimate.totalCostCents).toBe(0);
  });

  it("commission_log timesheets never enter Incomplete (filtered by payrollType)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // commission_log timesheetStatus is null (not draft)
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-3),
      totalHoursWorked: 0,
      payrollType: "commission_log",
      timesheetStatus: null,
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.incomplete.count).toBe(0);
    expect(result.historical?.approved.hours).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — Missing timesheet detection
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — missing timesheet detection", () => {
  it("detects a historical roster entry with no linked timesheet as Missing", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Historical shift (3 days ago, 8 hours) with NO timesheet
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: -3,
      durationHours: 8,
      status: "completed",
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.missing.count).toBe(1);
    expect(result.historical?.missing.scheduledHours).toBe(8);
    // Missing contributes zero cost
    expect(result.planningEstimate.totalCostCents).toBe(0);
  });

  it("does not count a roster entry as Missing when a linked hourly timesheet exists", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    const rosterEntry = await rosterRepo.createEntry({
      staffUserId: STAFF_USER_ID_A,
      staffEmail: "staff@clinic-a.au",
      rosteredClinicId: CLINIC_A_ID,
      rosteredClinicName: "Clinic A",
      shiftStartAt: new Date(`${dateOffset(-5)}T08:00:00.000Z`),
      shiftEndAt: new Date(`${dateOffset(-5)}T17:00:00.000Z`),
      shiftType: "standard",
      notes: null,
      createdByUserId: MANAGER_USER_ID,
      createdByEmail: "manager@clinic-a.au",
    });

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      rosterEntryId: rosterEntry.id,
      timesheetStatus: "approved",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    expect(result.historical?.missing.count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — Planning estimate formula
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — planning estimate", () => {
  it("planning estimate = Approved + Pending + Future (no other components)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Approved historical (8h × 5000 c/hr = 40000 c base + 6000 c overhead = 46000 c)
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-7),
      totalHoursWorked: 8,
      timesheetStatus: "approved",
    });

    // Pending historical (4h × 5000 c/hr = 20000 c base + 3000 c overhead = 23000 c)
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-3),
      totalHoursWorked: 4,
      timesheetStatus: "submitted",
    });

    // Rejected (should NOT appear in totalCost)
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-2),
      totalHoursWorked: 9,
      timesheetStatus: "rejected",
    });

    // Future shift (9h × 5500 c/hr fallback = 49500 c base + 7425 c overhead = 56925 c)
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      daysFromNow: 2,
      durationHours: 9,
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(5),
    });

    // Verify composition (all non-null because callerAdminWithRates has rates permission)
    expect(result.planningEstimate.approvedCostCents).toBe(result.historical?.approved.totalCostCents);
    expect(result.planningEstimate.pendingCostCents).toBe(result.historical?.pending.totalCostCents);
    expect(result.planningEstimate.futureCostCents).toBe(result.futureForecast?.totalCostCents);
    expect(result.planningEstimate.totalCostCents).toBe(
      (result.planningEstimate.approvedCostCents ?? 0) +
      (result.planningEstimate.pendingCostCents ?? 0) +
      (result.planningEstimate.futureCostCents ?? 0),
    );
    // Rejected is visible but not in total
    expect(result.historical?.rejected.hours).toBe(9);
    expect(result.planningEstimate.totalCostCents).not.toBe(0);
    expect(result.planningEstimate.totalCostCents).toBe(
      (result.historical?.approved.totalCostCents ?? 0) +
      (result.historical?.pending.totalCostCents ?? 0) +
      (result.futureForecast?.totalCostCents ?? 0),
    );
  });

  it("mixed range: planning estimate excludes rejected and requires_amendment", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "requires_amendment",
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(5),
    });

    expect(result.historical?.requiresAmendment.hours).toBe(8);
    expect(result.planningEstimate.approvedCostCents).toBe(0);
    expect(result.planningEstimate.pendingCostCents).toBe(0);
    expect(result.planningEstimate.totalCostCents).toBe(
      result.planningEstimate.futureCostCents, // future only
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — Fallback rate behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — fallback rate", () => {
  it("uses fallback rate (DEFAULT_HOURLY_RATE or clinic-wide) when no configured rate exists", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    // NO rate configured for STAFF_USER_ID_B — should use fallback
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      daysFromNow: 1,
      durationHours: 10,
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(0),
      to: dateOffset(2),
    });

    expect(result.futureForecast?.anyStaffUsingFallback).toBe(true);
    // 10h × 5000 c/hr (DEFAULT standard) = 50000 c
    expect(result.futureForecast?.baseCostCents).toBe(50_000);
  });

  it("uses configured rate when available and marks usingFallback=false", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 4_200,
      superRatePercent: 12,
      effectiveFrom: "2026-01-01",
    });

    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: 1,
      durationHours: 10,
    });

    // Use callerAdminWithRates so cost fields are non-null
    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(0),
      to: dateOffset(2),
    });

    expect(result.futureForecast?.anyStaffUsingFallback).toBe(false);
    // 10h × 4200 c/hr = 42000 c base; super = 42000 × 12% = 5040 c
    expect(result.futureForecast?.baseCostCents).toBe(42_000);
    expect(result.futureForecast?.superCostCents).toBe(5_040);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — Staff breakdown and GPM redaction
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — staff breakdown and GPM redaction", () => {
  it("staff breakdown sums to clinic-level totals (approved hours)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A, staffEmail: "a@clinic.au",
      shiftDate: dateOffset(-5), totalHoursWorked: 7, timesheetStatus: "approved",
    });
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_B, staffEmail: "b@clinic.au",
      shiftDate: dateOffset(-4), totalHoursWorked: 5, timesheetStatus: "approved",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    const staffSumApproved = result.staffBreakdown.reduce(
      (sum, s) => sum + s.approvedHours,
      0,
    );
    expect(staffSumApproved).toBeCloseTo(result.historical?.approved.hours ?? 0, 5);
  });

  it("owner_admin receives full rate and cost data in staff breakdown", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_800,
      superRatePercent: 12,
      effectiveFrom: "2026-01-01",
    });
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5), totalHoursWorked: 8, timesheetStatus: "approved",
    });

    const adminCaller: typeof callerAdmin = {
      ...callerAdmin,
      permissions: ["payroll:rates:read"],
    };

    const result = await svc.getLaborCostAnalysis(adminCaller, CLINIC_A_ID, {
      from: dateOffset(-10), to: dateOffset(-1),
    });

    const staffRow = result.staffBreakdown.find((s) => s.staffUserId === STAFF_USER_ID_A);
    expect(staffRow?.baseHourlyRateCents).toBe(3_800);
    expect(staffRow?.superRatePercent).toBe(12);
    expect(staffRow?.approvedCostCents).not.toBeNull();
    expect(staffRow?.approvedCostCents).toBeGreaterThan(0);
  });

  it("GPM without payroll:rates:read receives null for per-staff rate and cost fields", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const rateRepo = createInMemoryStaffPayRateRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, rateRepo);

    await seedRate(rateRepo, STAFF_USER_ID_A, {
      baseHourlyRateCents: 3_800,
      superRatePercent: 12,
      effectiveFrom: "2026-01-01",
    });
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID, staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5), totalHoursWorked: 8, timesheetStatus: "approved",
    });

    // GPM WITHOUT payroll:rates:read
    const gpmCaller: typeof callerManagerA = {
      ...callerManagerA,
      permissions: [], // no payroll:rates:read
    };

    const result = await svc.getLaborCostAnalysis(gpmCaller, CLINIC_A_ID, {
      from: dateOffset(-10), to: dateOffset(-1),
    });

    const staffRow = result.staffBreakdown.find((s) => s.staffUserId === STAFF_USER_ID_A);
    expect(staffRow?.baseHourlyRateCents).toBeNull();
    expect(staffRow?.superRatePercent).toBeNull();
    expect(staffRow?.approvedCostCents).toBeNull();
    expect(staffRow?.pendingCostCents).toBeNull();
    expect(staffRow?.futureCostCents).toBeNull();

    // Hours are still visible
    expect(staffRow?.approvedHours).toBe(8);

    // ISSUE 1 FIX: Clinic-level aggregate costs ALSO redacted for GPM without rates permission.
    expect(result.planningEstimate.approvedCostCents).toBeNull();
    expect(result.planningEstimate.totalCostCents).toBeNull();
    expect(result.historical?.approved.totalCostCents).toBeNull();
    expect(result.historical?.approved.baseCostCents).toBeNull();

    // Hours at clinic level are still visible
    expect(result.historical?.approved.hours).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite G — Date range + timezone validation
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — date range validation", () => {
  it("throws 400 INVALID_DATE_RANGE when from > to", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    await expect(
      svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
        from: "2026-12-31",
        to: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATE_RANGE", statusCode: 400 });
  });

  it("throws 400 DATE_RANGE_TOO_LARGE for ranges exceeding 365 days", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    await expect(
      svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
        from: "2025-01-01",
        to: "2027-01-01",
      }),
    ).rejects.toMatchObject({ code: "DATE_RANGE_TOO_LARGE", statusCode: 400 });
  });

  it("returns historical=null for future-only range", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(1),
      to: dateOffset(7),
    });

    expect(result.historical).toBeNull();
    expect(result.futureForecast).not.toBeNull();
  });

  it("returns futureForecast=null for historical-only range", async () => {
    const svc = createLaborForecastService(
      createInMemoryRosterRepository(),
      createInMemoryTimesheetRepository(),
    );

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-14),
      to: dateOffset(-1),
    });

    expect(result.futureForecast).toBeNull();
    expect(result.historical).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite H — Today hybrid classification (Issue 2)
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — today hybrid classification", () => {
  it("today's shift with an approved timesheet is classified as Approved, not Future Forecast", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    const todayStr = dateOffset(0);

    // Create today's roster entry
    const rosterEntry = await rosterRepo.createEntry({
      staffUserId: STAFF_USER_ID_A,
      staffEmail: "staff@clinic-a.au",
      rosteredClinicId: CLINIC_A_ID,
      rosteredClinicName: "Clinic A",
      shiftStartAt: new Date(`${todayStr}T08:00:00.000Z`),
      shiftEndAt:   new Date(`${todayStr}T17:00:00.000Z`),
      shiftType: "standard",
      notes: null,
      createdByUserId: MANAGER_USER_ID,
      createdByEmail: "manager@clinic-a.au",
    });

    // Seed an APPROVED timesheet linked to today's roster entry
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: todayStr,
      totalHoursWorked: 8,
      rosterEntryId: rosterEntry.id,
      timesheetStatus: "approved",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: todayStr,
      to: dateOffset(7),
    });

    // Today's approved timesheet must appear in historical Approved
    expect(result.historical?.approved.hours).toBe(8);

    // Today's shift must NOT be in Future Forecast (it was counted in historical)
    expect(result.futureForecast?.totalHours ?? 0).toBe(0);
  });

  it("today's shift with a submitted timesheet is classified as Pending Approval", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    const todayStr = dateOffset(0);

    const rosterEntry = await rosterRepo.createEntry({
      staffUserId: STAFF_USER_ID_A,
      staffEmail: "staff@clinic-a.au",
      rosteredClinicId: CLINIC_A_ID,
      rosteredClinicName: "Clinic A",
      shiftStartAt: new Date(`${todayStr}T08:00:00.000Z`),
      shiftEndAt:   new Date(`${todayStr}T17:00:00.000Z`),
      shiftType: "standard",
      notes: null,
      createdByUserId: MANAGER_USER_ID,
      createdByEmail: "manager@clinic-a.au",
    });

    // Seed a SUBMITTED (pending) timesheet linked to today's roster entry
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: todayStr,
      totalHoursWorked: 7,
      rosterEntryId: rosterEntry.id,
      timesheetStatus: "submitted",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-3),
      to: dateOffset(3),
    });

    // Classified as Pending Approval (not Approved, not Future Forecast)
    expect(result.historical?.pending.hours).toBe(7);
    expect(result.historical?.approved.hours).toBe(0);
    // The roster entry is excluded from future forecast
    expect(result.futureForecast?.totalHours ?? 0).toBe(0);
  });

  it("today's shift with no linked timesheet stays in Future Forecast (not Missing)", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    // Today's shift — no timesheet yet (shift in progress or upcoming)
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: 0,
      durationHours: 9,
      status: "confirmed",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(0),
      to: dateOffset(7),
    });

    // Today's un-timesheeted shift is UPCOMING → in Future Forecast, not Missing
    expect(result.futureForecast?.totalHours).toBe(9);
    expect(result.historical?.missing.count ?? 0).toBe(0);
  });

  it("same-day shifts are not double-counted: one approved + one upcoming", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    const todayStr = dateOffset(0);

    // Shift 1: already approved today (am shift)
    const rosterEntry1 = await rosterRepo.createEntry({
      staffUserId: STAFF_USER_ID_A,
      staffEmail: "staff@clinic-a.au",
      rosteredClinicId: CLINIC_A_ID,
      rosteredClinicName: "Clinic A",
      shiftStartAt: new Date(`${todayStr}T06:00:00.000Z`),
      shiftEndAt:   new Date(`${todayStr}T14:00:00.000Z`),
      shiftType: "standard",
      notes: null,
      createdByUserId: MANAGER_USER_ID,
      createdByEmail: "manager@clinic-a.au",
    });
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: todayStr,
      totalHoursWorked: 8,
      rosterEntryId: rosterEntry1.id,
      timesheetStatus: "approved",
    });

    // Shift 2: no timesheet yet (pm shift, still upcoming).
    // Times are 05:00–13:00 UTC = 15:00–23:00 AEST — well within the local
    // calendar day to avoid the midnight-AEST boundary (T14:00:00Z) which
    // equals tomorrowStartUTC and would be excluded by strict < comparators.
    await rosterRepo.createEntry({
      staffUserId: STAFF_USER_ID_B,
      staffEmail: "staff-b@clinic-a.au",
      rosteredClinicId: CLINIC_A_ID,
      rosteredClinicName: "Clinic A",
      shiftStartAt: new Date(`${todayStr}T05:00:00.000Z`),
      shiftEndAt:   new Date(`${todayStr}T13:00:00.000Z`),
      shiftType: "standard",
      notes: null,
      createdByUserId: MANAGER_USER_ID,
      createdByEmail: "manager@clinic-a.au",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: todayStr,
      to: todayStr,
    });

    // Shift 1 (approved, 8h) → historical Approved
    expect(result.historical?.approved.hours).toBe(8);

    // Shift 2 (no timesheet, 8h) → future forecast, not missing
    expect(result.futureForecast?.totalHours).toBe(8);
    expect(result.historical?.missing.count ?? 0).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite I — Commission staff regression (authoritative payroll_track)
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests verify that missing-timesheet detection uses the authoritative
// users.payroll_track column (injected via UserRepository) rather than
// inferring commission status from historical commission_log activity.
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — commission staff regression (authoritative payroll_track)", () => {
  it("commission staff (payroll_track='commission') with NO commission log history is NOT counted as Missing", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    // UserRepository: STAFF_USER_ID_A is commission-track — no timesheets are seeded at all.
    const userRepo = createMinimalUserRepo({ [STAFF_USER_ID_A]: "commission" });
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, undefined, userRepo);

    // Commission dentist has a completed historical roster entry with NO linked timesheet
    // and NO commission_log history — the 90-day lookback would have missed them, but
    // the authoritative payroll_track correctly identifies them as commission-track.
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: -5,
      durationHours: 8,
      status: "completed",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-20),
      to: dateOffset(-1),
    });

    // Commission staff must NOT be flagged as "Missing hourly timesheet"
    expect(result.historical?.missing.count).toBe(0);
    expect(result.historical?.missing.scheduledHours).toBe(0);
  });

  it("hourly staff (payroll_track='hourly') with no linked timesheet IS counted as Missing", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    // UserRepository: STAFF_USER_ID_B is hourly-track.
    const userRepo = createMinimalUserRepo({ [STAFF_USER_ID_B]: "hourly" });
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, undefined, userRepo);

    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      daysFromNow: -5,
      durationHours: 8,
      status: "completed",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-20),
      to: dateOffset(-1),
    });

    // Hourly staff with no timesheet MUST be flagged as Missing
    expect(result.historical?.missing.count).toBe(1);
    expect(result.historical?.missing.scheduledHours).toBe(8);
  });

  it("commission detection does NOT depend on historical commission log presence", async () => {
    // STAFF_USER_ID_A has payroll_track='commission' but ZERO commission_log history.
    // STAFF_USER_ID_B has commission_log history but payroll_track='hourly'.
    // → only the payroll_track column must determine the classification.
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const userRepo = createMinimalUserRepo({
      [STAFF_USER_ID_A]: "commission", // no commission history — should still be excluded from Missing
      [STAFF_USER_ID_B]: "hourly",     // has commission history — should still be Missing if no timesheet
    });
    const svc = createLaborForecastService(rosterRepo, timesheetRepo, undefined, userRepo);

    // Seed a commission_log for STAFF_USER_ID_B (the hourly one) — should not exempt them
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      shiftDate: dateOffset(-10),
      totalHoursWorked: 0,
      payrollType: "commission_log",
      timesheetStatus: null,
    });

    // Both staff have historical roster entries with no linked hourly timesheet
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: -5,
      durationHours: 8,
      status: "completed",
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      daysFromNow: -3,
      durationHours: 6,
      status: "completed",
    });

    const result = await svc.getLaborCostAnalysis(callerAdmin, CLINIC_A_ID, {
      from: dateOffset(-20),
      to: dateOffset(-1),
    });

    // STAFF_USER_ID_A (commission track, no commission history) → NOT Missing
    // STAFF_USER_ID_B (hourly track, has commission history) → IS Missing
    expect(result.historical?.missing.count).toBe(1);
    expect(result.historical?.missing.scheduledHours).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite J — Aggregate cost redaction (Issue 1)
// ─────────────────────────────────────────────────────────────────────────────

describe("getLaborCostAnalysis — aggregate cost redaction for callers without payroll:rates:read", () => {
  it("GPM without payroll:rates:read receives null for all historical aggregate cost fields", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "approved",
    });
    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-3),
      totalHoursWorked: 4,
      timesheetStatus: "submitted",
    });

    const gpmCaller: AuthenticatedUser = { ...callerManagerA, permissions: [] };
    const result = await svc.getLaborCostAnalysis(gpmCaller, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    // Hours MUST be visible
    expect(result.historical?.approved.hours).toBe(8);
    expect(result.historical?.pending.hours).toBe(4);

    // ALL aggregate cost fields must be null
    expect(result.historical?.approved.baseCostCents).toBeNull();
    expect(result.historical?.approved.superCostCents).toBeNull();
    expect(result.historical?.approved.totalCostCents).toBeNull();
    expect(result.historical?.pending.baseCostCents).toBeNull();
    expect(result.historical?.pending.totalCostCents).toBeNull();
  });

  it("GPM without payroll:rates:read receives null for all future forecast aggregate cost fields", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      daysFromNow: 3,
      durationHours: 9,
    });

    const gpmCaller: AuthenticatedUser = { ...callerManagerA, permissions: [] };
    const result = await svc.getLaborCostAnalysis(gpmCaller, CLINIC_A_ID, {
      from: dateOffset(1),
      to: dateOffset(7),
    });

    // Hours MUST be visible
    expect(result.futureForecast?.totalHours).toBe(9);

    // ALL aggregate cost fields must be null
    expect(result.futureForecast?.baseCostCents).toBeNull();
    expect(result.futureForecast?.superCostCents).toBeNull();
    expect(result.futureForecast?.totalCostCents).toBeNull();
    expect(result.futureForecast?.breakdownByShiftType[0]?.baseCostCents).toBeNull();
    expect(result.futureForecast?.breakdownByShiftType[0]?.totalCostCents).toBeNull();
  });

  it("GPM without payroll:rates:read receives null for all planning estimate cost fields", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "approved",
    });
    await seedShift(rosterRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_B,
      daysFromNow: 2,
      durationHours: 9,
    });

    const gpmCaller: AuthenticatedUser = { ...callerManagerA, permissions: [] };
    const result = await svc.getLaborCostAnalysis(gpmCaller, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(5),
    });

    // ALL planning estimate cost fields must be null
    expect(result.planningEstimate.approvedCostCents).toBeNull();
    expect(result.planningEstimate.pendingCostCents).toBeNull();
    expect(result.planningEstimate.futureCostCents).toBeNull();
    expect(result.planningEstimate.totalCostCents).toBeNull();

    // Data quality flags and hours must still be visible.
    // Approved hours = 8 (historical timesheet for STAFF_USER_ID_A).
    // Future hours = 8 (clinic-wide avg from STAFF_USER_ID_A's timesheet applies
    // to STAFF_USER_ID_B who has no personal history; scheduled duration not used).
    expect(result.historical?.approved.hours).toBe(8);
    expect(result.futureForecast?.totalHours).toBe(8);
  });

  it("caller WITH payroll:rates:read receives real non-null cost values for all aggregate fields", async () => {
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();
    const svc = createLaborForecastService(rosterRepo, timesheetRepo);

    await seedHistoricalTimesheet(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      staffUserId: STAFF_USER_ID_A,
      shiftDate: dateOffset(-5),
      totalHoursWorked: 8,
      timesheetStatus: "approved",
    });

    const result = await svc.getLaborCostAnalysis(callerAdminWithRates, CLINIC_A_ID, {
      from: dateOffset(-10),
      to: dateOffset(-1),
    });

    // All cost fields non-null and positive
    expect(result.historical?.approved.baseCostCents).toBeGreaterThan(0);
    expect(result.historical?.approved.superCostCents).toBeGreaterThan(0);
    expect(result.historical?.approved.totalCostCents).toBeGreaterThan(0);
    expect(result.planningEstimate.approvedCostCents).toBeGreaterThan(0);
    expect(result.planningEstimate.totalCostCents).toBeGreaterThan(0);
  });
});
