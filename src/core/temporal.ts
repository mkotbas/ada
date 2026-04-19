import { Temporal } from '@js-temporal/polyfill';

export const BUSINESS_TIMEZONE = 'Europe/Istanbul';

export type BusinessDateParts = {
  year: number;
  month: number; // 0-based for existing app compatibility
  day: number;
};

export function getBusinessNow(): Temporal.ZonedDateTime {
  return Temporal.Now.zonedDateTimeISO(BUSINESS_TIMEZONE);
}

export function getBusinessDateParts(): BusinessDateParts {
  const now = getBusinessNow();
  return {
    year: now.year,
    month: now.month - 1,
    day: now.day,
  };
}

export function getBusinessDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${month}-${day}`;
}

export function getBusinessYearMonthKeyFromParts(year: number, month: number): string {
  return `${year}-${month}`;
}

export function getBusinessYearMonthKey(): string {
  const now = getBusinessNow();
  return `${now.year}-${now.month - 1}`;
}

export function getBusinessWorkDaysOfMonth(year: number, month: number): number[] {
  const monthIndex = month + 1;
  const start = Temporal.PlainDate.from({ year, month: monthIndex, day: 1 });
  const daysInMonth = start.daysInMonth;
  const result: number[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = Temporal.PlainDate.from({ year, month: monthIndex, day });
    if (date.dayOfWeek <= 5) {
      result.push(day);
    }
  }

  return result;
}

export function toBusinessZonedDateTime(input?: string | Date): Temporal.ZonedDateTime {
  if (!input) return getBusinessNow();
  if (input instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(input.getTime()).toZonedDateTimeISO(BUSINESS_TIMEZONE);
  }
  return Temporal.Instant.from(input).toZonedDateTimeISO(BUSINESS_TIMEZONE);
}

export function getBusinessUtcIsoNow(): string {
  return getBusinessNow().toInstant().toString();
}

export function getBusinessMonthUtcRange(year: number, month: number): { startUtcIso: string; endUtcIso: string } {
  const start = Temporal.ZonedDateTime.from({
    timeZone: BUSINESS_TIMEZONE,
    year,
    month: month + 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const end = start.add({ months: 1 });
  return {
    startUtcIso: start.toInstant().toString(),
    endUtcIso: end.toInstant().toString(),
  };
}

export function getBusinessYearUtcRange(year: number): { startUtcIso: string; endUtcIso: string } {
  const start = Temporal.ZonedDateTime.from({
    timeZone: BUSINESS_TIMEZONE,
    year,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const end = start.add({ years: 1 });
  return {
    startUtcIso: start.toInstant().toString(),
    endUtcIso: end.toInstant().toString(),
  };
}
