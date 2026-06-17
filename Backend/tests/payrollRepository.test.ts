/**
 * payrollRepository.test.ts
 *
 * Unit tests for the in-memory leave and timesheet repository implementations.
 *
 * NOTE: Jest roots is configured to `["<rootDir>/tests"]` in jest.config.cjs.
 * All repository tests live in this directory, not inside src/.
 *
 * Critical coverage target:
 *   TimesheetRepository.getForecastLogs — the materials forecasting safeguard.
 *   The test matrix explicitly verifies every attendance_status value so a
 *   future refactor cannot accidentally include 'pending_verification' or
 *   'cancelled' in the forecasting dataset.
 */

import { createInMemoryLeaveRepository } from "../src/repositories/leaveRepository.js";
import { createInMemoryTimesheetRepository } from "../src/repositories/timesheetRepository.js";
import type { CreateTimesheetEntryInput } from "../src/types/payroll.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_A_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CLINIC_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_USER_ID = "cccccccc-0000-0000-0000-000000000003";
const MANAGER_USER_ID = "dddddddd-0000-0000-0000-000000000004";
const ROSTER_ENTRY_ID = "eeeeeeee-0000-0000-0000-000000000005";

const SHIFT_DATE = "2026-06-20";
const OTHER_DATE = "2026-06-21";

/** Returns a minimal valid CreateTimesheetEntryInput for a commission_log. */
function makeCommissionInput(
  overrides: Partial<CreateTimesheetEntryInput> = {},
): CreateTimesheetEntryInput {
  return {
    payrollType: "commission_log",
    staffUserId: STAFF_USER_ID,
    staffEmail: "provider@clinic-a.au",
    clinicId: CLINIC_A_ID,
    rosteredClinicId: CLINIC_A_ID,
    rosteredClinicName: "Clinic A",
    rosterEntryId: ROSTER_ENTRY_ID,
    shiftDate: SHIFT_DATE,
    shiftStartAt: new Date(`${SHIFT_DATE}T08:00:00.000Z`),
    shiftEndAt: new Date(`${SHIFT_DATE}T17:00:00.000Z`),
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
  };
}

