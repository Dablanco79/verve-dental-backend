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

function calendarDateFromUtcInstant(instant: Date): string {
  const year = String(instant.getUTCFullYear()).padStart(4, "0");
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const day = String(instant.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  return calendarDateFromUtcInstant(
    new Date((calendarOrdinal(date) + days) * MS_PER_CALENDAR_DAY),
  );
}

export function addCalendarMonths(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError("months must be an integer");
  const match = ISO_CALENDAR_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid calendar date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  calendarOrdinal(date);
  return calendarDateFromUtcInstant(new Date(Date.UTC(year, month - 1 + months, 1)));
}

export function formatCalendarDate(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid instant");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function formatCalendarTime(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid instant");
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

export function startOfCalendarDate(date: string, timeZone: string): Date {
  const utcMidnight = calendarOrdinal(date) * MS_PER_CALENDAR_DAY;
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

export function calendarDateLabel(
  date: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-AU", { ...options, timeZone }).format(
    startOfCalendarDate(date, timeZone),
  );
}

export function calendarDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  calendarOrdinal(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!timeMatch) throw new RangeError(`Invalid calendar time: ${time}`);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`Invalid calendar time: ${time}`);

  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredAsUtc;
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    const actualAsUtc = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    if (adjustment === 0) {
      const result = new Date(candidate);
      if (
        formatCalendarDate(result, timeZone) === date &&
        formatCalendarTime(result, timeZone) === time
      ) {
        return result;
      }
      break;
    }
    candidate += adjustment;
  }
  throw new RangeError(`${date} ${time} does not exist in ${timeZone}`);
}
