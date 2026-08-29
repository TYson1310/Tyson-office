export type ShiftEntryType = "automatic" | "manual";

export type ShiftVerificationStatus =
  | "open"
  | "pending"
  | "needs_attention"
  | "verified";

export type ShiftPayrollStatus = "unpaid" | "paid";

export type ScheduleStatus =
  | "scheduled"
  | "in_progress"
  | "awaiting_review"
  | "finalized"
  | "missed";

export type AttendanceExceptionType =
  | "missed_clock_in"
  | "missed_clock_out"
  | "late_start"
  | "early_finish"
  | "overtime"
  | "unscheduled_shift";

export type AttendanceExceptionStatus = "open" | "resolved" | "ignored";

export type AttendanceExceptionSeverity = "info" | "warning" | "critical";

export type ShiftEmployeeRecord = {
  id: string;
  name: string;
  role: string;
  status: "clocked_in" | "clocked_out";
  lastActionAt?: string;
  hoursToday: number;
  currentPayrollHours?: number;
  currentPayrollPeriodLabel?: string;
  scheduledTodayCount: number;
  openExceptionCount: number;
  nextScheduledAt?: string;
};

export type ShiftEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  clockInAt: string;
  clockOutAt?: string;
  hours: number;
  type: ShiftEntryType;
  isOpen: boolean;
  notes?: string;
  scheduleId?: string;
  verificationStatus: ShiftVerificationStatus;
  payrollStatus: ShiftPayrollStatus;
  verifiedAt?: string;
  paidAt?: string;
  paidPeriodLabel?: string;
  openExceptionCount: number;
};

export type ShiftSchedule = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  notes?: string;
  status: ScheduleStatus;
  linkedShiftId?: string;
  linkedShiftVerificationStatus?: ShiftVerificationStatus;
  linkedShiftHours?: number;
};

export type AttendanceException = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  type: AttendanceExceptionType;
  status: AttendanceExceptionStatus;
  severity: AttendanceExceptionSeverity;
  title: string;
  // Legacy free-form detail (may be present for older records). New UI should
  // prefer the structured timestamp fields below and format locally.
  detail: string;
  shiftId?: string;
  scheduleId?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  // ISO timestamps for when the exception row was created/updated in the DB
  createdAt: string;
  updatedAt?: string;
  // Structured ISO timestamps (optional) to allow client-side localized
  // formatting without relying on server pre-formatted strings.
  scheduleStartAt?: string;
  scheduleEndAt?: string;
  shiftStartAt?: string;
  shiftEndAt?: string;
};

export type SelfShiftPayload = {
  timeZone: string;
  employee: ShiftEmployeeRecord;
  shifts: ShiftEntry[];
  schedules: ShiftSchedule[];
  exceptions: AttendanceException[];
};

export type ShiftPayload = {
  timeZone: string;
  employees: ShiftEmployeeRecord[];
  shifts: ShiftEntry[];
  schedules: ShiftSchedule[];
  exceptions: AttendanceException[];
};

export const LATE_START_GRACE_MINUTES = 10;
export const EARLY_FINISH_GRACE_MINUTES = 10;
export const MISSED_CLOCK_OUT_GRACE_MINUTES = 15;
export const OVERTIME_GRACE_HOURS = 0.25;

export const ATTENDANCE_EXCEPTION_META: Record<
  AttendanceExceptionType,
  { title: string; severity: AttendanceExceptionSeverity }
> = {
  missed_clock_in: {
    title: "Missed clock-in",
    severity: "critical",
  },
  missed_clock_out: {
    title: "Missed clock-out",
    severity: "critical",
  },
  late_start: {
    title: "Late start",
    severity: "warning",
  },
  early_finish: {
    title: "Early finish",
    severity: "warning",
  },
  overtime: {
    title: "Overtime",
    severity: "warning",
  },
  unscheduled_shift: {
    title: "Unscheduled shift",
    severity: "warning",
  },
};

export function normalizeDateKey(value?: string | null) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function getTimeZoneDateParts(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values = {
    year: "0000",
    month: "00",
    day: "00",
    hour: "00",
    minute: "00",
    second: "00",
  };

  parts.forEach((part) => {
    if (part.type in values) {
      values[part.type as keyof typeof values] = part.value;
    }
  });

  return values;
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string) {
  const parts = getTimeZoneDateParts(date, timeZone);

  if (!parts) {
    return 0;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

export function getDateKeyInTimeZone(
  value: Date | string = new Date(),
  timeZone: string,
) {
  const parts = getTimeZoneDateParts(value, timeZone);

  if (!parts) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function crossesMidnight(startTime: string, endTime: string) {
  return endTime <= startTime;
}

export function getEndDateKeyForShift(
  startDateKey: string,
  startTime: string,
  endTime: string,
) {
  return crossesMidnight(startTime, endTime)
    ? addDaysToDateKey(startDateKey, 1)
    : startDateKey;
}

export function calculateLocalTimeRangeHours(
  startTime: string,
  endTime: string,
) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  if (
    [startHour, startMinute, endHour, endMinute].some((value) =>
      Number.isNaN(value),
    )
  ) {
    return 0;
  }

  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const durationMinutes =
    endMinutes > startMinutes
      ? endMinutes - startMinutes
      : 24 * 60 - startMinutes + endMinutes;

  return Math.round((durationMinutes / 60) * 100) / 100;
}

export function convertStoreLocalDateTimeToIso(
  dateKey: string,
  timeValue: string,
  timeZone: string,
) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !year ||
    !month ||
    !day ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let resolved = utcGuess;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMilliseconds(
      new Date(resolved),
      timeZone,
    );
    const corrected = utcGuess - offset;

    if (corrected === resolved) {
      break;
    }

    resolved = corrected;
  }

  return new Date(resolved).toISOString();
}

