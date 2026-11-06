import type { Express } from "express";
import request from "supertest";
import sharp from "sharp";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import {
  buildWeeklyRosterPdfRows,
  generateWeeklyRosterPdf,
  weeklyRosterPdfFilename,
  type WeeklyRosterPdfData,
} from "../src/services/weeklyRosterPdf.js";
import { assertWeeklyRosterExportSize } from "../src/services/rosterService.js";
import { startOfCalendarDate } from "../src/utils/calendarDate.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { extractPdfKitText } from "./helpers/pdfText.js";
import { createTestApp } from "./helpers/testApp.js";

const WEEK_START = "2026-11-16";
const WEEK_END = "2026-11-22";
const exportUrl = (clinicId: string, weekStart = WEEK_START) =>
  `/api/v1/clinics/${clinicId}/roster/export.pdf?weekStart=${weekStart}`;

function parseBuffer(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  response.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
  response.on("error", callback);
}

async function createShift(
  app: Express,
  token: string,
  clinicId = SEED_CLINIC_A_ID,
): Promise<void> {
  const response = await request(app)
    .post(`/api/v1/clinics/${clinicId}/roster`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      staffUserId: SEED_USER_IDS.clinicAStaff,
      shiftStartAt: "2026-11-16T09:00:00+11:00",
      shiftEndAt: "2026-11-16T17:00:00+11:00",
      shiftType: "standard",
      notes: "private management note",
    });
  expect(response.status).toBe(201);
}

