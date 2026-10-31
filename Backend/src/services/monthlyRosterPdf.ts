import PDFDocument from "pdfkit";

import {
  addCalendarDays,
  formatCalendarDate,
} from "../utils/calendarDate.js";
import {
  addRosterPdfFooters,
  collectPdfBuffer,
  drawRosterPageHeading,
  formatRosterPdfTime,
  safeRosterFilenamePart,
  type RosterPdfLogo,
  type RosterPdfStaff,
} from "./rosterPdfShared.js";

export type MonthlyRosterPaperSize = "A3" | "A4";

export type MonthlyRosterPdfData = {
  clinicName: string;
  clinicTimeZone: string;
  month: string;
  monthStart: string;
  monthEnd: string;
  generatedAt: Date;
  paperSize: MonthlyRosterPaperSize;
  logo?: RosterPdfLogo;
  staff: RosterPdfStaff[];
};

export type MonthlyRosterCalendarEntry = {
  id: string;
  date: string;
  kind: "shift" | "leave";
  sortAt: number;
  text: string;
};

export type MonthlyRosterCalendarDay = {
  date: string;
  inSelectedMonth: boolean;
  entries: MonthlyRosterCalendarEntry[];
};

export type MonthlyRosterCalendar = {
  monthLabel: string;
  weekCount: number;
  days: MonthlyRosterCalendarDay[];
  entryCount: number;
};

export type MonthlyRosterPdfResult = {
  buffer: Buffer;
  pageCount: number;
  entryCount: number;
  continuationEntryCount: number;
};

export type MonthlyRosterPdfOptions = {
  compress?: boolean;
};

type PaperLayout = {
  size: MonthlyRosterPaperSize;
  margins: { top: number; right: number; bottom: number; left: number };
  clinicFontSize: number;
  titleFontSize: number;
  subtitleFontSize: number;
  weekdayHeaderHeight: number;
  dayNumberFontSize: number;
  entryFontSize: number;
  entryLineGap: number;
  continuationFontSize: number;
};

const PAPER_LAYOUTS: Record<MonthlyRosterPaperSize, PaperLayout> = {
  A3: {
    size: "A3",
    margins: { top: 26, right: 30, bottom: 34, left: 30 },
    clinicFontSize: 16,
    titleFontSize: 12,
    subtitleFontSize: 9,
    weekdayHeaderHeight: 24,
    dayNumberFontSize: 9,
    entryFontSize: 8,
    entryLineGap: 2,
    continuationFontSize: 9,
  },
  A4: {
    size: "A4",
    margins: { top: 22, right: 22, bottom: 32, left: 22 },
    clinicFontSize: 13,
    titleFontSize: 10,
    subtitleFontSize: 7.5,
    weekdayHeaderHeight: 19,
    dayNumberFontSize: 7.5,
    entryFontSize: 7.2,
    entryLineGap: 1.5,
    continuationFontSize: 7.5,
  },
};

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const GRID_BOTTOM_CLEARANCE = 30;
const CELL_PADDING = 4;
const CELL_CLIP_INSET = 1;
const TEXT_FIT_SAFETY = 1;

function monthParts(month: string): { year: number; monthNumber: number } {
  const [yearText, monthText] = month.split("-");
  return {
    year: Number(yearText),
    monthNumber: Number(monthText),
  };
}

