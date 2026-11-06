import PDFDocument from "pdfkit";

import { addCalendarDays, formatCalendarDate } from "../utils/calendarDate.js";
import {
  addRosterPdfFooters,
  collectPdfBuffer,
  drawRosterPageHeading,
  formatRosterPdfTime,
  safeRosterFilenamePart,
  type RosterPdfLeave,
  type RosterPdfLogo,
  type RosterPdfShift,
  type RosterPdfStaff,
} from "./rosterPdfShared.js";

const PAGE_OPTIONS = {
  size: "A4",
  layout: "landscape",
  margins: { top: 28, right: 30, bottom: 32, left: 30 },
} as const;

const DAY_COLUMN_WIDTH = 82;
const COLUMNS = [
  { label: "Employee", width: 108 },
  { label: "Mon", width: DAY_COLUMN_WIDTH },
  { label: "Tue", width: DAY_COLUMN_WIDTH },
  { label: "Wed", width: DAY_COLUMN_WIDTH },
  { label: "Thu", width: DAY_COLUMN_WIDTH },
  { label: "Fri", width: DAY_COLUMN_WIDTH },
  { label: "Sat", width: DAY_COLUMN_WIDTH },
  { label: "Sun", width: DAY_COLUMN_WIDTH },
  { label: "Scheduled\nhours*", width: 68 },
] as const;

const TABLE_HEADER_HEIGHT = 28;
const ROW_PADDING = 4;
const MAX_LINES_PER_SEGMENT = 7;

export type WeeklyRosterPdfShift = RosterPdfShift;
export type WeeklyRosterPdfLeave = RosterPdfLeave;
export type WeeklyRosterPdfStaff = RosterPdfStaff;

export type WeeklyRosterPdfData = {
  clinicName: string;
  clinicTimeZone: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: Date;
  logo?: RosterPdfLogo;
  staff: WeeklyRosterPdfStaff[];
};

export type WeeklyRosterPdfResult = {
  buffer: Buffer;
  pageCount: number;
};

export type WeeklyRosterPdfOptions = {
  /** Test-only readability aid; production output remains compressed by default. */
  compress?: boolean;
};

export type WeeklyRosterPdfRow = {
  staffUserId: string;
  employee: string;
  days: string[][];
  scheduledHours: string;
};

function shortDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

function formatShift(
  shift: WeeklyRosterPdfShift,
  timeZone: string,
): string {
  const startDate = formatCalendarDate(shift.shiftStartAt, timeZone);
  const endDate = formatCalendarDate(
    new Date(shift.shiftEndAt.getTime() - 1),
    timeZone,
  );
  const startTime = formatRosterPdfTime(shift.shiftStartAt, timeZone);
  const endTime = formatRosterPdfTime(shift.shiftEndAt, timeZone);
  if (startDate === endDate) return `${startTime}-${endTime}`;
  return `${shortDateLabel(startDate)} ${startTime} - ${shortDateLabel(endDate)} ${endTime}`;
}

function clippedElapsedHours(
  shifts: WeeklyRosterPdfShift[],
  weekStartInstant: Date,
  weekEndInstant: Date,
): number {
  const milliseconds = shifts.reduce((total, shift) => {
    const start = Math.max(shift.shiftStartAt.getTime(), weekStartInstant.getTime());
    const end = Math.min(shift.shiftEndAt.getTime(), weekEndInstant.getTime());
    return total + Math.max(0, end - start);
  }, 0);
  return milliseconds / 3_600_000;
}

export function buildWeeklyRosterPdfRows(
  data: WeeklyRosterPdfData,
  weekStartInstant: Date,
  weekEndInstant: Date,
): WeeklyRosterPdfRow[] {
  const days = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(data.weekStart, index));

  return data.staff
    .map((staff): WeeklyRosterPdfRow => {
      const dayLines = days.map((date) => {
        const lines: string[] = [];
        for (const shift of [...staff.shifts].sort(
          (a, b) => a.shiftStartAt.getTime() - b.shiftStartAt.getTime(),
        )) {
          const shiftStartDate = formatCalendarDate(
            shift.shiftStartAt,
            data.clinicTimeZone,
          );
          const bucketDate =
            shiftStartDate < data.weekStart ? data.weekStart : shiftStartDate;
          if (bucketDate === date) {
            lines.push(formatShift(shift, data.clinicTimeZone));
          }
        }
        if (
          staff.approvedLeave.some(
            (leave) => leave.startDate <= date && leave.endDate >= date,
          )
        ) {
          lines.push("Approved Leave");
        }
        return lines.length > 0 ? lines : ["-"];
      });

      return {
        staffUserId: staff.staffUserId,
        employee: staff.displayName,
        days: dayLines,
        scheduledHours: `${clippedElapsedHours(
          staff.shifts,
          weekStartInstant,
          weekEndInstant,
        ).toFixed(1)} h`,
      };
    })
    .sort((a, b) => a.employee.localeCompare(b.employee));
}

export function weeklyRosterPdfFilename(
  clinicName: string,
  weekStart: string,
): string {
  return `RENQOR_${safeRosterFilenamePart(clinicName)}_Roster_${weekStart}.pdf`;
}

