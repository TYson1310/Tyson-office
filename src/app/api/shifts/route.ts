import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { getServerStoreContext } from "@/lib/stores/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  ATTENDANCE_EXCEPTION_META,
  EARLY_FINISH_GRACE_MINUTES,
  LATE_START_GRACE_MINUTES,
  MISSED_CLOCK_OUT_GRACE_MINUTES,
  OVERTIME_GRACE_HOURS,
  addMinutes,
  calculateDurationHours,
  convertStoreLocalDateTimeToIso,
  getDateKeyInTimeZone,
  getShiftVerificationStatus,
  getEndDateKeyForShift,
  getScheduleStatus,
  isMissingShiftDataError,
  normalizeDateKey,
  resolveShiftHours,
  roundHours,
  toTimeInputValueInTimeZone,
  toIsoTimestamp,
  type AttendanceException,
  type AttendanceExceptionSeverity,
  type AttendanceExceptionStatus,
  type AttendanceExceptionType,
  type SelfShiftPayload,
  type ShiftEmployeeRecord,
  type ShiftEntry,
  type ShiftEntryType,
  type ShiftPayrollStatus,
  type ShiftPayload,
  type ShiftSchedule,
  type ShiftVerificationStatus,
} from "@/lib/shifts/shared";
import {
  getLatestAvailablePayrollPeriod,
  isPayrollFrequency,
  type PayrollPeriod,
} from "@/lib/payroll/payroll-periods";
import type { UserRole } from "@/types/erp.types";

type EmployeeStatus = "active" | "inactive" | "on-leave";
type ShiftAssignableRole = Exclude<UserRole, "admin">;
type ShiftSelfServiceRole = Exclude<UserRole, "admin" | "manager">;

type ShiftEmployee = {
  id: string;
  name: string;
  role: ShiftAssignableRole;
  status: EmployeeStatus;
};

type ShiftDataClient = Awaited<ReturnType<typeof createClient>>;

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole | null;
  status: EmployeeStatus | null;
  pay_frequency: string | null;
};

type AccessProfileRow = {
  full_name: string | null;
  email: string | null;
  role: UserRole | null;
  store_key: string | null;
  permissions: string[] | null;
};

type ShiftEntryRow = {
  id: string;
  employee_id: string;
  entry_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  hours_worked: number | string;
  entry_type: ShiftEntryType;
  notes: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  verified_by: string | null;
  schedule_id: string | null;
};

type ShiftScheduleRow = {
  id: string;
  employee_id: string;
  shift_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  unpaid_break_minutes: number | string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AttendanceExceptionRow = {
  id: string;
  employee_id: string;
  shift_entry_id: string | null;
  schedule_id: string | null;
  exception_date: string;
  exception_type: AttendanceExceptionType;
  status: AttendanceExceptionStatus;
  severity: AttendanceExceptionSeverity;
  title: string;
  details: string;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type FinalizedPayrollShiftHoursRow = {
  employee_id: string;
  entry_date: string;
  hours_worked: number | string;
};

type PayStatementCoverageRow = {
  employee_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: "draft" | "scheduled" | "paid" | "archived";
};

type ShiftAccessContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  db: ShiftDataClient;
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  currentUserPermissions: string[] | null;
  activeStoreKey: string;
  storeTimeZone: string;
  canSyncAttendance: boolean;
};

type ActiveExceptionCandidate = {
  type: AttendanceExceptionType;
  severity: AttendanceExceptionSeverity;
  title: string;
  detail: string;
  shiftEntryId?: string | null;
  scheduleId?: string | null;
  sourceUpdatedAt: string;
};

type RequestedScheduleWindow = {
  shiftDate: string;
  startAt: string;
  endAt: string;
};

type RequestedManualEntryWindow = {
  entryDate: string;
  startAt: string;
  endAt: string;
};

const SHIFT_ENTRY_SELECT =
  "id,employee_id,entry_date,clock_in_at,clock_out_at,hours_worked,entry_type,notes,created_at,updated_at,verified_at,verified_by,schedule_id";

const SHIFT_SCHEDULE_SELECT =
  "id,employee_id,shift_date,scheduled_start_at,scheduled_end_at,unpaid_break_minutes,notes,created_at,updated_at";

const ATTENDANCE_EXCEPTION_SELECT =
  "id,employee_id,shift_entry_id,schedule_id,exception_date,exception_type,status,severity,title,details,resolution_notes,resolved_at,created_at,updated_at";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function getConfigurationError() {
  return NextResponse.json(
    { error: "Supabase configuration required" },
    { status: 503 },
  );
}

function isShiftOverlapError(
  error: { code?: string | null } | null | undefined,
) {
  return error?.code === "23P01";
}

function getShiftTrackingUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Shift scheduling and attendance tables are not available yet. Apply the latest Supabase migrations first.",
    },
    { status: 503 },
  );
}

function getShiftOverlapResponse(employeeName: string) {
  return NextResponse.json(
    {
      error: `Shift timing overlaps another protected attendance record for ${employeeName}`,
    },
    { status: 409 },
  );
}

function getTodayKey(date = new Date(), timeZone = "UTC") {
  return (
    getDateKeyInTimeZone(date, timeZone) ?? date.toISOString().slice(0, 10)
  );
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildGroupKey(employeeId: string, dateKey: string) {
  return `${employeeId}:${dateKey}`;
}

function formatTimeLabel(value: string) {
  return timeFormatter.format(new Date(value));
}

function getCurrentPayrollPeriod(
  payFrequency: string | null | undefined,
  referenceDate = new Date(),
) {
  if (!isPayrollFrequency(payFrequency)) {
    return null;
  }

  return getLatestAvailablePayrollPeriod(payFrequency, referenceDate);
}

function buildPayrollHoursMap(rows: FinalizedPayrollShiftHoursRow[]) {
  const map = new Map<string, Map<string, number>>();

  rows.forEach((row) => {
    const employeeHours = map.get(row.employee_id) ?? new Map<string, number>();
    employeeHours.set(
      row.entry_date,
      (employeeHours.get(row.entry_date) ?? 0) + Number(row.hours_worked ?? 0),
    );
    map.set(row.employee_id, employeeHours);
  });

  return map;
}

function buildPaidShiftCoverageMap(rows: PayStatementCoverageRow[]) {
  const map = new Map<string, PayStatementCoverageRow[]>();

  rows
    .filter((row) => row.status === "paid" || row.status === "archived")
    .forEach((row) => {
      const employeeCoverage = map.get(row.employee_id) ?? [];
      employeeCoverage.push(row);
      map.set(row.employee_id, employeeCoverage);
    });

  return map;
}

function getShiftPayrollCoverage(
  shift: Pick<ShiftEntryRow, "employee_id" | "entry_date" | "verified_at">,
  coverageRows: PayStatementCoverageRow[] | undefined,
) {
  if (!shift.verified_at) {
    return {
      payrollStatus: "unpaid" as ShiftPayrollStatus,
    };
  }

  const coverage = (coverageRows ?? []).find(
    (row) =>
      shift.entry_date >= row.period_start &&
      shift.entry_date <= row.period_end,
  );

  if (!coverage) {
    return {
      payrollStatus: "unpaid" as ShiftPayrollStatus,
    };
  }

  return {
    payrollStatus: "paid" as ShiftPayrollStatus,
    paidAt: coverage.pay_date,
    paidPeriodLabel: coverage.period_label,
  };
}

function getPayrollHoursForPeriod(
  dailyHours: Map<string, number> | undefined,
  period: PayrollPeriod | null,
) {
  if (!dailyHours || !period) {
    return undefined;
  }

  let totalHours = 0;

  dailyHours.forEach((hours, dateKey) => {
    if (dateKey >= period.periodStart && dateKey <= period.periodEnd) {
      totalHours += hours;
    }
  });

  return roundHours(totalHours);
}

function getUniqueSortedDateKeys(dateKeys: string[]) {
  return [...new Set(dateKeys)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function formatScheduleConflictMessage(
  employeeName: string,
  conflictingDateKeys: string[],
) {
  const uniqueDateKeys = getUniqueSortedDateKeys(conflictingDateKeys);

  if (uniqueDateKeys.length === 1) {
    return `${employeeName} already has a scheduled shift for ${uniqueDateKeys[0]}`;
  }

  const preview = uniqueDateKeys.slice(0, 5).join(", ");
  const remainingCount = uniqueDateKeys.length - 5;

  return `${employeeName} already has scheduled shifts for ${preview}${
    remainingCount > 0
      ? `, and ${remainingCount} more day${remainingCount === 1 ? "" : "s"}`
      : ""
  }`;
}

function parseRequestedScheduleWindows(
  body: Record<string, unknown>,
  timeZone: string,
) {
  const rawWindows = body.scheduleWindows;

  if (Array.isArray(rawWindows)) {
    const windows: RequestedScheduleWindow[] = [];

    for (const rawWindow of rawWindows) {
      if (!rawWindow || typeof rawWindow !== "object") {
        return { error: "scheduleWindows must contain valid shift windows" };
      }

      const shiftDate = normalizeDateKey(
        "shiftDate" in rawWindow && typeof rawWindow.shiftDate === "string"
          ? rawWindow.shiftDate
          : null,
      );
      const startTime =
        "startTime" in rawWindow && typeof rawWindow.startTime === "string"
          ? rawWindow.startTime
          : null;
      const endTime =
        "endTime" in rawWindow && typeof rawWindow.endTime === "string"
          ? rawWindow.endTime
          : null;
      const startAt =
        shiftDate && startTime
          ? convertStoreLocalDateTimeToIso(shiftDate, startTime, timeZone)
          : toIsoTimestamp(
              "startAt" in rawWindow && typeof rawWindow.startAt === "string"
                ? rawWindow.startAt
                : null,
            );
      const endAt =
        shiftDate && startTime && endTime
          ? convertStoreLocalDateTimeToIso(
              getEndDateKeyForShift(shiftDate, startTime, endTime),
              endTime,
              timeZone,
            )
          : toIsoTimestamp(
              "endAt" in rawWindow && typeof rawWindow.endAt === "string"
                ? rawWindow.endAt
                : null,
            );

      if (!shiftDate || !startAt || !endAt) {
        return {
          error: "Each schedule window requires shiftDate, startAt, and endAt",
        };
      }

      windows.push({ shiftDate, startAt, endAt });
    }

    return { data: windows };
  }

  const shiftDate = normalizeDateKey(
    typeof body.shiftDate === "string" ? body.shiftDate : null,
  );
  const startTime = typeof body.startTime === "string" ? body.startTime : null;
  const endTime = typeof body.endTime === "string" ? body.endTime : null;
  const startAt =
    shiftDate && startTime
      ? convertStoreLocalDateTimeToIso(shiftDate, startTime, timeZone)
      : toIsoTimestamp(typeof body.startAt === "string" ? body.startAt : null);
  const endAt =
    shiftDate && startTime && endTime
      ? convertStoreLocalDateTimeToIso(
          getEndDateKeyForShift(shiftDate, startTime, endTime),
          endTime,
          timeZone,
        )
      : toIsoTimestamp(typeof body.endAt === "string" ? body.endAt : null);

  if (!shiftDate || !startAt || !endAt) {
    return {
      error: "Provide scheduleWindows or include shiftDate, startAt, and endAt",
    };
  }

  return {
    data: [{ shiftDate, startAt, endAt }],
  };
}

function parseRequestedManualEntryWindows(
  body: Record<string, unknown>,
  timeZone: string,
) {
  const rawWindows = body.entryWindows;

  if (Array.isArray(rawWindows)) {
    const windows: RequestedManualEntryWindow[] = [];

    for (const rawWindow of rawWindows) {
      if (!rawWindow || typeof rawWindow !== "object") {
        return {
          error: "entryWindows must contain valid manual entry windows",
        };
      }

      const entryDate = normalizeDateKey(
        "entryDate" in rawWindow && typeof rawWindow.entryDate === "string"
          ? rawWindow.entryDate
          : null,
      );
      const startTime =
        "startTime" in rawWindow && typeof rawWindow.startTime === "string"
          ? rawWindow.startTime
          : null;
      const endTime =
        "endTime" in rawWindow && typeof rawWindow.endTime === "string"
          ? rawWindow.endTime
          : null;
      const startAt =
        entryDate && startTime
          ? convertStoreLocalDateTimeToIso(entryDate, startTime, timeZone)
          : toIsoTimestamp(
              "startAt" in rawWindow && typeof rawWindow.startAt === "string"
                ? rawWindow.startAt
                : null,
            );
      const endAt =
        entryDate && startTime && endTime
          ? convertStoreLocalDateTimeToIso(
              getEndDateKeyForShift(entryDate, startTime, endTime),
              endTime,
              timeZone,
            )
          : toIsoTimestamp(
              "endAt" in rawWindow && typeof rawWindow.endAt === "string"
                ? rawWindow.endAt
                : null,
            );

      if (!entryDate || !startAt || !endAt) {
        return {
          error:
            "Each manual entry window requires entryDate, startAt, and endAt",
        };
      }

      windows.push({ entryDate, startAt, endAt });
    }

    return { data: windows };
  }

  const entryDate = normalizeDateKey(
    typeof body.entryDate === "string"
      ? body.entryDate
      : typeof body.shiftDate === "string"
        ? body.shiftDate
        : null,
  );
  const startTime = typeof body.startTime === "string" ? body.startTime : null;
  const endTime = typeof body.endTime === "string" ? body.endTime : null;
  const startAt =
    entryDate && startTime
      ? convertStoreLocalDateTimeToIso(entryDate, startTime, timeZone)
      : toIsoTimestamp(typeof body.startAt === "string" ? body.startAt : null);
  const endAt =
    entryDate && startTime && endTime
      ? convertStoreLocalDateTimeToIso(
          getEndDateKeyForShift(entryDate, startTime, endTime),
          endTime,
          timeZone,
        )
      : toIsoTimestamp(typeof body.endAt === "string" ? body.endAt : null);

  if (!entryDate || !startAt || !endAt) {
    return {
      error: "Provide entryWindows or include entryDate, startAt, and endAt",
    };
  }

  return {
    data: [{ entryDate, startAt, endAt }],
  };
}

function getShiftBreakHours(schedule: ShiftScheduleRow | null) {
  return Number(schedule?.unpaid_break_minutes ?? 0) / 60;
}

function getScheduledHours(schedule: ShiftScheduleRow | null) {
  if (!schedule) {
    return 0;
  }

  return roundHours(
    Math.max(
      calculateDurationHours(
        schedule.scheduled_start_at,
        schedule.scheduled_end_at,
      ) - getShiftBreakHours(schedule),
      0,
    ),
  );
}

function isShiftManagerRole(role: UserRole) {
  return role === "admin" || role === "manager";
}

function isShiftSelfServiceRole(role: UserRole): role is ShiftSelfServiceRole {
  return !isShiftManagerRole(role);
}

function getShiftDataClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
): ShiftDataClient {
  return supabase;
}

async function getShiftAccessContext(): Promise<
  ShiftAccessContext | { error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name,email,role,store_key,permissions")
    .eq("id", user.id)
    .maybeSingle<AccessProfileRow>();

  if (profileError) {
    return {
      error: NextResponse.json(
        { error: profileError.message ?? "Failed to load current user" },
        { status: 500 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before managing shifts" },
        { status: 400 },
      ),
    };
  }

  const currentUserRole = profile?.role ?? "employee";

  if (
    !canAccessPath("/shifts", currentUserRole, profile?.permissions) &&
    !canAccessPath(
      "/admin/shift-management",
      currentUserRole,
      profile?.permissions,
    )
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: shift access denied" },
        { status: 403 },
      ),
    };
  }

  const storeSettings = await loadStoreSettingsForStore(
    supabase,
    storeContext.activeStoreKey,
  );

  return {
    supabase,
    db: getShiftDataClient(supabase),
    currentUserId: user.id,
    currentUserName: (
      profile?.full_name ??
      profile?.email ??
      user.email ??
      "Employee"
    ).trim(),
    currentUserRole,
    currentUserPermissions: profile?.permissions ?? null,
    activeStoreKey: storeContext.activeStoreKey,
    storeTimeZone: storeSettings.profile.timezone,
    canSyncAttendance: canAccessPath(
      "/admin/shift-management",
      currentUserRole,
      profile?.permissions,
    ),
  };
}

async function requireShiftManagerAccess() {
  const access = await getShiftAccessContext();

  if ("error" in access) {
    return access;
  }

  if (
    !canAccessPath(
      "/admin/shift-management",
      access.currentUserRole,
      access.currentUserPermissions,
    )
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: admin or manager access required" },
        { status: 403 },
      ),
    };
  }

  return access;
}