export function toTimeInputValueInTimeZone(
  isoValue: string | undefined,
  timeZone: string,
) {
  if (!isoValue) {
    return "";
  }

  const parts = getTimeZoneDateParts(isoValue, timeZone);

  if (!parts) {
    return "";
  }

  return `${parts.hour}:${parts.minute}`;
}

export function toIsoTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function calculateDurationHours(startIso: string, endIso: string) {
  const milliseconds =
    new Date(endIso).getTime() - new Date(startIso).getTime();

  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return 0;
  }

  return Math.round((milliseconds / (1000 * 60 * 60)) * 100) / 100;
}

export function resolveShiftHours(input: {
  clockInAt: string;
  clockOutAt?: string | null;
  hoursWorked?: number | string | null;
  referenceNowIso: string;
}) {
  if (input.clockOutAt) {
    return Number(input.hoursWorked ?? 0);
  }

  return calculateDurationHours(input.clockInAt, input.referenceNowIso);
}

export function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

export function addMinutes(isoTimestamp: string, minutes: number) {
  return new Date(
    new Date(isoTimestamp).getTime() + minutes * 60 * 1000,
  ).toISOString();
}

type ShiftSchemaError = {
  code?: string | null;
  message?: string | null;
};

function isMissingShiftSchemaError(
  error: ShiftSchemaError | null | undefined,
  tokens: string[],
) {
  const message = error?.message?.toLowerCase() ?? "";

  if (!message) {
    return false;
  }

  const missingSchema =
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find");

  if (!missingSchema) {
    return false;
  }

  return tokens.some((token) => message.includes(token));
}

export function isMissingShiftEntriesError(
  error: ShiftSchemaError | null | undefined,
) {
  return isMissingShiftSchemaError(error, ["shift_time_entries"]);
}

export function isMissingShiftSchedulesError(
  error: ShiftSchemaError | null | undefined,
) {
  return isMissingShiftSchemaError(error, ["shift_schedules"]);
}

export function isMissingAttendanceExceptionsError(
  error: ShiftSchemaError | null | undefined,
) {
  return isMissingShiftSchemaError(error, ["attendance_exceptions"]);
}

export function isMissingShiftDataError(
  error: ShiftSchemaError | null | undefined,
) {
  return (
    isMissingShiftEntriesError(error) ||
    isMissingShiftSchedulesError(error) ||
    isMissingAttendanceExceptionsError(error)
  );
}

export function getShiftVerificationStatus(input: {
  clockOutAt?: string | null;
  verifiedAt?: string | null;
  openExceptionCount?: number;
}) {
  if (!input.clockOutAt) {
    return "open" as const;
  }

  if (input.verifiedAt) {
    return "verified" as const;
  }

  if ((input.openExceptionCount ?? 0) > 0) {
    return "needs_attention" as const;
  }

  return "pending" as const;
}

export function getScheduleStatus(input: {
  startAt: string;
  endAt: string;
  linkedShiftId?: string | null;
  linkedShiftClockOutAt?: string | null;
  linkedShiftVerifiedAt?: string | null;
  linkedShiftOpenExceptionCount?: number;
  referenceNowIso: string;
}) {
  if (!input.linkedShiftId) {
    return new Date(input.referenceNowIso).getTime() >
      new Date(input.endAt).getTime()
      ? ("missed" as const)
      : ("scheduled" as const);
  }

  if (!input.linkedShiftClockOutAt) {
    return "in_progress" as const;
  }

  if (input.linkedShiftVerifiedAt) {
    return "finalized" as const;
  }

  if ((input.linkedShiftOpenExceptionCount ?? 0) > 0) {
    return "awaiting_review" as const;
  }

  return "awaiting_review" as const;
}

export function getAttendanceExceptionLabel(type: AttendanceExceptionType) {
  return ATTENDANCE_EXCEPTION_META[type].title;
}

export function getAttendanceExceptionSeverity(type: AttendanceExceptionType) {
  return ATTENDANCE_EXCEPTION_META[type].severity;
}
