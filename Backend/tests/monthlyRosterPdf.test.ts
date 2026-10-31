import type { Express } from "express";
import request from "supertest";
import sharp from "sharp";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../src/repositories/userRepository.js";
import {
  buildMonthlyRosterCalendar,
  generateMonthlyRosterPdf,
  monthlyRosterPdfFilename,
  type MonthlyRosterPdfData,
  type MonthlyRosterPaperSize,
} from "../src/services/monthlyRosterPdf.js";
import { assertMonthlyRosterExportSize } from "../src/services/rosterService.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { extractPdfKitText } from "./helpers/pdfText.js";
import { createTestApp } from "./helpers/testApp.js";

const MONTH = "2026-11";
const monthlyUrl = (
  clinicId: string,
  month = MONTH,
  paperSize = "A3",
) =>
  `/api/v1/clinics/${clinicId}/roster/monthly.pdf?month=${month}&paperSize=${paperSize}`;

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
  input: {
    start?: string;
    end?: string;
    clinicId?: string;
    notes?: string;
  } = {},
): Promise<string> {
  const response = await request(app)
    .post(`/api/v1/clinics/${input.clinicId ?? SEED_CLINIC_A_ID}/roster`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      staffUserId: SEED_USER_IDS.clinicAStaff,
      shiftStartAt: input.start ?? "2026-11-16T09:00:00+11:00",
      shiftEndAt: input.end ?? "2026-11-16T17:00:00+11:00",
      shiftType: "standard",
      notes: input.notes ?? "private shift note",
    });
  expect(response.status).toBe(201);
  return (response.body as { data: { id: string } }).data.id;
}