async function getEmployeeNameMap(
  db: ShiftDataClient,
  storeKey: string,
): Promise<
  | {
      employeeRows: ProfileRow[];
      employeeMap: Map<string, ShiftEmployee>;
    }
  | { error: { message?: string | null } }
> {
  const { data, error } = await db
    .from("profiles")
    .select("id,full_name,email,role,status,pay_frequency")
    .neq("role", "admin")
    .eq("store_key", storeKey)
    .order("full_name", { ascending: true })
    .returns<ProfileRow[]>();

  if (error) {
    return { error };
  }

  const employeeRows = data ?? [];
  const employeeMap = new Map(
    employeeRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: (row.full_name ?? row.email ?? "Employee").trim(),
        role: (row.role ?? "employee") as ShiftAssignableRole,
        status: row.status ?? "active",
      },
    ]),
  );

  return {
    employeeRows,
    employeeMap,
  };
}

async function resolveEmployee(
  access: ShiftAccessContext,
  employeeId: string,
): Promise<ShiftEmployee | { error: NextResponse }> {
  if (
    employeeId === access.currentUserId &&
    isShiftSelfServiceRole(access.currentUserRole)
  ) {
    return {
      id: access.currentUserId,
      name: access.currentUserName,
      role: access.currentUserRole,
      status: "active",
    };
  }

  const employeeResult = await getEmployeeNameMap(
    access.db,
    access.activeStoreKey,
  );

  if ("error" in employeeResult) {
    return {
      error: NextResponse.json(
        { error: employeeResult.error.message ?? "Failed to load employees" },
        { status: 500 },
      ),
    };
  }

  const employee = employeeResult.employeeMap.get(employeeId) ?? null;

  if (!employee) {
    return {
      error: NextResponse.json(
        { error: "Employee not found" },
        { status: 404 },
      ),
    };
  }

  return employee;
}

function getSourceUpdatedAt(
  schedule: ShiftScheduleRow | null,
  shiftRows: ShiftEntryRow[],
) {
  const scheduleUpdatedAt =
    schedule?.updated_at ?? schedule?.created_at ?? null;
  const latestShiftUpdatedAt =
    [...shiftRows].sort(
      (left, right) =>
        new Date(right.updated_at).getTime() -
        new Date(left.updated_at).getTime(),
    )[0]?.updated_at ?? null;

  if (scheduleUpdatedAt && latestShiftUpdatedAt) {
    return new Date(scheduleUpdatedAt).getTime() >
      new Date(latestShiftUpdatedAt).getTime()
      ? scheduleUpdatedAt
      : latestShiftUpdatedAt;
  }

  return scheduleUpdatedAt ?? latestShiftUpdatedAt ?? new Date().toISOString();
}

function buildActiveExceptionCandidates(input: {
  schedule: ShiftScheduleRow | null;
  shiftRows: ShiftEntryRow[];
  referenceNowIso: string;
}) {
  const { schedule, shiftRows, referenceNowIso } = input;
  const sortedShifts = [...shiftRows].sort(
    (left, right) =>
      new Date(left.clock_in_at).getTime() -
      new Date(right.clock_in_at).getTime(),
  );
  const openShift = sortedShifts.find((row) => !row.clock_out_at) ?? null;
  const firstShift = sortedShifts[0] ?? null;
  const closedShifts = sortedShifts.filter((row) => row.clock_out_at);
  const lastClosedShift =
    [...closedShifts].sort(
      (left, right) =>
        new Date(right.clock_out_at ?? right.clock_in_at).getTime() -
        new Date(left.clock_out_at ?? left.clock_in_at).getTime(),
    )[0] ?? null;
  const shiftStartAt = firstShift?.clock_in_at ?? null;
  const shiftEndAt = openShift ? null : (lastClosedShift?.clock_out_at ?? null);
  const totalHours = roundHours(
    sortedShifts.reduce(
      (sum, row) =>
        sum +
        resolveShiftHours({
          clockInAt: row.clock_in_at,
          clockOutAt: row.clock_out_at,
          hoursWorked: row.hours_worked,
          referenceNowIso,
        }),
      0,
    ),
  );
  const sourceUpdatedAt = getSourceUpdatedAt(schedule, sortedShifts);
  const candidates = new Map<
    AttendanceExceptionType,
    ActiveExceptionCandidate
  >();
  const hasOnlyVerifiedManualShifts =
    sortedShifts.length > 0 &&
    sortedShifts.every(
      (row) =>
        row.entry_type === "manual" &&
        Boolean(row.clock_out_at) &&
        Boolean(row.verified_at),
    );

  if (hasOnlyVerifiedManualShifts) {
    return [];
  }

  if (!schedule) {
    if (sortedShifts.length > 0) {
      candidates.set("unscheduled_shift", {
        type: "unscheduled_shift",
        severity: ATTENDANCE_EXCEPTION_META.unscheduled_shift.severity,
        title: ATTENDANCE_EXCEPTION_META.unscheduled_shift.title,
        detail:
          "Attendance was recorded without a published schedule for that day.",
        shiftEntryId: openShift?.id ?? lastClosedShift?.id ?? null,
        sourceUpdatedAt,
      });
    }

    return [...candidates.values()];
  }

  if (sortedShifts.length === 0) {
    if (
      new Date(referenceNowIso).getTime() >
      new Date(
        addMinutes(schedule.scheduled_start_at, LATE_START_GRACE_MINUTES),
      ).getTime()
    ) {
      candidates.set("missed_clock_in", {
        type: "missed_clock_in",
        severity: ATTENDANCE_EXCEPTION_META.missed_clock_in.severity,
        title: ATTENDANCE_EXCEPTION_META.missed_clock_in.title,
        detail: `No shift was started for the scheduled window ${formatTimeLabel(
          schedule.scheduled_start_at,
        )} to ${formatTimeLabel(schedule.scheduled_end_at)}.`,
        scheduleId: schedule.id,
        sourceUpdatedAt,
      });
    }

    return [...candidates.values()];
  }

  if (
    shiftStartAt &&
    new Date(shiftStartAt).getTime() >
      new Date(
        addMinutes(schedule.scheduled_start_at, LATE_START_GRACE_MINUTES),
      ).getTime()
  ) {
    candidates.set("late_start", {
      type: "late_start",
      severity: ATTENDANCE_EXCEPTION_META.late_start.severity,
      title: ATTENDANCE_EXCEPTION_META.late_start.title,
      detail: `Clock-in at ${formatTimeLabel(
        shiftStartAt,
      )} landed after the scheduled start of ${formatTimeLabel(
        schedule.scheduled_start_at,
      )}.`,
      scheduleId: schedule.id,
      shiftEntryId: firstShift?.id ?? null,
      sourceUpdatedAt,
    });
  }

  if (!shiftEndAt) {
    if (
      new Date(referenceNowIso).getTime() >
      new Date(
        addMinutes(schedule.scheduled_end_at, MISSED_CLOCK_OUT_GRACE_MINUTES),
      ).getTime()
    ) {
      candidates.set("missed_clock_out", {
        type: "missed_clock_out",
        severity: ATTENDANCE_EXCEPTION_META.missed_clock_out.severity,
        title: ATTENDANCE_EXCEPTION_META.missed_clock_out.title,
        detail: `The shift is still open after the scheduled end at ${formatTimeLabel(
          schedule.scheduled_end_at,
        )}.`,
        scheduleId: schedule.id,
        shiftEntryId: openShift?.id ?? null,
        sourceUpdatedAt,
      });
    }

    return [...candidates.values()];
  }

  if (
    new Date(shiftEndAt).getTime() <
    new Date(
      addMinutes(schedule.scheduled_end_at, -EARLY_FINISH_GRACE_MINUTES),
    ).getTime()
  ) {
    candidates.set("early_finish", {
      type: "early_finish",
      severity: ATTENDANCE_EXCEPTION_META.early_finish.severity,
      title: ATTENDANCE_EXCEPTION_META.early_finish.title,
      detail: `Clock-out at ${formatTimeLabel(
        shiftEndAt,
      )} landed before the scheduled end of ${formatTimeLabel(
        schedule.scheduled_end_at,
      )}.`,
      scheduleId: schedule.id,
      shiftEntryId: lastClosedShift?.id ?? null,
      sourceUpdatedAt,
    });
  }

  const scheduledHours = getScheduledHours(schedule);

  if (totalHours > scheduledHours + OVERTIME_GRACE_HOURS) {
    candidates.set("overtime", {
      type: "overtime",
      severity: ATTENDANCE_EXCEPTION_META.overtime.severity,
      title: ATTENDANCE_EXCEPTION_META.overtime.title,
      detail: `Recorded ${totalHours.toFixed(
        2,
      )}h against a scheduled ${scheduledHours.toFixed(2)}h.`,
      scheduleId: schedule.id,
      shiftEntryId: lastClosedShift?.id ?? null,
      sourceUpdatedAt,
    });
  }

  return [...candidates.values()];
}

