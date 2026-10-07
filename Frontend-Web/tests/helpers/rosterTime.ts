import {
  calendarDateTimeToInstant,
  formatCalendarDate,
} from "../../src/utils/calendarDate.js";

const ROSTER_TIME_ZONE = "Australia/Melbourne";

export function currentRosterCalendarDate(now = new Date()): string {
  return formatCalendarDate(now, ROSTER_TIME_ZONE);
}

export function rosterFixtureInstant(date: string, time: string): string {
  return calendarDateTimeToInstant(date, time, ROSTER_TIME_ZONE).toISOString();
}

export function formatRosterTime(instant: string | Date): string {
  const value = typeof instant === "string" ? new Date(instant) : instant;
  const formatted = new Intl.DateTimeFormat("en-AU", {
    timeZone: ROSTER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
  return formatted.replace(/^24:/, "00:");
}

export function rosterShiftAccessibleName(
  staffName: string,
  shiftStartAt: string,
  shiftEndAt: string,
): string {
  return `Shift: ${staffName}, ${formatRosterTime(shiftStartAt)}–${formatRosterTime(shiftEndAt)}`;
}
