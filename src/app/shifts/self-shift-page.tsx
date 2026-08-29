"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAppNotifications } from "@/contexts/NotificationContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AttendanceException,
  SelfShiftPayload,
  ShiftEmployeeRecord,
  ShiftEntry,
  ShiftSchedule,
} from "@/lib/shifts/shared";
import { getDateKeyInTimeZone } from "@/lib/shifts/shared";
import { AlertTriangle, LogIn, LogOut } from "lucide-react";

function getTodayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateKeyLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  return dateFormatter.format(new Date(year, month - 1, day));
}

function formatRoleLabel(role: string) {
  return role
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isSelfShiftPayload(payload: unknown): payload is SelfShiftPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return (
    "employee" in payload &&
    "shifts" in payload &&
    "schedules" in payload &&
    "exceptions" in payload
  );
}

function getVerificationTone(shift: ShiftEntry) {
  if (shift.verificationStatus === "verified") {
    return "green" as const;
  }

  if (shift.verificationStatus === "needs_attention") {
    return "red" as const;
  }

  if (shift.verificationStatus === "pending") {
    return "amber" as const;
  }

  return "slate" as const;
}

function getVerificationLabel(shift: ShiftEntry) {
  if (shift.verificationStatus === "verified") {
    return "Finalized";
  }

  if (shift.verificationStatus === "needs_attention") {
    return "Needs Attention";
  }

  if (shift.verificationStatus === "pending") {
    return "Awaiting Review";
  }

  return "Open Shift";
}

function getScheduleTone(schedule: ShiftSchedule) {
  if (schedule.status === "finalized") {
    return "green" as const;
  }

  if (schedule.status === "missed") {
    return "red" as const;
  }

  if (schedule.status === "awaiting_review") {
    return "amber" as const;
  }

  if (schedule.status === "in_progress") {
    return "blue" as const;
  }

  return "slate" as const;
}

function getScheduleLabel(schedule: ShiftSchedule) {
  if (schedule.status === "finalized") {
    return "Finalized";
  }

  if (schedule.status === "missed") {
    return "Missed";
  }

  if (schedule.status === "awaiting_review") {
    return "Awaiting Review";
  }

  if (schedule.status === "in_progress") {
    return "In Progress";
  }

  return "Scheduled";
}

function getExceptionTone(exception: AttendanceException) {
  if (exception.status === "resolved") {
    return "green" as const;
  }

  if (exception.status === "ignored") {
    return "slate" as const;
  }

  return exception.severity === "critical"
    ? ("red" as const)
    : ("amber" as const);
}

function getExceptionLabel(exception: AttendanceException) {
  if (exception.status === "resolved") {
    return "Resolved";
  }

  if (exception.status === "ignored") {
    return "Ignored";
  }

  return exception.title;
}