async function syncAttendanceWindow(input: {
  db: ShiftDataClient;
  storeKey: string;
  employeeIds?: string[];
  dateFrom: string;
  dateTo: string;
  actorId?: string | null;
}) {
  const { db, storeKey, employeeIds, dateFrom, dateTo, actorId } = input;

  if (employeeIds && employeeIds.length === 0) {
    return { success: true as const };
  }

  let scheduleQuery = db
    .from("shift_schedules")
    .select(SHIFT_SCHEDULE_SELECT)
    .eq("store_key", storeKey)
    .gte("shift_date", dateFrom)
    .lte("shift_date", dateTo);
  let shiftQuery = db
    .from("shift_time_entries")
    .select(SHIFT_ENTRY_SELECT)
    .eq("store_key", storeKey)
    .gte("entry_date", dateFrom)
    .lte("entry_date", dateTo);
  let exceptionQuery = db
    .from("attendance_exceptions")
    .select(ATTENDANCE_EXCEPTION_SELECT)
    .eq("store_key", storeKey)
    .gte("exception_date", dateFrom)
    .lte("exception_date", dateTo);

  const [scheduleResult, shiftResult, exceptionResult] = await Promise.all([
    scheduleQuery.returns<ShiftScheduleRow[]>(),
    shiftQuery.returns<ShiftEntryRow[]>(),
    exceptionQuery.returns<AttendanceExceptionRow[]>(),
  ]);

  const tableError =
    scheduleResult.error ?? shiftResult.error ?? exceptionResult.error;

  if (tableError) {
    return { error: tableError };
  }

  const scopedSchedules = (scheduleResult.data ?? []).filter(
    (row) => !employeeIds || employeeIds.includes(row.employee_id),
  );
  const scopedShifts = (shiftResult.data ?? []).filter(
    (row) => !employeeIds || employeeIds.includes(row.employee_id),
  );
  const scopedExceptions = (exceptionResult.data ?? []).filter(
    (row) => !employeeIds || employeeIds.includes(row.employee_id),
  );
  const schedulesByKey = new Map<string, ShiftScheduleRow>();
  const shiftsByKey = new Map<string, ShiftEntryRow[]>();
  const exceptionsByKey = new Map<string, AttendanceExceptionRow[]>();

  scopedSchedules.forEach((row) => {
    schedulesByKey.set(buildGroupKey(row.employee_id, row.shift_date), row);
  });

  scopedShifts.forEach((row) => {
    const key = buildGroupKey(row.employee_id, row.entry_date);
    const existing = shiftsByKey.get(key) ?? [];
    existing.push(row);
    shiftsByKey.set(key, existing);
  });

  scopedExceptions.forEach((row) => {
    const key = buildGroupKey(row.employee_id, row.exception_date);
    const existing = exceptionsByKey.get(key) ?? [];
    existing.push(row);
    exceptionsByKey.set(key, existing);
  });

  const keys = new Set<string>([
    ...schedulesByKey.keys(),
    ...shiftsByKey.keys(),
    ...exceptionsByKey.keys(),
  ]);
  const referenceNowIso = new Date().toISOString();
  const rowsToInsert: Array<Record<string, string | null>> = [];
  const updates: Array<{
    id: string;
    payload: Record<string, string | null>;
  }> = [];

  keys.forEach((key) => {
    const schedule = schedulesByKey.get(key) ?? null;
    const shiftRows = shiftsByKey.get(key) ?? [];
    const existingExceptions = exceptionsByKey.get(key) ?? [];
    const activeCandidates = buildActiveExceptionCandidates({
      schedule,
      shiftRows,
      referenceNowIso,
    });
    const activeTypes = new Set(
      activeCandidates.map((candidate) => candidate.type),
    );
    const existingByType = new Map(
      existingExceptions.map((row) => [row.exception_type, row]),
    );

    activeCandidates.forEach((candidate) => {
      const existing = existingByType.get(candidate.type);

      if (!existing) {
        rowsToInsert.push({
          store_key: storeKey,
          employee_id:
            schedule?.employee_id ?? shiftRows[0]?.employee_id ?? null,
          shift_entry_id: candidate.shiftEntryId ?? null,
          schedule_id: candidate.scheduleId ?? null,
          exception_date:
            schedule?.shift_date ?? shiftRows[0]?.entry_date ?? null,
          exception_type: candidate.type,
          status: "open",
          severity: candidate.severity,
          title: candidate.title,
          details: candidate.detail,
          resolution_notes: null,
          resolved_at: null,
          resolved_by: null,
          created_by: actorId ?? null,
          updated_by: actorId ?? null,
        });
        return;
      }

      const shouldReopen =
        existing.status !== "open" &&
        new Date(existing.updated_at).getTime() <
          new Date(candidate.sourceUpdatedAt).getTime();

      if (
        existing.status === "open" ||
        shouldReopen ||
        existing.title !== candidate.title ||
        existing.details !== candidate.detail ||
        existing.shift_entry_id !== (candidate.shiftEntryId ?? null) ||
        existing.schedule_id !== (candidate.scheduleId ?? null) ||
        existing.severity !== candidate.severity
      ) {
        updates.push({
          id: existing.id,
          payload: {
            shift_entry_id: candidate.shiftEntryId ?? null,
            schedule_id: candidate.scheduleId ?? null,
            status: shouldReopen ? "open" : existing.status,
            severity: candidate.severity,
            title: candidate.title,
            details: candidate.detail,
            resolution_notes: shouldReopen ? null : existing.resolution_notes,
            resolved_at: shouldReopen ? null : existing.resolved_at,
            resolved_by: shouldReopen ? null : null,
            updated_by: actorId ?? null,
          },
        });
      }
    });

    existingExceptions
      .filter(
        (row) => row.status === "open" && !activeTypes.has(row.exception_type),
      )
      .forEach((row) => {
        updates.push({
          id: row.id,
          payload: {
            status: "resolved",
            resolution_notes:
              row.resolution_notes ??
              "Cleared automatically from current attendance data.",
            resolved_at: referenceNowIso,
            resolved_by: actorId ?? null,
            updated_by: actorId ?? null,
          },
        });
      });
  });

  if (rowsToInsert.length > 0) {
    const { error } = await db
      .from("attendance_exceptions")
      .upsert(rowsToInsert, {
        onConflict: "store_key,employee_id,exception_date,exception_type",
      });

    if (error && !isMissingShiftDataError(error)) {
      return { error };
    }

    if (error) {
      return { error };
    }
  }

  if (updates.length > 0) {
    const updateResults = await Promise.all(
      updates.map(({ id, payload }) =>
        db.from("attendance_exceptions").update(payload).eq("id", id),
      ),
    );
    const updateError =
      updateResults.find((result) => result.error)?.error ?? null;

    if (updateError) {
      return { error: updateError };
    }
  }

  return { success: true as const };
}

async function maybeSyncAttendanceWindow(input: {
  access: ShiftAccessContext;
  employeeIds?: string[];
  dateFrom: string;
  dateTo: string;
  actorId?: string | null;
}) {
  const { access, employeeIds, dateFrom, dateTo, actorId } = input;

  if (!access.canSyncAttendance) {
    return { success: true as const };
  }

  return syncAttendanceWindow({
    db: access.db,
    storeKey: access.activeStoreKey,
    employeeIds,
    dateFrom,
    dateTo,
    actorId,
  });
}

function mapAttendanceExceptionRow(
  row: AttendanceExceptionRow,
  employeeName: string,
): AttendanceException {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName,
    date: row.exception_date,
    type: row.exception_type,
    status: row.status,
    severity: row.severity,
    title: row.title,
    detail: row.details,
    shiftId: row.shift_entry_id ?? undefined,
    scheduleId: row.schedule_id ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionNotes: row.resolution_notes ?? undefined,
    createdAt: row.created_at,
  };
}

function mapShiftEntryRow(
  row: ShiftEntryRow,
  employeeName: string,
  referenceNowIso: string,
  openExceptionCount: number,
  coverageRows?: PayStatementCoverageRow[],
): ShiftEntry {
  const payrollCoverage = getShiftPayrollCoverage(row, coverageRows);

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName,
    date: row.entry_date,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at ?? undefined,
    hours: resolveShiftHours({
      clockInAt: row.clock_in_at,
      clockOutAt: row.clock_out_at,
      hoursWorked: row.hours_worked,
      referenceNowIso,
    }),
    type: row.entry_type,
    isOpen: !row.clock_out_at,
    notes: row.notes ?? undefined,
    scheduleId: row.schedule_id ?? undefined,
    verificationStatus: getShiftVerificationStatus({
      clockOutAt: row.clock_out_at,
      verifiedAt: row.verified_at,
      openExceptionCount,
    }),
    payrollStatus: payrollCoverage.payrollStatus,
    verifiedAt: row.verified_at ?? undefined,
    paidAt: payrollCoverage.paidAt,
    paidPeriodLabel: payrollCoverage.paidPeriodLabel,
    openExceptionCount,
  };
}

