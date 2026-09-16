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
  SelfShiftPayload,
  ShiftEmployeeRecord,
  ShiftEntry,
  ShiftSchedule,
} from "@/lib/shifts/shared";
import { getDateKeyInTimeZone } from "@/lib/shifts/shared";

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
  const [isLoading, setIsLoading] = useState(true);
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
        return;
      }

      setEmployee(null);
      setShifts([]);
      setSchedules([]);
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
        label: "Finalized Shifts",
        value: `${finalizedCount}`,
        change: "Manager verified",
        detail: "completed shift records",
        tone: "green" as const,
      },
    ],
    [
      actionFormatter,
      finalizedCount,
      nextSchedule,
      todaySchedules,
    ],
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
          title="Shift Overview"
          description="Review your published schedule and completed shift records."
        >
          <div className="rounded-[24px] border border-stroke bg-gray-2/60 p-5 dark:border-dark-3 dark:bg-dark-2">
            <div>
              <div>
                <h2 className="mt-3 text-2xl font-bold text-dark dark:text-white">
                  {employee?.name ?? "Your shift"}
                </h2>
                <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                  {employee
                    ? formatRoleLabel(employee.role)
                    : "Loading your shift profile"}
                </p>
              </div>
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
                    ? "Your manager records completed shift time against this published schedule."
                    : "No shift has been published for today."}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-4 dark:bg-dark">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-dark-5 dark:text-dark-6">
                  Payroll Rule
                </div>
                <div className="mt-2 text-lg font-semibold text-dark dark:text-white">
                  Manager-recorded time
                </div>
                <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                  Completed shifts are reviewed and finalized by management
                  before payroll is processed.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Manager Review"
          description="Shift time is entered and finalized by management; there are no employee clock controls."
        >
          <div className="rounded-2xl border border-green/20 bg-green/10 p-4 text-sm text-green">
            Your published shifts and manager-recorded hours will appear here
            once they are available.
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

      </div>
    </>
  );
}
