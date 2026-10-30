import PDFDocument from "pdfkit";

import type { RosterEntry } from "../types/roster.js";
import { addCalendarDays, formatCalendarDate } from "../utils/calendarDate.js";

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

export type WeeklyRosterPdfShift = Pick<
  RosterEntry,
  "id" | "shiftStartAt" | "shiftEndAt"
>;

export type WeeklyRosterPdfLeave = {
  startDate: string;
  endDate: string;
};

export type WeeklyRosterPdfStaff = {
  staffUserId: string;
  displayName: string;
  shifts: WeeklyRosterPdfShift[];
  approvedLeave: WeeklyRosterPdfLeave[];
};

export type WeeklyRosterPdfData = {
  clinicName: string;
  clinicTimeZone: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: Date;
  logo?: {
    imageData: Buffer;
    mimeType: "image/png" | "image/jpeg";
  };
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

function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

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
  const startTime = formatTime(shift.shiftStartAt, timeZone);
  const endTime = formatTime(shift.shiftEndAt, timeZone);
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

function safeFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return cleaned || "Clinic";
}

export function weeklyRosterPdfFilename(
  clinicName: string,
  weekStart: string,
): string {
  return `RENQOR_${safeFilenamePart(clinicName)}_Roster_${weekStart}.pdf`;
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

function collectPdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);
  });
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
    const top = PAGE_OPTIONS.margins.top;
    let textX = PAGE_OPTIONS.margins.left;
    if (data.logo) {
      try {
        doc.image(data.logo.imageData, textX, top, {
          fit: [92, 38],
        });
        textX += 104;
      } catch {
        // Phase 1 stores normalized PNG/JPEG bytes. If historical bytes are
        // unreadable, retain a usable export with the clinic-name fallback.
      }
    }

    const clinicNameWidth =
      doc.page.width - textX - PAGE_OPTIONS.margins.right;
    doc
      .fillColor("#17233c")
      .font("Helvetica-Bold")
      .fontSize(14);
    const clinicNameHeight = doc.heightOfString(data.clinicName, {
      width: clinicNameWidth,
    });
    doc.text(data.clinicName, textX, top, {
      width: clinicNameWidth,
    });
    const titleY = top + clinicNameHeight + 3;
    doc
      .fontSize(11)
      .text("WEEKLY STAFF ROSTER", textX, titleY, { lineBreak: false });
    const dateY = titleY + 16;
    doc
      .fillColor("#526077")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${shortDateLabel(data.weekStart)} - ${shortDateLabel(data.weekEnd)}`,
        textX,
        dateY,
        { lineBreak: false },
      );
    return Math.max(top + 55, dateY + 13, data.logo ? top + 48 : top);
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

  const range = doc.bufferedPageRange();
  pageCount = range.count;
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Keep text above PDFKit's writable bottom edge. Drawing text below that
    // edge makes PDFKit silently append a blank overflow page.
    const footerY =
      doc.page.height - PAGE_OPTIONS.margins.bottom - 11;
    doc
      .strokeColor("#b9c2d0")
      .moveTo(PAGE_OPTIONS.margins.left, footerY - 5)
      .lineTo(doc.page.width - PAGE_OPTIONS.margins.right, footerY - 5)
      .stroke();
    doc
      .fillColor("#526077")
      .font("Helvetica")
      .fontSize(7.5)
      .text("Printed from RENQOR", PAGE_OPTIONS.margins.left, footerY, {
        lineBreak: false,
      })
      .text(
        `Generated ${data.generatedAt.toLocaleDateString("en-AU", {
          timeZone: data.clinicTimeZone,
        })}  |  Page ${String(index - range.start + 1)} of ${String(range.count)}`,
        PAGE_OPTIONS.margins.left,
        footerY,
        {
          width:
            doc.page.width -
            PAGE_OPTIONS.margins.left -
            PAGE_OPTIONS.margins.right,
          align: "right",
          lineBreak: false,
        },
      );
  }
  pageCount = doc.bufferedPageRange().count;

  doc.end();
  return { buffer: await result, pageCount };
}