/** Returns a minimal valid CreateTimesheetEntryInput for an hourly_auto entry. */
function makeHourlyInput(
  overrides: Partial<CreateTimesheetEntryInput> = {},
): CreateTimesheetEntryInput {
  return {
    payrollType: "hourly_auto",
    staffUserId: STAFF_USER_ID,
    staffEmail: "staff@clinic-a.au",
    clinicId: CLINIC_A_ID,
    rosteredClinicId: CLINIC_A_ID,
    rosteredClinicName: "Clinic A",
    rosterEntryId: null,
    shiftDate: SHIFT_DATE,
    shiftStartAt: new Date(`${SHIFT_DATE}T08:00:00.000Z`),
    shiftEndAt: new Date(`${SHIFT_DATE}T17:00:00.000Z`),
    attendanceStatus: "present",
    clockInAt: new Date(`${SHIFT_DATE}T08:02:00.000Z`),
    clockOutAt: new Date(`${SHIFT_DATE}T17:05:00.000Z`),
    breakDurationMinutes: 30,
    totalHoursWorked: 8.55,
    ordinaryHours: 7.6,
    overtime15xHours: 0,
    overtime2xHours: 0,
    overtimeCustomHours: 0,
    commissionNote: null,
    generatedBy: "system_auto",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveRepository
// ─────────────────────────────────────────────────────────────────────────────

describe("InMemoryLeaveRepository", () => {
  describe("create", () => {
    it("assigns a UUID, sets status=pending, and nulls review fields", async () => {
      const repo = createInMemoryLeaveRepository();
      const record = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        totalDays: 5,
        reason: "Holiday",
      });

      expect(record.id).toEqual(expect.any(String));
      expect(record.status).toBe("pending");
      expect(record.reviewedByUserId).toBeNull();
      expect(record.reviewedAt).toBeNull();
      expect(record.reviewNotes).toBeNull();
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("findById", () => {
    it("returns the record for a known id", async () => {
      const repo = createInMemoryLeaveRepository();
      const created = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "sick",
        startDate: "2026-06-15",
        endDate: "2026-06-15",
        totalDays: 1,
        reason: null,
      });

      const found = await repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("returns null for an unknown id", async () => {
      const repo = createInMemoryLeaveRepository();
      const result = await repo.findById("00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });
  });

  describe("listByStaff", () => {
    it("filters to the requested staff member only", async () => {
      const repo = createInMemoryLeaveRepository();
      const OTHER_STAFF = "ffffffff-0000-0000-0000-000000000001";

      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        totalDays: 2,
        reason: null,
      });
      await repo.create({
        staffUserId: OTHER_STAFF,
        staffEmail: "other@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        totalDays: 2,
        reason: null,
      });

      const results = await repo.listByStaff(STAFF_USER_ID);
      expect(results).toHaveLength(1);
      expect(results[0]?.staffUserId).toBe(STAFF_USER_ID);
    });

    it("filters by status option", async () => {
      const repo = createInMemoryLeaveRepository();
      const pending = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
        reason: null,
      });
      await repo.updateStatus(pending.id, {
        status: "approved",
        reviewedByUserId: MANAGER_USER_ID,
        reviewNotes: null,
      });
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "sick",
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        totalDays: 1,
        reason: null,
      });

      const approved = await repo.listByStaff(STAFF_USER_ID, { status: "approved" });
      const pendingList = await repo.listByStaff(STAFF_USER_ID, { status: "pending" });
      expect(approved).toHaveLength(1);
      expect(pendingList).toHaveLength(1);
    });

    it("filters by leaveType option", async () => {
      const repo = createInMemoryLeaveRepository();
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
        reason: null,
      });
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "compassionate",
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        totalDays: 3,
        reason: "Family bereavement",
      });

      const compassionate = await repo.listByStaff(STAFF_USER_ID, { leaveType: "compassionate" });
      expect(compassionate).toHaveLength(1);
      expect(compassionate[0]?.leaveType).toBe("compassionate");
    });
  });

  describe("listByClinic", () => {
    it("is scoped to the requested clinic", async () => {
      const repo = createInMemoryLeaveRepository();
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
        reason: null,
      });
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-b.au",
        clinicId: CLINIC_B_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
        reason: null,
      });

      const clinicA = await repo.listByClinic(CLINIC_A_ID);
      const clinicB = await repo.listByClinic(CLINIC_B_ID);
      expect(clinicA).toHaveLength(1);
      expect(clinicB).toHaveLength(1);
      expect(clinicA[0]?.clinicId).toBe(CLINIC_A_ID);
    });

    it("filters by date range: excludes leave ending before 'from'", async () => {
      const repo = createInMemoryLeaveRepository();
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        totalDays: 5,
        reason: null,
      });

      const results = await repo.listByClinic(CLINIC_A_ID, { from: "2026-06-10" });
      expect(results).toHaveLength(0);
    });
  });

  describe("findApprovedOverlap", () => {
    it("returns approved leave covering the given date", async () => {
      const repo = createInMemoryLeaveRepository();
      const created = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-07",
        totalDays: 7,
        reason: null,
      });
      await repo.updateStatus(created.id, {
        status: "approved",
        reviewedByUserId: MANAGER_USER_ID,
        reviewNotes: null,
      });

      const overlap = await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-04");
      expect(overlap).toHaveLength(1);
    });

    it("does not return pending leave even if the date overlaps", async () => {
      const repo = createInMemoryLeaveRepository();
      await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-07",
        totalDays: 7,
        reason: null,
      });

      const overlap = await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-04");
      expect(overlap).toHaveLength(0);
    });

    it("does not return approved leave outside the date range", async () => {
      const repo = createInMemoryLeaveRepository();
      const created = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-07",
        totalDays: 7,
        reason: null,
      });
      await repo.updateStatus(created.id, {
        status: "approved",
        reviewedByUserId: MANAGER_USER_ID,
        reviewNotes: null,
      });

      const noOverlap = await repo.findApprovedOverlap(STAFF_USER_ID, "2026-07-10");
      expect(noOverlap).toHaveLength(0);
    });
  });

  describe("updateStatus", () => {
    it("sets status, reviewedByUserId, reviewedAt, and reviewNotes", async () => {
      const repo = createInMemoryLeaveRepository();
      const created = await repo.create({
        staffUserId: STAFF_USER_ID,
        staffEmail: "staff@clinic-a.au",
        clinicId: CLINIC_A_ID,
        leaveType: "annual",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
        reason: null,
      });

      const updated = await repo.updateStatus(created.id, {
        status: "rejected",
        reviewedByUserId: MANAGER_USER_ID,
        reviewNotes: "Insufficient coverage for that day",
      });

      expect(updated.status).toBe("rejected");
      expect(updated.reviewedByUserId).toBe(MANAGER_USER_ID);
      expect(updated.reviewedAt).toBeInstanceOf(Date);
      expect(updated.reviewNotes).toBe("Insufficient coverage for that day");
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it("throws for a non-existent id", async () => {
      const repo = createInMemoryLeaveRepository();
      await expect(
        repo.updateStatus("00000000-0000-0000-0000-000000000000", {
          status: "approved",
          reviewedByUserId: MANAGER_USER_ID,
          reviewNotes: null,
        }),
      ).rejects.toThrow("Leave request not found");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TimesheetRepository
// ─────────────────────────────────────────────────────────────────────────────

describe("InMemoryTimesheetRepository", () => {
  describe("create — commission_log track", () => {
    it("sets timesheetStatus=null and preserves attendanceStatus from input", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());

      expect(entry.id).toEqual(expect.any(String));
      expect(entry.timesheetStatus).toBeNull();
      expect(entry.attendanceStatus).toBe("pending_verification");
      expect(entry.approvedByUserId).toBeNull();
      expect(entry.approvedAt).toBeNull();
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it("nulls all hourly-track fields regardless of input", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());

      expect(entry.clockInAt).toBeNull();
      expect(entry.clockOutAt).toBeNull();
      expect(entry.breakDurationMinutes).toBeNull();
      expect(entry.totalHoursWorked).toBeNull();
      expect(entry.ordinaryHours).toBeNull();
    });
  });

  describe("create — hourly_auto track", () => {
    it("sets timesheetStatus='draft' and preserves hour breakdown from input", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeHourlyInput());

      expect(entry.timesheetStatus).toBe("draft");
      expect(entry.attendanceStatus).toBe("present");
      expect(entry.totalHoursWorked).toBe(8.55);
      expect(entry.ordinaryHours).toBe(7.6);
      expect(entry.clockInAt).toBeInstanceOf(Date);
      expect(entry.clockOutAt).toBeInstanceOf(Date);
    });
  });

  describe("findById", () => {
    it("returns a copy of the record for a known id", async () => {
      const repo = createInMemoryTimesheetRepository();
      const created = await repo.create(makeCommissionInput());
      const found = await repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("returns null for an unknown id", async () => {
      const repo = createInMemoryTimesheetRepository();
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });

  describe("findByRosterEntry", () => {
    it("returns the entry linked to the roster entry id", async () => {
      const repo = createInMemoryTimesheetRepository();
      await repo.create(makeCommissionInput({ rosterEntryId: ROSTER_ENTRY_ID }));

      const found = await repo.findByRosterEntry(ROSTER_ENTRY_ID);
      expect(found).not.toBeNull();
      expect(found?.rosterEntryId).toBe(ROSTER_ENTRY_ID);
    });

    it("returns null when no entry is linked to the roster entry id", async () => {
      const repo = createInMemoryTimesheetRepository();
      const result = await repo.findByRosterEntry("00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });
  });

  describe("listByClinic", () => {
    it("is scoped to the requested clinic", async () => {
      const repo = createInMemoryTimesheetRepository();
      await repo.create(makeCommissionInput({ clinicId: CLINIC_A_ID }));
      await repo.create(makeCommissionInput({ clinicId: CLINIC_B_ID, rosterEntryId: null }));

      const clinicA = await repo.listByClinic(CLINIC_A_ID);
      expect(clinicA).toHaveLength(1);
      expect(clinicA[0]?.clinicId).toBe(CLINIC_A_ID);
    });

    it("filters by payrollType option", async () => {
      const repo = createInMemoryTimesheetRepository();
      await repo.create(makeCommissionInput());
      await repo.create(makeHourlyInput({ rosterEntryId: null }));

      const commissions = await repo.listByClinic(CLINIC_A_ID, { payrollType: "commission_log" });
      const hourly = await repo.listByClinic(CLINIC_A_ID, { payrollType: "hourly_auto" });
      expect(commissions).toHaveLength(1);
      expect(hourly).toHaveLength(1);
    });

    it("pendingApprovalOnly returns only submitted hourly entries", async () => {
      const repo = createInMemoryTimesheetRepository();
      const draft = await repo.create(makeHourlyInput({ rosterEntryId: null }));
      const submitted = await repo.create(
        makeHourlyInput({ rosterEntryId: "eeeeeeee-0000-0000-0000-000000000099" }),
      );
      await repo.update(submitted.id, { timesheetStatus: "submitted" });

      const pending = await repo.listByClinic(CLINIC_A_ID, { pendingApprovalOnly: true });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.timesheetStatus).toBe("submitted");
      expect(pending.find((e) => e.id === draft.id)).toBeUndefined();
    });
  });

  describe("update", () => {
    it("applies only the provided fields and bumps updatedAt", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      const before = entry.updatedAt;

      const updated = await repo.update(entry.id, {
        attendanceStatus: "present",
        commissionNote: "Confirmed by reception",
      });

      expect(updated.attendanceStatus).toBe("present");
      expect(updated.commissionNote).toBe("Confirmed by reception");
      expect(updated.timesheetStatus).toBeNull();
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("throws for a non-existent id", async () => {
      const repo = createInMemoryTimesheetRepository();
      await expect(
        repo.update("00000000-0000-0000-0000-000000000000", { attendanceStatus: "present" }),
      ).rejects.toThrow("Timesheet entry not found");
    });
  });

  // ── getForecastLogs — CRITICAL forecasting safeguard tests ─────────────────

  describe("getForecastLogs — forecasting safeguard", () => {
    it("includes commission entries with attendanceStatus='present'", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      await repo.update(entry.id, {
        attendanceStatus: "present",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs.some((e) => e.attendanceStatus === "present")).toBe(true);
    });

    it("includes commission entries with attendanceStatus='absent'", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      await repo.update(entry.id, {
        attendanceStatus: "absent",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs.some((e) => e.attendanceStatus === "absent")).toBe(true);
    });

    it("includes commission entries with attendanceStatus='sick'", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      await repo.update(entry.id, {
        attendanceStatus: "sick",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs.some((e) => e.attendanceStatus === "sick")).toBe(true);
    });

    it("EXCLUDES commission entries with attendanceStatus='pending_verification'", async () => {
      const repo = createInMemoryTimesheetRepository();
      // Commission entries start as pending_verification — do not update.
      await repo.create(makeCommissionInput());

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);
      expect(logs.some((e) => e.attendanceStatus === "pending_verification")).toBe(false);
    });

    it("EXCLUDES entries with a verified status but no manager approval audit trail", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      // Set a verified status but deliberately omit approvedByUserId / approvedAt.
      await repo.update(entry.id, { attendanceStatus: "present" });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);
    });

    it("EXCLUDES commission entries with attendanceStatus='cancelled'", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      await repo.update(entry.id, { attendanceStatus: "cancelled" });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);
      expect(logs.some((e) => e.attendanceStatus === "cancelled")).toBe(false);
    });

    it("EXCLUDES hourly_auto entries even when attendanceStatus='present'", async () => {
      const repo = createInMemoryTimesheetRepository();
      // Hourly entry — already has attendanceStatus='present' from makeHourlyInput.
      await repo.create(makeHourlyInput({ rosterEntryId: null }));

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);
      expect(logs.every((e) => e.payrollType === "commission_log")).toBe(true);
    });

    it("EXCLUDES entries for a different shift date", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(
        makeCommissionInput({
          shiftDate: OTHER_DATE,
          shiftStartAt: new Date(`${OTHER_DATE}T08:00:00.000Z`),
          shiftEndAt: new Date(`${OTHER_DATE}T17:00:00.000Z`),
        }),
      );
      await repo.update(entry.id, { attendanceStatus: "present" });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);
    });

    it("EXCLUDES entries for a different clinic", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(
        makeCommissionInput({ rosteredClinicId: CLINIC_B_ID }),
      );
      await repo.update(entry.id, {
        attendanceStatus: "present",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logs).toHaveLength(0);

      const clinicBLogs = await repo.getForecastLogs(CLINIC_B_ID, SHIFT_DATE);
      expect(clinicBLogs).toHaveLength(1);
    });

    it("returns all three verified statuses together in a mixed scenario", async () => {
      const repo = createInMemoryTimesheetRepository();

      const e1 = await repo.create(makeCommissionInput({ rosterEntryId: "rid-001" }));
      const e2 = await repo.create(makeCommissionInput({ rosterEntryId: "rid-002" }));
      const e3 = await repo.create(makeCommissionInput({ rosterEntryId: "rid-003" }));
      await repo.create(makeCommissionInput({ rosterEntryId: "rid-004" }));
      const e5 = await repo.create(makeCommissionInput({ rosterEntryId: "rid-005" }));

      // Three verified with full audit trail, two excluded.
      await repo.update(e1.id, {
        attendanceStatus: "present",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });
      await repo.update(e2.id, {
        attendanceStatus: "absent",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });
      await repo.update(e3.id, {
        attendanceStatus: "sick",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });
      // e4 stays as pending_verification — excluded.
      await repo.update(e5.id, { attendanceStatus: "cancelled" }); // excluded.

      const logs = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);

      expect(logs).toHaveLength(3);
      const statuses = logs.map((e) => e.attendanceStatus).sort();
      expect(statuses).toEqual(["absent", "present", "sick"]);
    });

    it("returns defensive copies — mutating the result does not affect the store", async () => {
      const repo = createInMemoryTimesheetRepository();
      const entry = await repo.create(makeCommissionInput());
      await repo.update(entry.id, {
        attendanceStatus: "present",
        approvedByUserId: MANAGER_USER_ID,
        approvedAt: new Date(),
      });

      const [log] = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      if (log) {
        (log as { attendanceStatus: string }).attendanceStatus = "cancelled";
      }

      const logsAfter = await repo.getForecastLogs(CLINIC_A_ID, SHIFT_DATE);
      expect(logsAfter).toHaveLength(1);
      expect(logsAfter[0]?.attendanceStatus).toBe("present");
    });
  });
});
