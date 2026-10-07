const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_CALENDAR_DAY = 86_400_000;

function calendarOrdinal(date: string): number {
  const match = ISO_CALENDAR_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid calendar date: ${date}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));

  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }

  return Math.floor(instant.getTime() / MS_PER_CALENDAR_DAY);
}

function calendarDateFromOrdinal(ordinal: number): string {
  return new Date(ordinal * MS_PER_CALENDAR_DAY).toISOString().slice(0, 10);
}

/** Returns a strictly validated ISO calendar date's inclusive span length. */
export function inclusiveCalendarDayCount(startDate: string, endDate: string): number {
  const start = calendarOrdinal(startDate);
  const end = calendarOrdinal(endDate);
  if (end < start) throw new RangeError("endDate must be on or after startDate");
  return end - start + 1;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  return calendarDateFromOrdinal(calendarOrdinal(date) + days);
}

/** Formats an instant as YYYY-MM-DD in any IANA timezone. */
export function formatCalendarDate(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid instant");

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Returns every local calendar date touched by [startInclusive, endExclusive).
 * Subtracting 1ms from the exclusive end avoids treating a shift ending at
 * local midnight as occupying the following date. No local day-length
 * assumption is made.
 */
export function coveredCalendarDateRange(
  startInclusive: Date,
  endExclusive: Date,
  timeZone: string,
): { firstDate: string; lastDate: string } {
  if (endExclusive <= startInclusive) {
    throw new RangeError("endExclusive must be after startInclusive");
  }

  return {
    firstDate: formatCalendarDate(startInclusive, timeZone),
    lastDate: formatCalendarDate(new Date(endExclusive.getTime() - 1), timeZone),
  };
}

/**
 * Finds the first instant belonging to a local calendar date. Binary search is
 * used instead of applying a fixed UTC offset, so DST and historical timezone
 * changes are respected without assuming a 24-hour local day.
 */
export function startOfCalendarDate(date: string, timeZone: string): Date {
  const ordinal = calendarOrdinal(date);
  const utcMidnight = ordinal * MS_PER_CALENDAR_DAY;
  let low = utcMidnight - 36 * 60 * 60 * 1000;
  let high = utcMidnight + 36 * 60 * 60 * 1000;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (formatCalendarDate(new Date(mid), timeZone) < date) low = mid + 1;
    else high = mid;
  }

  const result = new Date(low);
  if (formatCalendarDate(result, timeZone) !== date) {
    throw new RangeError(`Calendar date ${date} does not exist in ${timeZone}`);
  }
  return result;
}

export function calendarDayWindow(
  instant: Date,
  timeZone: string,
): { dayStart: Date; dayEndExclusive: Date } {
  const date = formatCalendarDate(instant, timeZone);
  return {
    dayStart: startOfCalendarDate(date, timeZone),
    dayEndExclusive: startOfCalendarDate(addCalendarDays(date, 1), timeZone),
  };
}