describe("monthly roster PDF endpoint", () => {
  it("exports A3 by default for an Owner/Admin with private download headers", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    await createShift(app, token);
    const response = await request(app)
      .get(
        `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/monthly.pdf?month=${MONTH}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="RENQOR_Verve-Dental-Clinic-A_Roster_${MONTH}_A3.pdf"`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-export-shift-count"]).toBe("1");
    expect(response.headers["x-export-entry-count"]).toBe("1");
    const pdf = response.body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+1190\.55\s+841\.89\s*\]/,
    );
  });

  it("exports A4 landscape and uses only the requested clinic logo", async () => {
    const requestedLogoClinicIds: string[] = [];
    const app = await createTestApp({
      configureDependencies: async (deps) => {
        const repository = deps.clinicRepository;
        const imageData = await sharp({
          create: {
            width: 37,
            height: 19,
            channels: 3,
            background: "#253b63",
          },
        }).png().toBuffer();
        await repository.upsertBrandAsset({
          clinicId: SEED_CLINIC_A_ID,
          imageData,
          mimeType: "image/png",
          sha256Checksum: "a".repeat(64),
          width: 37,
          height: 19,
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
      .get(monthlyUrl(SEED_CLINIC_A_ID, MONTH, "A4"))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);
    expect(response.status).toBe(200);
    expect(requestedLogoClinicIds).toEqual([SEED_CLINIC_A_ID]);
    expect((response.body as Buffer).toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+841\.89\s+595\.28\s*\]/,
    );
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
        .get(monthlyUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(200);

    const unassignedApp = await createTestApp();
    const unassignedToken = await loginAndGetAccessToken(
      unassignedApp,
      "manager@clinic-a.au",
    );
    expect(
      (await request(unassignedApp)
        .get(monthlyUrl(SEED_CLINIC_B_ID))
        .set("Authorization", `Bearer ${unassignedToken}`)).status,
    ).toBe(403);
  });

  it("denies unauthenticated, clinical staff and managers without module:roster", async () => {
    const app = await createTestApp();
    expect((await request(app).get(monthlyUrl(SEED_CLINIC_A_ID))).status)
      .toBe(401);
    const staffToken = await loginAndGetAccessToken(app, "staff@clinic-a.au");
    expect(
      (await request(app)
        .get(monthlyUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${staffToken}`)).status,
    ).toBe(403);

    const noModuleApp = await createTestApp({
      configureDependencies: async (deps) => {
        await deps.permissionRepository.revoke(
          SEED_CLINIC_A_ID,
          SEED_USER_IDS.clinicAManager,
          "module:roster",
        );
      },
    });
    const managerToken = await loginAndGetAccessToken(
      noModuleApp,
      "manager@clinic-a.au",
    );
    expect(
      (await request(noModuleApp)
        .get(monthlyUrl(SEED_CLINIC_A_ID))
        .set("Authorization", `Bearer ${managerToken}`)).status,
    ).toBe(403);
  });

  it("blocks an Owner/Admin from another organisation", async () => {
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
      .get(monthlyUrl(SEED_CLINIC_B_ID))
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code)
      .toBe("TENANT_ACCESS_DENIED");
  });

  it.each([
    ["missing month", `/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/monthly.pdf`],
    ["malformed month", monthlyUrl(SEED_CLINIC_A_ID, "11-2026")],
    ["impossible month", monthlyUrl(SEED_CLINIC_A_ID, "2026-13")],
    ["unsupported paper", monthlyUrl(SEED_CLINIC_A_ID, MONTH, "Letter")],
  ])("rejects %s", async (_label, url) => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    expect(
      (await request(app)
        .get(url)
        .set("Authorization", `Bearer ${token}`)).status,
    ).toBe(400);
  });

  it("excludes cancelled shifts from the composed monthly export", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const shiftId = await createShift(app, token, {
      start: "2026-11-18T06:13:00+11:00",
      end: "2026-11-18T07:27:00+11:00",
      notes: "cancelled confidential note",
    });
    await request(app)
      .delete(`/api/v1/clinics/${SEED_CLINIC_A_ID}/roster/${shiftId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const response = await request(app)
      .get(monthlyUrl(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);
    expect(response.status).toBe(200);
    expect(response.headers["x-export-shift-count"]).toBe("0");
    expect(extractPdfKitText(response.body as Buffer)).not.toMatch(
      /06:13|07:27|cancelled confidential note/i,
    );
  });

  it("returns continuation counts and footers for a busy A4 export", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "admin@clinic-a.au");
    const dayStart = Date.parse("2026-11-15T13:00:00.000Z");
    for (let index = 0; index < 32; index += 1) {
      const shiftStart = new Date(dayStart + index * 20 * 60_000);
      const shiftEnd = new Date(shiftStart.getTime() + 10 * 60_000);
      await createShift(app, token, {
        start: shiftStart.toISOString(),
        end: shiftEnd.toISOString(),
      });
    }

    const response = await request(app)
      .get(monthlyUrl(SEED_CLINIC_A_ID, MONTH, "A4"))
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);
    expect(response.status).toBe(200);
    const continuationCount = Number(
      response.headers["x-export-continuation-entry-count"],
    );
    const pageCount = Number(response.headers["x-export-page-count"]);
    expect(continuationCount).toBeGreaterThan(0);
    expect(pageCount).toBeGreaterThan(1);
    expect(
      extractPdfKitText(response.body as Buffer)
        .split("Printed from RENQOR"),
    ).toHaveLength(pageCount + 1);
  }, 15_000);
});

function sampleMonthlyData(
  paperSize: MonthlyRosterPaperSize = "A3",
): MonthlyRosterPdfData {
  return {
    clinicName: "Bentleigh East Dental",
    clinicTimeZone: "Australia/Melbourne",
    month: MONTH,
    monthStart: "2026-11-01",
    monthEnd: "2026-11-30",
    generatedAt: new Date("2026-11-01T00:00:00.000Z"),
    paperSize,
    staff: [
      {
        staffUserId: "staff-alex",
        displayName: "Alex Example",
        shifts: [
          {
            id: "shift-one",
            shiftStartAt: new Date("2026-11-15T22:00:00.000Z"),
            shiftEndAt: new Date("2026-11-16T01:00:00.000Z"),
          },
          {
            id: "shift-two",
            shiftStartAt: new Date("2026-11-16T02:00:00.000Z"),
            shiftEndAt: new Date("2026-11-16T06:00:00.000Z"),
          },
          {
            id: "overnight",
            shiftStartAt: new Date("2026-11-17T11:00:00.000Z"),
            shiftEndAt: new Date("2026-11-17T19:00:00.000Z"),
          },
        ],
        approvedLeave: [
          { startDate: "2026-11-19", endDate: "2026-11-19" },
        ],
      },
    ],
  };
}

describe("monthly roster calendar data and PDF generation", () => {
  it.each([
    ["2021-02", "2021-02-01", "2021-02-28", 4],
    ["2024-02", "2024-02-01", "2024-02-29", 5],
    ["2026-11", "2026-11-01", "2026-11-30", 6],
  ])(
    "builds a Monday-first %s calendar",
    (month, monthStart, monthEnd, expectedWeeks) => {
      const calendar = buildMonthlyRosterCalendar({
        ...sampleMonthlyData(),
        month,
        monthStart,
        monthEnd,
        staff: [],
      });
      expect(calendar.weekCount).toBe(expectedWeeks);
      const firstDay = calendar.days[0];
      if (!firstDay) throw new Error("Expected a populated calendar");
      expect(
        new Date(`${firstDay.date}T00:00:00.000Z`).getUTCDay(),
      ).toBe(1);
      expect(calendar.days.filter((day) => day.inSelectedMonth)).toHaveLength(
        Number(monthEnd.slice(-2)),
      );
    },
  );

  it("sorts multiple shifts by local start, attributes overnight shifts once, and includes approved leave", () => {
    const calendar = buildMonthlyRosterCalendar(sampleMonthlyData());
    const monday = calendar.days.find((day) => day.date === "2026-11-16");
    expect(monday?.entries.map((entry) => entry.text)).toEqual([
      "Alex Example  09:00–12:00",
      "Alex Example  13:00–17:00",
    ]);
    const tuesday = calendar.days.find((day) => day.date === "2026-11-17");
    expect(tuesday?.entries).toHaveLength(1);
    expect(tuesday?.entries[0]?.text).toContain("22:00–Wed 06:00");
    expect(
      calendar.days.find((day) => day.date === "2026-11-18")?.entries,
    ).toHaveLength(0);
    expect(
      calendar.days.find((day) => day.date === "2026-11-19")
        ?.entries[0]?.text,
    ).toBe("Alex Example — Leave");
  });

  it("does not place out-of-month shifts in muted adjacent-month cells", () => {
    const data = sampleMonthlyData();
    const staff = data.staff[0];
    if (!staff) throw new Error("Expected sample roster staff");
    staff.shifts.push({
      id: "october-secret",
      shiftStartAt: new Date("2026-10-29T22:00:00.000Z"),
      shiftEndAt: new Date("2026-10-30T06:00:00.000Z"),
    });
    const calendar = buildMonthlyRosterCalendar(data);
    expect(
      calendar.days
        .filter((day) => !day.inSelectedMonth)
        .flatMap((day) => day.entries),
    ).toHaveLength(0);
    expect(calendar.entryCount).toBe(4);
  });

  it("uses clinic-local time through the Melbourne daylight-saving transition", () => {
    const data: MonthlyRosterPdfData = {
      ...sampleMonthlyData(),
      month: "2026-10",
      monthStart: "2026-10-01",
      monthEnd: "2026-10-31",
      staff: [{
        staffUserId: "dst",
        displayName: "DST Staff",
        shifts: [{
          id: "dst-shift",
          shiftStartAt: new Date("2026-10-03T15:00:00.000Z"),
          shiftEndAt: new Date("2026-10-03T17:00:00.000Z"),
        }],
        approvedLeave: [],
      }],
    };
    const calendar = buildMonthlyRosterCalendar(data);
    expect(
      calendar.days.find((day) => day.date === "2026-10-04")
        ?.entries[0]?.text,
    ).toContain("01:00–04:00");
  });

  it("creates continuation pages without missing or duplicating busy-day entries", async () => {
    const data = sampleMonthlyData("A4");
    const longEmployeeName =
      "Dr Alexandra Very Long Employee Name for Orthodontics, Maxillofacial Surgery and Clinical Operations";
    data.clinicName =
      "RENQOR Specialist Dental and Maxillofacial Centre of Bentleigh East and Heathmont";
    data.staff = Array.from({ length: 32 }, (_, index) => ({
      staffUserId: `busy-${String(index)}`,
      displayName:
        index === 0
          ? longEmployeeName
          : `Unique Busy Staff ${String(index).padStart(2, "0")}`,
      shifts: [{
        id: `busy-shift-${String(index)}`,
        shiftStartAt: new Date(
          Date.parse("2026-11-16T00:00:00.000Z") + index * 60_000,
        ),
        shiftEndAt: new Date(
          Date.parse("2026-11-16T00:30:00.000Z") + index * 60_000,
        ),
      }],
      approvedLeave: [],
    }));
    const pdf = await generateMonthlyRosterPdf(data, { compress: false });
    const text = extractPdfKitText(pdf.buffer);
    const actualPageCount =
      pdf.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    expect(pdf.entryCount).toBe(32);
    expect(pdf.continuationEntryCount).toBeGreaterThan(0);
    expect(pdf.pageCount).toBe(3);
    expect(actualPageCount).toBe(pdf.pageCount);
    expect(text).toContain("see continuation");
    for (let index = 0; index < 32; index += 1) {
      const name =
        index === 0
          ? longEmployeeName
          : `Unique Busy Staff ${String(index).padStart(2, "0")}`;
      expect(text.split(name)).toHaveLength(2);
    }
    expect(text.split("Printed from RENQOR")).toHaveLength(pdf.pageCount + 1);
    expect(text.split(data.clinicName)).toHaveLength(pdf.pageCount + 1);
  });

  it("renders the complete clinic name when no logo is configured", async () => {
    const data = sampleMonthlyData();
    data.clinicName =
      "RENQOR Long Clinic Name Without a Configured Brand Logo";
    const pdf = await generateMonthlyRosterPdf(data, { compress: false });
    const text = extractPdfKitText(pdf.buffer);

    expect(text).toContain(data.clinicName);
    expect(pdf.buffer.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image\b/);
  });

  it("falls back to the clinic name when configured logo bytes are unreadable", async () => {
    const data = sampleMonthlyData();
    data.clinicName = "Heathmont Dental Clinic";
    data.logo = {
      imageData: Buffer.from("not-a-valid-image"),
      mimeType: "image/png",
    };
    const pdf = await generateMonthlyRosterPdf(data, { compress: false });
    const text = extractPdfKitText(pdf.buffer);

    expect(text).toContain(data.clinicName);
    expect(pdf.buffer.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image\b/);
  });

  it("renders A3 and A4 as distinct readable landscape documents", async () => {
    const a3 = await generateMonthlyRosterPdf(sampleMonthlyData("A3"));
    const a4 = await generateMonthlyRosterPdf(
      sampleMonthlyData("A4"),
      { compress: false },
    );
    expect(a3.buffer.toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+1190\.55\s+841\.89\s*\]/,
    );
    expect(a4.buffer.toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+841\.89\s+595\.28\s*\]/,
    );
    expect(a4.buffer.toString("latin1")).toMatch(/\b7\.2\s+Tf\b/);
    expect(a4.buffer.toString("latin1")).toMatch(/\bre\s*\nW\s+n\b/);
    expect(a3.pageCount).toBe(1);
    expect(a4.pageCount).toBe(1);
  });

  it("does not render confidential contact, payroll, notes, or leave-reason fields", async () => {
    const data = sampleMonthlyData();
    const staff = data.staff[0];
    if (!staff) throw new Error("Expected sample roster staff");
    Object.assign(staff, {
      email: "private@example.test",
      phone: "0400 000 000",
      payRate: "$999.99",
      payrollAmount: "$12345.67",
      notes: "confidential shift note",
      leaveReason: "private medical details",
    });
    const pdf = await generateMonthlyRosterPdf(data, { compress: false });
    const text = extractPdfKitText(pdf.buffer);
    expect(text).toContain("Alex Example — Leave");
    expect(text).not.toMatch(
      /private@example|0400 000 000|\$999\.99|\$12345\.67|confidential shift note|private medical details/i,
    );
  });

  it("enforces inclusive monthly export boundaries with HTTP 413 errors above them", () => {
    expect(() => {
      assertMonthlyRosterExportSize({
        shiftCount: 20_000,
        candidateStaffCount: 2_000,
        activeStaffCount: 500,
      });
    }).not.toThrow();
    for (const input of [
      { shiftCount: 20_001 },
      { candidateStaffCount: 2_001 },
      { activeStaffCount: 501 },
    ]) {
      try {
        assertMonthlyRosterExportSize(input);
        throw new Error("Expected monthly export size rejection");
      } catch (error: unknown) {
        expect(error).toMatchObject({
          statusCode: 413,
          code: "ROSTER_EXPORT_TOO_LARGE",
        });
      }
    }
  });

  it("creates safe descriptive monthly filenames", () => {
    expect(monthlyRosterPdfFilename("Heathmont / Dental", MONTH, "A3"))
      .toBe(`RENQOR_Heathmont-Dental_Roster_${MONTH}_A3.pdf`);
    expect(monthlyRosterPdfFilename("../../", MONTH, "A4"))
      .toBe(`RENQOR_Clinic_Roster_${MONTH}_A4.pdf`);
  });
});