function monthLabel(month: string): string {
  const { year, monthNumber } = monthParts(month);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function dateLabel(date: string, includeYear = false): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: includeYear ? "numeric" : undefined,
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

function compactAdjacentDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

function formatShiftText(
  displayName: string,
  shift: RosterPdfStaff["shifts"][number],
  timeZone: string,
): string {
  const startDate = formatCalendarDate(shift.shiftStartAt, timeZone);
  const endDate = formatCalendarDate(
    new Date(shift.shiftEndAt.getTime() - 1),
    timeZone,
  );
  const startTime = formatRosterPdfTime(shift.shiftStartAt, timeZone);
  const endTime = formatRosterPdfTime(shift.shiftEndAt, timeZone);
  if (startDate === endDate) {
    return `${displayName}  ${startTime}–${endTime}`;
  }
  const endDay = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${endDate}T00:00:00.000Z`));
  return `${displayName}  ${startTime}–${endDay} ${endTime}`;
}

export function buildMonthlyRosterCalendar(
  data: MonthlyRosterPdfData,
): MonthlyRosterCalendar {
  const firstWeekday = new Date(
    `${data.monthStart}T00:00:00.000Z`,
  ).getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  const gridStart = addCalendarDays(data.monthStart, -mondayOffset);
  const monthDayCount =
    Math.round(
      (Date.parse(`${addCalendarDays(data.monthEnd, 1)}T00:00:00.000Z`) -
        Date.parse(`${data.monthStart}T00:00:00.000Z`)) /
        86_400_000,
    );
  const weekCount = Math.ceil((mondayOffset + monthDayCount) / 7);
  const entriesByDate = new Map<string, MonthlyRosterCalendarEntry[]>();

  for (const staff of data.staff) {
    for (const shift of staff.shifts) {
      const date = formatCalendarDate(
        shift.shiftStartAt,
        data.clinicTimeZone,
      );
      if (date < data.monthStart || date > data.monthEnd) continue;
      const entries = entriesByDate.get(date) ?? [];
      entries.push({
        id: `shift:${shift.id}`,
        date,
        kind: "shift",
        sortAt: shift.shiftStartAt.getTime(),
        text: formatShiftText(
          staff.displayName,
          shift,
          data.clinicTimeZone,
        ),
      });
      entriesByDate.set(date, entries);
    }

    for (const leave of staff.approvedLeave) {
      const firstDate =
        leave.startDate < data.monthStart ? data.monthStart : leave.startDate;
      const lastDate =
        leave.endDate > data.monthEnd ? data.monthEnd : leave.endDate;
      if (firstDate > lastDate) continue;
      for (
        let date = firstDate;
        date <= lastDate;
        date = addCalendarDays(date, 1)
      ) {
        const entries = entriesByDate.get(date) ?? [];
        entries.push({
          id: `leave:${staff.staffUserId}:${date}`,
          date,
          kind: "leave",
          sortAt: Number.MAX_SAFE_INTEGER,
          text: `${staff.displayName} — Leave`,
        });
        entriesByDate.set(date, entries);
      }
    }
  }

  for (const entries of entriesByDate.values()) {
    entries.sort(
      (a, b) =>
        a.sortAt - b.sortAt ||
        a.text.localeCompare(b.text) ||
        a.id.localeCompare(b.id),
    );
  }

  const days = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = addCalendarDays(gridStart, index);
    const inSelectedMonth =
      date >= data.monthStart && date <= data.monthEnd;
    return {
      date,
      inSelectedMonth,
      entries: inSelectedMonth ? (entriesByDate.get(date) ?? []) : [],
    };
  });

  return {
    monthLabel: monthLabel(data.month),
    weekCount,
    days,
    entryCount: days.reduce((sum, day) => sum + day.entries.length, 0),
  };
}

export function monthlyRosterPdfFilename(
  clinicName: string,
  month: string,
  paperSize: MonthlyRosterPaperSize,
): string {
  return `RENQOR_${safeRosterFilenamePart(clinicName)}_Roster_${month}_${paperSize}.pdf`;
}

function entryHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  fontSize: number,
): number {
  doc.font("Helvetica").fontSize(fontSize);
  return doc.heightOfString(text, { width });
}

export async function generateMonthlyRosterPdf(
  data: MonthlyRosterPdfData,
  options: MonthlyRosterPdfOptions = {},
): Promise<MonthlyRosterPdfResult> {
  const layout = PAPER_LAYOUTS[data.paperSize];
  const pageOptions = {
    size: layout.size,
    layout: "landscape" as const,
    margins: layout.margins,
  };
  const doc = new PDFDocument({
    ...pageOptions,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `${data.clinicName} Monthly Staff Roster ${data.month}`,
      Author: "RENQOR",
      Subject: `${monthLabel(data.month)} — ${data.paperSize} landscape`,
    },
  });
  const result = collectPdfBuffer(doc);
  const calendar = buildMonthlyRosterCalendar(data);
  const subtitle = `${calendar.monthLabel}  |  ${data.paperSize} landscape`;

  function drawHeading(
    title = "MONTHLY STAFF ROSTER",
    headingSubtitle = subtitle,
  ): number {
    return drawRosterPageHeading(doc, {
      clinicName: data.clinicName,
      logo: data.logo,
      title,
      subtitle: headingSubtitle,
      margins: layout.margins,
      clinicNameFontSize: layout.clinicFontSize,
      titleFontSize: layout.titleFontSize,
      subtitleFontSize: layout.subtitleFontSize,
      logoFit: data.paperSize === "A3" ? [108, 44] : [82, 34],
      minimumHeight: data.paperSize === "A3" ? 62 : 53,
    });
  }

  const headingBottom = drawHeading();
  const gridX = layout.margins.left;
  const gridY = headingBottom + 5;
  const gridWidth =
    doc.page.width - layout.margins.left - layout.margins.right;
  const cellWidth = gridWidth / 7;
  const contentBottom =
    doc.page.height - layout.margins.bottom - GRID_BOTTOM_CLEARANCE;
  const calendarHeight =
    contentBottom - gridY - layout.weekdayHeaderHeight;
  const cellHeight = calendarHeight / calendar.weekCount;

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const x = gridX + dayIndex * cellWidth;
    doc
      .rect(x, gridY, cellWidth, layout.weekdayHeaderHeight)
      .fillAndStroke("#253b63", "#253b63");
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(data.paperSize === "A3" ? 9 : 7)
      .text(
        WEEKDAY_LABELS[dayIndex] ?? "",
        x + CELL_PADDING,
        gridY + (data.paperSize === "A3" ? 7 : 5),
        {
          width: cellWidth - CELL_PADDING * 2,
          align: "center",
          lineBreak: false,
        },
      );
  }

  const continuations: {
    day: MonthlyRosterCalendarDay;
    entries: MonthlyRosterCalendarEntry[];
  }[] = [];
  const entryTextWidth = cellWidth - CELL_PADDING * 2;
  const dayHeaderHeight = data.paperSize === "A3" ? 19 : 15;

  calendar.days.forEach((day, index) => {
    const row = Math.floor(index / 7);
    const column = index % 7;
    const x = gridX + column * cellWidth;
    const y =
      gridY + layout.weekdayHeaderHeight + row * cellHeight;
    doc
      .rect(x, y, cellWidth, cellHeight)
      .fillAndStroke(
        day.inSelectedMonth ? "#ffffff" : "#f1f3f6",
        "#aeb8c7",
      );
    doc
      .fillColor(day.inSelectedMonth ? "#17233c" : "#8a94a5")
      .font("Helvetica-Bold")
      .fontSize(layout.dayNumberFontSize)
      .text(
        day.inSelectedMonth
          ? String(Number(day.date.slice(-2)))
          : compactAdjacentDate(day.date),
        x + CELL_PADDING,
        y + 3,
        {
          width: entryTextWidth,
          lineBreak: false,
        },
      );
    if (!day.inSelectedMonth || day.entries.length === 0) return;

    const textTop = y + dayHeaderHeight;
    const textBottom = y + cellHeight - CELL_PADDING;
    const overflowText = (count: number) =>
      `+ ${String(count)} more — see continuation`;
    const overflowHeight = entryHeight(
      doc,
      overflowText(day.entries.length),
      entryTextWidth,
      layout.entryFontSize,
    ) + TEXT_FIT_SAFETY;
    const heights = day.entries.map((entry) =>
      entryHeight(
        doc,
        entry.text,
        entryTextWidth,
        layout.entryFontSize,
      ) + TEXT_FIT_SAFETY);
    const totalHeight = heights.reduce(
      (sum, height) => sum + height,
      Math.max(0, heights.length - 1) * layout.entryLineGap,
    );
    let visibleCount = day.entries.length;
    if (textTop + totalHeight > textBottom) {
      visibleCount = 0;
      let usedHeight = 0;
      for (const height of heights) {
        const spacing = visibleCount === 0 ? 0 : layout.entryLineGap;
        if (
          textTop +
            usedHeight +
            spacing +
            height +
            layout.entryLineGap +
            overflowHeight >
          textBottom
        ) {
          break;
        }
        usedHeight += spacing + height;
        visibleCount += 1;
      }
    }

    doc
      .save()
      .rect(
        x + CELL_CLIP_INSET,
        textTop,
        cellWidth - CELL_CLIP_INSET * 2,
        Math.max(0, textBottom - textTop),
      )
      .clip();
    let entryY = textTop;
    day.entries.slice(0, visibleCount).forEach((entry, entryIndex) => {
      doc
        .fillColor(entry.kind === "leave" ? "#6a4774" : "#17233c")
        .font(entry.kind === "leave" ? "Helvetica-Oblique" : "Helvetica")
        .fontSize(layout.entryFontSize)
        .text(entry.text, x + CELL_PADDING, entryY, {
          width: entryTextWidth,
        });
      entryY += heights[entryIndex] ?? 0;
      if (
        entryIndex < visibleCount - 1 ||
        visibleCount < day.entries.length
      ) {
        entryY += layout.entryLineGap;
      }
    });

    if (visibleCount < day.entries.length) {
      const remaining = day.entries.slice(visibleCount);
      doc
        .fillColor("#9a4d00")
        .font("Helvetica-Bold")
        .fontSize(layout.entryFontSize)
        .text(
          overflowText(remaining.length),
          x + CELL_PADDING,
          entryY,
          { width: entryTextWidth },
        );
      continuations.push({ day, entries: remaining });
    }
    doc.restore();
  });

  function startContinuationPage(): number {
    doc.addPage(pageOptions);
    return drawHeading(
      "MONTHLY STAFF ROSTER — CONTINUATION",
      `${calendar.monthLabel}  |  ${data.paperSize} landscape`,
    ) + 7;
  }

  let continuationY = 0;
  const continuationBottom =
    doc.page.height - layout.margins.bottom - GRID_BOTTOM_CLEARANCE;
  const continuationWidth =
    doc.page.width - layout.margins.left - layout.margins.right;
  let continuationEntryCount = 0;

  for (const continuation of continuations) {
    if (continuationY === 0) continuationY = startContinuationPage();
    const dateHeadingHeight =
      data.paperSize === "A3" ? 27 : 22;
    if (continuationY + dateHeadingHeight + 24 > continuationBottom) {
      continuationY = startContinuationPage();
    }
    doc
      .rect(
        layout.margins.left,
        continuationY,
        continuationWidth,
        dateHeadingHeight,
      )
      .fill("#e8edf5");
    doc
      .fillColor("#17233c")
      .font("Helvetica-Bold")
      .fontSize(data.paperSize === "A3" ? 11 : 9)
      .text(
        dateLabel(continuation.day.date, true),
        layout.margins.left + 7,
        continuationY + (data.paperSize === "A3" ? 8 : 6),
        { lineBreak: false },
      );
    continuationY += dateHeadingHeight + 3;

    for (const entry of continuation.entries) {
      const rowHeight = Math.max(
        data.paperSize === "A3" ? 20 : 17,
        entryHeight(
          doc,
          entry.text,
          continuationWidth - 14,
          layout.continuationFontSize,
        ) + 8,
      );
      if (continuationY + rowHeight > continuationBottom) {
        continuationY = startContinuationPage();
        doc
          .fillColor("#17233c")
          .font("Helvetica-Bold")
          .fontSize(data.paperSize === "A3" ? 10 : 8.5)
          .text(
            `${dateLabel(continuation.day.date, true)} (continued)`,
            layout.margins.left,
            continuationY,
            { lineBreak: false },
          );
        continuationY += data.paperSize === "A3" ? 22 : 18;
      }
      doc
        .rect(
          layout.margins.left,
          continuationY,
          continuationWidth,
          rowHeight,
        )
        .fillAndStroke(
          entry.kind === "leave" ? "#f8f1fa" : "#ffffff",
          "#c5ccd7",
        );
      doc
        .fillColor(entry.kind === "leave" ? "#6a4774" : "#17233c")
        .font(entry.kind === "leave" ? "Helvetica-Oblique" : "Helvetica")
        .fontSize(layout.continuationFontSize)
        .text(
          entry.text,
          layout.margins.left + 7,
          continuationY + 4,
          { width: continuationWidth - 14 },
        );
      continuationY += rowHeight;
      continuationEntryCount += 1;
    }
    continuationY += data.paperSize === "A3" ? 10 : 7;
  }

  const pageCount = addRosterPdfFooters(doc, {
    margins: layout.margins,
    generatedAt: data.generatedAt,
    timeZone: data.clinicTimeZone,
  });
  doc.end();
  return {
    buffer: await result,
    pageCount,
    entryCount: calendar.entryCount,
    continuationEntryCount,
  };
}
