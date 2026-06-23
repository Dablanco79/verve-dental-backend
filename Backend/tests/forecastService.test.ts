/**
 * forecastService.test.ts
 *
 * Unit / integration test suite for createForecastService.
 *
 * Tests use only in-memory repository implementations so no database or
 * network is required — the suite runs identically in CI and locally.
 *
 * Coverage targets:
 *   ✓ Zero-history baseline (new clinic — no alerts, zero projected usage)
 *   ✓ Average-usage-per-shift maths (scalar and multi-SKU)
 *   ✓ Threshold breach: warning (projected remaining < reorderPoint but > 0)
 *   ✓ Threshold breach: critical (projected remaining ≤ 0 — actual stockout)
 *   ✓ Alert is NOT fired when projected stock remains above reorder point
 *   ✓ FORECASTING SAFEGUARD: pending_verification entries are excluded
 *   ✓ FORECASTING SAFEGUARD: cancelled entries are excluded
 *   ✓ FORECASTING SAFEGUARD: hourly_auto entries are excluded
 *   ✓ Absent / sick verified shifts count as zero consumption (present-only)
 *   ✓ Multi-tenant isolation: cross-clinic forecast data does not leak
 *   ✓ Tenant guard: non-admin accessing a foreign clinic receives 403
 *   ✓ Cancelled roster shifts are excluded from scheduledShiftCount
 *   ✓ Alert sorting: critical before warning, shortfall descending within tier
 *   ✓ forecastDays / lookbackDays options are respected
 */

import { createForecastService } from "../src/services/forecastService.js";
import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../src/repositories/inventoryRepository.js";
import { createInMemoryRosterRepository } from "../src/repositories/rosterRepository.js";
import { createInMemoryTimesheetRepository } from "../src/repositories/timesheetRepository.js";

import type { CatalogRepository } from "../src/repositories/catalogRepository.js";
import type { InventoryRepository } from "../src/repositories/inventoryRepository.js";
import type { RosterRepository } from "../src/repositories/rosterRepository.js";
import type { TimesheetRepository } from "../src/repositories/timesheetRepository.js";
import type { AuthenticatedUser } from "../src/types/auth.js";
import type { CreateTimesheetEntryInput } from "../src/types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_A_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CLINIC_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_USER_ID = "cccccccc-0000-0000-0000-000000000003";
const MANAGER_USER_ID = "dddddddd-0000-0000-0000-000000000004";

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

const callerManager: AuthenticatedUser = {
  id: MANAGER_USER_ID,
  email: "manager@clinic-a.au",
  role: "group_practice_manager",
  homeClinicId: CLINIC_A_ID,
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
};

