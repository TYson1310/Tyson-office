"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ModalPortal } from "@/components/ui/modal-portal";
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
  ShiftEmployeeRecord,
  ShiftEntry,
  ShiftPayload,
  ShiftSchedule,
} from "@/lib/shifts/shared";
import {
  calculateLocalTimeRangeHours,
  crossesMidnight,
  getDateKeyInTimeZone,
  toTimeInputValueInTimeZone,
} from "@/lib/shifts/shared";
import {
  CalendarDays,
  CheckCircle2,
  LogIn,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

type ScheduleFormState = {
  scheduleId: string | null;
  employeeId: string;
  shiftDate: string;
  endDate: string;
  isRecurring: boolean;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  notes: string;
  repeatWeekdays: number[];
};

type ResolutionFormState = {
  exceptionId: string | null;
  employeeId: string;
  exceptionDate: string;
  resolution: "resolved" | "ignored";
  startTime: string;
  endTime: string;
  notes: string;
  verifyShift: boolean;
};

type ManualEntryFormState = {
  employeeId: string;
  entryDate: string;
  endDate: string;
  isRecurring: boolean;
  startTime: string;
  endTime: string;
  notes: string;
  repeatWeekdays: number[];
};

type LedgerFilter = "all" | "live" | "pending" | "verified" | "paid";
type LedgerHistoryRange = "30" | "90" | "180" | "365" | "all";
type LedgerSourceFilter = "all" | ShiftEntry["type"];

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];
const LEDGER_HISTORY_OPTIONS: Array<{
  label: string;
  value: LedgerHistoryRange;
}> = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last year" },
  { value: "all", label: "All history" },
];
const INPUT_CLASSNAME = "app-input";

function getTodayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatRoleLabel(role: string) {
  return role
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateKeyLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  return dateFormatter.format(new Date(year, month - 1, day));
}

