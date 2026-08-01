/**
 * Single source of truth for "what day/week/month is it" in the business's
 * own IANA timezone, as opposed to the server host's timezone (frequently
 * UTC) or a browser's local timezone. Every dashboard/KPI/calendar boundary
 * in the app (overdue, due today, completed today, month-over-month, etc.)
 * must go through these functions — prior to this module, at least five
 * independent implementations existed across controllers, some using
 * server-local midnight, some the business timezone, and one using the
 * browser's own clock, so the same instant could be "today" in one place
 * and "yesterday" in another.
 *
 * These are plain functions (not a NestJS-injectable service) so they can
 * be called from anywhere — a service, a schema method, a script — without
 * requiring dependency injection wiring.
 */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getBusinessTimezone(): string {
  return process.env.BUSINESS_TIMEZONE || 'Africa/Tunis';
}

/** Throws if `timeZone` is not a timezone name the runtime's ICU data recognizes. */
export function assertValidTimezone(timeZone: string): void {
  new Intl.DateTimeFormat('en-US', { timeZone });
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === '24' ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const seenBackInZone = zonedParts(new Date(utcGuess), timeZone);
  const seenAsUtc = Date.UTC(
    seenBackInZone.year,
    seenBackInZone.month - 1,
    seenBackInZone.day,
    seenBackInZone.hour,
    seenBackInZone.minute,
    seenBackInZone.second,
  );
  return new Date(utcGuess - (seenAsUtc - utcGuess));
}

export function startOfBusinessDay(
  value: Date,
  timeZone: string = getBusinessTimezone(),
): Date {
  const { year, month, day } = zonedParts(value, timeZone);
  return zonedWallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

export function parseBusinessDateInput(
  value: Date | string,
  timeZone: string = getBusinessTimezone(),
): Date {
  if (value instanceof Date) {
    return new Date(value);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return zonedWallTimeToUtc(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      0,
      0,
      0,
      timeZone,
    );
  }

  return new Date(value);
}

export function endOfBusinessDay(
  value: Date,
  timeZone: string = getBusinessTimezone(),
): Date {
  return new Date(
    addBusinessDays(
      startOfBusinessDay(value, timeZone),
      1,
      timeZone,
    ).getTime() - 1,
  );
}

export function addBusinessDays(
  value: Date,
  days: number,
  timeZone: string = getBusinessTimezone(),
): Date {
  const { year, month, day } = zonedParts(value, timeZone);
  // Do the day-count arithmetic at noon UTC (well clear of any DST
  // transition) before re-projecting through the target timezone, so the
  // calendar-day shift stays correct across month/year boundaries.
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  const parts = zonedParts(shifted, timeZone);
  return zonedWallTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0,
    timeZone,
  );
}

export function addBusinessMonths(
  value: Date,
  months: number,
  timeZone: string = getBusinessTimezone(),
): Date {
  const { year, month, day, hour, minute, second } = zonedParts(
    value,
    timeZone,
  );
  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return zonedWallTimeToUtc(
    targetYear,
    targetMonth + 1,
    clampedDay,
    hour,
    minute,
    second,
    timeZone,
  );
}

export function addBusinessYears(
  value: Date,
  years: number,
  timeZone: string = getBusinessTimezone(),
): Date {
  return addBusinessMonths(value, years * 12, timeZone);
}

export function startOfBusinessWeek(
  value: Date,
  timeZone: string = getBusinessTimezone(),
): Date {
  const dayStart = startOfBusinessDay(value, timeZone);
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(dayStart);
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = weekdayIndex[weekdayName] ?? 0;
  const diff = day === 0 ? -6 : 1 - day;
  return addBusinessDays(dayStart, diff, timeZone);
}

export function startOfBusinessMonth(
  value: Date,
  timeZone: string = getBusinessTimezone(),
): Date {
  const { year, month } = zonedParts(value, timeZone);
  return zonedWallTimeToUtc(year, month, 1, 0, 0, 0, timeZone);
}

export function startOfBusinessYear(
  value: Date,
  timeZone: string = getBusinessTimezone(),
): Date {
  const { year } = zonedParts(value, timeZone);
  return zonedWallTimeToUtc(year, 1, 1, 0, 0, 0, timeZone);
}