function splitRow(row: WeeklyRosterPdfRow): WeeklyRosterPdfRow[] {
  const segmentCount = Math.max(
    1,
    ...row.days.map((lines) =>
      Math.ceil(lines.length / MAX_LINES_PER_SEGMENT)),
  );
  return Array.from({ length: segmentCount }, (_, segmentIndex) => ({
    staffUserId: row.staffUserId,
    employee: segmentIndex === 0 ? row.employee : `${row.employee} (continued)`,
    days: row.days.map((lines) => {
      const segment = lines.slice(
        segmentIndex * MAX_LINES_PER_SEGMENT,
        (segmentIndex + 1) * MAX_LINES_PER_SEGMENT,
      );
      return segment.length > 0 ? segment : [""];
    }),
    scheduledHours: segmentIndex === 0 ? row.scheduledHours : "",
  }));
}

export async function generateWeeklyRosterPdf(
  data: WeeklyRosterPdfData,
  weekStartInstant: Date,
  weekEndInstant: Date,
  options: WeeklyRosterPdfOptions = {},
): Promise<WeeklyRosterPdfResult> {
  const doc = new PDFDocument({
    ...PAGE_OPTIONS,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `${data.clinicName} Weekly Staff Roster`,
      Author: "RENQOR",
      Subject: `${data.weekStart} to ${data.weekEnd}`,
    },
  });
  const result = collectPdfBuffer(doc);
  let pageCount = 1;
  const pageContentBottom = (): number => doc.page.height - 72;

  function drawPageHeading(): number {
    return drawRosterPageHeading(doc, {
      clinicName: data.clinicName,
      logo: data.logo,
      title: "WEEKLY STAFF ROSTER",
      subtitle:
        `${shortDateLabel(data.weekStart)} - ${shortDateLabel(data.weekEnd)}`,
      margins: PAGE_OPTIONS.margins,
    });
  }

  function drawTableHeader(y: number): number {
    let x = PAGE_OPTIONS.margins.left;
    for (const column of COLUMNS) {
      doc
        .rect(x, y, column.width, TABLE_HEADER_HEIGHT)
        .fillAndStroke("#253b63", "#253b63");
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(7.2)
        .text(column.label, x + 3, y + 6, {
          width: column.width - 6,
          align: column.label === "Employee" ? "left" : "center",
        });
      x += column.width;
    }
    return y + TABLE_HEADER_HEIGHT;
  }

  function startPage(isFirstPage: boolean): number {
    if (!isFirstPage) {
      doc.addPage(PAGE_OPTIONS);
      pageCount += 1;
    }
    return drawTableHeader(drawPageHeading());
  }

  let y = startPage(true);
  const rows = buildWeeklyRosterPdfRows(
    data,
    weekStartInstant,
    weekEndInstant,
  ).flatMap(splitRow);

  if (rows.length === 0) {
    doc
      .fillColor("#526077")
      .font("Helvetica")
      .fontSize(10)
      .text("No rostered staff, scheduled shifts or approved leave for this week.", PAGE_OPTIONS.margins.left, y + 16);
  } else {
    for (const row of rows) {
      const cells = [
        row.employee,
        ...row.days.map((lines) => lines.join("\n")),
        row.scheduledHours,
      ];
      doc.font("Helvetica").fontSize(7.2);
      const rowHeight = Math.max(
        26,
        ...cells.map((cell, index) => {
          const column = COLUMNS[index];
          if (!column) return 0;
          return doc.heightOfString(cell, {
            width: column.width - ROW_PADDING * 2,
          }) + ROW_PADDING * 2;
        }),
      );
      if (y + rowHeight > pageContentBottom()) {
        y = startPage(false);
      }

      let x = PAGE_OPTIONS.margins.left;
      cells.forEach((cell, index) => {
        const column = COLUMNS[index];
        if (!column) return;
        doc
          .rect(x, y, column.width, rowHeight)
          .fillAndStroke(index === 0 ? "#f4f6fa" : "#ffffff", "#b9c2d0");
        doc
          .fillColor("#17233c")
          .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7.2)
          .text(cell, x + ROW_PADDING, y + ROW_PADDING, {
            width: column.width - ROW_PADDING * 2,
            height: rowHeight - ROW_PADDING * 2,
            align: index === 0 ? "left" : "center",
          });
        x += column.width;
      });
      y += rowHeight;
    }
  }

  if (y + 24 > pageContentBottom()) {
    y = startPage(false);
  }
  doc
    .fillColor("#526077")
    .font("Helvetica")
    .fontSize(7.2)
    .text(
      "* Scheduled elapsed roster duration only; not payroll-approved or payable hours. No break deductions applied.",
      PAGE_OPTIONS.margins.left,
      Math.min(y + 8, pageContentBottom() - 10),
      { width: 620 },
    );

  pageCount = addRosterPdfFooters(doc, {
    margins: PAGE_OPTIONS.margins,
    generatedAt: data.generatedAt,
    timeZone: data.clinicTimeZone,
  });

  doc.end();
  return { buffer: await result, pageCount };
}