function mapShiftScheduleRow(
  row: ShiftScheduleRow,
  employeeName: string,
  linkedShift: ShiftEntryRow | null,
  linkedShiftOpenExceptionCount: number,
  referenceNowIso: string,
): ShiftSchedule {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName,
    date: row.shift_date,
    startAt: row.scheduled_start_at,
    endAt: row.scheduled_end_at,
    breakMinutes: Number(row.unpaid_break_minutes ?? 0),
    notes: row.notes ?? undefined,
    status: getScheduleStatus({
      startAt: row.scheduled_start_at,
      endAt: row.scheduled_end_at,
      linkedShiftId: linkedShift?.id,
      linkedShiftClockOutAt: linkedShift?.clock_out_at,
      linkedShiftVerifiedAt: linkedShift?.verified_at,
      linkedShiftOpenExceptionCount,
      referenceNowIso,
    }),
    linkedShiftId: linkedShift?.id ?? undefined,
    linkedShiftVerificationStatus: linkedShift
      ? getShiftVerificationStatus({
          clockOutAt: linkedShift.clock_out_at,
          verifiedAt: linkedShift.verified_at,
          openExceptionCount: linkedShiftOpenExceptionCount,
        })
      : undefined,
    linkedShiftHours: linkedShift
      ? resolveShiftHours({
          clockInAt: linkedShift.clock_in_at,
          clockOutAt: linkedShift.clock_out_at,
          hoursWorked: linkedShift.hours_worked,
          referenceNowIso,
        })
      : undefined,
  };
}

function buildOpenExceptionCountMap(rows: AttendanceExceptionRow[]) {
  const map = new Map<string, number>();

  rows
    .filter((row) => row.status === "open")
    .forEach((row) => {
      const key = buildGroupKey(row.employee_id, row.exception_date);
      map.set(key, (map.get(key) ?? 0) + 1);
    });

  return map;
}

function buildLatestShiftMap(rows: ShiftEntryRow[]) {
  const map = new Map<string, ShiftEntryRow>();

  [...rows]
    .sort(
      (left, right) =>
        new Date(right.clock_in_at).getTime() -
        new Date(left.clock_in_at).getTime(),
    )
    .forEach((row) => {
      const key = buildGroupKey(row.employee_id, row.entry_date);

      if (!map.has(key)) {
        map.set(key, row);
      }
    });

  return map;
}

function sortShiftsForHistory(shifts: ShiftEntry[]) {
  return [...shifts].sort((left, right) => {
    if (left.isOpen !== right.isOpen) {
      return left.isOpen ? -1 : 1;
    }

    return (
      new Date(right.clockOutAt ?? right.clockInAt).getTime() -
      new Date(left.clockOutAt ?? left.clockInAt).getTime()
    );
  });
}

function sortSchedulesForDisplay(schedules: ShiftSchedule[]) {
  return [...schedules].sort(
    (left, right) =>
      new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
  );
}

function sortExceptionsForDisplay(exceptions: AttendanceException[]) {
  return [...exceptions].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "open" ? -1 : 1;
    }

    return (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  });
}