describe("weekly roster PDF endpoint", () => {
  it("exports a complete PDF for an Owner/Admin with safe private-download headers", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await createShift(app, token);

    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="RENQOR_Verve-Dental-Clinic-A_Roster_${WEEK_START}.pdf"`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-export-shift-count"]).toBe("1");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect((response.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("excludes cancelled shifts and their private notes from the PDF", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const created = await request(app)
      .post(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        staffUserId: SEED_USER_IDS.clinicAStaff,
        shiftStartAt: "2026-11-16T06:13:00+11:00",
        shiftEndAt: "2026-11-16T07:27:00+11:00",
        shiftType: "standard",
        notes: "cancelled private note",
      });
    expect(created.status).toBe(201);
    const shiftId = (created.body as { data: { id: string } }).data.id;
    expect(
      (await request(app)
        .delete(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${shiftId}`)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);

    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);
    expect(response.status).toBe(200);
    expect(response.headers["x-export-shift-count"]).toBe("0");
    const text = extractPdfKitText(response.body as Buffer);
    expect(text).not.toMatch(/06:13-07:27|cancelled private note/i);
  });

  it("exports without a clinic logo and embeds only the selected clinic logo when present", async () => {
    const requestedLogoClinicIds: string[] = [];
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        const repository = deps.clinicRepository;
        const imageData = await sharp({
          create: {
            width: 120,
            height: 40,
            channels: 3,
            background: "#253b63",
          },
        }).png().toBuffer();
        await repository.upsertBrandAsset({
          clinicId: SEED_CLINIC_A_ID,
          imageData,
          mimeType: "image/png",
          sha256Checksum: "a".repeat(64),
          width: 120,
          height: 40,
          updatedByUserId: SEED_USER_IDS.clinicAAdmin,
        });
        deps.clinicRepository = {
          ...repository,
          async findBrandAsset(clinicId) {
            requestedLogoClinicIds.push(clinicId);
            return repository.findBrandAsset(clinicId);
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);

    expect(response.status).toBe(200);
    expect(requestedLogoClinicIds).toEqual([SEED_CLINIC_A_ID]);
    expect((response.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

    const noLogoApp = await createTestApp();
    const noLogoToken = await loginAndGetAccessToken(
      noLogoApp,
      "admin@clinic-a.au",
    );
    expect(
      (await request(noLogoApp)
        .get(exportUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${noLogoToken}`)).status,
    ).toBe(200);
  });

  it("allows an operationally assigned GPM and denies an unassigned clinic", async () => {
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        await deps.clinicAssignmentsRepository.upsert({
          userId: SEED_USER_IDS.clinicAManager,
          clinicId: SEED_CLINIC_B_ID,
          canRoster: false,
          canOperate: true,
        });
      },
    });
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    expect(
      (await request(app)
        .get(exportUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);

    const unassignedApp = await createTestApp();
    const unassignedToken = await loginAndGetAccessToken(
      unassignedApp,
      "manager@clinic-a.au",
    );
    expect(
      (await request(unassignedApp)
        .get(exportUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${unassignedToken}`)).status,
    ).toBe(403);
  });

  it("denies unauthenticated and clinical-staff clinic-wide exports", async () => {
    const app = await createTestApp();
    expect((await request(app).get(exportUrl(SEED_CLINIC_A_ID))).status).toBe(401);
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    expect(
      (await request(app)
        .get(exportUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${staffToken}`)).status,
    ).toBe(403);
  });

  it("denies a manager whose valid login lacks module:roster", async () => {
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        await deps.permissionRepository.revoke(
          SEED_CLINIC_A_ID,
          SEED_USER_IDS.clinicAManager,
          "module:roster",
        );
      },
    });
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code)
      .toBe("FORBIDDEN");
  });

  it("filters historical inactive assignments before enforcing the 500 active-staff limit", async () => {
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        const assignmentRepository = deps.clinicAssignmentsRepository;
        const userRepository = deps.userRepository;
        const template = await userRepository.findById(
          SEED_USER_IDS.clinicAStaff,
        );
        if (!template) throw new Error("Expected seed staff user");
        deps.clinicAssignmentsRepository = {
          ...assignmentRepository,
          async listByClinic(clinicId) {
            const existing = await assignmentRepository.listByClinic(clinicId);
            if (clinicId !== SEED_CLINIC_A_ID) return existing;
            return [
              ...existing,
              ...Array.from({ length: 600 }, (_, index) => ({
                id: `inactive-assignment-${String(index)}`,
                userId: `inactive-user-${String(index)}`,
                clinicId,
                canRoster: true,
                canOperate: false,
                assignedByUserId: null,
                assignedAt: new Date("2024-01-01T00:00:00.000Z"),
                updatedAt: new Date("2024-01-01T00:00:00.000Z"),
              })),
            ];
          },
        };
        deps.userRepository = {
          ...userRepository,
          findById(userId) {
            if (!userId.startsWith("inactive-user-")) {
              return userRepository.findById(userId);
            }
            return Promise.resolve({
              ...template,
              id: userId,
              email: `${userId}@inactive.test`,
              isActive: false,
            });
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["x-export-staff-count"]).toBe("3");
  });

  it("blocks an Owner/Admin from exporting another organisation's roster", async () => {
    const app = await createTestApp({
      configureDependencies: (deps) => {
        const repository = deps.clinicRepository;
        deps.clinicRepository = {
          ...repository,
          async findById(id) {
            const clinic = await repository.findById(id);
            if (!clinic) return null;
            return {
              ...clinic,
              organisationId:
                id === SEED_CLINIC_A_ID
                  ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                  : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            };
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const response = await request(app)
      .get(exportUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code)
      .toBe("TENANT_ACCESS_DENIED");
  });

  it.each([
    ["missing", `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/export.pdf`],
    ["malformed", exportUrl(SEED_CLINIC_A_ID, "16-11-2026")],
    ["impossible", exportUrl(SEED_CLINIC_A_ID, "2026-02-30")],
    ["not Monday", exportUrl(SEED_CLINIC_A_ID, "2026-11-17")],
  ])("rejects a %s weekStart", async (_label, url) => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    expect(
      (await request(app)
        .get(url)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(400);
  });
});

function samplePdfData(): WeeklyRosterPdfData {
  return {
    clinicName: "Bentleigh East / Dental",
    clinicTimeZone: "Australia/Melbourne",
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    generatedAt: new Date("2026-11-16T00:00:00.000Z"),
    staff: [
      {
        staffUserId: "staff-1",
        displayName: "Alex Example",
        shifts: [
          {
            id: "shift-1",
            shiftStartAt: new Date("2026-11-15T22:00:00.000Z"),
            shiftEndAt: new Date("2026-11-16T01:00:00.000Z"),
          },
          {
            id: "shift-2",
            shiftStartAt: new Date("2026-11-16T02:00:00.000Z"),
            shiftEndAt: new Date("2026-11-16T06:00:00.000Z"),
          },
          {
            id: "shift-overnight",
            shiftStartAt: new Date("2026-11-17T11:00:00.000Z"),
            shiftEndAt: new Date("2026-11-17T19:00:00.000Z"),
          },
        ],
        approvedLeave: [{ startDate: "2026-11-19", endDate: "2026-11-19" }],
      },
    ],
  };
}

describe("weekly roster PDF generation", () => {
  const from = startOfCalendarDate(WEEK_START, "Australia/Melbourne");
  const to = startOfCalendarDate("2026-11-23", "Australia/Melbourne");

  it("shows multiple shifts, approved leave, overnight boundaries and elapsed hours", () => {
    const rows = buildWeeklyRosterPdfRows(samplePdfData(), from, to);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.days[0]).toEqual(["09:00-12:00", "13:00-17:00"]);
    expect(rows[0]?.days[1]?.[0]).toContain(
      "Tue, 17 Nov 22:00 - Wed, 18 Nov 06:00",
    );
    expect(rows[0]?.days[3]).toContain("Approved Leave");
    expect(rows[0]?.scheduledHours).toBe("15.0 h");
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(/reason|medical|salary|pay rate|@/i);
  });

  it("clips a boundary-crossing shift to the selected week without duplication", () => {
    const data = samplePdfData();
    const staff = data.staff[0];
    if (!staff) throw new Error("Expected sample staff");
    staff.shifts = [{
      id: "boundary",
      shiftStartAt: new Date("2026-11-15T11:00:00.000Z"),
      shiftEndAt: new Date("2026-11-15T15:00:00.000Z"),
    }];
    const rows = buildWeeklyRosterPdfRows(data, from, to);
    expect(
      rows[0]?.days
        .flat()
        .filter((line) => line.includes("Sun, 15 Nov 22:00")),
    ).toHaveLength(1);
    expect(rows[0]?.scheduledHours).toBe("2.0 h");
  });

  it("uses elapsed instants across the Melbourne daylight-saving transition", () => {
    const dstWeekStart = "2026-09-28";
    const dstFrom = startOfCalendarDate(dstWeekStart, "Australia/Melbourne");
    const dstTo = startOfCalendarDate("2026-10-05", "Australia/Melbourne");
    const data: WeeklyRosterPdfData = {
      ...samplePdfData(),
      weekStart: dstWeekStart,
      weekEnd: "2026-10-04",
      staff: [{
        staffUserId: "dst-staff",
        displayName: "DST Staff",
        shifts: [{
          id: "dst-shift",
          shiftStartAt: new Date("2026-10-03T15:00:00.000Z"),
          shiftEndAt: new Date("2026-10-03T17:00:00.000Z"),
        }],
        approvedLeave: [],
      }],
    };

    const rows = buildWeeklyRosterPdfRows(data, dstFrom, dstTo);
    expect(rows[0]?.days[6]).toEqual(["01:00-04:00"]);
    expect(rows[0]?.scheduledHours).toBe("2.0 h");
  });

  it("paginates a busy roster without dropping staff", async () => {
    const data = samplePdfData();
    const sampleShifts = data.staff[0]?.shifts;
    if (!sampleShifts) throw new Error("Expected sample shifts");
    data.staff = Array.from({ length: 120 }, (_, index) => ({
      staffUserId: `staff-${String(index)}`,
      displayName: `Staff Member ${String(index).padStart(3, "0")}`,
      shifts: sampleShifts,
      approvedLeave: [],
    }));
    const rows = buildWeeklyRosterPdfRows(data, from, to);
    const pdf = await generateWeeklyRosterPdf(data, from, to);
    const actualPageCount =
      pdf.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    expect(rows).toHaveLength(120);
    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(actualPageCount).toBe(pdf.pageCount);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.buffer.toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+841\.89\s+595\.28\s*\]/,
    );
    expect(pdf.buffer.length).toBeGreaterThan(10_000);
  });

  it("wraps complete short and long clinic headings on every page", async () => {
    const data = samplePdfData();
    const longName =
      "RENQOR Specialist Dental and Maxillofacial Centre of Bentleigh East, Heathmont and Cheltenham";
    data.clinicName = longName;
    data.staff = Array.from({ length: 90 }, (_, index) => ({
      staffUserId: `header-staff-${String(index)}`,
      displayName: `Header Staff ${String(index).padStart(3, "0")}`,
      shifts: [],
      approvedLeave: [],
    }));
    const pdf = await generateWeeklyRosterPdf(data, from, to, {
      compress: false,
    });
    const text = extractPdfKitText(pdf.buffer);
    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(text.split(longName)).toHaveLength(pdf.pageCount + 1);
    expect(text.split("WEEKLY STAFF ROSTER")).toHaveLength(
      pdf.pageCount + 1,
    );
    expect(text.split("Printed from RENQOR")).toHaveLength(
      pdf.pageCount + 1,
    );

    const shortData = samplePdfData();
    shortData.clinicName = "Heathmont";
    const shortPdf = await generateWeeklyRosterPdf(shortData, from, to, {
      compress: false,
    });
    expect(extractPdfKitText(shortPdf.buffer)).toContain("Heathmont");
  });

  it("retains every shift when a staff row continues past seven entries", async () => {
    const data = samplePdfData();
    const mondayStart = Date.parse("2026-11-15T21:00:00.000Z");
    const staff = data.staff[0];
    if (!staff) throw new Error("Expected sample staff");
    staff.shifts = Array.from({ length: 9 }, (_, index) => ({
      id: `continued-${String(index)}`,
      shiftStartAt: new Date(mondayStart + index * 30 * 60_000),
      shiftEndAt: new Date(mondayStart + (index * 30 + 20) * 60_000),
    }));
    const expectedLines = buildWeeklyRosterPdfRows(data, from, to)[0]?.days[0]
      ?? [];
    const pdf = await generateWeeklyRosterPdf(data, from, to, {
      compress: false,
    });
    const text = extractPdfKitText(pdf.buffer);
    expect(expectedLines).toHaveLength(9);
    for (const line of expectedLines) expect(text).toContain(line);
    expect(text).toContain("Alex Example (continued)");
  });

  it("does not render sensitive contact, payroll, notes or leave-reason data", async () => {
    const data = samplePdfData();
    const staff = data.staff[0];
    if (!staff) throw new Error("Expected sample staff");
    Object.assign(staff, {
      email: "private@example.test",
      phone: "0400 000 000",
      payRate: "$999.99",
      payrollAmount: "$12345.67",
      notes: "private management note",
      leaveReason: "private medical details",
    });
    const pdf = await generateWeeklyRosterPdf(data, from, to, {
      compress: false,
    });
    const text = extractPdfKitText(pdf.buffer);
    expect(text).toContain("Approved Leave");
    expect(text).not.toMatch(
      /private@example|0400 000 000|\$999\.99|\$12345\.67|private management note|private medical details/i,
    );
  });

  it("enforces inclusive active-staff and shift boundaries", () => {
    expect(() => {
      assertWeeklyRosterExportSize({
        activeStaffCount: 500,
        shiftCount: 5_000,
      });
    }).not.toThrow();
    expect(() => {
      assertWeeklyRosterExportSize({ activeStaffCount: 501 });
    })
      .toThrow("too many active staff");
    expect(() => {
      assertWeeklyRosterExportSize({ shiftCount: 5_001 });
    })
      .toThrow("too many shifts");
  });

  it("creates safe descriptive filenames", () => {
    expect(weeklyRosterPdfFilename("Bentleigh East / Dental", WEEK_START))
      .toBe(`RENQOR_Bentleigh-East-Dental_Roster_${WEEK_START}.pdf`);
    expect(weeklyRosterPdfFilename("../../", WEEK_START))
      .toBe(`RENQOR_Clinic_Roster_${WEEK_START}.pdf`);
  });
});