function getDateKeyWeekday(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function getDefaultRepeatWeekdays(dateKey: string) {
  const weekday = getDateKeyWeekday(dateKey);
  return weekday === null ? [1] : [weekday];
}

function listDateKeysBetween(startDate: string, endDate: string) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);

  if (
    !startYear ||
    !startMonth ||
    !startDay ||
    !endYear ||
    !endMonth ||
    !endDay
  ) {
    return [];
  }

  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() < start.getTime()
  ) {
    return [];
  }

  const dateKeys: string[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    dateKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dateKeys;
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = getKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isShiftPayload(payload: unknown): payload is ShiftPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return (
    "employees" in payload &&
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

function createDefaultScheduleForm(todayKey: string): ScheduleFormState {
  return {
    scheduleId: null,
    employeeId: "",
    shiftDate: todayKey,
    endDate: todayKey,
    isRecurring: false,
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    breakMinutes: "0",
    notes: "",
    repeatWeekdays: getDefaultRepeatWeekdays(todayKey),
  };
}

function createDefaultResolutionForm(): ResolutionFormState {
  return {
    exceptionId: null,
    employeeId: "",
    exceptionDate: "",
    resolution: "resolved",
    startTime: "",
    endTime: "",
    notes: "",
    verifyShift: true,
  };
}

function createDefaultManualEntryForm(todayKey: string): ManualEntryFormState {
  return {
    employeeId: "",
    entryDate: todayKey,
    endDate: todayKey,
    isRecurring: false,
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    notes: "",
    repeatWeekdays: getDefaultRepeatWeekdays(todayKey),
  };
}

export default function ShiftManagementPage() {
  const { notify } = useAppNotifications();
  const [timeZone, setTimeZone] = useState("America/New_York");
  const todayKey = useMemo(
    () => getDateKeyInTimeZone(new Date(), timeZone) ?? getTodayKey(),
    [timeZone],
  );
  const [employees, setEmployees] = useState<ShiftEmployeeRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);
  const [schedules, setSchedules] = useState<ShiftSchedule[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [activeExceptionId, setActiveExceptionId] = useState<string | null>(
    null,
  );
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isResolutionModalOpen, setIsResolutionModalOpen] = useState(false);
  const [isManualEntryModalOpen, setIsManualEntryModalOpen] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [ledgerHistoryRange, setLedgerHistoryRange] =
    useState<LedgerHistoryRange>("90");
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState("");
  const [ledgerSourceFilter, setLedgerSourceFilter] =
    useState<LedgerSourceFilter>("all");
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() =>
    createDefaultScheduleForm(todayKey),
  );
  const [resolutionForm, setResolutionForm] = useState<ResolutionFormState>(
    createDefaultResolutionForm,
  );
  const [manualEntryForm, setManualEntryForm] = useState<ManualEntryFormState>(
    () => createDefaultManualEntryForm(todayKey),
  );
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
    setIsLoadingData(true);

    try {
      const params = new URLSearchParams();

      if (ledgerHistoryRange === "all") {
        params.set("history", "all");
      } else {
        params.set("historyDays", ledgerHistoryRange);
      }

      const response = await fetch(`/api/shifts?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | ShiftPayload
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Failed to load shift tracking data",
        );
      }

      if (isShiftPayload(payload)) {
        if (
          typeof payload.timeZone === "string" &&
          payload.timeZone.length > 0
        ) {
          setTimeZone(payload.timeZone);
        }
        setEmployees(payload.employees);
        setShifts(payload.shifts);
        setSchedules(payload.schedules);
        setExceptions(payload.exceptions);
        return;
      }

      setEmployees([]);
      setShifts([]);
      setSchedules([]);
      setExceptions([]);
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to load shift tracking data",
      );
    } finally {
      setIsLoadingData(false);
    }
  }, [ledgerHistoryRange, showNotify]);

  useEffect(() => {
    void loadShiftData();
  }, [loadShiftData]);

  const dedupedShifts = useMemo(
    () => dedupeByKey(shifts, (shift) => shift.id),
    [shifts],
  );

  const dedupedExceptions = useMemo(
    () =>
      dedupeByKey(exceptions, (exception) =>
        [
          exception.employeeId,
          exception.date,
          exception.type,
          exception.status,
          exception.shiftId ?? "",
          exception.scheduleId ?? "",
          exception.detail,
          exception.resolvedAt ?? "",
        ].join("|"),
      ),
    [exceptions],
  );

  const filteredEmployees = useMemo(
    () =>
      employees.filter(
        (employee) =>
          employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          employee.role.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [employees, searchTerm],
  );

  const openExceptions = useMemo(
    () => dedupedExceptions.filter((exception) => exception.status === "open"),
    [dedupedExceptions],
  );

  const visibleSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.status !== "finalized"),
    [schedules],
  );

  const scheduledTodayCountByEmployee = useMemo(() => {
    const counts = new Map<string, number>();

    visibleSchedules
      .filter((schedule) => schedule.date === todayKey)
      .forEach((schedule) => {
        counts.set(
          schedule.employeeId,
          (counts.get(schedule.employeeId) ?? 0) + 1,
        );
      });

    return counts;
  }, [todayKey, visibleSchedules]);

  const openExceptionCountByEmployee = useMemo(() => {
    const counts = new Map<string, number>();

    openExceptions.forEach((exception) => {
      counts.set(
        exception.employeeId,
        (counts.get(exception.employeeId) ?? 0) + 1,
      );
    });

    return counts;
  }, [openExceptions]);

  const ledgerCounts = useMemo(
    () => ({
      all: dedupedShifts.length,
      live: dedupedShifts.filter((shift) => shift.isOpen).length,
      pending: dedupedShifts.filter(
        (shift) =>
          shift.isOpen ||
          shift.verificationStatus === "pending" ||
          shift.verificationStatus === "needs_attention",
      ).length,
      verified: dedupedShifts.filter(
        (shift) =>
          shift.verificationStatus === "verified" &&
          shift.payrollStatus !== "paid",
      ).length,
      paid: dedupedShifts.filter((shift) => shift.payrollStatus === "paid")
        .length,
    }),
    [dedupedShifts],
  );

  const filteredLedgerShifts = useMemo(() => {
    const normalizedLedgerSearch = ledgerSearchTerm.trim().toLowerCase();

    return dedupedShifts.filter((shift) => {
      const matchesLedgerFilter =
        ledgerFilter === "all"
          ? true
          : ledgerFilter === "live"
            ? shift.isOpen
            : ledgerFilter === "pending"
              ? shift.isOpen ||
                shift.verificationStatus === "pending" ||
                shift.verificationStatus === "needs_attention"
              : ledgerFilter === "verified"
                ? shift.verificationStatus === "verified" &&
                  shift.payrollStatus !== "paid"
                : shift.payrollStatus === "paid";

      if (!matchesLedgerFilter) {
        return false;
      }

      if (ledgerSourceFilter !== "all" && shift.type !== ledgerSourceFilter) {
        return false;
      }

      if (normalizedLedgerSearch.length === 0) {
        return true;
      }

      const sourceLabel = shift.type === "manual" ? "manual" : "attendance";
      const searchHaystack = [
        shift.employeeName,
        shift.date,
        formatDateKeyLabel(shift.date),
        sourceLabel,
        getVerificationLabel(shift),
        shift.payrollStatus === "paid" ? "paid" : "unpaid",
        shift.paidPeriodLabel ?? "",
        shift.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return searchHaystack.includes(normalizedLedgerSearch);
    });
  }, [dedupedShifts, ledgerFilter, ledgerSearchTerm, ledgerSourceFilter]);

  const stats = useMemo(
    () => ({
      scheduledToday: visibleSchedules.filter(
        (schedule) => schedule.date === todayKey,
      ).length,
      clockedIn: employees.filter(
        (employee) => employee.status === "clocked_in",
      ).length,
      openExceptions: openExceptions.length,
      finalizedToday: dedupedShifts.filter(
        (shift) =>
          shift.date === todayKey && shift.verificationStatus === "verified",
      ).length,
    }),
    [
      dedupedShifts,
      employees,
      openExceptions.length,
      todayKey,
      visibleSchedules,
    ],
  );

  const scheduleHoursPreview = useMemo(() => {
    if (
      !scheduleForm.shiftDate ||
      !scheduleForm.startTime ||
      !scheduleForm.endTime
    ) {
      return 0;
    }

    return calculateLocalTimeRangeHours(
      scheduleForm.startTime,
      scheduleForm.endTime,
    );
  }, [scheduleForm.endTime, scheduleForm.shiftDate, scheduleForm.startTime]);

  const selectedScheduleDates = useMemo(() => {
    if (!scheduleForm.shiftDate) {
      return [];
    }

    if (scheduleForm.scheduleId || !scheduleForm.isRecurring) {
      return [scheduleForm.shiftDate];
    }

    const selectedWeekdays = new Set(scheduleForm.repeatWeekdays);

    return listDateKeysBetween(scheduleForm.shiftDate, scheduleForm.endDate)
      .filter((dateKey) => {
        const weekday = getDateKeyWeekday(dateKey);
        return weekday !== null && selectedWeekdays.has(weekday);
      })
      .sort((left, right) => left.localeCompare(right));
  }, [
    scheduleForm.endDate,
    scheduleForm.isRecurring,
    scheduleForm.repeatWeekdays,
    scheduleForm.scheduleId,
    scheduleForm.shiftDate,
  ]);

  const selectedManualEntryDates = useMemo(() => {
    if (!manualEntryForm.entryDate) {
      return [];
    }

    if (!manualEntryForm.isRecurring) {
      return [manualEntryForm.entryDate];
    }

    const selectedWeekdays = new Set(manualEntryForm.repeatWeekdays);

    return listDateKeysBetween(
      manualEntryForm.entryDate,
      manualEntryForm.endDate,
    )
      .filter((dateKey) => {
        const weekday = getDateKeyWeekday(dateKey);
        return weekday !== null && selectedWeekdays.has(weekday);
      })
      .sort((left, right) => left.localeCompare(right));
  }, [
    manualEntryForm.endDate,
    manualEntryForm.entryDate,
    manualEntryForm.isRecurring,
    manualEntryForm.repeatWeekdays,
  ]);

  const selectedResolutionException = useMemo(
    () =>
      openExceptions.find(
        (exception) => exception.id === resolutionForm.exceptionId,
      ) ?? null,
    [openExceptions, resolutionForm.exceptionId],
  );

  const handleVerifyShift = useCallback(
    async (shift: ShiftEntry) => {
      setIsSubmitting(true);
      setActiveShiftId(shift.id);

      try {
        const response = await fetch("/api/shifts", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "verify_entry",
            shiftId: shift.id,
          }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to finalize shift");
        }

        await loadShiftData();
        showNotify(
          "success",
          `${shift.employeeName}'s attendance was finalized`,
        );
      } catch (error) {
        console.error(error);
        showNotify(
          "error",
          error instanceof Error ? error.message : "Failed to finalize shift",
        );
      } finally {
        setIsSubmitting(false);
        setActiveShiftId(null);
      }
    },
    [loadShiftData, showNotify],
  );

  const openManualEntryModal = useCallback(
    (employeeId?: string) => {
      setManualEntryForm({
        ...createDefaultManualEntryForm(todayKey),
        employeeId: employeeId ?? "",
      });
      setIsManualEntryModalOpen(true);
    },
    [todayKey],
  );

  const openShiftEditModal = useCallback(
    (shift: ShiftEntry) => {
      setEditingShiftId(shift.id);
      setManualEntryForm({
        employeeId: shift.employeeId,
        entryDate: shift.date,
        endDate: shift.date,
        isRecurring: false,
        startTime:
          toTimeInputValueInTimeZone(shift.clockInAt, timeZone) ||
          DEFAULT_START_TIME,
        endTime: shift.clockOutAt
          ? toTimeInputValueInTimeZone(shift.clockOutAt, timeZone) ||
            DEFAULT_END_TIME
          : DEFAULT_END_TIME,
        notes: shift.notes ?? "",
        repeatWeekdays: getDefaultRepeatWeekdays(shift.date),
      });
      setIsManualEntryModalOpen(true);
    },
    [timeZone],
  );

  const closeScheduleModal = useCallback(() => {
    setIsScheduleModalOpen(false);
    setScheduleForm(createDefaultScheduleForm(todayKey));
  }, [todayKey]);

  const closeManualEntryModal = useCallback(() => {
    setIsManualEntryModalOpen(false);
    setEditingShiftId(null);
    setManualEntryForm(createDefaultManualEntryForm(todayKey));
  }, [todayKey]);

  const closeResolutionModal = useCallback(() => {
    setIsResolutionModalOpen(false);
    setResolutionForm(createDefaultResolutionForm());
  }, []);

  const handleManualEntrySave = useCallback(async () => {
    if (!manualEntryForm.employeeId) {
      showNotify("error", "Please select an employee");
      return;
    }

    if (selectedManualEntryDates.length === 0) {
      showNotify("error", "Choose at least one day for the manual entry");
      return;
    }

    const entryWindows = selectedManualEntryDates.map((entryDate) => ({
      entryDate,
      startTime: manualEntryForm.startTime,
      endTime: manualEntryForm.endTime,
    }));

    if (
      !manualEntryForm.startTime ||
      !manualEntryForm.endTime ||
      entryWindows.some((window) => !window.startTime || !window.endTime)
    ) {
      showNotify("error", "Enter a valid start and end time");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/shifts", {
        method: editingShiftId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: editingShiftId ? "update_entry" : "manual_entry",
          employeeId: manualEntryForm.employeeId,
          ...(editingShiftId
            ? {
                shiftId: editingShiftId,
                entryDate: entryWindows[0].entryDate,
                startTime: entryWindows[0].startTime,
                endTime: entryWindows[0].endTime,
              }
            : { entryWindows }),
          notes: manualEntryForm.notes.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save manual shift");
      }

      await loadShiftData();
      showNotify(
        "success",
        editingShiftId
          ? "Shift was updated and returned to pending review"
          : selectedManualEntryDates.length === 1
            ? "Manual shift was saved and verified immediately"
            : `${selectedManualEntryDates.length} manual shifts were saved and verified immediately`,
      );
      setManualEntryForm(createDefaultManualEntryForm(todayKey));
      setIsManualEntryModalOpen(false);
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error ? error.message : "Failed to save manual shift",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    loadShiftData,
    editingShiftId,
    manualEntryForm,
    selectedManualEntryDates,
    showNotify,
    todayKey,
  ]);

  const openScheduleModal = useCallback(
    (schedule?: ShiftSchedule) => {
      if (!schedule) {
        setScheduleForm(createDefaultScheduleForm(todayKey));
        setIsScheduleModalOpen(true);
        return;
      }

      setScheduleForm({
        scheduleId: schedule.id,
        employeeId: schedule.employeeId,
        shiftDate: schedule.date,
        endDate: schedule.date,
        isRecurring: false,
        startTime:
          toTimeInputValueInTimeZone(schedule.startAt, timeZone) ||
          DEFAULT_START_TIME,
        endTime:
          toTimeInputValueInTimeZone(schedule.endAt, timeZone) ||
          DEFAULT_END_TIME,
        breakMinutes: String(schedule.breakMinutes),
        notes: schedule.notes ?? "",
        repeatWeekdays: getDefaultRepeatWeekdays(schedule.date),
      });
      setIsScheduleModalOpen(true);
    },
    [timeZone, todayKey],
  );

  const handleScheduleSave = useCallback(async () => {
    if (!scheduleForm.employeeId) {
      showNotify("error", "Please select an employee");
      return;
    }

    if (selectedScheduleDates.length === 0) {
      showNotify(
        "error",
        scheduleForm.scheduleId
          ? "Choose a valid schedule date"
          : "Choose at least one day to publish",
      );
      return;
    }

    const scheduleWindows = selectedScheduleDates.map((shiftDate) => ({
      shiftDate,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
    }));

    if (
      !scheduleForm.startTime ||
      !scheduleForm.endTime ||
      scheduleWindows.some((window) => !window.startTime || !window.endTime)
    ) {
      showNotify("error", "Enter a valid start and end time");
      return;
    }

    setIsSubmitting(true);
    setActiveScheduleId(scheduleForm.scheduleId ?? scheduleForm.employeeId);

    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save_schedule",
          scheduleId: scheduleForm.scheduleId,
          employeeId: scheduleForm.employeeId,
          scheduleWindows,
          breakMinutes: Number(scheduleForm.breakMinutes || "0"),
          notes: scheduleForm.notes.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save schedule");
      }

      await loadShiftData();
      showNotify(
        "success",
        scheduleForm.scheduleId
          ? "Shift schedule updated"
          : selectedScheduleDates.length === 1
            ? "Shift schedule published"
            : `${selectedScheduleDates.length} shift schedules published`,
      );
      setScheduleForm(createDefaultScheduleForm(todayKey));
      setIsScheduleModalOpen(false);
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error ? error.message : "Failed to save schedule",
      );
    } finally {
      setIsSubmitting(false);
      setActiveScheduleId(null);
    }
  }, [
    loadShiftData,
    scheduleForm,
    selectedScheduleDates,
    showNotify,
    todayKey,
  ]);

  const handleScheduleDelete = useCallback(
    async (schedule: ShiftSchedule) => {
      setIsSubmitting(true);
      setActiveScheduleId(schedule.id);

      try {
        const response = await fetch("/api/shifts", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "delete_schedule",
            scheduleId: schedule.id,
          }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to delete schedule");
        }

        await loadShiftData();
        showNotify(
          "success",
          `${schedule.employeeName}'s schedule was removed`,
        );
      } catch (error) {
        console.error(error);
        showNotify(
          "error",
          error instanceof Error ? error.message : "Failed to delete schedule",
        );
      } finally {
        setIsSubmitting(false);
        setActiveScheduleId(null);
      }
    },
    [loadShiftData, showNotify],
  );

  const openResolutionModal = useCallback(
    (exception: AttendanceException) => {
      const matchingSchedule =
        schedules.find((schedule) => schedule.id === exception.scheduleId) ??
        schedules.find(
          (schedule) =>
            schedule.employeeId === exception.employeeId &&
            schedule.date === exception.date,
        ) ??
        null;
      const matchingShift =
        dedupedShifts.find((shift) => shift.id === exception.shiftId) ??
        dedupedShifts.find(
          (shift) =>
            shift.employeeId === exception.employeeId &&
            shift.date === exception.date,
        ) ??
        null;

      setResolutionForm({
        exceptionId: exception.id,
        employeeId: exception.employeeId,
        exceptionDate: exception.date,
        resolution: "resolved",
        startTime:
          (matchingShift?.clockInAt
            ? toTimeInputValueInTimeZone(matchingShift.clockInAt, timeZone)
            : "") ||
          (matchingSchedule?.startAt
            ? toTimeInputValueInTimeZone(matchingSchedule.startAt, timeZone)
            : ""),
        endTime:
          (matchingShift?.clockOutAt
            ? toTimeInputValueInTimeZone(matchingShift.clockOutAt, timeZone)
            : "") ||
          (matchingSchedule?.endAt
            ? toTimeInputValueInTimeZone(matchingSchedule.endAt, timeZone)
            : ""),
        notes: "",
        verifyShift:
          matchingShift?.verificationStatus === "verified" ? false : true,
      });
      setIsResolutionModalOpen(true);
    },
    [dedupedShifts, schedules, timeZone],
  );

  const handleResolveException = useCallback(async () => {
    if (!resolutionForm.exceptionId || !selectedResolutionException) {
      showNotify("error", "Select an exception to resolve");
      return;
    }

    setIsSubmitting(true);
    setActiveExceptionId(resolutionForm.exceptionId);

    try {
      const response = await fetch("/api/shifts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "resolve_exception",
          exceptionId: resolutionForm.exceptionId,
          resolution: resolutionForm.resolution,
          startTime: resolutionForm.startTime || undefined,
          endTime: resolutionForm.endTime || undefined,
          notes: resolutionForm.notes.trim() || undefined,
          verifyShift: resolutionForm.verifyShift,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Failed to resolve attendance exception",
        );
      }

      await loadShiftData();
      showNotify(
        "success",
        resolutionForm.resolution === "ignored"
          ? "Attendance exception was ignored"
          : "Attendance exception was resolved",
      );
      setResolutionForm(createDefaultResolutionForm());
      setIsResolutionModalOpen(false);
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to resolve attendance exception",
      );
    } finally {
      setIsSubmitting(false);
      setActiveExceptionId(null);
    }
  }, [loadShiftData, resolutionForm, selectedResolutionException, showNotify]);

  return (
    <>
      <Breadcrumb pageName="Shift Management" />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Scheduled Today",
            value: stats.scheduledToday,
            change: "Published",
            detail: "assigned shifts",
            tone: "blue" as const,
            icon: <CalendarDays className="h-5 w-5" />,
          },
          {
            label: "Currently Clocked In",
            value: stats.clockedIn,
            change: "Live",
            detail: "active attendance sessions",
            tone: "green" as const,
            icon: <LogIn className="h-5 w-5" />,
          },
          {
            label: "Pending Review",
            value: ledgerCounts.pending,
            change: "Needs review",
            detail: "shift records awaiting verification",
            tone: ledgerCounts.pending > 0 ? ("amber" as const) : ("green" as const),
            icon: <CheckCircle2 className="h-5 w-5" />,
          },
          {
            label: "Finalized Today",
            value: stats.finalizedToday,
            change: "Payroll ready",
            detail: "cleared attendance records",
            tone: "violet" as const,
            icon: <CheckCircle2 className="h-5 w-5" />,
          },
        ].map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="space-y-6">
        <SectionCard
          title="Live Staff Status"
          description="Monitor current shift status and attendance records."
          action={
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" />
              <input
                type="text"
                placeholder="Search staff..."
                className="rounded-lg border border-stroke bg-transparent py-1.5 pl-9 pr-4 text-sm outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Hours Today</TableHead>
                  <TableHead>Payroll Hours</TableHead>
                  <TableHead>Exceptions</TableHead>
                  <TableHead>Last Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingData ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading live shift data...
                    </TableCell>
                  </TableRow>
                ) : filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      {employees.length === 0
                        ? "No staff records are available for shift tracking."
                        : "No staff match the current search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((employee) => {
                    const openExceptionCount =
                      openExceptionCountByEmployee.get(employee.id) ??
                      employee.openExceptionCount;
                    const scheduledTodayCount =
                      scheduledTodayCountByEmployee.get(employee.id) ?? 0;

                    return (
                      <TableRow key={employee.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-2 dark:bg-dark-3">
                              <User className="h-5 w-5 text-dark-5" />
                            </div>
                            <div>
                              <p className="font-semibold text-dark dark:text-white">
                                {employee.name}
                              </p>
                              <p className="text-xs text-dark-5 dark:text-dark-6">
                                {formatRoleLabel(employee.role)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={
                              employee.status === "clocked_in"
                                ? "green"
                                : "slate"
                            }
                          >
                            {employee.status === "clocked_in"
                              ? "Clocked In"
                              : "Clocked Out"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-sm text-dark dark:text-white">
                          {scheduledTodayCount > 0
                            ? `${scheduledTodayCount} today`
                            : "Off"}
                        </TableCell>
                        <TableCell className="font-semibold text-primary">
                          {employee.hoursToday.toFixed(2)}h
                        </TableCell>
                        <TableCell className="text-sm text-dark dark:text-white">
                          {typeof employee.currentPayrollHours === "number" ? (
                            <div>
                              <div className="font-semibold text-dark dark:text-white">
                                {employee.currentPayrollHours.toFixed(2)}h
                              </div>
                              <div className="text-xs text-dark-5 dark:text-dark-6">
                                {employee.currentPayrollPeriodLabel ??
                                  "Current payroll"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-dark-5 dark:text-dark-6">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={openExceptionCount > 0 ? "amber" : "green"}
                          >
                            {openExceptionCount > 0
                              ? `${openExceptionCount} open`
                              : "Clear"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                          {employee.lastActionAt
                            ? actionFormatter.format(
                                new Date(employee.lastActionAt),
                              )
                            : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Published Schedule"
          description="Assign one scheduled shift per employee per day. Attendance exceptions are derived from these records."
          action={
            <button
              onClick={() => openScheduleModal()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Publish Shift
            </button>
          }
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Break</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingData ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading schedules...
                    </TableCell>
                  </TableRow>
                ) : visibleSchedules.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      No shift schedules are available yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleSchedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="text-sm font-medium text-dark-5 dark:text-dark-6">
                        {formatDateKeyLabel(schedule.date)}
                      </TableCell>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {schedule.employeeName}
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
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openScheduleModal(schedule)}
                            disabled={isSubmitting}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stroke text-dark transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:text-dark-6"
                            aria-label="Edit schedule"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => void handleScheduleDelete(schedule)}
                            disabled={isSubmitting}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red/30 text-red transition hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Delete schedule"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
          title="Shift Ledger"
          description="Filter attendance by Live, Pending, Verified, and Paid while keeping manual retro entries under admin control."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { key: "all", label: "All", count: ledgerCounts.all },
                  { key: "live", label: "Live", count: ledgerCounts.live },
                  {
                    key: "pending",
                    label: "Pending",
                    count: ledgerCounts.pending,
                  },
                  {
                    key: "verified",
                    label: "Verified",
                    count: ledgerCounts.verified,
                  },
                  { key: "paid", label: "Paid", count: ledgerCounts.paid },
                ] as Array<{
                  key: LedgerFilter;
                  label: string;
                  count: number;
                }>
              ).map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setLedgerFilter(filter.key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    ledgerFilter === filter.key
                      ? "border-primary bg-primary text-white"
                      : "border-stroke text-dark hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                  }`}
                >
                  {filter.label}
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      ledgerFilter === filter.key
                        ? "bg-white/15"
                        : "bg-gray-2 text-dark-5 dark:bg-dark-3 dark:text-dark-6"
                    }`}
                  >
                    {filter.count}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => openManualEntryModal()}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Manual Entry
              </button>
            </div>
          }
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_180px_220px_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-dark-5 dark:text-dark-6" />
              <input
                value={ledgerSearchTerm}
                onChange={(event) => setLedgerSearchTerm(event.target.value)}
                className={`${INPUT_CLASSNAME} pl-10`}
                placeholder="Search employee, date, source, or status"
              />
            </label>

            <select
              value={ledgerHistoryRange}
              onChange={(event) =>
                setLedgerHistoryRange(event.target.value as LedgerHistoryRange)
              }
              className={INPUT_CLASSNAME}
            >
              {LEDGER_HISTORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={ledgerSourceFilter}
              onChange={(event) =>
                setLedgerSourceFilter(event.target.value as LedgerSourceFilter)
              }
              className={INPUT_CLASSNAME}
            >
              <option value="all">All sources</option>
              <option value="automatic">Attendance</option>
              <option value="manual">Manual</option>
            </select>

            <div className="flex items-center text-sm text-dark-5 dark:text-dark-6">
              Showing {filteredLedgerShifts.length} of {dedupedShifts.length}{" "}
              shifts
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingData ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading attendance logs...
                    </TableCell>
                  </TableRow>
                ) : filteredLedgerShifts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      {dedupedShifts.length === 0
                        ? "No attendance logs are available yet."
                        : "No shifts match the current search or filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLedgerShifts.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell className="text-sm font-medium text-dark-5 dark:text-dark-6">
                        {formatDateKeyLabel(shift.date)}
                      </TableCell>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {shift.employeeName}
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
                      <TableCell className="font-bold text-primary">
                        {shift.hours.toFixed(2)}h
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge tone={getVerificationTone(shift)}>
                            {getVerificationLabel(shift)}
                          </StatusBadge>
                          {shift.payrollStatus === "paid" ? (
                            <div className="text-xs text-green">
                              {shift.paidPeriodLabel
                                ? `Paid in ${shift.paidPeriodLabel}`
                                : "Paid"}
                            </div>
                          ) : shift.verificationStatus === "verified" ? (
                            <div className="text-xs text-dark-5 dark:text-dark-6">
                              Ready for payroll
                            </div>
                          ) : null}
                          {shift.verifiedAt ? (
                            <div className="text-xs text-dark-5 dark:text-dark-6">
                              {actionFormatter.format(
                                new Date(shift.verifiedAt),
                              )}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          {shift.payrollStatus !== "paid" ? (
                            <button
                              onClick={() => openShiftEditModal(shift)}
                              disabled={isSubmitting}
                              className="inline-flex min-w-[72px] items-center justify-center rounded-lg bg-primary/10 px-3 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Edit
                            </button>
                          ) : null}
                          {shift.verificationStatus === "pending" ? (
                            <button
                              onClick={() => void handleVerifyShift(shift)}
                              disabled={isSubmitting}
                              className="inline-flex min-w-[96px] items-center justify-center rounded-lg bg-green/10 px-3 py-1 text-xs font-bold text-green transition-colors hover:bg-green/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSubmitting && activeShiftId === shift.id
                                ? "Saving..."
                                : "Finalize"}
                            </button>
                          ) : shift.verificationStatus === "needs_attention" ? (
                            <button
                              onClick={() => {
                                const exception =
                                  openExceptions.find(
                                    (candidate) =>
                                      candidate.shiftId === shift.id,
                                  ) ??
                                  openExceptions.find(
                                    (candidate) =>
                                      candidate.employeeId === shift.employeeId &&
                                      candidate.date === shift.date,
                                  );

                                if (exception) {
                                  openResolutionModal(exception);
                                } else {
                                  openShiftEditModal(shift);
                                }
                              }}
                              disabled={isSubmitting}
                              className="inline-flex min-w-[82px] items-center justify-center rounded-lg bg-red/10 px-3 py-1 text-xs font-bold text-red transition-colors hover:bg-red/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Resolve
                            </button>
                          ) : (
                            <span className="text-xs text-dark-5 dark:text-dark-6">
                              {shift.verificationStatus === "verified"
                                ? "Complete"
                                : "Waiting"}
                            </span>
                          )}
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

      {isScheduleModalOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                scheduleForm.scheduleId
                  ? "Edit scheduled shift"
                  : "Publish scheduled shift"
              }
              className="modal-card-scroll max-w-xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-5 py-4 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    {scheduleForm.scheduleId
                      ? "Edit Scheduled Shift"
                      : "Publish Scheduled Shift"}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Schedules drive the exception queue and determine what
                    managers review before payroll finalization.
                  </p>
                </div>
                <button
                  onClick={closeScheduleModal}
                  className="app-icon-button"
                  aria-label="Close schedule dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto p-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Select Employee
                  </label>
                  <select
                    className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                    value={scheduleForm.employeeId}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        employeeId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose employee...</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </div>

                {scheduleForm.scheduleId ? null : (
                  <label className="flex items-start gap-3 rounded-lg border border-stroke px-4 py-3 text-sm text-dark dark:border-dark-3 dark:text-dark-6">
                    <input
                      type="checkbox"
                      checked={scheduleForm.isRecurring}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          isRecurring: event.target.checked,
                          endDate: event.target.checked
                            ? current.endDate >= current.shiftDate
                              ? current.endDate
                              : current.shiftDate
                            : current.shiftDate,
                          repeatWeekdays:
                            current.repeatWeekdays.length > 0
                              ? current.repeatWeekdays
                              : getDefaultRepeatWeekdays(current.shiftDate),
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                    />
                    <span>
                      Repeat this schedule across a date range. Leave this off
                      to publish a single shift.
                    </span>
                  </label>
                )}

                <div
                  className={
                    scheduleForm.scheduleId || !scheduleForm.isRecurring
                      ? ""
                      : "grid gap-4 md:grid-cols-2"
                  }
                >
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      {scheduleForm.scheduleId || !scheduleForm.isRecurring
                        ? "Date"
                        : "Start Date"}
                    </label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={scheduleForm.shiftDate}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          shiftDate: event.target.value,
                          endDate:
                            current.scheduleId || !current.isRecurring
                              ? event.target.value
                              : current.endDate >= event.target.value
                                ? current.endDate
                                : event.target.value,
                          repeatWeekdays: current.isRecurring
                            ? current.repeatWeekdays
                            : getDefaultRepeatWeekdays(event.target.value),
                        }))
                      }
                    />
                  </div>

                  {scheduleForm.scheduleId ||
                  !scheduleForm.isRecurring ? null : (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        End Date
                      </label>
                      <input
                        type="date"
                        min={scheduleForm.shiftDate}
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        value={scheduleForm.endDate}
                        onChange={(event) =>
                          setScheduleForm((current) => ({
                            ...current,
                            endDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>

                {scheduleForm.scheduleId || !scheduleForm.isRecurring ? null : (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Publish On
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_OPTIONS.map((option) => {
                        const isSelected = scheduleForm.repeatWeekdays.includes(
                          option.value,
                        );

                        return (
                          <button
                            type="button"
                            key={option.value}
                            onClick={() =>
                              setScheduleForm((current) => ({
                                ...current,
                                repeatWeekdays: isSelected
                                  ? current.repeatWeekdays.filter(
                                      (value) => value !== option.value,
                                    )
                                  : [
                                      ...current.repeatWeekdays,
                                      option.value,
                                    ].sort((left, right) => left - right),
                              }))
                            }
                            className={`inline-flex min-w-[64px] items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                              isSelected
                                ? "border-primary bg-primary text-white"
                                : "border-stroke text-dark hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      {selectedScheduleDates.length === 0
                        ? "Choose at least one weekday inside the selected date range."
                        : selectedScheduleDates.length === 1
                          ? `This will publish 1 shift on ${formatDateKeyLabel(
                              selectedScheduleDates[0],
                            )}.`
                          : `This will publish ${selectedScheduleDates.length} shifts from ${formatDateKeyLabel(
                              selectedScheduleDates[0],
                            )} through ${formatDateKeyLabel(
                              selectedScheduleDates[
                                selectedScheduleDates.length - 1
                              ],
                            )}.`}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Start Time
                    </label>
                    <input
                      type="time"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={scheduleForm.startTime}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      End Time
                    </label>
                    <input
                      type="time"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={scheduleForm.endTime}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          endTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={scheduleForm.notes}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Optional shift note"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Break (min)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={scheduleForm.breakMinutes}
                      onChange={(event) =>
                        setScheduleForm((current) => ({
                          ...current,
                          breakMinutes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-dark-5 dark:text-dark-6">
                  Scheduled duration:{" "}
                  <span className="font-semibold text-dark dark:text-white">
                    {scheduleHoursPreview > 0
                      ? `${scheduleHoursPreview.toFixed(2)} hours`
                      : "Invalid range"}
                  </span>
                  {crossesMidnight(scheduleForm.startTime, scheduleForm.endTime)
                    ? " • ends next day"
                    : ""}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={closeScheduleModal}
                    className="inline-flex items-center justify-center rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleScheduleSave()}
                    disabled={isSubmitting || employees.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    {isSubmitting && activeScheduleId
                      ? "Saving..."
                      : scheduleForm.scheduleId
                        ? "Update Schedule"
                        : selectedScheduleDates.length > 1
                          ? `Publish ${selectedScheduleDates.length} Shifts`
                          : "Publish Shift"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {isManualEntryModalOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={editingShiftId ? "Edit shift entry" : "Manual shift entry"}
              className="modal-card-scroll max-w-xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-5 py-4 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    {editingShiftId ? "Edit Shift Entry" : "Manual Shift Entry"}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {editingShiftId
                      ? "Update the recorded times or notes for this shift."
                      : "Create a retro shift, record yourself as the actor, and mark the entry verified immediately."}
                  </p>
                </div>
                <button
                  onClick={closeManualEntryModal}
                  className="app-icon-button"
                  aria-label="Close manual entry dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto p-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Employee
                  </label>
                  <select
                    className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                    value={manualEntryForm.employeeId}
                    onChange={(event) =>
                      setManualEntryForm((current) => ({
                        ...current,
                        employeeId: event.target.value,
                      }))
                    }
                    disabled={Boolean(editingShiftId)}
                  >
                    <option value="">Choose employee...</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </div>

                {!editingShiftId ? (
                <label className="flex items-start gap-3 rounded-lg border border-stroke px-4 py-3 text-sm text-dark dark:border-dark-3 dark:text-dark-6">
                  <input
                    type="checkbox"
                    checked={manualEntryForm.isRecurring}
                    onChange={(event) =>
                      setManualEntryForm((current) => ({
                        ...current,
                        isRecurring: event.target.checked,
                        endDate: event.target.checked
                          ? current.endDate >= current.entryDate
                            ? current.endDate
                            : current.entryDate
                          : current.entryDate,
                        repeatWeekdays:
                          current.repeatWeekdays.length > 0
                            ? current.repeatWeekdays
                            : getDefaultRepeatWeekdays(current.entryDate),
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                  />
                  <span>
                    Repeat this manual entry across a date range. Leave this off
                    to create one corrected shift.
                  </span>
                </label>
                ) : null}

                <div
                  className={
                    manualEntryForm.isRecurring
                      ? "grid gap-4 md:grid-cols-2"
                      : ""
                  }
                >
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      {manualEntryForm.isRecurring ? "Start Date" : "Date"}
                    </label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={manualEntryForm.entryDate}
                      onChange={(event) =>
                        setManualEntryForm((current) => ({
                          ...current,
                          entryDate: event.target.value,
                          endDate: current.isRecurring
                            ? current.endDate >= event.target.value
                              ? current.endDate
                              : event.target.value
                            : event.target.value,
                          repeatWeekdays: current.isRecurring
                            ? current.repeatWeekdays
                            : getDefaultRepeatWeekdays(event.target.value),
                        }))
                      }
                    />
                  </div>

                  {manualEntryForm.isRecurring ? (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        End Date
                      </label>
                      <input
                        type="date"
                        min={manualEntryForm.entryDate}
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        value={manualEntryForm.endDate}
                        onChange={(event) =>
                          setManualEntryForm((current) => ({
                            ...current,
                            endDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </div>

                {manualEntryForm.isRecurring ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Apply On
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_OPTIONS.map((option) => {
                        const isSelected =
                          manualEntryForm.repeatWeekdays.includes(option.value);

                        return (
                          <button
                            type="button"
                            key={option.value}
                            onClick={() =>
                              setManualEntryForm((current) => ({
                                ...current,
                                repeatWeekdays: isSelected
                                  ? current.repeatWeekdays.filter(
                                      (value) => value !== option.value,
                                    )
                                  : [
                                      ...current.repeatWeekdays,
                                      option.value,
                                    ].sort((left, right) => left - right),
                              }))
                            }
                            className={`inline-flex min-w-[64px] items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                              isSelected
                                ? "border-primary bg-primary text-white"
                                : "border-stroke text-dark hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      {selectedManualEntryDates.length === 0
                        ? "Choose at least one weekday inside the selected date range."
                        : selectedManualEntryDates.length === 1
                          ? `This will create 1 manual shift on ${formatDateKeyLabel(
                              selectedManualEntryDates[0],
                            )}.`
                          : `This will create ${selectedManualEntryDates.length} manual shifts from ${formatDateKeyLabel(
                              selectedManualEntryDates[0],
                            )} through ${formatDateKeyLabel(
                              selectedManualEntryDates[
                                selectedManualEntryDates.length - 1
                              ],
                            )}.`}
                    </p>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Start Time
                    </label>
                    <input
                      type="time"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={manualEntryForm.startTime}
                      onChange={(event) =>
                        setManualEntryForm((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      End Time
                    </label>
                    <input
                      type="time"
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      value={manualEntryForm.endTime}
                      onChange={(event) =>
                        setManualEntryForm((current) => ({
                          ...current,
                          endTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Notes
                  </label>
                  <textarea
                    rows={4}
                    className="w-full rounded-lg border border-stroke bg-transparent px-4 py-3 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                    value={manualEntryForm.notes}
                    onChange={(event) =>
                      setManualEntryForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Explain why this retro shift is being added."
                  />
                </div>

                <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-dark-5 dark:text-dark-6">
                  {editingShiftId
                    ? "Saving changes will return the shift to pending review."
                    : "Manual entries create a closed shift, preserve the audit trail, and bypass the live punch flow."}
                  {crossesMidnight(
                    manualEntryForm.startTime,
                    manualEntryForm.endTime,
                  )
                    ? " This entry will clock out on the next day."
                    : ""}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={closeManualEntryModal}
                    className="inline-flex items-center justify-center rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleManualEntrySave()}
                    disabled={isSubmitting || employees.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    {isSubmitting
                      ? "Saving..."
                      : selectedManualEntryDates.length > 1
                        ? `Save ${selectedManualEntryDates.length} Entries`
                        : editingShiftId
                          ? "Save Changes"
                          : "Save Manual Entry"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {isResolutionModalOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Resolve attendance exception"
              className="modal-card-scroll max-w-xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-5 py-4 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Resolve Attendance Exception
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {selectedResolutionException
                      ? formatExceptionDetail(selectedResolutionException, actionFormatter, timeFormatter)
                      : "Clear the issue, add corrected times if needed, and optionally finalize the shift."}
                  </p>
                </div>
                <button
                  onClick={closeResolutionModal}
                  className="app-icon-button"
                  aria-label="Close exception dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto p-5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      setResolutionForm((current) => ({
                        ...current,
                        resolution: "resolved",
                      }))
                    }
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      resolutionForm.resolution === "resolved"
                        ? "border-primary bg-primary text-white"
                        : "border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                    }`}
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() =>
                      setResolutionForm((current) => ({
                        ...current,
                        resolution: "ignored",
                      }))
                    }
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      resolutionForm.resolution === "ignored"
                        ? "border-primary bg-primary text-white"
                        : "border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                    }`}
                  >
                    Ignore
                  </button>
                </div>

                {resolutionForm.resolution === "resolved" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Corrected Start
                      </label>
                      <input
                        type="time"
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        value={resolutionForm.startTime}
                        onChange={(event) =>
                          setResolutionForm((current) => ({
                            ...current,
                            startTime: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Corrected End
                      </label>
                      <input
                        type="time"
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        value={resolutionForm.endTime}
                        onChange={(event) =>
                          setResolutionForm((current) => ({
                            ...current,
                            endTime: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Resolution Notes
                  </label>
                  <textarea
                    rows={4}
                    className="w-full rounded-lg border border-stroke bg-transparent px-4 py-3 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                    value={resolutionForm.notes}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Explain what changed or why this issue is being ignored."
                  />
                </div>

                {resolutionForm.resolution === "resolved" ? (
                  <div className="space-y-3">
                    {resolutionForm.startTime &&
                    resolutionForm.endTime &&
                    crossesMidnight(
                      resolutionForm.startTime,
                      resolutionForm.endTime,
                    ) ? (
                      <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-dark-5 dark:text-dark-6">
                        Corrected end time will be saved on the next day.
                      </div>
                    ) : null}
                    <label className="flex items-start gap-3 rounded-lg border border-stroke px-4 py-3 text-sm text-dark dark:border-dark-3 dark:text-dark-6">
                      <input
                        type="checkbox"
                        checked={resolutionForm.verifyShift}
                        onChange={(event) =>
                          setResolutionForm((current) => ({
                            ...current,
                            verifyShift: event.target.checked,
                          }))
                        }
                        className="mt-1 h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                      />
                      <span>
                        Finalize the shift after the exception is cleared if the
                        record is complete.
                      </span>
                    </label>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={closeResolutionModal}
                    className="inline-flex items-center justify-center rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleResolveException()}
                    disabled={isSubmitting || !resolutionForm.exceptionId}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting &&
                    activeExceptionId === resolutionForm.exceptionId
                      ? "Saving..."
                      : resolutionForm.resolution === "ignored"
                        ? "Ignore Exception"
                        : "Resolve Exception"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