async function loadOpenExceptionCount(
  db: ShiftDataClient,
  storeKey: string,
  employeeId: string,
  dateKey: string,
) {
  const { count, error } = await db
    .from("attendance_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("store_key", storeKey)
    .eq("employee_id", employeeId)
    .eq("exception_date", dateKey)
    .eq("status", "open");

  if (error) {
    return { error };
  }

  return { count: count ?? 0 };
}

async function loadOpenBlockingExceptionCountForShift(
  db: ShiftDataClient,
  storeKey: string,
  shift: Pick<ShiftEntryRow, "id" | "schedule_id">,
) {
  let query = db
    .from("attendance_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("store_key", storeKey)
    .eq("status", "open");

  if (shift.schedule_id) {
    query = query.or(
      `shift_entry_id.eq.${shift.id},schedule_id.eq.${shift.schedule_id}`,
    );
  } else {
    query = query.eq("shift_entry_id", shift.id);
  }

  const { count, error } = await query;

  if (error) {
    return { error };
  }

  return { count: count ?? 0 };
}

async function loadShiftById(
  db: ShiftDataClient,
  storeKey: string,
  shiftId: string,
) {
  return db
    .from("shift_time_entries")
    .select(SHIFT_ENTRY_SELECT)
    .eq("id", shiftId)
    .eq("store_key", storeKey)
    .returns<ShiftEntryRow[]>()
    .maybeSingle();
}

async function loadScheduleById(
  db: ShiftDataClient,
  storeKey: string,
  scheduleId: string,
) {
  return db
    .from("shift_schedules")
    .select(SHIFT_SCHEDULE_SELECT)
    .eq("id", scheduleId)
    .eq("store_key", storeKey)
    .returns<ShiftScheduleRow[]>()
    .maybeSingle();
}

async function loadExceptionById(
  db: ShiftDataClient,
  storeKey: string,
  exceptionId: string,
) {
  return db
    .from("attendance_exceptions")
    .select(ATTENDANCE_EXCEPTION_SELECT)
    .eq("id", exceptionId)
    .eq("store_key", storeKey)
    .returns<AttendanceExceptionRow[]>()
    .maybeSingle();
}

async function finalizeShiftIfClear(input: {
  db: ShiftDataClient;
  storeKey: string;
  shift: ShiftEntryRow;
  verifierId: string;
}) {
  const { db, storeKey, shift, verifierId } = input;

  if (!shift.clock_out_at) {
    return { error: "Open shifts cannot be finalized yet" };
  }

  const exceptionCountResult = await loadOpenBlockingExceptionCountForShift(
    db,
    storeKey,
    shift,
  );

  if ("error" in exceptionCountResult) {
    return {
      error:
        exceptionCountResult.error?.message ?? "Failed to inspect exceptions",
    };
  }

  if (exceptionCountResult.count > 0) {
    return {
      error: "Resolve open attendance exceptions before finalizing this shift",
    };
  }

  const verifiedAt = shift.verified_at ?? new Date().toISOString();
  const { data, error } = await db
    .from("shift_time_entries")
    .update({
      verified_at: verifiedAt,
      verified_by: verifierId,
      updated_by: verifierId,
    })
    .eq("id", shift.id)
    .eq("store_key", storeKey)
    .select(SHIFT_ENTRY_SELECT)
    .returns<ShiftEntryRow[]>()
    .single();

  if (error) {
    return { error: error.message ?? "Failed to finalize shift" };
  }

  return { data };
}

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const scope = request.nextUrl.searchParams.get("scope");

    if (scope === "self") {
      const access = await getShiftAccessContext();

      if ("error" in access) {
        return access.error;
      }

      if (access.currentUserRole === "admin") {
        return NextResponse.json(
          {
            error:
              "Admin shift workflows are managed from the admin shift page",
          },
          { status: 403 },
        );
      }

      const todayKey =
        normalizeDateKey(request.nextUrl.searchParams.get("today")) ??
        getTodayKey(new Date(), access.storeTimeZone);
      const historyStart = addDays(todayKey, -21);
      const scheduleStart = addDays(todayKey, -7);
      const scheduleEnd = addDays(todayKey, 14);
      const exceptionSyncStart = addDays(todayKey, -14);

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: [access.currentUserId],
        dateFrom: exceptionSyncStart,
        dateTo: todayKey,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error:
              syncResult.error.message ??
              "Failed to refresh attendance exceptions",
          },
          { status: 500 },
        );
      }

      const [todaysShiftResult, shiftResult, scheduleResult, exceptionResult] =
        await Promise.all([
          access.db
            .from("shift_time_entries")
            .select(SHIFT_ENTRY_SELECT)
            .eq("store_key", access.activeStoreKey)
            .eq("employee_id", access.currentUserId)
            .eq("entry_date", todayKey)
            .order("clock_in_at", { ascending: false })
            .returns<ShiftEntryRow[]>(),
          access.db
            .from("shift_time_entries")
            .select(SHIFT_ENTRY_SELECT)
            .eq("store_key", access.activeStoreKey)
            .eq("employee_id", access.currentUserId)
            .gte("entry_date", historyStart)
            .order("clock_in_at", { ascending: false })
            .limit(40)
            .returns<ShiftEntryRow[]>(),
          access.db
            .from("shift_schedules")
            .select(SHIFT_SCHEDULE_SELECT)
            .eq("store_key", access.activeStoreKey)
            .eq("employee_id", access.currentUserId)
            .gte("shift_date", scheduleStart)
            .lte("shift_date", scheduleEnd)
            .order("shift_date", { ascending: true })
            .returns<ShiftScheduleRow[]>(),
          access.db
            .from("attendance_exceptions")
            .select(ATTENDANCE_EXCEPTION_SELECT)
            .eq("store_key", access.activeStoreKey)
            .eq("employee_id", access.currentUserId)
            .gte("exception_date", exceptionSyncStart)
            .order("created_at", { ascending: false })
            .returns<AttendanceExceptionRow[]>(),
        ]);

      const tableError =
        todaysShiftResult.error ??
        shiftResult.error ??
        scheduleResult.error ??
        exceptionResult.error;

      if (tableError) {
        if (isMissingShiftDataError(tableError)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: tableError.message ?? "Failed to load your shift data" },
          { status: 500 },
        );
      }

      const paidShiftCoverageResult = await access.db
        .from("pay_statements")
        .select(
          "employee_id,period_label,period_start,period_end,pay_date,status",
        )
        .eq("store_key", access.activeStoreKey)
        .eq("employee_id", access.currentUserId)
        .lte("period_start", todayKey)
        .gte("period_end", historyStart)
        .in("status", ["paid", "archived"])
        .returns<PayStatementCoverageRow[]>();

      if (paidShiftCoverageResult.error) {
        return NextResponse.json(
          {
            error:
              paidShiftCoverageResult.error.message ??
              "Failed to load payroll coverage for shifts",
          },
          { status: 500 },
        );
      }

      const referenceNowIso = new Date().toISOString();
      const exceptionCountMap = buildOpenExceptionCountMap(
        exceptionResult.data ?? [],
      );
      const latestShiftByDate = buildLatestShiftMap(shiftResult.data ?? []);
      const paidShiftCoverageMap = buildPaidShiftCoverageMap(
        paidShiftCoverageResult.data ?? [],
      );
      const shifts = sortShiftsForHistory(
        (shiftResult.data ?? []).map((row) =>
          mapShiftEntryRow(
            row,
            access.currentUserName,
            referenceNowIso,
            exceptionCountMap.get(
              buildGroupKey(row.employee_id, row.entry_date),
            ) ?? 0,
            paidShiftCoverageMap.get(row.employee_id),
          ),
        ),
      );
      const schedules = sortSchedulesForDisplay(
        (scheduleResult.data ?? []).map((row) => {
          const key = buildGroupKey(row.employee_id, row.shift_date);
          const linkedShift = latestShiftByDate.get(key) ?? null;
          const openExceptionCount = exceptionCountMap.get(key) ?? 0;

          return mapShiftScheduleRow(
            row,
            access.currentUserName,
            linkedShift,
            openExceptionCount,
            referenceNowIso,
          );
        }),
      );
      const exceptions = sortExceptionsForDisplay(
        (exceptionResult.data ?? []).map((row) =>
          mapAttendanceExceptionRow(row, access.currentUserName),
        ),
      );
      const todayHours = (todaysShiftResult.data ?? []).reduce(
        (sum, row) =>
          sum +
          resolveShiftHours({
            clockInAt: row.clock_in_at,
            clockOutAt: row.clock_out_at,
            hoursWorked: row.hours_worked,
            referenceNowIso,
          }),
        0,
      );
      const openShift =
        (todaysShiftResult.data ?? []).find((row) => !row.clock_out_at) ?? null;
      const latestShift = (shiftResult.data ?? [])[0] ?? null;
      const nextScheduled = schedules.find(
        (schedule) =>
          new Date(schedule.endAt).getTime() >=
          new Date(referenceNowIso).getTime(),
      );
      const employee: ShiftEmployeeRecord = {
        id: access.currentUserId,
        name: access.currentUserName,
        role: access.currentUserRole,
        status: openShift ? "clocked_in" : "clocked_out",
        lastActionAt:
          openShift?.clock_in_at ??
          latestShift?.clock_out_at ??
          latestShift?.clock_in_at ??
          undefined,
        hoursToday: roundHours(todayHours),
        scheduledTodayCount: schedules.filter(
          (schedule) => schedule.date === todayKey,
        ).length,
        openExceptionCount: exceptions.filter((row) => row.status === "open")
          .length,
        nextScheduledAt: nextScheduled?.startAt,
      };
      const response: SelfShiftPayload = {
        timeZone: access.storeTimeZone,
        employee,
        shifts,
        schedules,
        exceptions,
      };

      return NextResponse.json(response);
    }

    const access = await requireShiftManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const todayKey =
      normalizeDateKey(request.nextUrl.searchParams.get("today")) ??
      getTodayKey(new Date(), access.storeTimeZone);
    const historyStart = addDays(todayKey, -21);
    const scheduleStart = addDays(todayKey, -7);
    const scheduleEnd = addDays(todayKey, 14);
    const exceptionSyncStart = addDays(todayKey, -14);

    const employeeResult = await getEmployeeNameMap(
      access.db,
      access.activeStoreKey,
    );

    if ("error" in employeeResult) {
      return NextResponse.json(
        { error: employeeResult.error.message ?? "Failed to load employees" },
        { status: 500 },
      );
    }

    const employeeIds = employeeResult.employeeRows.map((row) => row.id);
    const syncResult = await maybeSyncAttendanceWindow({
      access,
      employeeIds,
      dateFrom: exceptionSyncStart,
      dateTo: todayKey,
      actorId: access.currentUserId,
    });

    if ("error" in syncResult && syncResult.error) {
      if (isMissingShiftDataError(syncResult.error)) {
        return getShiftTrackingUnavailableResponse();
      }

      return NextResponse.json(
        {
          error:
            syncResult.error.message ??
            "Failed to refresh attendance exceptions",
        },
        { status: 500 },
      );
    }

    const [todaysShiftResult, shiftResult, scheduleResult, exceptionResult] =
      await Promise.all([
        access.db
          .from("shift_time_entries")
          .select(SHIFT_ENTRY_SELECT)
          .eq("store_key", access.activeStoreKey)
          .eq("entry_date", todayKey)
          .order("clock_in_at", { ascending: false })
          .returns<ShiftEntryRow[]>(),
        access.db
          .from("shift_time_entries")
          .select(SHIFT_ENTRY_SELECT)
          .eq("store_key", access.activeStoreKey)
          .gte("entry_date", historyStart)
          .order("clock_in_at", { ascending: false })
          .returns<ShiftEntryRow[]>(),
        access.db
          .from("shift_schedules")
          .select(SHIFT_SCHEDULE_SELECT)
          .eq("store_key", access.activeStoreKey)
          .gte("shift_date", scheduleStart)
          .lte("shift_date", scheduleEnd)
          .order("shift_date", { ascending: true })
          .returns<ShiftScheduleRow[]>(),
        access.db
          .from("attendance_exceptions")
          .select(ATTENDANCE_EXCEPTION_SELECT)
          .eq("store_key", access.activeStoreKey)
          .gte("exception_date", exceptionSyncStart)
          .order("created_at", { ascending: false })
          .limit(100)
          .returns<AttendanceExceptionRow[]>(),
      ]);

    const tableError =
      todaysShiftResult.error ??
      shiftResult.error ??
      scheduleResult.error ??
      exceptionResult.error;

    if (tableError) {
      if (isMissingShiftDataError(tableError)) {
        return getShiftTrackingUnavailableResponse();
      }

      return NextResponse.json(
        { error: tableError.message ?? "Failed to load shift data" },
        { status: 500 },
      );
    }

    const earliestShiftDate =
      (shiftResult.data ?? []).reduce<string | null>((earliest, shift) => {
        if (!earliest || shift.entry_date < earliest) {
          return shift.entry_date;
        }

        return earliest;
      }, null) ?? historyStart;

    const referenceNowIso = new Date().toISOString();
    const exceptionCountMap = buildOpenExceptionCountMap(
      exceptionResult.data ?? [],
    );
    const latestShiftByDate = buildLatestShiftMap(shiftResult.data ?? []);
    const { employeeRows, employeeMap } = employeeResult;
    const payrollPeriodsByEmployee = new Map<string, PayrollPeriod>();
    const payrollPeriods = employeeRows
      .map((row) => {
        const period = getCurrentPayrollPeriod(
          row.pay_frequency,
          new Date(referenceNowIso),
        );

        if (period) {
          payrollPeriodsByEmployee.set(row.id, period);
        }

        return period;
      })
      .filter((period): period is PayrollPeriod => period !== null);
    const earliestPayrollStart =
      payrollPeriods.length > 0
        ? payrollPeriods.reduce(
            (earliest, period) =>
              period.periodStart < earliest ? period.periodStart : earliest,
            payrollPeriods[0].periodStart,
          )
        : null;
    const latestPayrollEnd =
      payrollPeriods.length > 0
        ? payrollPeriods.reduce(
            (latest, period) =>
              period.periodEnd > latest ? period.periodEnd : latest,
            payrollPeriods[0].periodEnd,
          )
        : null;
    let payrollHoursRows: FinalizedPayrollShiftHoursRow[] = [];

    if (employeeIds.length > 0 && earliestPayrollStart && latestPayrollEnd) {
      const payrollHoursResult = await access.db
        .from("shift_time_entries")
        .select("employee_id,entry_date,hours_worked")
        .eq("store_key", access.activeStoreKey)
        .in("employee_id", employeeIds)
        .gte("entry_date", earliestPayrollStart)
        .lte("entry_date", latestPayrollEnd)
        .not("clock_out_at", "is", null)
        .not("verified_at", "is", null)
        .returns<FinalizedPayrollShiftHoursRow[]>();

      if (payrollHoursResult.error) {
        if (isMissingShiftDataError(payrollHoursResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error:
              payrollHoursResult.error.message ??
              "Failed to load finalized payroll hours",
          },
          { status: 500 },
        );
      }

      payrollHoursRows = payrollHoursResult.data ?? [];
    }

    let paidShiftCoverageRows: PayStatementCoverageRow[] = [];

    if (employeeIds.length > 0) {
      const paidShiftCoverageResult = await access.db
        .from("pay_statements")
        .select(
          "employee_id,period_label,period_start,period_end,pay_date,status",
        )
        .eq("store_key", access.activeStoreKey)
        .in("employee_id", employeeIds)
        .lte("period_start", todayKey)
        .gte("period_end", earliestShiftDate)
        .in("status", ["paid", "archived"])
        .returns<PayStatementCoverageRow[]>();

      if (paidShiftCoverageResult.error) {
        return NextResponse.json(
          {
            error:
              paidShiftCoverageResult.error.message ??
              "Failed to load payroll coverage for shifts",
          },
          { status: 500 },
        );
      }

      paidShiftCoverageRows = paidShiftCoverageResult.data ?? [];
    }

    const payrollHoursMap = buildPayrollHoursMap(payrollHoursRows);
    const paidShiftCoverageMap = buildPaidShiftCoverageMap(
      paidShiftCoverageRows,
    );
    const employees: ShiftEmployeeRecord[] = employeeRows.map((row) => {
      const todayShifts = (todaysShiftResult.data ?? []).filter(
        (shift) => shift.employee_id === row.id,
      );
      const openShift =
        todayShifts.find((shift) => !shift.clock_out_at) ?? null;
      const latestShift =
        (shiftResult.data ?? []).find(
          (shift) => shift.employee_id === row.id,
        ) ?? null;
      const todayHours = todayShifts.reduce(
        (sum, shift) =>
          sum +
          resolveShiftHours({
            clockInAt: shift.clock_in_at,
            clockOutAt: shift.clock_out_at,
            hoursWorked: shift.hours_worked,
            referenceNowIso,
          }),
        0,
      );
      const nextScheduledShift = (scheduleResult.data ?? [])
        .filter(
          (schedule) =>
            schedule.employee_id === row.id &&
            new Date(schedule.scheduled_end_at).getTime() >=
              new Date(referenceNowIso).getTime(),
        )
        .sort(
          (left, right) =>
            new Date(left.scheduled_start_at).getTime() -
            new Date(right.scheduled_start_at).getTime(),
        )[0];
      const currentPayrollPeriod = payrollPeriodsByEmployee.get(row.id) ?? null;

      return {
        id: row.id,
        name: employeeMap.get(row.id)?.name ?? "Employee",
        role: row.role ?? "employee",
        status: openShift ? "clocked_in" : "clocked_out",
        lastActionAt:
          openShift?.clock_in_at ??
          latestShift?.clock_out_at ??
          latestShift?.clock_in_at ??
          undefined,
        hoursToday: roundHours(todayHours),
        currentPayrollHours: getPayrollHoursForPeriod(
          payrollHoursMap.get(row.id),
          currentPayrollPeriod,
        ),
        currentPayrollPeriodLabel: currentPayrollPeriod?.label,
        scheduledTodayCount: (scheduleResult.data ?? []).filter(
          (schedule) =>
            schedule.employee_id === row.id && schedule.shift_date === todayKey,
        ).length,
        openExceptionCount: (exceptionResult.data ?? []).filter(
          (exception) =>
            exception.employee_id === row.id && exception.status === "open",
        ).length,
        nextScheduledAt: nextScheduledShift?.scheduled_start_at,
      };
    });

    const shifts = sortShiftsForHistory(
      (shiftResult.data ?? []).map((row) =>
        mapShiftEntryRow(
          row,
          employeeMap.get(row.employee_id)?.name ?? "Employee",
          referenceNowIso,
          exceptionCountMap.get(
            buildGroupKey(row.employee_id, row.entry_date),
          ) ?? 0,
          paidShiftCoverageMap.get(row.employee_id),
        ),
      ),
    );
    const schedules = sortSchedulesForDisplay(
      (scheduleResult.data ?? []).map((row) => {
        const key = buildGroupKey(row.employee_id, row.shift_date);
        const linkedShift = latestShiftByDate.get(key) ?? null;
        const openExceptionCount = exceptionCountMap.get(key) ?? 0;

        return mapShiftScheduleRow(
          row,
          employeeMap.get(row.employee_id)?.name ?? "Employee",
          linkedShift,
          openExceptionCount,
          referenceNowIso,
        );
      }),
    );
    const exceptions = sortExceptionsForDisplay(
      (exceptionResult.data ?? []).map((row) =>
        mapAttendanceExceptionRow(
          row,
          employeeMap.get(row.employee_id)?.name ?? "Employee",
        ),
      ),
    );
    const response: ShiftPayload = {
      timeZone: access.storeTimeZone,
      employees,
      shifts,
      schedules,
      exceptions,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Shifts GET error:", error);
    return NextResponse.json(
      { error: "Failed to load shift data" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const access = await getShiftAccessContext();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const requestedEmployeeId =
      typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const isManager = canAccessPath(
      "/admin/shift-management",
      access.currentUserRole,
      access.currentUserPermissions,
    );

    if (action === "manual_entry") {
      if (!isManager) {
        return NextResponse.json(
          { error: "Forbidden: admin or manager access required" },
          { status: 403 },
        );
      }

      const employeeId = requestedEmployeeId;
      const manualEntryWindowsResult = parseRequestedManualEntryWindows(
        body,
        access.storeTimeZone,
      );
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;

      if (!employeeId) {
        return NextResponse.json(
          { error: "employeeId is required" },
          { status: 400 },
        );
      }

      if ("error" in manualEntryWindowsResult) {
        return NextResponse.json(
          { error: manualEntryWindowsResult.error },
          { status: 400 },
        );
      }

      const manualEntryWindows = manualEntryWindowsResult.data;

      if (manualEntryWindows.length === 0) {
        return NextResponse.json(
          { error: "At least one manual entry window is required" },
          { status: 400 },
        );
      }

      if (
        manualEntryWindows.some(
          (window) =>
            new Date(window.endAt).getTime() <=
            new Date(window.startAt).getTime(),
        )
      ) {
        return NextResponse.json(
          { error: "Manual shift end time must be after the start time" },
          { status: 400 },
        );
      }

      const entryDateKeys = getUniqueSortedDateKeys(
        manualEntryWindows.map((window) => window.entryDate),
      );

      if (entryDateKeys.length !== manualEntryWindows.length) {
        return NextResponse.json(
          {
            error:
              "Each manual entry date can only be included once per request",
          },
          { status: 400 },
        );
      }

      const employee = await resolveEmployee(access, employeeId);

      if ("error" in employee) {
        return employee.error;
      }

      const scheduleLookup = await access.db
        .from("shift_schedules")
        .select("id,shift_date")
        .eq("store_key", access.activeStoreKey)
        .eq("employee_id", employeeId)
        .in("shift_date", entryDateKeys)
        .returns<Array<{ id: string; shift_date: string }>>();

      if (scheduleLookup.error) {
        if (isMissingShiftDataError(scheduleLookup.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error: scheduleLookup.error.message ?? "Failed to inspect schedule",
          },
          { status: 500 },
        );
      }

      const scheduleIdByDate = new Map(
        (scheduleLookup.data ?? []).map((row) => [row.shift_date, row.id]),
      );
      const verifiedAt = new Date().toISOString();
      const { data, error } = await access.db
        .from("shift_time_entries")
        .insert(
          manualEntryWindows.map((window) => ({
            store_key: access.activeStoreKey,
            employee_id: employeeId,
            entry_date: window.entryDate,
            clock_in_at: window.startAt,
            clock_out_at: window.endAt,
            hours_worked: calculateDurationHours(window.startAt, window.endAt),
            entry_type: "manual",
            notes,
            created_by: access.currentUserId,
            updated_by: access.currentUserId,
            verified_at: verifiedAt,
            verified_by: access.currentUserId,
            schedule_id: scheduleIdByDate.get(window.entryDate) ?? null,
          })),
        )
        .select(SHIFT_ENTRY_SELECT)
        .returns<ShiftEntryRow[]>();

      if (error) {
        if (isMissingShiftDataError(error)) {
          return getShiftTrackingUnavailableResponse();
        }

        if (isShiftOverlapError(error)) {
          return getShiftOverlapResponse(employee.name);
        }

        return NextResponse.json(
          { error: error.message ?? "Failed to create manual shift" },
          { status: 500 },
        );
      }

      const insertedRows = data ?? [];

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: [employeeId],
        dateFrom: entryDateKeys[0],
        dateTo: entryDateKeys[entryDateKeys.length - 1],
        actorId: access.currentUserId,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: syncResult.error.message ?? "Failed to refresh exceptions" },
          { status: 500 },
        );
      }

      const openExceptionCountResults = await Promise.all(
        entryDateKeys.map((entryDate) =>
          loadOpenExceptionCount(
            access.db,
            access.activeStoreKey,
            employeeId,
            entryDate,
          ),
        ),
      );

      const countError =
        openExceptionCountResults.find((result) => "error" in result) ?? null;

      if (countError && "error" in countError) {
        if (isMissingShiftDataError(countError.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error: countError.error?.message ?? "Failed to load exceptions",
          },
          { status: 500 },
        );
      }

      const openExceptionCountByDate = new Map(
        entryDateKeys.map((entryDate, index) => [
          entryDate,
          "count" in openExceptionCountResults[index]
            ? openExceptionCountResults[index].count
            : 0,
        ]),
      );

      await Promise.all(
        insertedRows.map((row) =>
          appendAuditEvent({
            supabase: access.supabase,
            storeKey: access.activeStoreKey,
            entityType: "shift_time_entry",
            entityId: row.id,
            action: "shift.manual_entry_created",
            summary: `Manual shift added for ${employee.name}`,
            actorId: access.currentUserId,
            actorName: access.currentUserName,
            actorRole: access.currentUserRole,
            metadata: {
              employeeId,
              employeeName: employee.name,
              entryDate: row.entry_date,
              startAt: row.clock_in_at,
              endAt: row.clock_out_at,
              scheduleId: row.schedule_id,
              verifiedImmediately: true,
              batchSize: insertedRows.length,
            },
          }),
        ),
      );

      if (insertedRows.length === 1) {
        const createdShift = insertedRows[0];

        return NextResponse.json(
          mapShiftEntryRow(
            createdShift,
            employee.name,
            verifiedAt,
            openExceptionCountByDate.get(createdShift.entry_date) ?? 0,
          ),
          { status: 201 },
        );
      }

      return NextResponse.json(
        {
          createdCount: insertedRows.length,
          entryDates: entryDateKeys,
        },
        { status: 201 },
      );
    }

    if (action === "save_schedule") {
      if (!isManager) {
        return NextResponse.json(
          { error: "Forbidden: admin or manager access required" },
          { status: 403 },
        );
      }

      const employeeId = requestedEmployeeId;
      const scheduleWindowsResult = parseRequestedScheduleWindows(
        body,
        access.storeTimeZone,
      );
      const scheduleId =
        typeof body.scheduleId === "string" && body.scheduleId.trim().length > 0
          ? body.scheduleId.trim()
          : null;
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;
      const breakMinutes =
        typeof body.breakMinutes === "number"
          ? body.breakMinutes
          : Number(body.breakMinutes ?? 0);

      if (!employeeId) {
        return NextResponse.json(
          { error: "employeeId is required" },
          { status: 400 },
        );
      }

      if ("error" in scheduleWindowsResult) {
        return NextResponse.json(
          { error: scheduleWindowsResult.error },
          { status: 400 },
        );
      }

      const scheduleWindows = scheduleWindowsResult.data;

      if (scheduleWindows.length === 0) {
        return NextResponse.json(
          { error: "At least one schedule window is required" },
          { status: 400 },
        );
      }

      if (scheduleId && scheduleWindows.length !== 1) {
        return NextResponse.json(
          {
            error:
              "Editing an existing shift schedule only supports one schedule window",
          },
          { status: 400 },
        );
      }

      if (Number.isNaN(breakMinutes) || breakMinutes < 0) {
        return NextResponse.json(
          { error: "breakMinutes must be zero or greater" },
          { status: 400 },
        );
      }

      if (
        scheduleWindows.some(
          (window) =>
            new Date(window.endAt).getTime() <=
            new Date(window.startAt).getTime(),
        )
      ) {
        return NextResponse.json(
          { error: "Scheduled end time must be after start time" },
          { status: 400 },
        );
      }

      const scheduleDateKeys = getUniqueSortedDateKeys(
        scheduleWindows.map((window) => window.shiftDate),
      );

      if (scheduleDateKeys.length !== scheduleWindows.length) {
        return NextResponse.json(
          { error: "Each schedule date can only be included once per request" },
          { status: 400 },
        );
      }

      const primaryWindow = scheduleWindows[0];
      const shiftDate = primaryWindow.shiftDate;

      const employee = await resolveEmployee(access, employeeId);

      if ("error" in employee) {
        return employee.error;
      }

      let scheduleRow: ShiftScheduleRow | null = null;
      let savedScheduleRows: ShiftScheduleRow[] = [];
      let previousScheduleContext: Pick<
        ShiftScheduleRow,
        "employee_id" | "shift_date"
      > | null = null;

      if (scheduleId) {
        const currentSchedule = await loadScheduleById(
          access.db,
          access.activeStoreKey,
          scheduleId,
        );

        if (currentSchedule.error) {
          if (isMissingShiftDataError(currentSchedule.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error: currentSchedule.error.message ?? "Failed to load schedule",
            },
            { status: 500 },
          );
        }

        if (!currentSchedule.data) {
          return NextResponse.json(
            { error: "Schedule not found" },
            { status: 404 },
          );
        }

        previousScheduleContext = {
          employee_id: currentSchedule.data.employee_id,
          shift_date: currentSchedule.data.shift_date,
        };

        const { data, error } = await access.db
          .from("shift_schedules")
          .update({
            employee_id: employeeId,
            shift_date: primaryWindow.shiftDate,
            scheduled_start_at: primaryWindow.startAt,
            scheduled_end_at: primaryWindow.endAt,
            unpaid_break_minutes: breakMinutes,
            notes,
            updated_by: access.currentUserId,
          })
          .eq("id", scheduleId)
          .eq("store_key", access.activeStoreKey)
          .select(SHIFT_SCHEDULE_SELECT)
          .returns<ShiftScheduleRow[]>()
          .single();

        if (error) {
          if (isMissingShiftDataError(error)) {
            return getShiftTrackingUnavailableResponse();
          }

          if (error.code === "23505") {
            return NextResponse.json(
              {
                error: formatScheduleConflictMessage(employee.name, [
                  primaryWindow.shiftDate,
                ]),
              },
              { status: 409 },
            );
          }

          if (isShiftOverlapError(error)) {
            return getShiftOverlapResponse(employee.name);
          }

          return NextResponse.json(
            { error: error.message ?? "Failed to update schedule" },
            { status: 500 },
          );
        }

        scheduleRow = data;
        savedScheduleRows = data ? [data] : [];
      } else {
        const existingSchedulesResult = await access.db
          .from("shift_schedules")
          .select("shift_date")
          .eq("store_key", access.activeStoreKey)
          .eq("employee_id", employeeId)
          .in("shift_date", scheduleDateKeys)
          .returns<Pick<ShiftScheduleRow, "shift_date">[]>();

        if (existingSchedulesResult.error) {
          if (isMissingShiftDataError(existingSchedulesResult.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error:
                existingSchedulesResult.error.message ??
                "Failed to inspect existing schedules",
            },
            { status: 500 },
          );
        }

        if ((existingSchedulesResult.data ?? []).length > 0) {
          return NextResponse.json(
            {
              error: formatScheduleConflictMessage(
                employee.name,
                (existingSchedulesResult.data ?? []).map(
                  (row) => row.shift_date,
                ),
              ),
            },
            { status: 409 },
          );
        }

        const { data, error } = await access.db
          .from("shift_schedules")
          .insert(
            scheduleWindows.map((window) => ({
              store_key: access.activeStoreKey,
              employee_id: employeeId,
              shift_date: window.shiftDate,
              scheduled_start_at: window.startAt,
              scheduled_end_at: window.endAt,
              unpaid_break_minutes: breakMinutes,
              notes,
              created_by: access.currentUserId,
              updated_by: access.currentUserId,
            })),
          )
          .select(SHIFT_SCHEDULE_SELECT)
          .returns<ShiftScheduleRow[]>();

        if (error) {
          if (isMissingShiftDataError(error)) {
            return getShiftTrackingUnavailableResponse();
          }

          if (error.code === "23505") {
            return NextResponse.json(
              {
                error: formatScheduleConflictMessage(
                  employee.name,
                  scheduleDateKeys,
                ),
              },
              { status: 409 },
            );
          }

          if (isShiftOverlapError(error)) {
            return getShiftOverlapResponse(employee.name);
          }

          return NextResponse.json(
            { error: error.message ?? "Failed to save schedule" },
            { status: 500 },
          );
        }

        savedScheduleRows = data ?? [];
        scheduleRow = savedScheduleRows[0] ?? null;
      }

      if (scheduleId) {
        const unlinkResult = await access.db
          .from("shift_time_entries")
          .update({
            schedule_id: null,
            updated_by: access.currentUserId,
          })
          .eq("store_key", access.activeStoreKey)
          .eq("schedule_id", scheduleId);

        if (unlinkResult.error) {
          if (isMissingShiftDataError(unlinkResult.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error:
                unlinkResult.error.message ??
                "Failed to refresh prior attendance links",
            },
            { status: 500 },
          );
        }
      }

      for (const savedSchedule of savedScheduleRows) {
        const linkResult = await access.db
          .from("shift_time_entries")
          .update({
            schedule_id: savedSchedule.id,
            updated_by: access.currentUserId,
          })
          .eq("store_key", access.activeStoreKey)
          .eq("employee_id", employeeId)
          .eq("entry_date", savedSchedule.shift_date)
          .is("schedule_id", null);

        if (linkResult.error) {
          if (isMissingShiftDataError(linkResult.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error:
                linkResult.error.message ?? "Failed to link attendance records",
            },
            { status: 500 },
          );
        }
      }

      const syncEmployeeIds = [
        ...new Set(
          previousScheduleContext
            ? [employeeId, previousScheduleContext.employee_id]
            : [employeeId],
        ),
      ];
      const syncDateKeys = getUniqueSortedDateKeys(
        previousScheduleContext
          ? [previousScheduleContext.shift_date, ...scheduleDateKeys]
          : scheduleDateKeys,
      );

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: syncEmployeeIds,
        dateFrom: syncDateKeys[0],
        dateTo: syncDateKeys[syncDateKeys.length - 1],
        actorId: access.currentUserId,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error:
              syncResult.error.message ?? "Failed to refresh schedule state",
          },
          { status: 500 },
        );
      }

      if (!scheduleRow) {
        return NextResponse.json(
          { error: "Failed to load the saved shift schedule" },
          { status: 500 },
        );
      }

      if (!scheduleId && scheduleDateKeys.length > 1) {
        return NextResponse.json(
          {
            createdCount: savedScheduleRows.length,
            shiftDates: scheduleDateKeys,
          },
          { status: 201 },
        );
      }

      const linkedShiftResult = await access.db
        .from("shift_time_entries")
        .select(SHIFT_ENTRY_SELECT)
        .eq("store_key", access.activeStoreKey)
        .eq("employee_id", employeeId)
        .eq("entry_date", shiftDate)
        .order("clock_in_at", { ascending: false })
        .limit(1)
        .returns<ShiftEntryRow[]>()
        .maybeSingle();
      const openExceptionCountResult = await loadOpenExceptionCount(
        access.db,
        access.activeStoreKey,
        employeeId,
        shiftDate,
      );

      if (linkedShiftResult.error || "error" in openExceptionCountResult) {
        const error =
          linkedShiftResult.error ??
          ("error" in openExceptionCountResult
            ? openExceptionCountResult.error
            : null);

        if (isMissingShiftDataError(error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: error?.message ?? "Failed to load refreshed schedule" },
          { status: 500 },
        );
      }

      return NextResponse.json(
        mapShiftScheduleRow(
          scheduleRow,
          employee.name,
          linkedShiftResult.data ?? null,
          openExceptionCountResult.count,
          new Date().toISOString(),
        ),
        { status: 201 },
      );
    }

    const employeeId = requestedEmployeeId || access.currentUserId;

    if (!employeeId) {
      return NextResponse.json(
        { error: "employeeId is required" },
        { status: 400 },
      );
    }

    if (!isManager && employeeId !== access.currentUserId) {
      return NextResponse.json(
        { error: "You can only clock shifts for your own profile" },
        { status: 403 },
      );
    }

    const employee = await resolveEmployee(access, employeeId);

    if ("error" in employee) {
      return employee.error;
    }

    if (action === "clock_in") {
      const performedAt = toIsoTimestamp(
        typeof body.performedAt === "string" ? body.performedAt : null,
      );
      const entryDate = performedAt
        ? getDateKeyInTimeZone(performedAt, access.storeTimeZone)
        : null;

      if (!performedAt || !entryDate) {
        return NextResponse.json(
          { error: "performedAt is required for clock in" },
          { status: 400 },
        );
      }

      const { data: openShift, error: openShiftError } = await access.db
        .from("shift_time_entries")
        .select("id")
        .eq("store_key", access.activeStoreKey)
        .eq("employee_id", employeeId)
        .is("clock_out_at", null)
        .maybeSingle<{ id: string }>();

      if (openShiftError) {
        if (isMissingShiftDataError(openShiftError)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error: openShiftError.message ?? "Failed to inspect current shift",
          },
          { status: 500 },
        );
      }

      if (openShift) {
        return NextResponse.json(
          { error: `${employee.name} is already clocked in` },
          { status: 409 },
        );
      }

      const scheduleLookup = await access.db
        .from("shift_schedules")
        .select("id")
        .eq("store_key", access.activeStoreKey)
        .eq("employee_id", employeeId)
        .eq("shift_date", entryDate)
        .maybeSingle<{ id: string }>();

      if (
        scheduleLookup.error &&
        !isMissingShiftDataError(scheduleLookup.error)
      ) {
        return NextResponse.json(
          {
            error: scheduleLookup.error.message ?? "Failed to inspect schedule",
          },
          { status: 500 },
        );
      }

      const { data, error } = await access.db
        .from("shift_time_entries")
        .insert({
          store_key: access.activeStoreKey,
          employee_id: employeeId,
          entry_date: entryDate,
          clock_in_at: performedAt,
          entry_type: "automatic",
          hours_worked: 0,
          created_by: access.currentUserId,
          updated_by: access.currentUserId,
          verified_at: null,
          verified_by: null,
          schedule_id: scheduleLookup.data?.id ?? null,
        })
        .select(SHIFT_ENTRY_SELECT)
        .returns<ShiftEntryRow[]>()
        .single();

      if (error) {
        if (isMissingShiftDataError(error)) {
          return getShiftTrackingUnavailableResponse();
        }

        if (isShiftOverlapError(error)) {
          return getShiftOverlapResponse(employee.name);
        }

        if (error.code === "23505") {
          return NextResponse.json(
            { error: `${employee.name} is already clocked in` },
            { status: 409 },
          );
        }

        return NextResponse.json(
          { error: error.message ?? "Failed to clock in employee" },
          { status: 500 },
        );
      }

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: [employeeId],
        dateFrom: entryDate,
        dateTo: entryDate,
        actorId: access.currentUserId,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: syncResult.error.message ?? "Failed to refresh exceptions" },
          { status: 500 },
        );
      }

      return NextResponse.json(
        mapShiftEntryRow(data, employee.name, performedAt, 0),
        { status: 201 },
      );
    }

    return NextResponse.json(
      { error: "Unsupported shift action" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Shifts POST error:", error);
    return NextResponse.json(
      { error: "Failed to save shift entry" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "verify_entry") {
      const access = await requireShiftManagerAccess();

      if ("error" in access) {
        return access.error;
      }

      const shiftId =
        typeof body.shiftId === "string" ? body.shiftId.trim() : "";

      if (!shiftId) {
        return NextResponse.json(
          { error: "shiftId is required" },
          { status: 400 },
        );
      }

      const currentShift = await loadShiftById(
        access.db,
        access.activeStoreKey,
        shiftId,
      );

      if (currentShift.error) {
        if (isMissingShiftDataError(currentShift.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: currentShift.error.message ?? "Failed to load shift entry" },
          { status: 500 },
        );
      }

      if (!currentShift.data) {
        return NextResponse.json(
          { error: "Shift entry not found" },
          { status: 404 },
        );
      }

      const finalized = await finalizeShiftIfClear({
        db: access.db,
        storeKey: access.activeStoreKey,
        shift: currentShift.data,
        verifierId: access.currentUserId,
      });

      if ("error" in finalized) {
        return NextResponse.json({ error: finalized.error }, { status: 409 });
      }

      const employee = await resolveEmployee(
        access,
        finalized.data.employee_id,
      );

      if ("error" in employee) {
        return employee.error;
      }

      return NextResponse.json(
        mapShiftEntryRow(
          finalized.data,
          employee.name,
          finalized.data.clock_out_at ?? finalized.data.clock_in_at,
          0,
        ),
      );
    }

    if (action === "delete_schedule") {
      const access = await requireShiftManagerAccess();

      if ("error" in access) {
        return access.error;
      }

      const scheduleId =
        typeof body.scheduleId === "string" ? body.scheduleId.trim() : "";

      if (!scheduleId) {
        return NextResponse.json(
          { error: "scheduleId is required" },
          { status: 400 },
        );
      }

      const currentSchedule = await loadScheduleById(
        access.db,
        access.activeStoreKey,
        scheduleId,
      );

      if (currentSchedule.error) {
        if (isMissingShiftDataError(currentSchedule.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: currentSchedule.error.message ?? "Failed to load schedule" },
          { status: 500 },
        );
      }

      if (!currentSchedule.data) {
        return NextResponse.json(
          { error: "Schedule not found" },
          { status: 404 },
        );
      }

      const { error } = await access.db
        .from("shift_schedules")
        .delete()
        .eq("id", scheduleId)
        .eq("store_key", access.activeStoreKey);

      if (error) {
        if (isMissingShiftDataError(error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: error.message ?? "Failed to delete schedule" },
          { status: 500 },
        );
      }

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: [currentSchedule.data.employee_id],
        dateFrom: currentSchedule.data.shift_date,
        dateTo: currentSchedule.data.shift_date,
        actorId: access.currentUserId,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: syncResult.error.message ?? "Failed to refresh exceptions" },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === "resolve_exception") {
      const access = await requireShiftManagerAccess();

      if ("error" in access) {
        return access.error;
      }

      const exceptionId =
        typeof body.exceptionId === "string" ? body.exceptionId.trim() : "";
      const resolution = body.resolution === "ignored" ? "ignored" : "resolved";
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;
      const requestedStartTime =
        typeof body.startTime === "string" && body.startTime.trim().length > 0
          ? body.startTime.trim()
          : null;
      const requestedEndTime =
        typeof body.endTime === "string" && body.endTime.trim().length > 0
          ? body.endTime.trim()
          : null;
      let startAt = toIsoTimestamp(
        typeof body.startAt === "string" ? body.startAt : null,
      );
      let endAt = toIsoTimestamp(
        typeof body.endAt === "string" ? body.endAt : null,
      );
      const shouldVerify = body.verifyShift === true;

      if (!exceptionId) {
        return NextResponse.json(
          { error: "exceptionId is required" },
          { status: 400 },
        );
      }

      const currentException = await loadExceptionById(
        access.db,
        access.activeStoreKey,
        exceptionId,
      );

      if (currentException.error) {
        if (isMissingShiftDataError(currentException.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error: currentException.error.message ?? "Failed to load exception",
          },
          { status: 500 },
        );
      }

      if (!currentException.data) {
        return NextResponse.json(
          { error: "Attendance exception not found" },
          { status: 404 },
        );
      }

      const exception = currentException.data;
      let shiftRow: ShiftEntryRow | null = null;

      if (exception.shift_entry_id) {
        const linkedShift = await loadShiftById(
          access.db,
          access.activeStoreKey,
          exception.shift_entry_id,
        );

        if (linkedShift.error) {
          if (isMissingShiftDataError(linkedShift.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error: linkedShift.error.message ?? "Failed to load linked shift",
            },
            { status: 500 },
          );
        }

        shiftRow = linkedShift.data ?? null;
      }

      if (!shiftRow) {
        const fallbackShift = await access.db
          .from("shift_time_entries")
          .select(SHIFT_ENTRY_SELECT)
          .eq("store_key", access.activeStoreKey)
          .eq("employee_id", exception.employee_id)
          .eq("entry_date", exception.exception_date)
          .order("clock_in_at", { ascending: false })
          .limit(1)
          .returns<ShiftEntryRow[]>()
          .maybeSingle();

        if (fallbackShift.error) {
          if (isMissingShiftDataError(fallbackShift.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            {
              error:
                fallbackShift.error.message ?? "Failed to load shift entry",
            },
            { status: 500 },
          );
        }

        shiftRow = fallbackShift.data ?? null;
      }

      if (requestedStartTime || requestedEndTime) {
        const effectiveStartTime =
          requestedStartTime ??
          (shiftRow
            ? toTimeInputValueInTimeZone(
                shiftRow.clock_in_at,
                access.storeTimeZone,
              )
            : "");
        const effectiveEndTime =
          requestedEndTime ??
          (shiftRow?.clock_out_at
            ? toTimeInputValueInTimeZone(
                shiftRow.clock_out_at,
                access.storeTimeZone,
              )
            : "");

        if (!effectiveStartTime || (!shiftRow && !effectiveEndTime)) {
          return NextResponse.json(
            {
              error:
                "Both startTime and endTime are required when creating a corrected shift",
            },
            { status: 400 },
          );
        }

        startAt = convertStoreLocalDateTimeToIso(
          exception.exception_date,
          effectiveStartTime,
          access.storeTimeZone,
        );
        endAt = effectiveEndTime
          ? convertStoreLocalDateTimeToIso(
              getEndDateKeyForShift(
                exception.exception_date,
                effectiveStartTime,
                effectiveEndTime,
              ),
              effectiveEndTime,
              access.storeTimeZone,
            )
          : null;
      }

      if (resolution === "resolved" && (startAt || endAt)) {
        if (!shiftRow && (!startAt || !endAt)) {
          return NextResponse.json(
            {
              error:
                "Both start and end times are required when creating a corrected shift",
            },
            { status: 400 },
          );
        }

        if (shiftRow) {
          const nextClockIn = startAt ?? shiftRow.clock_in_at;
          const nextClockOut = endAt ?? shiftRow.clock_out_at;

          if (
            nextClockOut &&
            new Date(nextClockOut).getTime() <= new Date(nextClockIn).getTime()
          ) {
            return NextResponse.json(
              { error: "Corrected end time must be after the start time" },
              { status: 400 },
            );
          }

          const { data, error } = await access.db
            .from("shift_time_entries")
            .update({
              clock_in_at: nextClockIn,
              clock_out_at: nextClockOut,
              hours_worked: nextClockOut
                ? calculateDurationHours(nextClockIn, nextClockOut)
                : 0,
              schedule_id: exception.schedule_id ?? shiftRow.schedule_id,
              updated_by: access.currentUserId,
              verified_at: null,
              verified_by: null,
            })
            .eq("id", shiftRow.id)
            .eq("store_key", access.activeStoreKey)
            .select(SHIFT_ENTRY_SELECT)
            .returns<ShiftEntryRow[]>()
            .single();

          if (error) {
            if (isMissingShiftDataError(error)) {
              return getShiftTrackingUnavailableResponse();
            }

            if (isShiftOverlapError(error)) {
              const employee = await resolveEmployee(
                access,
                exception.employee_id,
              );
              return "error" in employee
                ? employee.error
                : getShiftOverlapResponse(employee.name);
            }

            return NextResponse.json(
              { error: error.message ?? "Failed to update corrected shift" },
              { status: 500 },
            );
          }

          shiftRow = data;
        } else {
          const { data, error } = await access.db
            .from("shift_time_entries")
            .insert({
              store_key: access.activeStoreKey,
              employee_id: exception.employee_id,
              entry_date: exception.exception_date,
              clock_in_at: startAt,
              clock_out_at: endAt,
              hours_worked: calculateDurationHours(startAt!, endAt!),
              entry_type: "automatic",
              notes: `Created while resolving ${exception.title.toLowerCase()}.`,
              created_by: access.currentUserId,
              updated_by: access.currentUserId,
              verified_at: null,
              verified_by: null,
              schedule_id: exception.schedule_id,
            })
            .select(SHIFT_ENTRY_SELECT)
            .returns<ShiftEntryRow[]>()
            .single();

          if (error) {
            if (isMissingShiftDataError(error)) {
              return getShiftTrackingUnavailableResponse();
            }

            if (isShiftOverlapError(error)) {
              const employee = await resolveEmployee(
                access,
                exception.employee_id,
              );
              return "error" in employee
                ? employee.error
                : getShiftOverlapResponse(employee.name);
            }

            return NextResponse.json(
              { error: error.message ?? "Failed to create corrected shift" },
              { status: 500 },
            );
          }

          shiftRow = data;
        }
      } else if (
        resolution === "resolved" &&
        exception.schedule_id &&
        shiftRow &&
        !shiftRow.schedule_id
      ) {
        const { data, error } = await access.db
          .from("shift_time_entries")
          .update({
            schedule_id: exception.schedule_id,
            updated_by: access.currentUserId,
            verified_at: null,
            verified_by: null,
          })
          .eq("id", shiftRow.id)
          .eq("store_key", access.activeStoreKey)
          .select(SHIFT_ENTRY_SELECT)
          .returns<ShiftEntryRow[]>()
          .single();

        if (error) {
          if (isMissingShiftDataError(error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            { error: error.message ?? "Failed to link corrected shift" },
            { status: 500 },
          );
        }

        shiftRow = data;
      }

      const resolvedAt = new Date().toISOString();
      const { error: exceptionUpdateError } = await access.db
        .from("attendance_exceptions")
        .update({
          status: resolution,
          resolution_notes: notes,
          resolved_at: resolvedAt,
          resolved_by: access.currentUserId,
          updated_by: access.currentUserId,
          shift_entry_id: shiftRow?.id ?? exception.shift_entry_id,
        })
        .eq("id", exceptionId)
        .eq("store_key", access.activeStoreKey);

      if (exceptionUpdateError) {
        if (isMissingShiftDataError(exceptionUpdateError)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          {
            error: exceptionUpdateError.message ?? "Failed to update exception",
          },
          { status: 500 },
        );
      }

      const syncResult = await maybeSyncAttendanceWindow({
        access,
        employeeIds: [exception.employee_id],
        dateFrom: exception.exception_date,
        dateTo: exception.exception_date,
        actorId: access.currentUserId,
      });

      if ("error" in syncResult && syncResult.error) {
        if (isMissingShiftDataError(syncResult.error)) {
          return getShiftTrackingUnavailableResponse();
        }

        return NextResponse.json(
          { error: syncResult.error.message ?? "Failed to refresh exceptions" },
          { status: 500 },
        );
      }

      let verifiedShift: ShiftEntryRow | null = shiftRow;

      if (shouldVerify && verifiedShift) {
        const latestShift = await loadShiftById(
          access.db,
          access.activeStoreKey,
          verifiedShift.id,
        );

        if (latestShift.error) {
          if (isMissingShiftDataError(latestShift.error)) {
            return getShiftTrackingUnavailableResponse();
          }

          return NextResponse.json(
            { error: latestShift.error.message ?? "Failed to reload shift" },
            { status: 500 },
          );
        }

        if (latestShift.data) {
          const finalized = await finalizeShiftIfClear({
            db: access.db,
            storeKey: access.activeStoreKey,
            shift: latestShift.data,
            verifierId: access.currentUserId,
          });

          if (!("error" in finalized)) {
            verifiedShift = finalized.data;
          } else {
            return NextResponse.json(
              {
                error: `Exception was resolved, but the shift could not be finalized: ${finalized.error}`,
                shiftId: latestShift.data.id,
                exceptionResolved: true,
              },
              { status: 409 },
            );
          }
        }
      }

      return NextResponse.json({
        success: true,
        shiftId: verifiedShift?.id ?? null,
      });
    }

    const access = await getShiftAccessContext();

    if ("error" in access) {
      return access.error;
    }

    const employeeId =
      typeof body.employeeId === "string" && body.employeeId.trim().length > 0
        ? body.employeeId.trim()
        : access.currentUserId;
    const isManager = canAccessPath(
      "/admin/shift-management",
      access.currentUserRole,
      access.currentUserPermissions,
    );

    if (action !== "clock_out") {
      return NextResponse.json(
        { error: "Unsupported shift action" },
        { status: 400 },
      );
    }

    if (!isManager && employeeId !== access.currentUserId) {
      return NextResponse.json(
        { error: "You can only clock shifts for your own profile" },
        { status: 403 },
      );
    }

    const performedAt = toIsoTimestamp(
      typeof body.performedAt === "string" ? body.performedAt : null,
    );

    if (!performedAt) {
      return NextResponse.json(
        { error: "performedAt is required for clock out" },
        { status: 400 },
      );
    }

    const employee = await resolveEmployee(access, employeeId);

    if ("error" in employee) {
      return employee.error;
    }

    const openShift = await access.db
      .from("shift_time_entries")
      .select(SHIFT_ENTRY_SELECT)
      .eq("store_key", access.activeStoreKey)
      .eq("employee_id", employeeId)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .returns<ShiftEntryRow[]>()
      .maybeSingle();

    if (openShift.error) {
      if (isMissingShiftDataError(openShift.error)) {
        return getShiftTrackingUnavailableResponse();
      }

      return NextResponse.json(
        { error: openShift.error.message ?? "Failed to load open shift" },
        { status: 500 },
      );
    }

    if (!openShift.data) {
      return NextResponse.json(
        { error: `${employee.name} is not currently clocked in` },
        { status: 409 },
      );
    }

    if (
      new Date(performedAt).getTime() <=
      new Date(openShift.data.clock_in_at).getTime()
    ) {
      return NextResponse.json(
        { error: "Clock-out time must be after clock-in time" },
        { status: 400 },
      );
    }

    const { data, error } = await access.db
      .from("shift_time_entries")
      .update({
        clock_out_at: performedAt,
        hours_worked: calculateDurationHours(
          openShift.data.clock_in_at,
          performedAt,
        ),
        updated_by: access.currentUserId,
        verified_at: null,
        verified_by: null,
      })
      .eq("id", openShift.data.id)
      .eq("store_key", access.activeStoreKey)
      .select(SHIFT_ENTRY_SELECT)
      .returns<ShiftEntryRow[]>()
      .single();

    if (error) {
      if (isMissingShiftDataError(error)) {
        return getShiftTrackingUnavailableResponse();
      }

      if (isShiftOverlapError(error)) {
        return getShiftOverlapResponse(employee.name);
      }

      return NextResponse.json(
        { error: error.message ?? "Failed to clock out employee" },
        { status: 500 },
      );
    }

    const syncResult = await maybeSyncAttendanceWindow({
      access,
      employeeIds: [employeeId],
      dateFrom: data.entry_date,
      dateTo: data.entry_date,
      actorId: access.currentUserId,
    });

    if ("error" in syncResult && syncResult.error) {
      if (isMissingShiftDataError(syncResult.error)) {
        return getShiftTrackingUnavailableResponse();
      }

      return NextResponse.json(
        { error: syncResult.error.message ?? "Failed to refresh exceptions" },
        { status: 500 },
      );
    }

    const openExceptionCountResult = await loadOpenExceptionCount(
      access.db,
      access.activeStoreKey,
      employeeId,
      data.entry_date,
    );

    if ("error" in openExceptionCountResult) {
      if (isMissingShiftDataError(openExceptionCountResult.error)) {
        return getShiftTrackingUnavailableResponse();
      }

      return NextResponse.json(
        {
          error:
            openExceptionCountResult.error?.message ??
            "Failed to load exceptions",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      mapShiftEntryRow(
        data,
        employee.name,
        performedAt,
        openExceptionCountResult.count,
      ),
    );
  } catch (error) {
    console.error("Shifts PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update shift entry" },
      { status: 500 },
    );
  }
}
