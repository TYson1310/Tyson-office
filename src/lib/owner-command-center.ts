const OWNER_REPORTING_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

type OwnerReportingMonthSearchParam = string | string[] | undefined;
type OwnerReportingDate = Date | string;

export type OwnerReportingPeriod = {
  endDateKey: string;
  monthKey: string;
  startDateKey: string;
};

function toDateKey(value: OwnerReportingDate) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  const normalized = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

export function resolveOwnerReportingMonth(
  value: OwnerReportingMonthSearchParam,
  currentDateKey: string,
) {
  const currentMonthKey = currentDateKey.slice(0, 7);
  const requestedMonth =
    (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

  return OWNER_REPORTING_MONTH_PATTERN.test(requestedMonth) &&
    requestedMonth <= currentMonthKey
    ? requestedMonth
    : currentMonthKey;
}

export function getOwnerReportingPeriod(
  monthKey: string,
): OwnerReportingPeriod {
  const match = OWNER_REPORTING_MONTH_PATTERN.exec(monthKey);

  if (!match) {
    throw new Error("Owner reporting month must use YYYY-MM format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();

  return {
    endDateKey: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
    monthKey,
    startDateKey: `${monthKey}-01`,
  };
}

export function filterRowsToOwnerReportingPeriod<T>(
  rows: T[],
  getDate: (row: T) => OwnerReportingDate,
  period: OwnerReportingPeriod,
) {
  return rows.filter((row) => {
    const dateKey = toDateKey(getDate(row));

    return (
      dateKey !== null &&
      dateKey >= period.startDateKey &&
      dateKey <= period.endDateKey
    );
  });
}

export function filterRowsThroughOwnerReportingPeriod<T>(
  rows: T[],
  getDate: (row: T) => OwnerReportingDate,
  period: OwnerReportingPeriod,
) {
  return rows.filter((row) => {
    const dateKey = toDateKey(getDate(row));
    return dateKey !== null && dateKey <= period.endDateKey;
  });
}

export function getMissingOwnerReconciliationDateKeys(
  reconciledDates: OwnerReportingDate[],
  period: OwnerReportingPeriod,
  currentDateKey: string,
) {
  const coverageEndDateKey =
    currentDateKey < period.endDateKey ? currentDateKey : period.endDateKey;

  if (coverageEndDateKey < period.startDateKey) {
    return [];
  }

  const reconciledDateKeys = new Set(
    reconciledDates
      .map(toDateKey)
      .filter(
        (dateKey): dateKey is string =>
          dateKey !== null &&
          dateKey >= period.startDateKey &&
          dateKey <= coverageEndDateKey,
      ),
  );
  const missingDateKeys: string[] = [];
  let cursor = period.startDateKey;

  while (cursor <= coverageEndDateKey) {
    if (!reconciledDateKeys.has(cursor)) {
      missingDateKeys.push(cursor);
    }

    const nextDate = new Date(`${cursor}T12:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    cursor = nextDate.toISOString().slice(0, 10);
  }

  return missingDateKeys.reverse();
}

export function getMissingOwnerLotteryReconciliationDays(
  activityDates: OwnerReportingDate[],
  reconciledDates: OwnerReportingDate[],
  period: OwnerReportingPeriod,
  currentDateKey: string,
) {
  const activityDateKeys = new Set(
    activityDates
      .map(toDateKey)
      .filter((dateKey): dateKey is string => dateKey !== null),
  );

  return getMissingOwnerReconciliationDateKeys(
    reconciledDates,
    period,
    currentDateKey,
  ).map((dateKey) => ({
    dateKey,
    hasActivity: activityDateKeys.has(dateKey),
  }));
}

export function sumRowsInOwnerReportingPeriod<T>(
  rows: T[],
  getDate: (row: T) => OwnerReportingDate,
  getAmount: (row: T) => number,
  period: OwnerReportingPeriod,
) {
  return filterRowsToOwnerReportingPeriod(rows, getDate, period).reduce(
    (sum, row) => sum + getAmount(row),
    0,
  );
}
