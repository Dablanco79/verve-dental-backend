const ROSTER_TIME_ZONE = "Australia/Melbourne";

export function formatRosterTime(instant: string | Date): string {
  const value = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: ROSTER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export function rosterShiftAccessibleName(
  staffName: string,
  shiftStartAt: string,
  shiftEndAt: string,
): string {
  return `Shift: ${staffName}, ${formatRosterTime(shiftStartAt)}–${formatRosterTime(shiftEndAt)}`;
}
