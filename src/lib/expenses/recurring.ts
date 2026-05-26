const ISO_MONTH_START_PATTERN = /^\d{4}-\d{2}-01$/;

export const RECURRING_EXPENSE_MIN_DUE_DAY = 1;
export const RECURRING_EXPENSE_MAX_DUE_DAY = 31;

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

export function isRecurringExpenseMonthKey(value: string) {
  return ISO_MONTH_START_PATTERN.test(value.trim());
}

export function getRecurringExpenseMonthKey(dateKey: string) {
  const normalized = dateKey.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  return `${normalized.slice(0, 7)}-01`;
}

export function clampRecurringExpenseDueDay(value: number) {
  return Math.min(
    RECURRING_EXPENSE_MAX_DUE_DAY,
    Math.max(RECURRING_EXPENSE_MIN_DUE_DAY, value),
  );
}

export function resolveRecurringExpenseDate(
  monthKey: string,
  dueDayOfMonth: number,
) {
  if (!isRecurringExpenseMonthKey(monthKey)) {
    return null;
  }

  const [yearLabel, monthLabel] = monthKey.split("-");
  const year = Number(yearLabel);
  const month = Number(monthLabel);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return null;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(
    clampRecurringExpenseDueDay(dueDayOfMonth),
    daysInMonth,
  );

  return `${yearLabel}-${monthLabel}-${padNumber(clampedDay)}`;
}

export function formatRecurringExpenseMonthLabel(monthKey: string) {
  if (!isRecurringExpenseMonthKey(monthKey)) {
    return monthKey;
  }

  const [yearLabel, monthLabel] = monthKey.split("-");
  const parsed = new Date(
    Date.UTC(Number(yearLabel), Number(monthLabel) - 1, 1, 12),
  );

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
