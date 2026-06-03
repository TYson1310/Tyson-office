const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const THURSDAY_UTC_DAY = 4;

function parseIsoDateAsUtcNoon(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function isValidLotteryEftDateKey(value: string | null | undefined) {
  if (!value || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = parseIsoDateAsUtcNoon(value);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function addDaysToLotteryEftDateKey(dateKey: string, days: number) {
  const date = parseIsoDateAsUtcNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function getUtcDayOfWeek(dateKey: string) {
  return parseIsoDateAsUtcNoon(dateKey).getUTCDay();
}

export function isLotteryEftSweepDate(dateKey: string) {
  return (
    isValidLotteryEftDateKey(dateKey) &&
    getUtcDayOfWeek(dateKey) === THURSDAY_UTC_DAY
  );
}

export function getLatestLotteryEftSweepDate(dateKey: string) {
  const dayOfWeek = getUtcDayOfWeek(dateKey);
  const daysSinceThursday = (dayOfWeek - THURSDAY_UTC_DAY + 7) % 7;

  return addDaysToLotteryEftDateKey(dateKey, -daysSinceThursday);
}

export function getLotteryEftSweepPeriod(sweepDate: string) {
  return {
    sweepDate,
    weekEndDate: addDaysToLotteryEftDateKey(sweepDate, -1),
    weekStartDate: addDaysToLotteryEftDateKey(sweepDate, -7),
  };
}

export function getLotteryEftSweepDateForReportDate(reportDate: string) {
  if (!isValidLotteryEftDateKey(reportDate)) {
    return null;
  }

  const dayOfWeek = getUtcDayOfWeek(reportDate);
  const daysUntilThursday =
    (THURSDAY_UTC_DAY - dayOfWeek + 7) % 7 || 7;

  return addDaysToLotteryEftDateKey(reportDate, daysUntilThursday);
}

export function getLotteryEftSweepPeriods({
  latestSweepDate,
  weeks,
}: {
  latestSweepDate: string;
  weeks: number;
}) {
  return Array.from({ length: Math.max(weeks, 0) }, (_, index) =>
    getLotteryEftSweepPeriod(
      addDaysToLotteryEftDateKey(latestSweepDate, -(index * 7)),
    ),
  );
}
