import { getDateKeyInTimeZone } from "./shifts/shared.ts";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export function isDateOnlyString(value: string) {
  return DATE_ONLY_PATTERN.test(value.trim());
}

export function parseStoredDate(value: string | Date) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const normalized = value.trim();

  if (isDateOnlyString(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number);

    // Use midday UTC so local date math in the app does not drift backward in US timezones.
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  return new Date(normalized);
}

export function dateKeyToUtcNoonDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function formatDateOnly(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  },
  fallback = "",
) {
  if (!value) {
    return fallback;
  }

  const isDateOnly =
    typeof value === "string" && isDateOnlyString(value.trim());
  const date = isDateOnly
    ? dateKeyToUtcNoonDate(value.trim())
    : parseStoredDate(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-US", {
    ...options,
    ...(isDateOnly && !options.timeZone ? { timeZone: "UTC" } : {}),
  }).format(date);
}

export function toIsoDateKey(value?: string | Date | null) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    if (isDateOnlyString(normalized)) {
      return normalized;
    }

    const parsed = new Date(normalized);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

export function getTodayIsoDateInTimeZone(
  timeZone: string,
  referenceDate: Date = new Date(),
) {
  return (
    getDateKeyInTimeZone(referenceDate, timeZone) ??
    referenceDate.toISOString().slice(0, 10)
  );
}

export function getIsoDateKeyInTimeZone(
  value: string | Date,
  timeZone: string,
) {
  return getDateKeyInTimeZone(value, timeZone);
}

export function getCurrentMonthStartIsoDateInTimeZone(
  timeZone: string,
  referenceDate: Date = new Date(),
) {
  return `${getTodayIsoDateInTimeZone(timeZone, referenceDate).slice(0, 7)}-01`;
}

export function getCurrentYearStartIsoDateInTimeZone(
  timeZone: string,
  referenceDate: Date = new Date(),
) {
  return `${getTodayIsoDateInTimeZone(timeZone, referenceDate).slice(0, 4)}-01-01`;
}

export function addDaysToIsoDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  const value = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function enumerateIsoDateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDaysToIsoDateKey(cursor, 1);
  }

  return dates;
}

export function getIsoDateRangeEndingTodayInTimeZone(
  days: number,
  timeZone: string,
) {
  const endDate = getTodayIsoDateInTimeZone(timeZone);
  const startDate = addDaysToIsoDateKey(endDate, -(Math.max(days, 1) - 1));

  return { endDate, startDate };
}

export function isValidTimeZone(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(
      new Date(),
    );
    return true;
  } catch {
    return false;
  }
}

export function formatDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions & {
    locale?: string;
  } = {},
) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const { locale = "en-US", ...formatterOptions } = options;

  return new Intl.DateTimeFormat(locale, formatterOptions).format(date);
}