function formatExceptionDetail(
  exception: AttendanceException,
  actionFormatter: Intl.DateTimeFormat,
  timeFormatter: Intl.DateTimeFormat,
) {
  // Prefer structured timestamps when available so client can localize
  const { type, scheduleStartAt, scheduleEndAt, shiftStartAt, shiftEndAt, detail } = exception as any;

  const fmtTime = (iso?: string) => (iso ? timeFormatter.format(new Date(iso)) : "");
  const fmtAction = (iso?: string) => (iso ? actionFormatter.format(new Date(iso)) : "");

  switch (type) {
    case "missed_clock_in":
      if (scheduleStartAt && scheduleEndAt) {
        return `No shift was started for the scheduled window ${fmtTime(
          scheduleStartAt,
        )} to ${fmtTime(scheduleEndAt)}.`;
      }
      break;
    case "missed_clock_out":
      if (scheduleEndAt) {
        return `The shift is still open after the scheduled end at ${fmtTime(
          scheduleEndAt,
        )}.`;
      }
      break;
    case "late_start":
      if (shiftStartAt && scheduleStartAt) {
        return `Clock-in at ${fmtTime(shiftStartAt)} landed after the scheduled start of ${fmtTime(
          scheduleStartAt,
        )}.`;
      }
      break;
    case "early_finish":
      if (shiftEndAt && scheduleEndAt) {
        return `Clock-out at ${fmtTime(shiftEndAt)} landed before the scheduled end of ${fmtTime(
          scheduleEndAt,
        )}.`;
      }
      break;
    case "unscheduled_shift":
      if (shiftStartAt) {
        return `Attendance was recorded without a published schedule for that day. First record at ${fmtTime(
          shiftStartAt,
        )}.`;
      }
      break;
    case "overtime":
      // Keep server-provided detail if available for complex messages
      break;
    default:
      break;
  }

  return detail ?? "";
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function SelfShiftPage() {
  const { notify } = useAppNotifications();
  const [timeZone, setTimeZone] = useState("America/New_York");
  const todayKey = useMemo(
    () => getDateKeyInTimeZone(new Date(), timeZone) ?? getTodayKey(),
    [timeZone],
  );
  const [employee, setEmployee] = useState<ShiftEmployeeRecord | null>(null);
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);
  const [schedules, setSchedules] = useState<ShiftSchedule[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }),
    [timeZone],
  );
  const actionFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }),
    [timeZone],
  );

  const showNotify = useCallback(
    (type: "success" | "error", message: string) => {
      notify({ type, message, durationMs: 3000 });
    },
    [notify],
  );

  const loadShiftData = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/shifts?scope=self", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | SelfShiftPayload
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Failed to load your shift data",
        );
      }

      if (isSelfShiftPayload(payload)) {
        if (typeof payload.timeZone === "string" && payload.timeZone.length > 0) {
          setTimeZone(payload.timeZone);
        }
        setEmployee(payload.employee);
        setShifts(payload.shifts);
        setSchedules(payload.schedules);
        setExceptions(payload.exceptions);
        return;
      }

      setEmployee(null);
      setShifts([]);
      setSchedules([]);
      setExceptions([]);
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to load your shift data",
      );
    } finally {
      setIsLoading(false);
    }
  }, [showNotify]);

  useEffect(() => {
    void loadShiftData();
  }, [loadShiftData]);

  const currentOpenShift = useMemo(
    () => shifts.find((shift) => shift.isOpen) ?? null,
    [shifts],
  );
  const openExceptions = useMemo(
    () => exceptions.filter((exception) => exception.status === "open"),
    [exceptions],
  );
  const todaySchedules = useMemo(
    () => schedules.filter((schedule) => schedule.date === todayKey),
    [schedules, todayKey],
  );
  const nextSchedule = useMemo(
    () =>
      schedules.find(
        (schedule) =>
          schedule.status === "scheduled" || schedule.status === "in_progress",
      ) ?? null,
    [schedules],
  );
  const finalizedCount = useMemo(
    () =>
      shifts.filter((shift) => shift.verificationStatus === "verified").length,
    [shifts],
  );

  const metrics = useMemo(
    () => [
      {
        label: "Current Status",
        value: employee?.status === "clocked_in" ? "Clocked In" : "Clocked Out",
        change: employee?.lastActionAt
          ? actionFormatter.format(new Date(employee.lastActionAt))
          : "No activity",
        detail: employee ? formatRoleLabel(employee.role) : "Shift tracking",
        tone:
          employee?.status === "clocked_in"
            ? ("green" as const)
            : ("slate" as const),
      },
      {
        label: "Today's Schedule",
        value:
          todaySchedules.length > 0
            ? `${todaySchedules.length} planned`
            : "No shift",
        change:
          nextSchedule && todaySchedules.length === 0
            ? actionFormatter.format(new Date(nextSchedule.startAt))
            : "Today",
        detail:
          todaySchedules.length > 0
            ? `${todaySchedules[0]?.breakMinutes ?? 0} min break on first shift`
            : nextSchedule
              ? "next scheduled start"
              : "no published shift yet",
        tone:
          todaySchedules.length > 0 ? ("blue" as const) : ("slate" as const),
      },
      {
        label: "Open Exceptions",
        value: `${openExceptions.length}`,
        change: `${finalizedCount} finalized`,
        detail: "manager review blocks payroll finalization",
        tone:
          openExceptions.length > 0 ? ("amber" as const) : ("green" as const),
      },
    ],
    [
      actionFormatter,
      employee,
      finalizedCount,
      nextSchedule,
      openExceptions.length,
      todaySchedules,
    ],
  );

  const handleShiftAction = useCallback(
    async (action: "clock_in" | "clock_out") => {
      setIsSubmitting(true);

      try {
        const now = new Date();
        const response = await fetch("/api/shifts", {
          method: action === "clock_in" ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            action === "clock_in"
              ? {
                  action,
                  performedAt: now.toISOString(),
                }
              : {
                  action,
                  performedAt: now.toISOString(),
                },
          ),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            payload?.error ?? `Failed to ${action.replace("_", " ")}`,
          );
        }

        await loadShiftData();
        showNotify(
          "success",
          action === "clock_in"
            ? "You clocked in successfully"
            : "You clocked out successfully",
        );
      } catch (error) {
        console.error(error);
        showNotify(
          "error",
          error instanceof Error
            ? error.message
            : "Failed to update your shift",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [loadShiftData, showNotify],
  );

  return (
    <>
      <Breadcrumb pageName="My Shift" />

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <SectionCard
          title="Shift Controls"
          description="Clock in and out against your scheduled shifts. Finalized attendance feeds payroll once review is complete."
        >
          <div className="rounded-[24px] border border-stroke bg-gray-2/60 p-5 dark:border-dark-3 dark:bg-dark-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <StatusBadge
                  tone={employee?.status === "clocked_in" ? "green" : "slate"}
                >
                  {employee?.status === "clocked_in"
                    ? "Clocked In"
                    : "Clocked Out"}
                </StatusBadge>
                <h2 className="mt-3 text-2xl font-bold text-dark dark:text-white">
                  {employee?.name ?? "Your shift"}
                </h2>
                <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                  {employee
                    ? formatRoleLabel(employee.role)
                    : "Loading your shift profile"}
                </p>
              </div>
              <button
                onClick={() =>
                  void handleShiftAction(
                    employee?.status === "clocked_in"
                      ? "clock_out"
                      : "clock_in",
                  )
                }
                disabled={isSubmitting || isLoading || !employee}
                className={`inline-flex min-w-[148px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  employee?.status === "clocked_in"
                    ? "bg-red hover:bg-red/90"
                    : "bg-green hover:bg-green/90"
                }`}
              >
                {employee?.status === "clocked_in" ? (
                  <LogOut className="h-4 w-4" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {isSubmitting
                  ? "Saving..."
                  : employee?.status === "clocked_in"
                    ? "Clock Out"
                    : "Clock In"}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-white px-4 py-4 dark:bg-dark">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-dark-5 dark:text-dark-6">
                  Scheduled Window
                </div>
                <div className="mt-2 text-lg font-semibold text-dark dark:text-white">
                  {todaySchedules.length > 0
                    ? `${timeFormatter.format(new Date(todaySchedules[0].startAt))} to ${timeFormatter.format(
                        new Date(todaySchedules[0].endAt),
                      )}`
                    : nextSchedule
                      ? `Next at ${timeFormatter.format(new Date(nextSchedule.startAt))}`
                      : "No shift published"}
                </div>
                <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                  {todaySchedules.length > 0
                    ? "Use the live clock controls against your scheduled shift for the cleanest attendance record."
                    : "If you are working today without a schedule, managers will see that as an exception."}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-4 dark:bg-dark">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-dark-5 dark:text-dark-6">
                  Payroll Rule
                </div>
                <div className="mt-2 text-lg font-semibold text-dark dark:text-white">
                  Finalized attendance only
                </div>
                <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                  Closed shifts stay out of payroll until managers clear any
                  open attendance exceptions and finalize the record.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Attendance Queue"
          description="Open exceptions or unfinished shifts stay visible here until management clears them."
        >
          <div className="space-y-4">
            <div
              className={`rounded-2xl border p-4 ${
                openExceptions.length > 0
                  ? "border-amber/20 bg-amber/10"
                  : "border-green/20 bg-green/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className={`mt-0.5 h-5 w-5 ${
                    openExceptions.length > 0 ? "text-amber" : "text-green"
                  }`}
                />
                <div>
                  <h3
                    className={`text-sm font-semibold ${
                      openExceptions.length > 0 ? "text-amber" : "text-green"
                    }`}
                  >
                    {openExceptions.length > 0
                      ? "Manager follow-up needed"
                      : "Queue is clear"}
                  </h3>
                  <p
                    className={`mt-1 text-sm ${
                      openExceptions.length > 0
                        ? "text-amber/80"
                        : "text-green/80"
                    }`}
                  >
                    {openExceptions.length > 0
                      ? `${openExceptions.length} attendance issue${openExceptions.length === 1 ? "" : "s"} are still open.`
                      : "No open attendance exceptions are blocking payroll finalization."}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-dark-5 dark:text-dark-6">
                Last activity
              </div>
              <div className="mt-2 text-lg font-semibold text-dark dark:text-white">
                {employee?.lastActionAt
                  ? actionFormatter.format(new Date(employee.lastActionAt))
                  : "No recent shift action"}
              </div>
              <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                {currentOpenShift
                  ? "Your active shift is live right now. Clock out at the end of work so it can move into review."
                  : "Finished shifts move from pending review to finalized once managers clear the queue."}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Scheduled Shifts"
          description="Your recent and upcoming published shifts."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Break</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading your scheduled shifts...
                    </TableCell>
                  </TableRow>
                ) : schedules.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      No published shifts are available yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="text-sm font-medium text-dark-5 dark:text-dark-6">
                        {formatDateKeyLabel(schedule.date)}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {timeFormatter.format(new Date(schedule.startAt))}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {timeFormatter.format(new Date(schedule.endAt))}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {schedule.breakMinutes} min
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getScheduleTone(schedule)}>
                          {getScheduleLabel(schedule)}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Attendance History"
          description="Closed shifts move from review into finalized attendance. Manager-entered manual rows stay visible here with their verification status."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading your attendance history...
                    </TableCell>
                  </TableRow>
                ) : shifts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      No attendance history is available yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  shifts.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell className="text-sm font-medium text-dark-5 dark:text-dark-6">
                        {formatDateKeyLabel(shift.date)}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {shift.type === "manual" ? "Manual" : "Attendance"}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {timeFormatter.format(new Date(shift.clockInAt))}
                      </TableCell>
                      <TableCell className="text-sm text-dark dark:text-white">
                        {shift.clockOutAt
                          ? timeFormatter.format(new Date(shift.clockOutAt))
                          : "In progress"}
                      </TableCell>
                      <TableCell className="font-semibold text-primary">
                        {shift.hours.toFixed(2)}h
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge tone={getVerificationTone(shift)}>
                            {getVerificationLabel(shift)}
                          </StatusBadge>
                          {shift.verifiedAt ? (
                            <div className="text-xs text-dark-5 dark:text-dark-6">
                              {actionFormatter.format(
                                new Date(shift.verifiedAt),
                              )}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Exception History"
          description="These are the attendance issues managers review when a shift does not line up with the schedule."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading attendance exceptions...
                    </TableCell>
                  </TableRow>
                ) : exceptions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      No attendance exceptions are on record.
                    </TableCell>
                  </TableRow>
                ) : (
                  exceptions.map((exception) => (
                    <TableRow key={exception.id}>
                      <TableCell className="text-sm font-medium text-dark-5 dark:text-dark-6">
                        {formatDateKeyLabel(exception.date)}
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-dark dark:text-white">
                        {exception.title}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getExceptionTone(exception)}>
                          {getExceptionLabel(exception)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                        {formatExceptionDetail(exception, actionFormatter, timeFormatter)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