const callerStaffB: AuthenticatedUser = {
  id: STAFF_USER_ID,
  email: "staff@clinic-b.au",
  role: "clinical_staff",
  homeClinicId: CLINIC_B_ID,
  homeClinicName: "Clinic B",
  firstName: null,
  lastName: null,
  displayName: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build an isolated repo set with a single custom SKU + inventory item
// ─────────────────────────────────────────────────────────────────────────────

type TestRepos = {
  catalogRepo: CatalogRepository;
  inventoryRepo: InventoryRepository;
  rosterRepo: RosterRepository;
  timesheetRepo: TimesheetRepository;
};

type SeedSkuConfig = {
  sku?: string;
  name?: string;
  clinicId?: string;
  quantityOnHand?: number;
  reorderPoint?: number;
};

/**
 * Creates four fresh in-memory repositories and seeds a single master item
 * plus clinic inventory row.  Returns repos + the created IDs for use in tests.
 */
async function buildTestRepos(config: SeedSkuConfig = {}): Promise<
  TestRepos & { masterItemId: string; inventoryItemId: string }
> {
  const catalogRepo = createInMemoryCatalogRepository();
  const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
  const rosterRepo = createInMemoryRosterRepository();
  const timesheetRepo = createInMemoryTimesheetRepository();

  const clinicId = config.clinicId ?? CLINIC_A_ID;

  // Create a master catalog item.
  const masterItem = await catalogRepo.createMasterItem({
    sku: config.sku ?? "TEST-SKU-001",
    name: config.name ?? "Test Gloves",
    description: null,
    category: "PPE",
    unitOfMeasure: "box",
    defaultUnitCostCents: 500,
  });

  // Create a clinic inventory item.
  const inventoryItem = await inventoryRepo.createClinicInventoryItem({
    clinicId,
    masterCatalogItemId: masterItem.id,
    quantityOnHand: config.quantityOnHand ?? 20,
    reorderPoint: config.reorderPoint ?? 5,
    unitCostOverrideCents: null,
    supplierPreference: null,
  });

  return {
    catalogRepo,
    inventoryRepo,
    rosterRepo,
    timesheetRepo,
    masterItemId: masterItem.id,
    inventoryItemId: inventoryItem.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: record a scan_deduct adjustment
// ─────────────────────────────────────────────────────────────────────────────

async function recordDeduct(
  inventoryRepo: InventoryRepository,
  clinicId: string,
  clinicInventoryItemId: string,
  masterCatalogItemId: string,
  quantityDelta: number,
): Promise<void> {
  const current = await inventoryRepo.findClinicInventoryByMasterItemId(
    clinicId,
    masterCatalogItemId,
  );

  if (!current) return;

  const before = current.quantityOnHand;
  const after = before + quantityDelta;

  await inventoryRepo.updateQuantity(clinicId, clinicInventoryItemId, after);
  await inventoryRepo.recordAdjustment({
    clinicId,
    clinicInventoryItemId,
    masterCatalogItemId,
    adjustmentType: "scan_deduct",
    quantityDelta,
    quantityBefore: before,
    quantityAfter: after,
    reason: "test deduct",
    performedByUserId: MANAGER_USER_ID,
    performedByEmail: "manager@clinic-a.au",
    referenceId: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed a verified commission_log timesheet entry (present by default)
// ─────────────────────────────────────────────────────────────────────────────

async function seedVerifiedShift(
  timesheetRepo: TimesheetRepository,
  overrides: Partial<CreateTimesheetEntryInput> & {
    clinicId?: string;
    shiftDate?: string;
    attendanceStatus?: "present" | "absent" | "sick";
  } = {},
): Promise<void> {
  const clinicId = overrides.clinicId ?? CLINIC_A_ID;
  const shiftDate = overrides.shiftDate ?? todayStr();

  const input: CreateTimesheetEntryInput = {
    payrollType: "commission_log",
    staffUserId: STAFF_USER_ID,
    staffEmail: "provider@clinic-a.au",
    rosteredClinicName: "Clinic A",
    rosterEntryId: String(Math.random()),
    shiftStartAt: new Date(`${shiftDate}T08:00:00.000Z`),
    shiftEndAt: new Date(`${shiftDate}T17:00:00.000Z`),
    attendanceStatus: "pending_verification",
    clockInAt: null,
    clockOutAt: null,
    breakDurationMinutes: null,
    totalHoursWorked: null,
    ordinaryHours: null,
    overtime15xHours: null,
    overtime2xHours: null,
    overtimeCustomHours: null,
    commissionNote: null,
    generatedBy: "system_auto",
    ...overrides,
    // shiftDate and clinicId are set above — re-apply to ensure consistency.
    shiftDate,
    clinicId,
    rosteredClinicId: clinicId,
  };

  const entry = await timesheetRepo.create(input);

  // Promote to the target attendance status with a full manager audit trail
  // (getForecastLogs REQUIRES approvedByUserId + approvedAt to be non-null).
  await timesheetRepo.update(entry.id, {
    attendanceStatus: overrides.attendanceStatus ?? "present",
    approvedByUserId: MANAGER_USER_ID,
    approvedAt: new Date(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed an upcoming roster shift (scheduled status by default)
// ─────────────────────────────────────────────────────────────────────────────

async function seedUpcomingShift(
  rosterRepo: RosterRepository,
  clinicId: string,
  daysFromNow: number,
  status: "scheduled" | "confirmed" | "completed" | "cancelled" = "scheduled",
): Promise<void> {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(8, 0, 0, 0);

  const end = new Date(start);
  end.setHours(17, 0, 0, 0);

  const entry = await rosterRepo.createEntry({
    staffUserId: STAFF_USER_ID,
    staffEmail: "provider@clinic-a.au",
    rosteredClinicId: clinicId,
    rosteredClinicName: "Clinic A",
    shiftStartAt: start,
    shiftEndAt: end,
    shiftType: "standard",
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
}

/** Returns today as a YYYY-MM-DD string. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns a date N days ago as YYYY-MM-DD. */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe("ForecastService — getMaterialForecast", () => {
  it("returns an empty array for a clinic with no inventory items", async () => {
    const catalogRepo = createInMemoryCatalogRepository();
    const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();

    const svc = createForecastService(
      inventoryRepo,
      catalogRepo,
      rosterRepo,
      timesheetRepo,
    );

    const result = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);
    expect(result).toHaveLength(0);
  });

  it("returns a projection row for every inventory item", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos();

    // Add a second SKU.
    const item2 = await catalogRepo.createMasterItem({
      sku: "TEST-SKU-002",
      name: "Face Masks",
      description: null,
      category: "PPE",
      unitOfMeasure: "box",
      defaultUnitCostCents: 300,
    });
    await inventoryRepo.createClinicInventoryItem({
      clinicId: CLINIC_A_ID,
      masterCatalogItemId: item2.id,
      quantityOnHand: 10,
      reorderPoint: 2,
      unitCostOverrideCents: null,
      supplierPreference: null,
    });

    const svc = createForecastService(
      inventoryRepo,
      catalogRepo,
      rosterRepo,
      timesheetRepo,
    );

    const result = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);
    expect(result).toHaveLength(2);
  });

  it("produces zero projectedUsage and avgUsagePerShift when no history exists", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ quantityOnHand: 20, reorderPoint: 5 });

    // Upcoming shifts but NO historical consumption data.
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 3);

    const svc = createForecastService(
      inventoryRepo,
      catalogRepo,
      rosterRepo,
      timesheetRepo,
    );

    const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

    expect(proj?.avgUsagePerShift).toBe(0);
    expect(proj?.projectedUsage).toBe(0);
    expect(proj?.projectedStockRemaining).toBe(20);
    expect(proj?.willBreachSafetyThreshold).toBe(false);
  });

  describe("usage-per-shift maths", () => {
    it("correctly derives avgUsagePerShift from scan_deduct history", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
      } = await buildTestRepos({ quantityOnHand: 50, reorderPoint: 5 });

      // 2 verified-present shifts in lookback window.
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(5),
        attendanceStatus: "present",
      });
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(10),
        attendanceStatus: "present",
      });

      // 10 units consumed total across those 2 shifts.
      await recordDeduct(
        inventoryRepo,
        CLINIC_A_ID,
        inventoryItemId,
        masterItemId,
        -10,
      );

      const svc = createForecastService(
        inventoryRepo,
        catalogRepo,
        rosterRepo,
        timesheetRepo,
      );

      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      // avg = 10 / 2 = 5 units per shift.
      expect(proj?.historicalPresentShiftCount).toBe(2);
      expect(proj?.historicalConsumption).toBe(10);
      expect(proj?.avgUsagePerShift).toBe(5);
    });

    it("correctly calculates projectedUsage as avg × scheduledShiftCount", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
      } = await buildTestRepos({ quantityOnHand: 56, reorderPoint: 5 });

      // 2 verified-present historical shifts.
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(3),
        attendanceStatus: "present",
      });
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(7),
        attendanceStatus: "present",
      });

      // 6 units consumed over 2 shifts → avg 3 per shift.
      // recordDeduct also decreases quantityOnHand by 6 (56 − 6 = 50).
      await recordDeduct(
        inventoryRepo,
        CLINIC_A_ID,
        inventoryItemId,
        masterItemId,
        -6,
      );

      // 4 upcoming scheduled shifts.
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 3);
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 5);
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 7);

      const svc = createForecastService(
        inventoryRepo,
        catalogRepo,
        rosterRepo,
        timesheetRepo,
      );

      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.scheduledShiftCount).toBe(4);
      expect(proj?.avgUsagePerShift).toBe(3);
      // projectedUsage = Math.round(3 × 4) = 12.
      expect(proj?.projectedUsage).toBe(12);
      // projectedStockRemaining = (56 − 6) − 12 = 50 − 12 = 38.
      expect(proj?.projectedStockRemaining).toBe(38);
    });

    it("rounds projected usage to nearest whole unit", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
      } = await buildTestRepos({ quantityOnHand: 30, reorderPoint: 5 });

      // 3 present shifts, 10 units → avg 3.33 per shift.
      for (let i = 1; i <= 3; i++) {
        await seedVerifiedShift(timesheetRepo, {
          shiftDate: daysAgoStr(i),
          attendanceStatus: "present",
        });
      }
      await recordDeduct(
        inventoryRepo,
        CLINIC_A_ID,
        inventoryItemId,
        masterItemId,
        -10,
      );

      // 2 upcoming shifts → projected = round(3.33 × 2) = round(6.67) = 7.
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 2);
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 4);

      const svc = createForecastService(
        inventoryRepo,
        catalogRepo,
        rosterRepo,
        timesheetRepo,
      );

      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.avgUsagePerShift).toBe(3.33);
      expect(proj?.projectedUsage).toBe(7);
    });
  });

  describe("willBreachSafetyThreshold flag", () => {
    it("is false when projected remaining is at or above reorderPoint", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
      } = await buildTestRepos({ quantityOnHand: 20, reorderPoint: 5 });

      // 1 present shift, 2 units used → avg 2/shift.
      await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
      await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -2);

      // 1 upcoming shift → projected usage 2; remaining = 20 - 2 = 18 (>= 5).
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.willBreachSafetyThreshold).toBe(false);
    });

    it("is true (warning) when projected remaining drops below reorderPoint but stays above zero", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
        // Seed 18 so that after recordDeduct(-8) the live quantityOnHand = 10.
        // Forecast: projectedUsage = 8×1 = 8; projectedStockRemaining = 10-8 = 2 (warning).
      } = await buildTestRepos({ quantityOnHand: 18, reorderPoint: 5 });

      // 1 present shift, 8 units → avg 8/shift.
      await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
      await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -8);

      // 1 upcoming shift → projected usage 8; remaining = 10 - 8 = 2 (< 5 but > 0).
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.willBreachSafetyThreshold).toBe(true);
      expect(proj?.projectedStockRemaining).toBe(2);
    });

    it("is true (critical) when projected remaining drops to zero or below", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
        // Seed 10 so that after recordDeduct(-5) the live quantityOnHand = 5.
        // Forecast: projectedUsage = 5×1 = 5; projectedStockRemaining = 5-5 = 0 (critical).
      } = await buildTestRepos({ quantityOnHand: 10, reorderPoint: 5 });

      // 1 present shift, 5 units → avg 5/shift.
      await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
      await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -5);

      // 1 upcoming shift → projected usage 5; remaining = 5 - 5 = 0.
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 2);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.willBreachSafetyThreshold).toBe(true);
      expect(proj?.projectedStockRemaining).toBe(0);
    });
  });

  describe("FORECASTING SAFEGUARD: attendance status filtering", () => {
    it("EXCLUDES pending_verification entries from historicalPresentShiftCount", async () => {
      const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
        await buildTestRepos({ quantityOnHand: 20, reorderPoint: 5 });

      // Create a commission_log in default pending_verification state (no update).
      await timesheetRepo.create({
        payrollType: "commission_log",
        staffUserId: STAFF_USER_ID,
        staffEmail: "provider@clinic-a.au",
        clinicId: CLINIC_A_ID,
        rosteredClinicId: CLINIC_A_ID,
        rosteredClinicName: "Clinic A",
        rosterEntryId: "rid-pv",
        shiftDate: daysAgoStr(3),
        shiftStartAt: new Date(),
        shiftEndAt: new Date(),
        attendanceStatus: "pending_verification",
        clockInAt: null,
        clockOutAt: null,
        breakDurationMinutes: null,
        totalHoursWorked: null,
        ordinaryHours: null,
        overtime15xHours: null,
        overtime2xHours: null,
        overtimeCustomHours: null,
        commissionNote: null,
        generatedBy: "system_auto",
      });

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.historicalPresentShiftCount).toBe(0);
    });

    it("EXCLUDES cancelled entries from historicalPresentShiftCount", async () => {
      const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
        await buildTestRepos();

      // Seed a cancelled timesheet entry — getForecastLogs must exclude it.
      const entry = await timesheetRepo.create({
        payrollType: "commission_log",
        staffUserId: STAFF_USER_ID,
        staffEmail: "provider@clinic-a.au",
        clinicId: CLINIC_A_ID,
        rosteredClinicId: CLINIC_A_ID,
        rosteredClinicName: "Clinic A",
        rosterEntryId: "rid-cancelled",
        shiftDate: daysAgoStr(2),
        shiftStartAt: new Date(),
        shiftEndAt: new Date(),
        attendanceStatus: "pending_verification",
        clockInAt: null,
        clockOutAt: null,
        breakDurationMinutes: null,
        totalHoursWorked: null,
        ordinaryHours: null,
        overtime15xHours: null,
        overtime2xHours: null,
        overtimeCustomHours: null,
        commissionNote: null,
        generatedBy: "system_auto",
      });
      await timesheetRepo.update(entry.id, { attendanceStatus: "cancelled" });

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.historicalPresentShiftCount).toBe(0);
    });

    it("EXCLUDES hourly_auto entries from historicalPresentShiftCount", async () => {
      const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
        await buildTestRepos();

      // Hourly entries are not commission_log → must be excluded by getForecastLogs.
      await timesheetRepo.create({
        payrollType: "hourly_auto",
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        rosteredClinicId: CLINIC_A_ID,
        rosteredClinicName: "Clinic A",
        rosterEntryId: null,
        shiftDate: daysAgoStr(2),
        shiftStartAt: new Date(),
        shiftEndAt: new Date(),
        attendanceStatus: "present",
        clockInAt: new Date(),
        clockOutAt: new Date(),
        breakDurationMinutes: 30,
        totalHoursWorked: 8,
        ordinaryHours: 8,
        overtime15xHours: 0,
        overtime2xHours: 0,
        overtimeCustomHours: 0,
        commissionNote: null,
        generatedBy: "system_auto",
      });

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.historicalPresentShiftCount).toBe(0);
    });

    it("counts absent/sick shifts as zero consumption (not in present count)", async () => {
      const {
        catalogRepo,
        inventoryRepo,
        rosterRepo,
        timesheetRepo,
        masterItemId,
        inventoryItemId,
      } = await buildTestRepos({ quantityOnHand: 20, reorderPoint: 5 });

      // 1 present shift (8 units) + 1 absent shift (0 units consumed).
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(3),
        attendanceStatus: "present",
      });
      await seedVerifiedShift(timesheetRepo, {
        shiftDate: daysAgoStr(5),
        attendanceStatus: "absent",
      });
      await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -8);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      // Only 1 PRESENT shift — absent is excluded from the present count.
      expect(proj?.historicalPresentShiftCount).toBe(1);
      // avgUsagePerShift = 8 / 1 = 8 (absent not reducing denominator).
      expect(proj?.avgUsagePerShift).toBe(8);
    });
  });

  describe("cancelled roster shifts", () => {
    it("excludes cancelled upcoming shifts from scheduledShiftCount", async () => {
      const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
        await buildTestRepos();

      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 2, "scheduled");
      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 4, "cancelled");

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const [proj] = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);

      expect(proj?.scheduledShiftCount).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMaterialAlerts
// ─────────────────────────────────────────────────────────────────────────────

describe("ForecastService — getMaterialAlerts", () => {
  it("returns an empty array when no items breach the safety threshold", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ quantityOnHand: 50, reorderPoint: 5 });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
    const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

    expect(alerts).toHaveLength(0);
  });

  it("returns a warning alert when projected remaining is below reorderPoint but above zero", async () => {
    const {
      catalogRepo,
      inventoryRepo,
      rosterRepo,
      timesheetRepo,
      masterItemId,
      inventoryItemId,
      // Seed 14 so that after recordDeduct(-6) the live quantityOnHand = 8.
      // Forecast: projectedUsage = 6×1 = 6; projectedStockRemaining = 8-6 = 2 (warning).
    } = await buildTestRepos({ quantityOnHand: 14, reorderPoint: 5 });

    await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
    await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -6);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
    const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

    expect(alerts).toHaveLength(1);
    // projectedStockRemaining = 8 - 6 = 2; reorderPoint = 5 → warning.
    expect(alerts[0]?.severity).toBe("warning");
    expect(alerts[0]?.projectedStockRemaining).toBe(2);
    expect(alerts[0]?.shortfallUnits).toBe(3); // reorderPoint - remaining = 5 - 2
  });

  it("returns a critical alert when projected stock reaches zero", async () => {
    const {
      catalogRepo,
      inventoryRepo,
      rosterRepo,
      timesheetRepo,
      masterItemId,
      inventoryItemId,
      // Seed 10 so that after recordDeduct(-5) the live quantityOnHand = 5.
      // Forecast: projectedUsage = 5×1 = 5; projectedStockRemaining = 5-5 = 0 (critical).
    } = await buildTestRepos({ quantityOnHand: 10, reorderPoint: 3 });

    await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
    await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -5);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 2);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
    const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.projectedStockRemaining).toBe(0);
  });

  it("returns a critical alert when projected stock goes negative", async () => {
    const {
      catalogRepo,
      inventoryRepo,
      rosterRepo,
      timesheetRepo,
      masterItemId,
      inventoryItemId,
    } = await buildTestRepos({ quantityOnHand: 3, reorderPoint: 2 });

    await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });
    await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -5);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
    const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.projectedStockRemaining).toBeLessThan(0);
  });

  it("includes correct shortfallUnits value in the alert", async () => {
    const {
      catalogRepo,
      inventoryRepo,
      rosterRepo,
      timesheetRepo,
      masterItemId,
      inventoryItemId,
    } = await buildTestRepos({ quantityOnHand: 16, reorderPoint: 8 });

    // recordDeduct also decreases quantityOnHand by 6 (16 − 6 = 10).
    // avg 6/shift (1 verified present shift from yesterday), 2 upcoming → projected usage 12.
    // projectedStockRemaining = 10 - 12 = -2.
    await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present", shiftDate: daysAgoStr(1) });
    await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -6);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 3);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
    const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

    expect(alerts).toHaveLength(1);
    // shortfallUnits = max(0, reorderPoint - remaining) = max(0, 8 - (-2)) = 10.
    expect(alerts[0]?.shortfallUnits).toBe(10);
  });

  describe("alert sorting", () => {
    it("sorts critical alerts before warning alerts", async () => {
      const catalogRepo = createInMemoryCatalogRepository();
      const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
      const rosterRepo = createInMemoryRosterRepository();
      const timesheetRepo = createInMemoryTimesheetRepository();

      // SKU A: warning — seed 14 so after deduct(-6) live QoH=8;
      //   projectedUsage=6×1=6; projectedStockRemaining=8-6=2 (0<2<reorder5 → warning).
      const skuA = await catalogRepo.createMasterItem({
        sku: "SKU-A",
        name: "SKU A",
        description: null,
        category: "PPE",
        unitOfMeasure: "unit",
        defaultUnitCostCents: 100,
      });
      const invA = await inventoryRepo.createClinicInventoryItem({
        clinicId: CLINIC_A_ID,
        masterCatalogItemId: skuA.id,
        quantityOnHand: 14,
        reorderPoint: 5,
        unitCostOverrideCents: null,
        supplierPreference: null,
      });

      // SKU B: critical — seed 8 so after deduct(-5) live QoH=3;
      //   projectedUsage=5×1=5; projectedStockRemaining=3-5=-2 (≤0 → critical).
      const skuB = await catalogRepo.createMasterItem({
        sku: "SKU-B",
        name: "SKU B",
        description: null,
        category: "PPE",
        unitOfMeasure: "unit",
        defaultUnitCostCents: 100,
      });
      const invB = await inventoryRepo.createClinicInventoryItem({
        clinicId: CLINIC_A_ID,
        masterCatalogItemId: skuB.id,
        quantityOnHand: 8,
        reorderPoint: 3,
        unitCostOverrideCents: null,
        supplierPreference: null,
      });

      // 1 present historical shift.
      await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });

      // Deduct 6 from SKU A → live QoH 14-6=8; projectedRemaining 8-6=2 (warning).
      await recordDeduct(inventoryRepo, CLINIC_A_ID, invA.id, skuA.id, -6);

      // Deduct 5 from SKU B → live QoH 8-5=3; projectedRemaining 3-5=-2 (critical).
      await recordDeduct(inventoryRepo, CLINIC_A_ID, invB.id, skuB.id, -5);

      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

      expect(alerts).toHaveLength(2);
      expect(alerts[0]?.severity).toBe("critical");
      expect(alerts[1]?.severity).toBe("warning");
    });

    it("within the same severity tier, sorts by shortfallUnits descending", async () => {
      const catalogRepo = createInMemoryCatalogRepository();
      const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
      const rosterRepo = createInMemoryRosterRepository();
      const timesheetRepo = createInMemoryTimesheetRepository();

      // SKU C: remaining 1, reorder 5 → shortfall 4 (warning).
      const skuC = await catalogRepo.createMasterItem({
        sku: "SKU-C",
        name: "SKU C",
        description: null,
        category: "PPE",
        unitOfMeasure: "unit",
        defaultUnitCostCents: 100,
      });
      const invC = await inventoryRepo.createClinicInventoryItem({
        clinicId: CLINIC_A_ID,
        masterCatalogItemId: skuC.id,
        quantityOnHand: 7,
        reorderPoint: 5,
        unitCostOverrideCents: null,
        supplierPreference: null,
      });

      // SKU D: remaining 3, reorder 5 → shortfall 2 (warning).
      const skuD = await catalogRepo.createMasterItem({
        sku: "SKU-D",
        name: "SKU D",
        description: null,
        category: "PPE",
        unitOfMeasure: "unit",
        defaultUnitCostCents: 100,
      });
      const invD = await inventoryRepo.createClinicInventoryItem({
        clinicId: CLINIC_A_ID,
        masterCatalogItemId: skuD.id,
        quantityOnHand: 5,
        reorderPoint: 5,
        unitCostOverrideCents: null,
        supplierPreference: null,
      });

      await seedVerifiedShift(timesheetRepo, { attendanceStatus: "present" });

      // Deduct 6 from SKU C → remaining 7-6=1, shortfall = 5-1 = 4.
      await recordDeduct(inventoryRepo, CLINIC_A_ID, invC.id, skuC.id, -6);
      // Deduct 2 from SKU D → remaining 5-2=3, shortfall = 5-3 = 2.
      await recordDeduct(inventoryRepo, CLINIC_A_ID, invD.id, skuD.id, -2);

      await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 1);

      const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);
      const alerts = await svc.getMaterialAlerts(callerAdmin, CLINIC_A_ID);

      expect(alerts).toHaveLength(2);
      // Largest shortfall first within the same tier.
      expect(alerts[0]?.sku).toBe("SKU-C");
      expect(alerts[1]?.sku).toBe("SKU-D");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("ForecastService — multi-tenant isolation", () => {
  it("clinic A data does not appear in clinic B forecast", async () => {
    const catalogRepo = createInMemoryCatalogRepository();
    const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();

    const masterItem = await catalogRepo.createMasterItem({
      sku: "SHARED-SKU",
      name: "Shared Item",
      description: null,
      category: "PPE",
      unitOfMeasure: "box",
      defaultUnitCostCents: 100,
    });

    // Inventory for Clinic A only — Clinic B has none.
    await inventoryRepo.createClinicInventoryItem({
      clinicId: CLINIC_A_ID,
      masterCatalogItemId: masterItem.id,
      quantityOnHand: 30,
      reorderPoint: 5,
      unitCostOverrideCents: null,
      supplierPreference: null,
    });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    const clinicAResult = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);
    const clinicBResult = await svc.getMaterialForecast(callerAdmin, CLINIC_B_ID);

    expect(clinicAResult).toHaveLength(1);
    expect(clinicBResult).toHaveLength(0);
  });

  it("scan_deduct from clinic A does not influence clinic B consumption", async () => {
    const catalogRepo = createInMemoryCatalogRepository();
    const inventoryRepo = createInMemoryInventoryRepository(catalogRepo);
    const rosterRepo = createInMemoryRosterRepository();
    const timesheetRepo = createInMemoryTimesheetRepository();

    const masterItem = await catalogRepo.createMasterItem({
      sku: "CROSS-SKU",
      name: "Cross Clinic Item",
      description: null,
      category: "PPE",
      unitOfMeasure: "box",
      defaultUnitCostCents: 100,
    });

    const invA = await inventoryRepo.createClinicInventoryItem({
      clinicId: CLINIC_A_ID,
      masterCatalogItemId: masterItem.id,
      quantityOnHand: 20,
      reorderPoint: 2,
      unitCostOverrideCents: null,
      supplierPreference: null,
    });
    await inventoryRepo.createClinicInventoryItem({
      clinicId: CLINIC_B_ID,
      masterCatalogItemId: masterItem.id,
      quantityOnHand: 20,
      reorderPoint: 2,
      unitCostOverrideCents: null,
      supplierPreference: null,
    });

    // Heavy deduction only in Clinic A.
    await seedVerifiedShift(timesheetRepo, {
      clinicId: CLINIC_A_ID,
      attendanceStatus: "present",
    });
    await recordDeduct(inventoryRepo, CLINIC_A_ID, invA.id, masterItem.id, -15);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    const clinicAProj = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID);
    const clinicBProj = await svc.getMaterialForecast(callerAdmin, CLINIC_B_ID);

    // Clinic A has a consumption history.
    expect(clinicAProj[0]?.historicalConsumption).toBe(15);
    // Clinic B has zero — the adjustment was recorded against CLINIC_A_ID.
    expect(clinicBProj[0]?.historicalConsumption).toBe(0);
  });

  it("throws TENANT_ACCESS_DENIED when a non-admin queries a foreign clinic", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ clinicId: CLINIC_A_ID });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    // callerStaffB has homeClinicId = CLINIC_B_ID — querying CLINIC_A_ID must fail.
    await expect(
      svc.getMaterialForecast(callerStaffB, CLINIC_A_ID),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
  });

  it("throws TENANT_ACCESS_DENIED for getMaterialAlerts on a foreign clinic", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ clinicId: CLINIC_A_ID });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    await expect(
      svc.getMaterialAlerts(callerStaffB, CLINIC_A_ID),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
  });

  it("allows owner_admin to query any clinic regardless of homeClinicId", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ clinicId: CLINIC_B_ID });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    // callerAdmin homeClinicId = CLINIC_A_ID, but querying CLINIC_B_ID must succeed.
    await expect(
      svc.getMaterialForecast(callerAdmin, CLINIC_B_ID),
    ).resolves.toEqual(expect.any(Array));
  });

  it("allows group_practice_manager to query their own clinic", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos({ clinicId: CLINIC_A_ID });

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    await expect(
      svc.getMaterialForecast(callerManager, CLINIC_A_ID),
    ).resolves.toEqual(expect.any(Array));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ForecastOptions windows
// ─────────────────────────────────────────────────────────────────────────────

describe("ForecastService — ForecastOptions windows", () => {
  it("only counts upcoming shifts within the forecastDays window", async () => {
    const { catalogRepo, inventoryRepo, rosterRepo, timesheetRepo } =
      await buildTestRepos();

    // Shift in 3 days — inside any reasonable window.
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 3, "scheduled");
    // Shift in 20 days — outside a forecastDays:7 window.
    await seedUpcomingShift(rosterRepo, CLINIC_A_ID, 20, "scheduled");

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    const narrow = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID, {
      forecastDays: 7,
    });
    const wide = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID, {
      forecastDays: 30,
    });

    // narrow window: only the 3-day shift.
    expect(narrow[0]?.scheduledShiftCount).toBe(1);
    // wide window: both shifts.
    expect(wide[0]?.scheduledShiftCount).toBe(2);
  });

  it("only samples history within the lookbackDays window", async () => {
    const {
      catalogRepo,
      inventoryRepo,
      rosterRepo,
      timesheetRepo,
      masterItemId,
      inventoryItemId,
    } = await buildTestRepos({ quantityOnHand: 30, reorderPoint: 5 });

    // Present shift 5 days ago (inside a 7-day lookback).
    await seedVerifiedShift(timesheetRepo, {
      shiftDate: daysAgoStr(5),
      attendanceStatus: "present",
    });
    // Present shift 40 days ago (outside a 7-day lookback).
    await seedVerifiedShift(timesheetRepo, {
      shiftDate: daysAgoStr(40),
      attendanceStatus: "present",
    });

    await recordDeduct(inventoryRepo, CLINIC_A_ID, inventoryItemId, masterItemId, -10);

    const svc = createForecastService(inventoryRepo, catalogRepo, rosterRepo, timesheetRepo);

    const narrow = await svc.getMaterialForecast(callerAdmin, CLINIC_A_ID, {
      lookbackDays: 7,
    });

    // Only the 5-day-ago shift falls inside the 7-day lookback.
    expect(narrow[0]?.historicalPresentShiftCount).toBe(1);
  });
});
