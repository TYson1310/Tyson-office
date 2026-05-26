export type PayrollFrequency = "weekly" | "monthly";

export type PayrollPeriod = {
  frequency: PayrollFrequency;
  label: string;
  periodStart: string;
  periodEnd: string;
  nextAvailableOn: string;
};

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function startOfUtcDay(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getLastDayOfUtcMonth(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatWeeklyLabel(start: Date, end: Date) {
  return `Week of ${shortDateFormatter.format(start)} - ${shortDateFormatter.format(end)}, ${end.getUTCFullYear()}`;
}

export function isPayrollFrequency(value: unknown): value is PayrollFrequency {
  return value === "weekly" || value === "monthly";
}

export function getPayrollFrequencyLabel(frequency: PayrollFrequency) {
  return frequency === "weekly" ? "Weekly" : "Monthly";
}

export function formatPayrollDateLabel(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const normalizedValue = value.includes("T") ? value : `${value}T00:00:00.000Z`;
  const parsedValue = new Date(normalizedValue);

  if (Number.isNaN(parsedValue.getTime())) {
    return "Not set";
  }

  return longDateFormatter.format(parsedValue);
}

export function getLatestAvailablePayrollPeriod(
  frequency: PayrollFrequency,
  referenceDate = new Date(),
): PayrollPeriod {
  const today = startOfUtcDay(referenceDate);

  if (frequency === "weekly") {
    const dayOfWeek = today.getUTCDay();
    const periodEnd = addUtcDays(today, dayOfWeek === 0 ? 0 : -dayOfWeek);
    const periodStart = addUtcDays(periodEnd, -6);

    return {
      frequency,
      label: formatWeeklyLabel(periodStart, periodEnd),
      periodStart: formatIsoDate(periodStart),
      periodEnd: formatIsoDate(periodEnd),
      nextAvailableOn: formatIsoDate(addUtcDays(periodEnd, 7)),
    };
  }

  const lastDayOfMonth = getLastDayOfUtcMonth(today);
  const periodEnd =
    today.getTime() === lastDayOfMonth.getTime()
      ? today
      : createUtcDate(today.getUTCFullYear(), today.getUTCMonth(), 0);
  const periodStart = createUtcDate(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    1,
  );

  return {
    frequency,
    label: monthYearFormatter.format(periodStart),
    periodStart: formatIsoDate(periodStart),
    periodEnd: formatIsoDate(periodEnd),
    nextAvailableOn: formatIsoDate(
      createUtcDate(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 1),
    ),
  };
}
